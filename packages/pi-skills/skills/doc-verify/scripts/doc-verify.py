#!/usr/bin/env python3
"""Mechanical checks for markdown documents (stdlib only).

Usage: doc-verify.py [--json] [--today YYYY-MM-DD] [--repo DIR] [--allow-repo DIR]... PATH...

Checks (code: level):
  broken-link, broken-anchor: relative links and #anchors that do not resolve
  unclosed-fence: a ``` fence that never closes
  future-front-matter-date: front matter date/created/updated is after today (error)
  filename-date-mismatch: YYYY-MM-DD filename prefix differs from front matter `date`
  future-date: ISO date after today with no deadline/plan wording on the line (warning)
  verified-against: front matter sha is malformed or does not resolve (error)
  verified-repo-not-allowed: `verified-repo` points outside the document's repo and is not listed
    with --allow-repo (error). Front matter is untrusted input, so it cannot pick any directory.
  verified-paths-empty: `verified-paths` is set but yields no paths, so staleness cannot be checked
  verified-paths-unchecked: `git diff` failed for the listed paths (for example a malformed pathspec)
  link-outside-repo: a relative link resolves outside the repo root, or the current directory
    when there is no repo, the current directory (warning; the target is neither probed nor opened)
  stale-evidence: files listed in `verified-paths` changed since `verified-against` (error)
  unconfirmed-assumptions: [assumed] tags remain (warning)
  no-provenance-tags: no [verified]/[inferred]/[assumed] tags (info)
  mermaid-syntax: `mmdc` rejected a mermaid block (error); mermaid-unavailable when mmdc itself
    could not run or timed out (warning); mermaid-not-checked when mmdc is absent (info)

Exit: 0 when there are no errors, 1 when any error, 2 on usage problems.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.parse

ISO_DATE = re.compile(r"\b(\d{4})-(\d{2})-(\d{2})\b")
LINK = re.compile(r"(?<!\!)\[[^\]\n]*\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)")
FENCE_RUN = re.compile(r"^\s{0,3}(`{3,}|~{3,})(.*)$")
INLINE_CODE = re.compile(r"`[^`\n]*`")
PLAN_WORDS = re.compile(
    r"deadline|due|target|go-?live|launch|release|\bby\b|\beta\b|planned|scheduled|expected|until|"
    r"starts?|expires?|renew|sunset|milestone|\bq[1-4]\b|freeze|cutover|review on|next review",
    re.I,
)
TAGS = {
    "verified": re.compile(r"\[verified\]", re.I),
    "inferred": re.compile(r"\[inferred\]", re.I),
    "assumed": re.compile(r"\[assumed\]", re.I),
}


def strip_inline_comment(value: str) -> str:
    """Drop a trailing ` # comment` that is outside quotes (YAML comment rule: `#` after a space)."""
    quote = ""
    for index, char in enumerate(value):
        if quote:
            if char == quote:
                quote = ""
        elif char in "'\"":
            quote = char
        elif char == "#" and (index == 0 or value[index - 1] in " \t"):
            return value[:index].rstrip()
    return value.strip()


def unquote(value: str) -> str:
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"":
        return value[1:-1]
    return value


def parse_front_matter(lines: list[str]) -> tuple[dict[str, str], int]:
    if not lines or lines[0].strip() != "---":
        return {}, 0
    data: dict[str, str] = {}
    for index in range(1, len(lines)):
        if lines[index].strip() == "---":
            return data, index + 1
        match = re.match(r"^([A-Za-z0-9_-]+):\s*(.*)$", lines[index])
        if match:
            data[match.group(1).lower()] = strip_inline_comment(match.group(2))
    return {}, 0


def parse_list(value: str) -> list[str]:
    """Parse `[a, "b", 'c']` or `a, b` into items with quotes and blanks removed."""
    inner = value.strip()
    if inner.startswith("[") and inner.endswith("]"):
        inner = inner[1:-1]
    return [unquote(item) for item in inner.split(",") if unquote(item)]


SHA_PATTERN = re.compile(r"^[0-9a-fA-F]{7,64}$")


class FenceTracker:
    """Tracks fenced code blocks: a fence closes only on the same character, at least as long,
    with no info string. Shared by heading and link scanning so both agree on what is code."""

    def __init__(self) -> None:
        self.open = False
        self.char = ""
        self.length = 0
        self.info = ""

    def feed(self, line: str) -> str:
        """Return 'open', 'close', 'inside' (a line within a block) or 'text'."""
        fence = FENCE_RUN.match(line)
        if not self.open:
            if fence:
                self.open, self.char, self.length = True, fence.group(1)[0], len(fence.group(1))
                self.info = fence.group(2).strip().lower()
                return "open"
            return "text"
        if fence and fence.group(1)[0] == self.char and len(fence.group(1)) >= self.length and not fence.group(2).strip():
            self.open = False
            return "close"
        return "inside"


def slugify(heading: str) -> str:
    text = re.sub(r"[`*_~]", "", heading.strip().lower())
    text = re.sub(r"[^\w\s-]", "", text)
    return re.sub(r"\s+", "-", text).strip("-")


def heading_slugs(path: str) -> set[str]:
    slugs: set[str] = set()
    counts: dict[str, int] = {}
    fences = FenceTracker()
    try:
        with open(path, encoding="utf-8", errors="replace") as handle:
            for line in handle:
                state = fences.feed(line.rstrip("\n"))
                match = re.match(r"^#{1,6}\s+(.*?)\s*#*\s*$", line) if state == "text" else None
                if match:
                    base = slugify(match.group(1))
                    seen = counts.get(base, 0)
                    counts[base] = seen + 1
                    slugs.add(base if seen == 0 else f"{base}-{seen}")
    except OSError:
        pass
    return slugs


def git(repo: str, *args: str) -> tuple[int, str]:
    try:
        proc = subprocess.run(
            ["git", "-c", "safe.bareRepository=explicit", "-C", repo, *args],
            capture_output=True,
            text=True,
            timeout=60,
        )
    except FileNotFoundError:
        return 127, "git is not installed"
    except subprocess.TimeoutExpired:
        return 124, "git timed out"
    return proc.returncode, (proc.stdout + proc.stderr).strip()


def inside(root: str, target: str) -> bool:
    """True when `target` is within `root`. The text is checked first, so an outside target is
    rejected without any filesystem access (realpath would stat every component, which can wake
    autofs mounts or hang on a dead network share); only a lexically inside target is resolved."""
    root_real = os.path.realpath(root)
    normalised = os.path.normpath(os.path.abspath(target))
    if os.path.commonpath([root_real, normalised]) != root_real:
        # `root` itself may be reached through a symlink (for example /tmp -> /private/tmp):
        # compare against the text of the unresolved root too before giving up.
        root_text = os.path.normpath(os.path.abspath(root))
        if os.path.commonpath([root_text, normalised]) != root_text:
            return False
    target_real = os.path.realpath(target)
    return os.path.commonpath([root_real, target_real]) == root_real


def repo_root(start: str) -> str | None:
    code, out = git(start, "rev-parse", "--show-toplevel")
    return out if code == 0 else None


def check_file(path: str, today: dt.date, repo_override: str | None, allowed_repos: list[str]) -> list[dict]:
    findings: list[dict] = []

    def add(line: int, level: str, code: str, message: str) -> None:
        findings.append({"path": path, "line": line, "level": level, "code": code, "message": message})

    with open(path, encoding="utf-8", errors="replace") as handle:
        lines = handle.read().split("\n")

    directory = os.path.dirname(os.path.abspath(path))
    root = repo_override or repo_root(directory)
    front, body_start = parse_front_matter(lines)

    for key in ("date", "created", "updated"):
        value = front.get(key, "")
        match = ISO_DATE.search(value)
        if match:
            try:
                if dt.date(int(match.group(1)), int(match.group(2)), int(match.group(3))) > today:
                    add(1, "error", "future-front-matter-date", f"front matter {key}: {value} is after today ({today})")
            except ValueError:
                add(1, "error", "future-front-matter-date", f"front matter {key}: {value} is not a valid date")
    name_match = re.match(r"^(\d{4}-\d{2}-\d{2})-", os.path.basename(path))
    if name_match and front.get("date") and name_match.group(1) not in front["date"]:
        add(1, "warning", "filename-date-mismatch", f"filename date {name_match.group(1)} differs from front matter date {front['date']}")

    sha = front.get("verified-against", "")
    if sha:
        sha = unquote(sha)
        declared_repo = unquote(front.get("verified-repo", ""))
        target_repo = declared_repo or root
        denied = False
        if declared_repo:
            target_repo = os.path.normpath(os.path.join(directory, declared_repo))
            permitted = (root is not None and inside(root, target_repo)) or any(
                os.path.realpath(target_repo) == os.path.realpath(allowed) for allowed in allowed_repos
            )
            if not permitted:
                add(1, "error", "verified-repo-not-allowed", f"verified-repo {declared_repo} is outside this repo; pass --allow-repo {target_repo} to permit it")
                denied = True
        if not SHA_PATTERN.match(sha):
            add(1, "error", "verified-against", f"verified-against {sha!r} is not a 7-64 character hex commit id")
        elif denied:
            pass
        elif not target_repo or not os.path.isdir(target_repo):
            add(1, "error", "verified-against", "verified-against set but no git repo found (set verified-repo)")
        else:
            code, out = git(target_repo, "cat-file", "-e", f"{sha}^{{commit}}")
            if code != 0:
                add(1, "error", "verified-against", f"commit {sha} not found in {target_repo}" + (f" ({out})" if code in (124, 127) else ""))
            else:
                paths = parse_list(front.get("verified-paths", ""))
                if "verified-paths" in front and not paths:
                    add(1, "warning", "verified-paths-empty", "verified-paths is set but empty, so staleness is not checked")
                if paths:
                    code, out = git(target_repo, "diff", "--name-only", f"{sha}..HEAD", "--", *paths)
                    if code != 0:
                        add(1, "warning", "verified-paths-unchecked", f"git diff failed, staleness not checked: {out[:160]}")
                    changed = [line for line in out.split("\n") if line.strip()] if code == 0 else []
                    if changed:
                        add(1, "error", "stale-evidence", f"{len(changed)} file(s) changed since {sha[:10]}: " + ", ".join(changed[:5]))

    fences = FenceTracker()
    fence_open_line = 0
    fence_buf: list[str] = []
    mermaid_blocks: list[tuple[int, str]] = []
    tag_counts = {name: 0 for name in TAGS}
    own_slugs: set[str] | None = None

    for offset, raw in enumerate(lines[body_start:], start=body_start + 1):
        state = fences.feed(raw)
        if state == "open":
            fence_open_line, fence_buf = offset, []
            continue
        if state == "inside":
            fence_buf.append(raw)
            continue
        if state == "close":
            if fences.info.startswith("mermaid"):
                mermaid_blocks.append((fence_open_line, "\n".join(fence_buf)))
            continue

        prose = INLINE_CODE.sub("", raw)
        for name, pattern in TAGS.items():
            tag_counts[name] += len(pattern.findall(prose))

        for match in LINK.finditer(prose):
            target = urllib.parse.unquote(match.group(1).strip("<>"))
            if re.match(r"^[a-z][a-z0-9+.-]*:", target, re.I):
                continue
            file_part, _, fragment = target.partition("#")
            file_part = file_part.split("?")[0]
            if file_part == "" and not fragment:
                continue
            if file_part == "":
                resolved = os.path.abspath(path)
            elif file_part.startswith("/"):
                resolved = os.path.join(root or directory, file_part.lstrip("/"))
            else:
                resolved = os.path.normpath(os.path.join(directory, file_part))
            # Targets outside the boundary (repo root, else the document's own directory) are
            # reported without touching the filesystem: no existence probing, no file opened.
            if not inside(root or os.getcwd(), resolved):
                add(offset, "warning", "link-outside-repo", f"{target} resolves outside the repo root; the link breaks when the document moves and was not checked")
            elif not os.path.exists(resolved):
                add(offset, "error", "broken-link", f"{target} does not exist")
            elif fragment and resolved.lower().endswith(".md"):
                slugs = own_slugs if resolved == os.path.abspath(path) and own_slugs else heading_slugs(resolved)
                if resolved == os.path.abspath(path):
                    own_slugs = slugs
                if slugify(fragment.replace("-", " ")) not in slugs and fragment.lower() not in slugs:
                    add(offset, "warning", "broken-anchor", f"#{fragment} is not a heading in {os.path.relpath(resolved, directory)}")

        for match in ISO_DATE.finditer(prose):
            try:
                when = dt.date(int(match.group(1)), int(match.group(2)), int(match.group(3)))
            except ValueError:
                continue
            if when > today and not PLAN_WORDS.search(prose):
                add(offset, "warning", "future-date", f"{when} is after today ({today}) with no plan/deadline wording")

    if fences.open:
        add(fence_open_line, "error", "unclosed-fence", "code fence is never closed")

    if tag_counts["assumed"]:
        add(1, "warning", "unconfirmed-assumptions", f"{tag_counts['assumed']} [assumed] claim(s) still unconfirmed")
    if not any(tag_counts.values()):
        add(1, "info", "no-provenance-tags", "no [verified]/[inferred]/[assumed] tags")

    if mermaid_blocks:
        mmdc = shutil.which("mmdc")
        if not mmdc:
            add(mermaid_blocks[0][0], "info", "mermaid-not-checked", f"{len(mermaid_blocks)} mermaid block(s); install mmdc to validate")
        else:
            for start, source in mermaid_blocks:
                with tempfile.TemporaryDirectory() as tmp:
                    src, out = os.path.join(tmp, "d.mmd"), os.path.join(tmp, "d.svg")
                    with open(src, "w", encoding="utf-8") as handle:
                        handle.write(source)
                    try:
                        proc = subprocess.run([mmdc, "-i", src, "-o", out], capture_output=True, text=True, timeout=60)
                    except subprocess.TimeoutExpired:
                        add(start, "warning", "mermaid-unavailable", "mmdc timed out after 60s")
                        continue
                    if proc.returncode != 0:
                        detail = (proc.stderr or proc.stdout).strip()
                        first = detail.split("\n")[0][:200]
                        # Classify on the exit status and the first line only: mmdc echoes the
                        # diagram source after its message, so a diagram that merely contains a
                        # word such as "env:" or "Browser" must not turn a syntax error into
                        # an environment warning.
                        if proc.returncode in (126, 127) or re.search(r"puppeteer|chrom|sandbox|ENOENT|browser process|Failed to launch|command not found|No such file", first, re.I):
                            add(start, "warning", "mermaid-unavailable", f"mmdc could not run: {first}")
                        else:
                            add(start, "error", "mermaid-syntax", first or "mmdc failed")
    return findings


def collect(paths: list[str]) -> list[str]:
    files: list[str] = []
    for path in paths:
        if os.path.isdir(path):
            for current, dirs, names in os.walk(path):
                dirs[:] = [d for d in dirs if d not in {".git", "node_modules", ".worktrees"}]
                files += [os.path.join(current, n) for n in sorted(names) if n.endswith(".md")]
        elif os.path.isfile(path):
            files.append(path)
        else:
            print(f"doc-verify: no such path: {path}", file=sys.stderr)
            sys.exit(2)
    return files


def main() -> int:
    parser = argparse.ArgumentParser(add_help=True)
    parser.add_argument("paths", nargs="+")
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--today")
    parser.add_argument("--repo")
    parser.add_argument("--allow-repo", action="append", default=[], dest="allow_repo")
    args = parser.parse_args()
    try:
        today = dt.date.fromisoformat(args.today) if args.today else dt.date.today()
    except ValueError:
        print("doc-verify: --today must be YYYY-MM-DD", file=sys.stderr)
        return 2

    findings: list[dict] = []
    for file_path in collect(args.paths):
        try:
            findings += check_file(file_path, today, args.repo, args.allow_repo)
        except OSError as error:
            print(f"doc-verify: cannot read {file_path}: {error}", file=sys.stderr)
            return 2

    if args.json:
        print(json.dumps(findings, indent=2))
    else:
        for item in findings:
            print(f"{item['path']}:{item['line']}: {item['level']}: {item['code']}: {item['message']}")
        errors = sum(1 for f in findings if f["level"] == "error")
        warnings = sum(1 for f in findings if f["level"] == "warning")
        print(f"doc-verify: {errors} error(s), {warnings} warning(s)", file=sys.stderr)
    return 1 if any(f["level"] == "error" for f in findings) else 0


if __name__ == "__main__":
    sys.exit(main())
