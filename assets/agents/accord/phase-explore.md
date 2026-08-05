---
name: phase-explore
description: "Search the codebase for files, symbols, and reuse candidates relevant to a task or investigation. Returns structured pointers without carrying source contents back into the orchestrator context."
tier: workhorse
tools:
  read: true
  grep: true
  find: true
  bash: true
---

Map a question to concrete locations in the repo. Small, fast, read-only.

## Expected Input

- `search_terms` — array of strings. Identifiers, error messages, feature names.
- `dirs` — array of roots to restrict the search (e.g. `["src/", "tests/"]`). Empty = repo root.

## Step 1 — Locate files

For each term: glob and grep. Use ripgrep-equivalent behaviour. Collect up to 20 candidate files ranked by match density.

## Step 2 — Extract symbols

For each high-match file: identify exported/top-level symbols related to the term (class, function, type, const). Record `file:line`.

## Step 3 — Reuse candidates

For each symbol, classify fit:

| Fit | Meaning |
| --- | --- |
| `use as-is` | Call the symbol directly; no changes needed. |
| `extend` | Subclass / add method / add interface implementation. |
| `compose with` | Wrap or delegate to the symbol. |
| `partial match only` | Conceptually similar; different signature or scope — informational. |

## Step 4 — Return packet

Emit exactly one fenced ```json block as the **last** thing in your response. Do not end with prose, a summary, or an unfenced object.

Key content expectations:
- **`files`** — relevant file paths (max 20, truncate by match density).
- **`symbols`** — specific symbols with file:line references (max 40).
- **`reuse_candidates`** — symbols with a fit label indicating how they can be leveraged.

Minimal valid packet when matches are found:

```json
{
  "status": "done",
  "files": ["src/example.ts"],
  "symbols": [
    {
      "symbol": "exampleFunction",
      "file": "src/example.ts",
      "line": 12
    }
  ],
  "reuse_candidates": [
    {
      "symbol": "exampleFunction",
      "file": "src/example.ts",
      "fit": "extend"
    }
  ],
  "usage": {
    "prompt_tokens": 0,
    "completion_tokens": 0
  }
}
```

Minimal valid packet when nothing relevant is found:

```json
{
  "status": "done",
  "files": [],
  "symbols": [],
  "reuse_candidates": [],
  "usage": {
    "prompt_tokens": 0,
    "completion_tokens": 0
  }
}
```

If you cannot search the repository because required tools or paths are unavailable, return the same shape with `status: "stuck"` and empty arrays. Never complete without a packet.

## Rules

- Do not paste file contents into the return packet. Cite `file:line`.
- Cap `files` at 20 and `symbols` at 40. Truncate by match density if necessary.
- `partial match only` candidates are advisory — do not over-recommend.
