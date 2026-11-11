# Risk checklist

Questions, not answers. For each applicable question, record the answer, its source and a provenance tag (`[verified]`, `[inferred]`, `[assumed]`). Mark a whole domain `n/a` with a one-line reason when it does not apply.

Regulation names below are examples that often apply to health software. Whether and how they apply is a legal and compliance decision: ask the compliance owner, and record who confirmed it.

## 1. Data
- What personal, health or payment data does this touch? Classify each field (PII, PHI, payment, public).
- Where is it created, stored, cached, logged, sent to third parties, and deleted? Draw the flow.
- Is any of it written to logs, traces, metrics labels, error messages, analytics or test fixtures?
- Retention period, deletion path and right-to-erasure handling for each store.
- Is production data used in lower environments?

## 2. Jurisdiction and residency
- Which countries, states or provinces are patients or data in? Which rules may apply (examples: HIPAA and state laws in the US; PIPEDA and provincial health-information laws in Canada; GDPR and UK GDPR in the EU and UK)?
- Must data stay in a region? Does any store, backup, cache, queue, log pipeline, support tool or sub-processor sit outside it?
- Cross-border transfer mechanisms and contractual terms with each vendor.
- Regulated activity rules for the product itself (licensing, prescribing, pharmacy, advertising, consent).
- Per-jurisdiction differences that need configuration rather than code branches.

## 3. Security and access
- Trust boundaries and authentication for each new interface. Who can call it, with which identity?
- Authorisation model: who can read, write or export the data. Least privilege for service roles.
- Secrets: where they live, rotation, who can read them.
- Encryption in transit and at rest. Key ownership.
- Abuse cases: enumeration, replay, injection, rate limits, tenant isolation.
- Audit trail for access to sensitive data.

## 4. Correctness and identity
- What uniquely identifies each entity across systems and files? Who owns that identifier?
- Idempotency: what happens when a request or message is delivered twice or out of order?
- Concurrency and ordering assumptions. Partial failure across systems.
- Money, dates, time zones and rounding. Behaviour when a pricing or eligibility rule changes while a request is in flight.

## 5. Failure and degradation
- For each dependency: what happens when it is down, slow, or returns garbage? Is there a timeout, retry with backoff, circuit breaker, fallback?
- Does the failure of an optional dependency (for example a cache) block the main path?
- Capacity and load: expected peak, worst case, back-pressure.
- Blast radius: how many users, tenants or partners does one failure affect?
- Recovery: restore time and data-loss targets. Has the restore been tried?

## 6. Delivery and rollback
- Feature flag or config switch? Default value in each environment?
- Migration: forward path, backward compatibility, and what happens to data written by the new code if you roll back.
- Order of deployment across services and the window where versions differ.
- How is rollback done, who decides, how long does it take?
- Dark launch, canary or phased rollout; success and abort criteria.

## 7. Observability and operations
- Which signals show the change is healthy (errors, latency, business events)? Dashboards and alerts that exist, or must be added.
- Who is on call, and does the runbook cover the new failure modes?
- Support and customer-communication impact.

## 8. People, process and cost
- Owner, reviewers and approvers. Who signs off on residual risk?
- Dependencies on other teams, vendors or contracts, and their dates.
- Cost: run cost, one-off cost, and cost at 10x load.
- What would we regret not knowing in 6 months?

## 9. Open decisions
- Which decisions are still open or were assumed? List each with an owner and a date.
