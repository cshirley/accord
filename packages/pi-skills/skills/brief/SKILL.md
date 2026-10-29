---
name: brief
description: Agree the problem, scope and key decisions with the user before building — a short alignment conversation that produces docs/dev/<ID>/brief.md, using a synthetic ADHOC id when there is no tracker ticket. Use when starting ad-hoc or ambiguous work, when the request is a short sentence with many open choices, or when the user says brief, align or scope.
---

# Brief

Shift decisions left: settle the problem, the boundaries and the choices **before** code exists. The brief is the grounding document for spec, plan and review. It follows the ACCORD `phase-align` shape, so the accord harness can continue from it.

Use it for work with no tracker ticket, or any change where earlier work needed "revert, too big", "wrong approach" or "you missed X".

## Modes

| Mode | When | How |
|------|------|-----|
| **Harness** | The `accord` CLI is installed and `AGENTS.md` has a `## Dev Harness` block | `accord bootstrap --adhoc -- '<title>'` prints a `Next:` line (usually `accord align <ID>`); run it |
| **Inline** | No accord CLI, or the user wants to stay in this conversation | Follow the process below and write the file yourself |

Check with `command -v accord`. In harness mode accord runs the alignment agent for you and writes `brief.md`. The rest of this skill covers inline mode and the checks that apply to both.

## ID

- **Real ticket exists:** use it (for example `STEP-123`).
- **No ticket:** use a synthetic id `ADHOC-<YYYYMMDD><NN>` (for example `ADHOC-2026102901`). Get it from `accord bootstrap --adhoc` (harness mode) or `scripts/adhoc-id.sh` (inline; path relative to this skill; it checks only `./.tasks` and `./docs/dev` of the current directory, so run it from the repo root). It matches the accord id pattern and is never looked up in a tracker.
- **Quote the title for the shell:** use single quotes and write an embedded `'` as `'\''`, or pass the title after `--`. Never put user text inside double quotes.
- The **title** must describe the work. Never use the id as the title: a ticket-shaped title makes align query the tracker for a ticket that does not exist.

## Process (inline mode)

1. **Prepare.** Get the id. Pin the worktree (`worktree` skill) when a ticket worktree exists. Read `AGENTS.md`, the files the request names, and at most 5 more files per round.
2. **Scout reuse.** Run the `reuse-scout` skill for the concerns involved. Keep its table for the brief.
3. **Round 1 — reflect, probe, check.** Send one message with three parts, nothing else:
   - **Reflect** (max 3): what you understand, with `file:line` references. Start with this, never with questions.
   - **Probe** (max 3): open questions about gaps, aimed at understanding ("how do users handle this today?"), not at filling a template.
   - **Check** (max 3): specific claims for the user to confirm or correct. Number them `am-1`, `am-2`, …

   Cover problem, stakeholders, current state and desired outcome first. Then the remaining dimensions in the template.
4. **Integrate** each answer: `confirmed`, `corrected` (rewrite the claim), or `contested` (becomes an open question). Add new `proposed` claims.
5. **Repeat** until the user signals readiness, the claims are stable and every dimension is covered or `n/a` with a reason. Stop after 5 rounds and list what is still open. Small, well-defined work converges in 1–2 rounds.
6. **Surface decisions.** Every choice you made that the user did not make goes in the **Decision and assumption ledger** as `UNCONFIRMED`. Ask about them before finalising; never leave one silently decided.
7. **Risk pass.** If the work touches personal or health data, a new region or partner, or a production rollout, run the `risk-checklist` skill and link its register from the brief.
8. **Write** `docs/dev/<ID>/brief.md` from [`template.md`](template.md) (this skill's directory), using today's date from `date +%F`. Replace every placeholder. Mark irrelevant dimensions `n/a` with a reason.
9. **Verify** with the `doc-verify` skill (links, dates, fences). Fix errors.
10. **Hand off.** Show the file path. Tell the user the next step:
    - accord harness: `accord plan resume <ID>` (it recovers from `brief.md`), then `accord spec <ID>`.
    - no harness: write the plan from the brief; keep the `Done means` list as the acceptance check.

## Rules

- Never invent requirements. Propose understanding; the user confirms scope.
- Never ask structured spec questions ("what is AC-1?"). Spec comes later.
- Cap each round: 3 reflections, 3 probes, 3 claims.
- Contested claims stay visible as open questions. Do not drop disagreements.
- The brief is Markdown only: no code changes, no spec JSON.
- The brief must stand alone. A reader with no other context should understand the problem, the boundaries, the current state and the agreed direction.
- Do not start implementation until the user has confirmed the brief and no ledger row is `UNCONFIRMED`.
- Harness mode, a synthetic id and a ticket-shaped title do not mix: if `accord align` asks for tracker context for an `ADHOC-` id, stop and report it as a bug.
