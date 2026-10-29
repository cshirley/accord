# Workflow cost: ASDLC-1

- Generated: 2026-10-29T13:58:47.384Z
- Source: `.tasks/ASDLC-1-usage.jsonl`
- Calls: **32**
- Input tokens: **320,000** (+ cache read **0**, cache write **0**)
- Output tokens: **54,600**
- Estimated cost (USD): **$1.7790**
- ⚠ 13 call(s) reported no usage — counted, tokens/cost unknown

## By scope and agent

| Scope | Agent | Calls | Input | Cache read | Cache write | Output | Est. $ |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Task 1 | phase-code | 1 | 40,000 | 0 | 0 | 4,000 | $0.1800 |
| Task 1 | phase-test | 1 | 20,000 | 0 | 0 | 5,000 | $0.1350 |
| Task 1 | phase-verify-task | 1 | 9,000 | 0 | 0 | 300 | $0.0315 |
| Task 1 | review-code | 1 (1 no usage) | 0 | 0 | 0 | 0 | $0.0000 |
| Task 1 | review-test | 1 (1 no usage) | 0 | 0 | 0 | 0 | $0.0000 |
| Task 2 | phase-code | 4 | 41,000 | 0 | 0 | 4,300 | $0.1875 |
| Task 2 | phase-test | 4 | 89,000 | 0 | 0 | 16,900 | $0.5205 |
| Task 2 | phase-verify-task | 1 | 9,000 | 0 | 0 | 500 | $0.0345 |
| Task 2 | review-code | 1 (1 no usage) | 0 | 0 | 0 | 0 | $0.0000 |
| Task 2 | review-test | 4 (4 no usage) | 0 | 0 | 0 | 0 | $0.0000 |
| Task 3 | phase-code | 1 | 12,000 | 0 | 0 | 1,500 | $0.0585 |
| Task 3 | phase-test | 1 | 12,000 | 0 | 0 | 4,000 | $0.0960 |
| Task 3 | phase-verify-task | 1 | 9,000 | 0 | 0 | 700 | $0.0375 |
| Task 3 | review-code | 1 (1 no usage) | 0 | 0 | 0 | 0 | $0.0000 |
| Task 3 | review-test | 1 (1 no usage) | 0 | 0 | 0 | 0 | $0.0000 |
| Task 4 | phase-code | 1 | 30,000 | 0 | 0 | 4,500 | $0.1575 |
| Task 4 | phase-test | 2 | 40,000 | 0 | 0 | 12,000 | $0.3000 |
| Task 4 | phase-verify-task | 1 | 9,000 | 0 | 0 | 900 | $0.0405 |
| Task 4 | review-code | 1 (1 no usage) | 0 | 0 | 0 | 0 | $0.0000 |
| Task 4 | review-security | 1 (1 no usage) | 0 | 0 | 0 | 0 | $0.0000 |
| Task 4 | review-test | 2 (2 no usage) | 0 | 0 | 0 | 0 | $0.0000 |
| **Total** | | **32** | **320,000** | **0** | **0** | **54,600** | **$1.7790** |

Pricing is estimated from model rates in the harness config; see `.tasks/<ID>-usage.jsonl` for per-call detail.
