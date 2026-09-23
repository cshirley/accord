---
name: phase-gather
description: "Gather upstream context for a work item — fetch the ticket from the configured tracker, enrich with supplementary sources (Slack, Docs, Confluence, etc.), cache enrichment content to disk, and emit a compact summary with cache references. Downstream phases read full content on demand."
tier: workhorse
tools:
  read: true
  grep: true
  find: true
  bash: true
  write: true
---

Produce the factual baseline every other phase builds on. Keep the return packet tight — summaries + cache references only. Full enrichment content is persisted to `.tasks/<ID>-enrichments/` for downstream phases to read on demand.

## Expected Input

- `work_item_id` (e.g. `ACCORD-1234`, `#42`, `ENG-789`). Format depends on the tracker provider.
- `tracker` (optional) — object with `type` and optional `project_prefix`. If omitted, infer from the ID format or default to `jira`.
- `description` (optional) — inline text from the user. Used as the sole source for `plain-text` provider, or as supplementary context for other providers.
- `context_sources` (optional) — array of enrichment source configs, pre-merged by the orchestrator from global `accord.json` + project AGENTS.md `context_sources`. Each entry has `type`, `enabled`, and source-specific scoping fields.
- `fresh` (optional, default false) — if true, bypass cache and re-fetch all enrichments.

## Step 1 — Resolve the primary provider

Determine which provider to use, in priority order:

1. **Explicit `tracker.type`** in the brief → use that provider.
2. **Infer from `work_item_id` format:**
   - `#<number>` or bare number + presence of `.git` in cwd → `github`
   - Standard `[A-Z]+(-[A-Z]+)*-\d+` key → `jira` (default)
3. **No ID + `description` present** → `plain-text`

Read the provider instructions and follow them for fetching. The orchestrator appends a **Provider Playbooks** block to your task with absolute paths for the active tracker and each enrichment provider — read from the path printed there. (Bundled providers also live at `providers/trackers/<type>.md` if no preflight block is supplied.)

## Step 2 — Fetch the ticket

Execute the fetch instructions from the provider file. Capture all available fields: summary, description, labels, parent/epic, linked issues, acceptance criteria, status.

If the fetch fails (MCP unavailable, CLI missing, ticket not found), check whether a `description` was provided in the brief:
- **Yes** → fall back to `plain-text` provider using the description.
- **No** → set `status: "done"` with `context` = "No ticket found and no description provided" and return early (skip enrichment).

## Step 3 — Prepare enrichment cache directory

```bash
mkdir -p .tasks/<ID>-enrichments
```

Where `<ID>` is the `work_item_id` (e.g. `.tasks/ACCORD-1234-enrichments/`).

## Step 4 — Enrich from supplementary sources

Two enrichment passes, run in parallel where possible:

### 4a — Check cache

Before fetching any enrichment, check for cached content:

1. List files in `.tasks/<ID>-enrichments/`.
2. For each potential enrichment, check if a cache file exists.
3. Read the cache file and check `fetched_at` + `ttl_hours`:
   - If `now < fetched_at + ttl_hours` **and** `fresh` is not true → **cache hit**. Use the cached `summary`, set `status: "cached"` in the return packet.
   - Otherwise → **cache miss**. Proceed to fetch.

### 4b — Configured sources (keyword search)

For each entry in `context_sources` where `enabled` is true (or omitted — default true) and cache missed:

1. Read the enrichment provider instructions from the path listed in the **Provider Playbooks** block of the preflight report (or `providers/enrichments/<type>.md` if no block is present).
2. Extract keyword search terms from the ticket: title/summary + labels + key noun phrases from the description.
3. Execute the keyword search using the scoping fields from the config (channels, space, folder_id, etc.).
4. Apply the context budget documented in the enrichment provider file.
5. **Write the cache file** (see §Cache file format below).

If `context_sources` is empty or not provided, skip this pass.

### 4c — URL-triggered enrichments

Scan the ticket body, linked issues, acceptance criteria, and the user's `description` (if provided) for URLs matching enrichment trigger patterns:

| Pattern | Enrichment type |
|---|---|
| `slack.com/archives/` | `slack` |
| `docs.google.com/document/` | `google-docs` |
| `*.atlassian.net/wiki/` or `*/confluence/` | `confluence` |
| `github.com/.*/pull/\d+` | `github-pr` |
| `github.com/.*/discussions/\d+` | `github-discussions` |
| `figma.com/(file\|design\|proto)/` | `figma` |

For each matched URL:
1. Check cache first (by filename derived from URL — see §Cache filename convention).
2. If cache hit → skip.
3. If already fetched in 4b and the specific URL is in those results → skip (deduplicate).
4. Read the enrichment provider playbook (path from the **Provider Playbooks** preflight block, or `providers/enrichments/<type>.md` as fallback) for URL-specific fetch instructions.
5. Fetch, apply context budget, and **write the cache file**.

### Cache file format

Each cache file is JSON with fields: `source`, `fetched_at` (ISO-8601), `ttl_hours`, `status` ("ok" | "cached" | "unavailable"), `url`, `title`, `summary`, `content` (full text, budget-capped), `metadata` (optional: `last_modified`, `key_sections[]`). For unavailable sources: include `reason` instead of `content`.

### Cache filename convention

Derive a stable, filesystem-safe filename from the source type + identifier:

| Source | Filename pattern | Example |
|---|---|---|
| `slack` | `slack-<channel_id>-<ts>.json` | `slack-C0123-1714234567.json` |
| `google-docs` | `google-docs-<doc_id>.json` | `google-docs-1abc_xyz.json` |
| `confluence` | `confluence-<page_id>.json` | `confluence-12345.json` |
| `github-pr` | `github-pr-<number>.json` | `github-pr-142.json` |
| `github-discussions` | `github-discussions-<number>.json` | `github-discussions-89.json` |
| `figma` | `figma-<file_key>.json` | `figma-XyZ123.json` |
| keyword search | `<type>-search-<hash>.json` | `slack-search-a3f8.json` |

For keyword search results (4b), use a short hash of the search query for the filename to enable cache invalidation when the ticket changes.

### Deduplication

If both passes return content from the same source document/message, keep the richer version (URL-triggered typically has more context than keyword search). When merging, overwrite the keyword-search cache file with the URL-triggered content.

### Enrichment failure handling

If an enrichment source is unavailable (no API token, MCP tool missing, service error):
- Write a cache file with `"status": "unavailable"` and `"reason"` — this prevents re-attempting the same failed source on the next run within the TTL window.
- Continue with remaining sources — enrichment failures never block the gather phase.

### TTL defaults

| Source | Default TTL |
|---|---|
| `slack` | 4 hours (messages are ephemeral) |
| `google-docs` | 24 hours |
| `confluence` | 24 hours |
| `github-pr` | 12 hours |
| `github-discussions` | 24 hours |
| `figma` | 48 hours (designs change infrequently) |
| unavailable | 1 hour (retry soon) |

## Step 5 — Extract file and symbol references

From the ticket body + linked issues + inline `description` (if provided) + enrichment `content` (from cache files or freshly fetched):

- Grep for file paths (e.g. `src/**/*.ts`, `pkg/auth/handler.go`)
- Extract class/function/type names in backticks
- Capture PR numbers or commit SHAs
- Deduplicate

## Step 6 — Return packet

Emit exactly one fenced ```json block as the **last** thing in your response. Do not end with prose, a summary, or an unfenced object.

Key content expectations:
- **`context`** — 2–4 sentence factual summary of what the ticket asks for and why. No opinions.
- **`files_mentioned`** — deduplicated file paths extracted from ticket + enrichments.
- **`enrichments`** array carries only **summaries and references**. Full content is in the `cache_path` files. Downstream phases read specific cache files when they need detail.
- **`enrichments_dir`** and **`enrichments`** are optional — omit entirely if no enrichment sources were configured or triggered.

Minimal valid `done` packet:

```json
{
  "status": "done",
  "context": "No ticket was available, but the user supplied enough inline context to continue.",
  "files_mentioned": [],
  "linked_issues": [],
  "usage": {
    "prompt_tokens": 0,
    "completion_tokens": 0
  }
}
```

Minimal valid `stuck` packet:

```json
{
  "status": "stuck",
  "context": "Unable to gather the requested work item context.",
  "question": "Which tracker or inline description should I use for this work item?",
  "context_on_stuck": "The configured provider could not fetch the work item and no fallback description was supplied.",
  "usage": {
    "prompt_tokens": 0,
    "completion_tokens": 0
  }
}
```

If no files, linked issues, or enrichments are found, still return `status: "done"` with empty arrays. If you cannot identify any primary context at all, return the `stuck` shape. Never complete without one of these packet shapes.

## Rules

- Do not speculate about implementation. Report what the ticket says, not what you would do.
- Do not read source files beyond confirming a referenced path exists.
- No opinions. The orchestrator and downstream phases produce judgements.
- If the provider file references an MCP tool that isn't available, fall back to CLI or API alternatives documented in the provider file before giving up.
- Respect context budgets from enrichment provider files. Total enrichment summaries in the return packet should not exceed ~1000 tokens. Full content in cache files follows the per-provider budget.
- Enrichment failures are silent — log them in the return packet and cache file but never fail the gather phase because of them.
- Always write cache files, even for failures (with `status: "unavailable"`) — this prevents re-attempting broken sources within the TTL.
