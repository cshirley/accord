#!/usr/bin/env python3
"""Mechanical checks for markdown documents (stdlib only).

Usage: doc-verify.py [--json] [--today YYYY-MM-DD] [--repo DIR] PATH...

Checks (code: level):
  broken-link, broken-anchor: relative links and #anchors that do not resolve
  unclosed-fence: a ``` fence that never closes
  future-front-matter-date: front matter date/created/updated is after today (error)
  filename-date-mismatch: YYYY-MM-DD filename prefix differs from front matter `date`
  future-date: ISO date after today with no deadline/plan wording on the line (warning)
  verified-against: front matter sha does not resolve (error)
  stale-evidence: files listed in `verified-paths` changed since `verified-against` (error)
  unconfirmed-assumptions: [assumed] tags remain (warning)
  no-provenance-tags: no [verified]/[inferred]/[assumed] tags (info)
  mermaid-syntax: `mmdc` rejected a mermaid block (error); mermaid-not-checked when mmdc is absent (info)

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

ISO_DATE = re.compile(r"\b(\d{4})-(\d{2})-(\d{2})\b")
LINK = re.compile(r"(?<!\!)\[[^\]\n]*\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)")
FENCE = re.compile(r"^\s*(```|~~~)")
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


def parse_front_matter(lines: list[str]) -> tuple[dict[str, str], int]:
    if not lines or lines[0].strip() != "---":
        return {}, 0
    data: dict[str, str] = {}
    for index in range(1, len(lines)):
        if lines[index].strip() == "---":
            return data, index + 1
        match = re.match(r"^([A-Za-z0-9_-]+):\s*(.*)$", lines[index])
        if match:
            data[match.group(1).lower()] = match.group(2).strip().strip("'\"")
    return {}, 0


def slugify(heading: str) -> str:
    text = re.sub(r"[`*_~]", "", heading.strip().lower())
    text = re.sub(r"[^\w\s-]", "", text)
    return re.sub(r"\s+", "-", text).strip("-")


def heading_slugs(path: str) -> set[str]:
    slugs: set[str] = set()
    counts: dict[str, int] = {}
    in_fence = False
    try:
        with open(path, encoding="utf-8") as handle:
            for line in handle:
                if FENCE.match(line):
                    in_fence = not in_fence
                    continue
                match = None if in_fence else re.match(r"^#{1,6}\s+(.*?)\s*#*\s*$", line)
                if match:
                    base = slugify(match.group(1))
                    seen = counts.get(base, 0)
                    counts[base] = seen + 1
                    slugs.add(base if seen == 0 else f"{base}-{seen}")
    except OSError:
        pass
    return slugs


def git(repo: str, *args: str) -> tuple[int, str]:
    proc = subprocess.run(["git", "-C", repo, *args], capture_output=True, text=True)
    return proc.returncode, (proc.stdout + proc.stderr).strip()


def repo_root(start: str) -> str | None:
    code, out = git(start, "rev-parse", "--show-toplevel")
    return out if code == 0 else None


def check_file(path: str, today: dt.date, repo_override: str | None) -> list[dict]:
    findings: list[dict] = []

    def add(line: int, level: str, code: str, message: str) -> None:
        findings.append({"path": path, "line": line, "level": level, "code": code, "message": message})

    with open(path, encoding="utf-8") as handle:
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
        target_repo = front.get("verified-repo") or root
        if target_repo and not os.path.isabs(target_repo):
            target_repo = os.path.normpath(os.path.join(directory, target_repo))
        if not target_repo or not os.path.isdir(target_repo):
            add(1, "error", "verified-against", "verified-against set but no git repo found (set verified-repo)")
        else:
            code, _ = git(target_repo, "cat-file", "-e", f"{sha}^{{commit}}")
            if code != 0:
                add(1, "error", "verified-against", f"commit {sha} not found in {target_repo}")
            else:
                paths = [p.strip() for p in front.get("verified-paths", "").strip("[]").split(",") if p.strip()]
                if paths:
                    code, out = git(target_repo, "diff", "--name-only", f"{sha}..HEAD", "--", *paths)
                    changed = [line for line in out.split("\n") if line.strip()] if code == 0 else []
                    if changed:
                        add(1, "error", "stale-evidence", f"{len(changed)} file(s) changed since {sha[:10]}: " + ", ".join(changed[:5]))

    in_fence = False
    fence_open_line = 0
    fence_info = ""
    fence_buf: list[str] = []
    mermaid_blocks: list[tuple[int, str]] = []
    tag_counts = {name: 0 for name in TAGS}
    own_slugs: set[str] | None = None

    for offset, raw in enumerate(lines[body_start:], start=body_start + 1):
        fence = FENCE.match(raw)
        if fence:
            if not in_fence:
                in_fence, fence_open_line = True, offset
                fence_info = raw.strip()[3:].strip().lower()
                fence_buf = []
            else:
                in_fence = False
                if fence_info.startswith("mermaid"):
                    mermaid_blocks.append((fence_open_line, "\n".join(fence_buf)))
            continue
        if in_fence:
            fence_buf.append(raw)
            continue

        prose = INLINE_CODE.sub("", raw)
        for name, pattern in TAGS.items():
            tag_counts[name] += len(pattern.findall(prose))

        for match in LINK.finditer(prose):
            target = match.group(1).strip("<>")
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
            if not os.path.exists(resolved):
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

    if in_fence:
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
                    proc = subprocess.run([mmdc, "-i", src, "-o", out], capture_output=True, text=True)
                    if proc.returncode != 0:
                        first = (proc.stderr or proc.stdout).strip().split("\n")[0][:200]
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
    args = parser.parse_args()
    try:
        today = dt.date.fromisoformat(args.today) if args.today else dt.date.today()
    except ValueError:
        print("doc-verify: --today must be YYYY-MM-DD", file=sys.stderr)
        return 2

    findings: list[dict] = []
    for file_path in collect(args.paths):
        findings += check_file(file_path, today, args.repo)

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
