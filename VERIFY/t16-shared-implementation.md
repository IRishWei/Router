# T16 shared implementation review pointer

## Scope and invariants

- Shared Host/RPC/Renderer/build wiring only; no DNS, proxy, Codex configuration, credential or paid request changes.
- One awaited T13 acceptance publication boundary; requirements remain true-user-only.
- Durable Host-only coordination CAS uses both acceptance and coordination revisions.
- One Task/turn/budget/signal; one self-repair and at most one consultation; advice is not evidence.
- Old Tasks remain byte-for-field compatible and receive no new coordination or coordinationPolicy field.
- Research/model-review failures stay fail-closed until T14 publishes a canonical trusted predicate.

## RED evidence

- `node --test test/t16.integration.test.mjs`: missing `config.coordination`.
- same command after the first slice: missing Host `publishCoordination`.
- real 4→9→14 tracer before shared hook: final canonical verdict remained `failed`.

## GREEN evidence

- `node --test test/t16.coordination.test.mjs test/t16.controller.test.mjs test/t16.integration.test.mjs test/t16.client.test.mjs`
- `npm run check`
- `npm test`: 284/284 passed in the final full run. An earlier run had one timing-sensitive T05 deadline failure; its isolated rerun passed before the clean full run.
- `npm run bundle`: Router 0.9.0 package contains the closed `lib/coordination.js` import graph. Generated Router package: 159448 bytes, SHA256 `ED52F806455C941FACD54D5681BADD91C333F081DDC83BBBA7368DCCA287DFC6`.

## Review baseline

- Base: `cc2de49dfb7e7c64dac314dff5168bc73db38438`
- Implementation merge/core: `2f76d14`, shared wiring: `943b7ed`, latest integration merge: `4c837f4`.
- Review diff after final commit: `git diff cc2de49dfb7e7c64dac314dff5168bc73db38438..HEAD`.

Focus on CAS persistence ordering, stale/human boundaries, budget wait release, candidate identity/authorization recapture, old Task compatibility, Renderer RPC exposure, and package relative-import closure. Actual Desktop acceptance remains outside this implementation checkpoint.
