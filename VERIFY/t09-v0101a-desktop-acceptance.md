# T09 0.10.1 target Desktop acceptance — incomplete

2026-10-08, evidence label `t09-v0101a`. T09/#10 remains OPEN; the project remains at 9/24 closed.

## Verified result

- Target: DSH Desktop 0.2.0-rc.2 / build `04f392c9ddd144fa426da2045178797da6db6c11`, isolated home `C:/Users/a1500/AppData/Local/Temp/router-implementation/desktop-validation-home`.
- Installed Router 0.10.1, author `7813bac6b47eafbf412187c0902f7d8b06439cd8`, integration `4126cc5076e4675cd08da3ffbe1bb58fb527cb05`: 183381 bytes, SHA-256 `644BE21C30A985C4EA79E7282121DF07828C0027EDCB52A854BBE0BCA7B4EAEE`. All 29 package files matched installed bytes.
- The actual installed client ran through the native Renderer, Typert RPC codec and owned public HTTP carrier. Official browser authorization returned successfully; direct-use scope was present and the same authorized account listed 7 models. Catalog visibility is not evidence of successful inference.
- The one authorized real Task `a836c60e-05dd-4de9-a340-07e1b0a7cb5e` selected catalog-first `gpt-6.1-sol`. It dispatched exactly two possible model requests: detection and auxiliary title. Both failed with `INVALID_RESPONSE`, HTTP 200, message `Responses endpoint did not return an event stream`. There is no `response.completed` or output marker. Task lifecycle is `paused`, original top-level reason `UNKNOWN`.
- Both usages and aggregate token consumption remain unknown/null, not zero. The 65536-token reservation and 120000-ms duration budget had no extension; no server output cap is claimed. The authorized real-request allowance is exhausted. No additional real model request was sent during diagnosis, configuration recovery or restart.

## Preservation and recovery

The fresh pre-install baseline contained 230 Task objects, 536 Calls, config revision 560 and the native default selection. All old Task objects were compared in full and preserved. After the new failed Task, restoration and restart preserved all 231 Tasks and 538 Calls exactly; original configuration values and native default were restored (revision advanced to 566). Redacted OAuth account/connection/catalog metadata and the used validation claim survived restart. The exact owned validation root PID 22476 was stopped after verification; ordinary Desktop processes were not stopped. The isolated home is retained.

The initial renderer detection helper failed while controls were still loading, before any Task or request. Its source and zero-dispatch evidence were preserved before fixing only the helper. A PowerShell 5 restart invocation failed its frozen-package guard because of UTF-8 script path decoding, before stopping anything; invoking the unchanged launcher from the workspace PowerShell succeeded. Public cold Session reads returned `gateway/internal`; diagnosis instead copied the exact failed Session persistence file exclusively and decoded its 19 Zstd frames (header plus 18 events). Neither failure was hidden or charged as a model request.

## Independent acceptance reviews

- `t09-v0101a-installed-standards-20261008.md`: PASS for process standards, SHA-256 `65BBAAAEF27B8AE874F7611751FAC696192E1BFEA5B9746612ADF1E86BADE7AB`.
- `t09-v0101a-installed-spec-20261008.md`: BLOCK/P1 for incomplete real Responses execution, SHA-256 `56742976766F7E638C014BEF86A421812BB0982F435C6C491B543B655C618542`.

These preserve the earlier source-review PASS without substituting it for installed acceptance. AC3 is partial and AC4 is unmet. Successful real inference and persistence of its complete result remain required before closing T09.

## Evidence entrypoints

All detailed evidence lives under `C:/Users/a1500/AppData/Local/Temp/router-implementation/` and is retained under this unique label:

- `t09-v0101a-{before-upgrade,installed-hashes,installed-state,authorization-started,installed-renderer-inspection-loaded}.json`
- `t09-v0101a-{real-task-evidence,failed-session-persistence-page,config-restored,before-restart,restart-evidence,owned-stop}.json`
- `t09-v0101a-failed-session-original.v4.jsonl.zstd`
- `t09-v0101a-evidence-manifest.json` and `t09-v0101a-evidence-protection-check.mjs`

Private carrier logs and original state backups stay outside Git; their contents must not be printed or shared. The prior T14 manifest/checker and packages remain immutable. The verified rollback package remains 0.9.3; the failed-review 0.10.0 package is not a rollback target.

## Diagnosis boundary

An offline real SessionController + target-default `dsh-llm-retry` + controlled HTTP 200 non-SSE endpoint reproduced the secondary `UNKNOWN`: the adapter returned a partial retry policy, and the retry plugin attempted `policy.retryableCodes.includes(...)`. The 0.10.2 source fix uses the public resolved-policy contract with zero retries and a fixed response content-type classification. Local production CONNECT/TLS/SSE checks succeed and reject non-SSE responses precisely. Neither result explains the actual upstream non-SSE response or grants permission for further real calls.
