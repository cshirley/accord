# Workflow cost: ASDLC-1

- Generated: 2026-10-29T12:36:57.911Z
- Source: `.tasks/ASDLC-1-usage.jsonl`
- Calls: **5**
- Input tokens: **69,000** (+ cache read **0**, cache write **0**)
- Output tokens: **9,300**
- Estimated cost (USD): **$0.3465**
- ⚠ 2 call(s) reported no usage — counted, tokens/cost unknown

## By scope and agent

| Scope | Agent | Calls | Input | Cache read | Cache write | Output | Est. $ |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Task 1 | phase-code | 1 | 40,000 | 0 | 0 | 4,000 | $0.1800 |
| Task 1 | phase-test | 1 | 20,000 | 0 | 0 | 5,000 | $0.1350 |
| Task 1 | phase-verify-task | 1 | 9,000 | 0 | 0 | 300 | $0.0315 |
| Task 1 | review-code | 1 (1 no usage) | 0 | 0 | 0 | 0 | $0.0000 |
| Task 1 | review-test | 1 (1 no usage) | 0 | 0 | 0 | 0 | $0.0000 |
| **Total** | | **5** | **69,000** | **0** | **0** | **9,300** | **$0.3465** |

Pricing is estimated from model rates in the harness config; see `.tasks/<ID>-usage.jsonl` for per-call detail.
