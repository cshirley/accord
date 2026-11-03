---
id: auth-token-refresh
type: Feature
title: Token refresh
description: Refresh expired session tokens.
tags: [auth, session]
status: active
owners: [team-auth]
acs:
  - { id: auth-token-refresh.AC1, text: "Expired token is refreshed", tests: ["verify/refresh.proof.ts#expired"] }
  - { id: auth-token-refresh.AC2, text: "Refresh rotates the token", tests: ["verify/refresh.proof.ts#rotated"] }
anchors:
  code: [src/auth/refresh.ts]
  interfaces: ["POST /token/refresh"]
depends_on: [session-store]
related: []
supersedes: []
changes: []
---

# Token refresh

See the [session store](./session-store.md).
