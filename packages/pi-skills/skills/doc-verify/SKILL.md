---
name: doc-verify
description: Check research, plan and design documents before sharing them — broken links, wrong or future dates, stale evidence, unclosed code fences, mermaid syntax, and claim provenance. Use when a markdown document is drafted, moved between repos, reviewed against changed code, or the user asks to verify that findings still hold.
---

# Doc verify

Mechanical checks plus a short judgement pass for markdown documents. It targets problems seen in research and planning documents: a wrong date on a plan, links broken after a move to another repo, findings that no longer hold after the code changed, and diagrams that do not render.

## Run

From this skill's directory (host-neutral; needs `python3` and `git`):

```bash
scripts/doc-verify.py [--json] [--today YYYY-MM-DD] [--repo DIR] PATH...
```

`PATH` is a file or a directory (walked for `*.md`; `.git`, `node_modules` and `.worktrees` are skipped). Exit 0 means no errors, 1 means at least one error, 2 means a usage problem.

| Code | Level | Meaning |
|------|-------|---------|
| `broken-link` | error | A relative link target does not exist. `/path` resolves from the repo root. |
| `broken-anchor` | warning | `#fragment` is not a heading in the target file. |
| `unclosed-fence` | error | A code fence never closes. |
| `future-front-matter-date` | error | Front matter `date`, `created` or `updated` is after today. |
| `filename-date-mismatch` | warning | A `YYYY-MM-DD-` filename prefix differs from front matter `date`. |
| `future-date` | warning | A date after today on a line with no deadline or plan wording. |
| `verified-against` | error | The `verified-against` commit does not resolve. |
| `stale-evidence` | error | Files in `verified-paths` changed since `verified-against`. |
| `unconfirmed-assumptions` | warning | `[assumed]` tags remain. |
| `no-provenance-tags` | info | No `[verified]`, `[inferred]` or `[assumed]` tags. |
| `mermaid-syntax` | error | `mmdc` rejected a mermaid block. `mermaid-not-checked` (info) when `mmdc` is absent. |

## Process

1. Run the script on the document, or on the folder when links cross files.
2. Fix every **error**. For each **warning**, fix it or state why it is correct.
3. **Provenance.** Tag each claim that drives a decision with `[verified]` (checked against a source you can name), `[inferred]` (derived, not directly observed) or `[assumed]` (not checked). Put the source next to `[verified]` claims. Ask the user to confirm every `[assumed]` claim before the document is final.
4. **Evidence freshness.** For a document that makes claims about code in a repo, add front matter:

   ```yaml
   ---
   date: 2026-10-29
   verified-against: <full or short commit sha>
   verified-repo: ../other-repo        # optional; default is the repo holding the document
   verified-paths: [src/auth, docs/api] # optional; enables stale-evidence
   ---
   ```

   After a rebase, a PR split or a repo move, re-run the script. A `stale-evidence` error means the cited files changed: re-check those claims, then update `verified-against`.
5. **Moved documents.** After moving a document to another repo, run the script. Fix broken links to point at the new location (for example the GitHub URL of the original repo) instead of deleting them.
6. **Dates.** Use today's date from the system clock (`date +%F`), not a remembered one. Plans, ADRs and meeting notes carry the date in front matter.
7. Report the result: counts by level, what you fixed, and any remaining warnings with the reason.

## Not covered

- The script does not check that a claim is true. Provenance tags show how well each claim was checked; the checking is your job.
- Mermaid is validated only when `mmdc` (mermaid-cli) is installed. Without it, render the diagram another way before sharing.
- Links to `http(s)` URLs are not fetched.

## Rules

- Never delete a link or a claim only to make the script pass.
- Do not change a `verified-against` sha until the affected claims are re-checked.
- Findings that earlier reviews raised need a second look after a PR stack changes: re-verify them against the final code and say which were mitigated by later changes.
