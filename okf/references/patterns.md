---
type: Reference
title: Intent patterns and variants
description: How /dev classifies requests into patterns and which phase sequence each pattern runs.
tags: [patterns, intent, pipeline, quick-fix, investigate]
status: stable
generated: { by: agent:pi, at: 2026-09-28T16:41:59Z }
sources:
  - id: workflow
    resource: /docs/accord-workflow.md
    title: ACCORD agentic workflow (Patterns)
  - id: pipeline
    resource: /docs/pipeline.md
    title: Pipeline diagrams per pattern
  - id: intent
    resource: /packages/accord-core/src/commands/intent.ts
    title: dev_intent / dev_intent_enrich
---

`dev_intent` classifies free text with keyword heuristics; `dev_intent_enrich` refines using
ticket metadata (AC count, story points, subtasks, description length).

| Pattern / variant | When | Phases |
|-------------------|------|--------|
| `implement/standard` | Default for add/implement/build + ticket | align → gather → spec* → plan* → per task (test → review-test → code → post-code → [review-security] → review-code) → verify-acceptance |
| `implement/express` | "quick one", "no ceremony" | gather → code → post-code → [review-code] |
| `implement/orchestrated` | 3+ parallelisable tasks | align → gather → spec* → plan* → parallel worktrees (test → code) → sequential merge → verify-acceptance |
| `quick_fix` | Typo / one-liner, obvious target | `dev_quick_fix_brief` → [test → review-test] → code → post-code |
| `investigate` | "why", "root cause" | gather → explore → hypothesise → [review-investigation] → test → report |
| `infra` | Terraform, Helm, K8s, Pulumi, CloudFormation | gather → explore → code (IaC) → verify-infra |
| `analyse` | ADR, design doc, compare options | gather → explore → draft → review-design |

`*` = multi-turn (spec/plan loop spawn → questions → answer → respawn via checkpoint).
Hooks and decision packets are identical across patterns. Diagrams: [`docs/pipeline.md`](../../docs/pipeline.md).
