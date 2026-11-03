---
id: big-feature
type: Feature
title: Big feature
description: Has three ACs.
tags: [fixture]
status: active
owners: [team-auth]
acs:
  - { id: big-feature.AC1, text: "one", tests: ["verify/refresh.proof.ts#expired"] }
  - { id: big-feature.AC2, text: "two", tests: ["verify/refresh.proof.ts#expired"] }
  - { id: big-feature.AC3, text: "three", tests: ["verify/refresh.proof.ts#rotated"] }
anchors:
  code: [src/auth/refresh.ts]
  interfaces: []
depends_on: []
related: []
supersedes: []
changes: []
---

# Big feature
