# T16 shared 0.9.1 production fixes

## Fixed review findings

- Host startup now validates every persisted coordination record and atomically persists all self-repair `intent-persisted` and consultation `intent-persisted` / `call-reserved` / `advice-ready` states as `delivery-unknown/stalled`. Recovery does not depend on a paused historical Task receiving another acceptance hook and does not replay an effect.
- Final candidate capture is outside the steer exception boundary. Capture failure or identity/revision change is `CONSULTATION_CANDIDATE_CHANGED/stale` with zero steer; only an exception after calling `agent.steer` is `delivery-unknown`.
- The configured consultant is a current preference in the complete enabled-pool objective ranking. It is retained when no comparable objective winner exists; a different real winner freezes `objective-mismatch`, authorizes zero consultation and is visible in Renderer instead of forcing or replacing a candidate. Fixed-main consultation permission remains independent.
- Completed coordination remains unchanged. Legacy Tasks without coordination fields remain field-for-field unchanged. The T13 4→9→14 path, sole awaited hook, shared budget runner and research/model-review fail-closed boundary are unchanged.

## RED evidence

At base `1e0c1703851be8ff9df118ac44579371374cdff4`:

`node --test test/t16.coordination.test.mjs test/t16.integration.test.mjs` produced 33/36 passing and the three expected failures:

- final capture exception returned `none` and produced `delivery-unknown` instead of stale;
- token objective retained a configured candidate selected through the fixed-candidate bypass;
- real `startNative` left persisted pending coordination at revision 1.

## GREEN evidence

- Targeted coordination and Host tests: 36/36 passed.
- Full source suite before version freeze: `npm test`, 287/287 passed.
- Final 0.9.1 `npm test`: 287/287 passed.
- `npm run check`, build, pack and bundle passed; the package has 24 files including `lib/coordination.js`.
- `irishwei-dsh-router-0.9.1.tgz`: 160169 bytes, SHA256 `1D3E99B28B142A45E629C3F371C17C5E2CED53D8D6E58983FB33BE0103BBB575`.
- The preserved 0.9.0 artifact remains 159448 bytes with SHA256 `ED52F806455C941FACD54D5681BADD91C333F081DDC83BBBA7368DCCA287DFC6`.

## Review pointer

- Production base: `1e0c1703851be8ff9df118ac44579371374cdff4`.
- Review the final frozen delta with `git diff 1e0c1703851be8ff9df118ac44579371374cdff4...HEAD`.
- Focus on startup write atomicity and idempotence, pending-state completeness, capture/steer effect classification, objective comparison semantics, fixed-main permission independence and legacy Task preservation.
- Desktop, companion, verifier and installed 123-Task upgrade acceptance remain outside this source checkpoint.
