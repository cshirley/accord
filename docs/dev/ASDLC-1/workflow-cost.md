# Workflow cost: ASDLC-1

- Generated: 2026-10-29T19:45:20.775Z
- Source: `.tasks/ASDLC-1-usage.jsonl`
- Calls: **104**
- Input tokens: **1,630,000** (+ cache read **0**, cache write **0**)
- Output tokens: **287,700**
- Estimated cost (USD): **$9.2055**
- ⚠ 44 call(s) reported no usage — counted, tokens/cost unknown

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
| Task 5 | phase-code | 1 | 30,000 | 0 | 0 | 9,000 | $0.2250 |
| Task 5 | phase-test | 2 | 60,000 | 0 | 0 | 16,000 | $0.4200 |
| Task 5 | phase-verify-task | 1 | 9,000 | 0 | 0 | 700 | $0.0375 |
| Task 5 | review-code | 1 (1 no usage) | 0 | 0 | 0 | 0 | $0.0000 |
| Task 5 | review-test | 2 (2 no usage) | 0 | 0 | 0 | 0 | $0.0000 |
| Task 6 | phase-code | 1 | 40,000 | 0 | 0 | 6,000 | $0.2100 |
| Task 6 | phase-test | 2 | 60,000 | 0 | 0 | 18,000 | $0.4500 |
| Task 6 | phase-verify-task | 1 | 9,000 | 0 | 0 | 900 | $0.0405 |
| Task 6 | review-code | 1 (1 no usage) | 0 | 0 | 0 | 0 | $0.0000 |
| Task 6 | review-test | 2 (2 no usage) | 0 | 0 | 0 | 0 | $0.0000 |
| Task 7 | phase-code | 3 | 109,000 | 0 | 0 | 14,900 | $0.5505 |
| Task 7 | phase-test | 5 | 210,000 | 0 | 0 | 37,000 | $1.1850 |
| Task 7 | phase-verify-task | 1 | 9,000 | 0 | 0 | 900 | $0.0405 |
| Task 7 | review-code | 2 (2 no usage) | 0 | 0 | 0 | 0 | $0.0000 |
| Task 7 | review-test | 5 (5 no usage) | 0 | 0 | 0 | 0 | $0.0000 |
| Task 8 | phase-code | 1 | 30,000 | 0 | 0 | 4,000 | $0.1500 |
| Task 8 | phase-test | 3 | 130,000 | 0 | 0 | 26,500 | $0.7875 |
| Task 8 | phase-verify-task | 1 | 9,000 | 0 | 0 | 700 | $0.0375 |
| Task 8 | review-code | 1 (1 no usage) | 0 | 0 | 0 | 0 | $0.0000 |
| Task 8 | review-test | 3 (3 no usage) | 0 | 0 | 0 | 0 | $0.0000 |
| Task 9 | phase-code | 1 | 30,000 | 0 | 0 | 3,000 | $0.1350 |
| Task 9 | phase-test | 1 | 40,000 | 0 | 0 | 6,000 | $0.2100 |
| Task 9 | phase-verify-task | 1 | 9,000 | 0 | 0 | 700 | $0.0375 |
| Task 9 | review-code | 1 (1 no usage) | 0 | 0 | 0 | 0 | $0.0000 |
| Task 9 | review-test | 1 (1 no usage) | 0 | 0 | 0 | 0 | $0.0000 |
| Task 10 | phase-code | 1 | 30,000 | 0 | 0 | 3,000 | $0.1350 |
| Task 10 | phase-test | 2 | 40,000 | 0 | 0 | 6,000 | $0.2100 |
| Task 10 | phase-verify-task | 1 | 9,000 | 0 | 0 | 500 | $0.0345 |
| Task 10 | review-code | 1 (1 no usage) | 0 | 0 | 0 | 0 | $0.0000 |
| Task 10 | review-test | 2 (2 no usage) | 0 | 0 | 0 | 0 | $0.0000 |
| Task 11 | phase-code | 1 | 60,000 | 0 | 0 | 6,000 | $0.2700 |
| Task 11 | phase-test | 2 | 70,000 | 0 | 0 | 14,000 | $0.4200 |
| Task 11 | phase-verify-task | 1 | 9,000 | 0 | 0 | 700 | $0.0375 |
| Task 11 | review-code | 1 (1 no usage) | 0 | 0 | 0 | 0 | $0.0000 |
| Task 11 | review-test | 2 (2 no usage) | 0 | 0 | 0 | 0 | $0.0000 |
| Task 12 | phase-code | 1 | 40,000 | 0 | 0 | 9,000 | $0.2550 |
| Task 12 | phase-test | 2 | 90,000 | 0 | 0 | 21,000 | $0.5850 |
| Task 12 | phase-verify-task | 1 | 9,000 | 0 | 0 | 700 | $0.0375 |
| Task 12 | review-code | 1 (1 no usage) | 0 | 0 | 0 | 0 | $0.0000 |
| Task 12 | review-test | 2 (2 no usage) | 0 | 0 | 0 | 0 | $0.0000 |
| Task 13 | phase-code | 1 | 60,000 | 0 | 0 | 9,000 | $0.3150 |
| Task 13 | phase-test | 2 | 100,000 | 0 | 0 | 18,000 | $0.5700 |
| Task 13 | phase-verify-task | 1 | 9,000 | 0 | 0 | 900 | $0.0405 |
| Task 13 | review-code | 1 (1 no usage) | 0 | 0 | 0 | 0 | $0.0000 |
| Task 13 | review-test | 2 (2 no usage) | 0 | 0 | 0 | 0 | $0.0000 |
| **Total** | | **104** | **1,630,000** | **0** | **0** | **287,700** | **$9.2055** |

Pricing is estimated from model rates in the harness config; see `.tasks/<ID>-usage.jsonl` for per-call detail.
