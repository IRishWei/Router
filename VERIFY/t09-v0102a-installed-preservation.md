# T09 0.10.2 installed preservation and pending real validation

2026-10-08. Source repair and installed preservation pass; T09/#10 remains OPEN and the project remains at 9/24 closed. No new real model request is authorized or dispatched by this stage.

## Repair and installation

Source author `0665b4135587958476c464caa9bcf505379e5ea6` fixes the secondary error that hid `INVALID_RESPONSE` behind `UNKNOWN`: the Responses adapter now returns the rc.2 public resolved retry policy with zero retries. A non-SSE response remains an error; its message adds only the fixed `application/json`, `text/html`, `missing` or `other` classification. No arbitrary response header or body is recorded.

Independent source Standards/Spec passed; non-author source/test merges are `092d901` and `9c143b6`, followed by review archives. The integrated suite passed **331 tests, 0 failures, 0 skips, 0 todos**, plus build/check. The additional self-contained test CA and hostname-verified CONNECT/TLS regression exercise the production transport locally. These tests do not identify the actual upstream non-SSE cause.

Frozen package: Router **0.10.2**, **183603 bytes**, SHA-256 **`9527C25C9C0A0CE0525E06705A91CA2C24E0E2A63EC5F402E708B36895B9DA2B`**. The target DSH Desktop 0.2.0-rc.2 was installed with the official CLI in the existing isolated validation home under a fresh `t09-v0102a` label. All **29 installed files** matched the frozen package exactly.

## Complete preservation

The current full baseline was captured from 0.10.1 before installation. Across baseline, install and restart, all **231 Tasks, 538 Calls, configuration revision 566, DeepSeek metadata, native default and ChatGPT host/account/connection/catalog/inference/lastDetectionTaskId** remained deeply equal. There were **0 new Tasks and 0 new model requests**. The old failed Task and its two settled Calls were not rewritten; their unknown usage and historical `UNKNOWN` remain intact. The used admission claim still points to `a836c60e-05dd-4de9-a340-07e1b0a7cb5e`.

The exact owned restart root PID **26620** was stopped after verification; the isolated home is retained and ordinary Desktop processes were not stopped. Source repair behavior on a new real request is still unverified.

## Independent installed reviews

- `t09-v0102a-installed-standards-20261008.md`: PASS for installation/preservation, SHA-256 `D66A1FE36FD88AE61767F77E7D77BFE3F3E42AB9B00233F69CE447F760D5E629`.
- `t09-v0102a-installed-spec-20261008.md`: PASS for installation/preservation, SHA-256 `51F6F9E38237C80DA560DC5710E870E15D01AD4BECDB897485950D767ADFD893`.

Both retain T09's overall BLOCK/OPEN conclusion: the earlier real OAuth authorization and 7-model catalog succeeded, but both authorized requests returned HTTP 200 without an SSE stream. There is no real `response.completed` or complete result. The original 1 Task / 2 request allowance is exhausted.

## Reviewable next-validation proposal — not applied

An independent temporary tool can rotate only the one-time admission pointer after **new explicit human authorization**, allowing one separately bounded Task without altering the earlier Task, its request limit or its usage. The tool is outside the product package; its production CLI binds fixed state/owner/executable paths, a stopped owned Host, no running Desktop, the approved proposal digest, an exclusive grant marker and atomic state replacement. It does not call a model.

Only the non-mutating preparation ran. Under `C:/Users/a1500/AppData/Local/Temp/router-implementation/t09-v0102a-renewed-claim-proposal/` it saved a complete byte backup, one-field proposal and manifest:

- Manifest SHA-256: `89dbb6f501676d32d30361cf23636ab9c3805cabbddfdaa9a4f6751fbd310366`.
- Current/source state SHA-256: `1749c2c213d8b0e78eca61c7994e96a2591deb35a2e0bf119c7b1fb277fbc8d5`.
- Proposed state SHA-256: `d358289caff5fa7031e157e301e97cf256ba5af8e4cfd6fb65c81e206271d40d`.

The sole semantic change would be `/chatGpt/lastDetectionTaskId: <old Task ID> → null`; all Task/Call/config/account/connection objects remain identical. The live state still has its original SHA and pointer; the grant marker is absent. **Apply was not run.** Future execution must have new permission for at most **1 additional Task / 2 model requests including title**, full input reservation, the same 65536-token / 120000-ms limits and no transparent retry or billing fallback. An ordinary Desktop must be closed by the user if it is running then.

The separate `t09-v0102b-launch-owned.ps1` and `t09-v0102b-renderer.mjs` were prepared and independently reviewed without executing them. The launcher binds the approved proposal, marker, installed files and stopped owner; it refuses any running Desktop. The renderer binds all 231 historical Tasks and 538 Calls, retains the original failed Task, and permits only the new bounded Task. Their hashes and pending-execution boundary are recorded in `t09-v0102b-preflight-review.md`. This preparation does not authorize another request or establish that the actual upstream non-SSE cause is resolved.

The renewed-claim tool's initial review was BLOCK for path and ownership guards; its report and draft hashes are retained. The unsealed draft was iterated before a byte-backup request arrived, so its old source bytes are not available. The fixed version passed independent Standards and Spec, synthetic guard tests and boundary-tampering checks. This does not affect any sealed package, prior evidence or live history.

## Evidence entrypoints

All detailed files are in `C:/Users/a1500/AppData/Local/Temp/router-implementation/`:

- `t09-v0102a-{before-upgrade,installed-hashes,installed-state,before-restart,restart-evidence,owned-stop}.json`
- `t09-v0102a-{isolated-launcher.ps1,preserve.mjs,stop-owned.ps1}`
- `t09-v0102a-{renewed-claim-lib,prepare-renewed-claim,apply-renewed-claim}.mjs`
- `t09-v0102a-renewed-claim-{standards-initial-block,standards,spec}.md`
- `t09-v0102a-evidence-manifest.json` and `t09-v0102a-evidence-protection-check.mjs`

The earlier 40-file `t09-v0101a` manifest and the T14 63-file/2-prefix protection remain authoritative and unchanged. The v0.10.1 compression-description correction is in `t09-v0101a-desktop-acceptance-erratum.md`. Private logs, state backups, proposals and credentials stay outside Git.
