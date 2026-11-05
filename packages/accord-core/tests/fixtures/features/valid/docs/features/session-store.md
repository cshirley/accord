---
id: session-store
type: Feature
title: Session store
description: Persist sessions.
tags: [session]
status: active
owners: [team-auth]
acs:
  - { id: session-store.AC1, text: "Sessions persist", tests: ["verify/refresh.proof.ts#rotated"] }
anchors:
  code: [src/auth/refresh.ts]
  interfaces: []
depends_on: []
related: [auth-token-refresh]
supersedes: []
changes: []
---

# Session store
