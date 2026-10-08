# T09 0.10.2 renewed Desktop acceptance: expired before dispatch

2026-10-08. **Actual acceptance BLOCK; history/configuration preservation and owned cleanup PASS.** T09/#10 remains OPEN, with 9/24 Issues closed.

## Authorization and actual result

The human explicitly approved one additional Task and at most two model requests including title, with full-input reservation, a 65536-token budget and 120000-ms absolute deadline. The separately reviewed fixed-path proposal was applied once after that answer; only the admission pointer changed. All prior Tasks and Calls were retained.

The installed 0.10.2 native Renderer/Typert/public-RPC flow created exactly one new Task, `8471898a-8454-4085-b79e-a6f6c5f00cc6`, in session `session-6fbb0efa-ff8e-478e-97f8-c3bf444a5e44`. Its one proposed Call, `07606ca2-d162-48db-a321-04faa9239fae`, remained **not-dispatched**, with `dispatchStarted=false`, no uncertain dispatch, and a released reservation. **Actual model requests: 0.** There was no retry, title request, billing fallback, output or `response.completed`.

The reservation included 35726 input tokens and 2048 output forecast tokens; that forecast was not a server output cap. Limits remained exactly 65536 tokens / 120000 ms, with no budget extensions. The selected account, account-scoped provider, candidate and subscription billing identity were consistent throughout the Task and Call snapshots.

The native session is decisive: a copied **966-byte** persistence file, SHA-256 `2763062D2FCE6D1B0BA53B61032AF7A599CA0F18F7556BD6DF17555175DA68B5`, decodes from **5 Zstd frames into 10 JSON records**. `turn/end` records `UNKNOWN` with the fixed message **`ChatGPT access token expired; sign in again`**. The normal Error's own TOKEN_EXPIRED code was lost at the native LlmError boundary. This is a pre-dispatch credential failure and does not validate the earlier non-SSE response repair or explain the earlier two non-SSE responses.

Call usage remains null; the ledger correctly totals zero dispatched Calls and zero tokens after releasing the unspent reservation. The prior failed Task and its two unknown-usage Calls remain unchanged.

The one-Task allowance is now consumed despite zero model requests. The terminated Task cannot resume or reopen its absolute deadline through the current public Router contract; the remaining request allowance cannot authorize a replacement Task. Fresh same-account sign-in and explicit authorization for another bounded Task are required for another real acceptance.

## Preservation, restart and cleanup

The baseline was **231 Tasks / 538 Calls / config566**, with a null renewed admission pointer. After restoring the captured Router configuration and native default through public interfaces, the complete state contains **232 Tasks / 539 Calls / config572**. All 231 historical Tasks and the new Task remained deeply equal across restore and restart; configuration values were restored, with the revision advancing normally.

The first root PID **3160** and its owned process tree were stopped after preservation. Restart root PID **30992** used the same frozen 0.10.2 package, **183603 bytes / SHA-256 `9527C25C9C0A0CE0525E06705A91CA2C24E0E2A63EC5F402E708B36895B9DA2B`**, with all **29 installed files** reverified.

The strict restart helper reported a real metadata change: **connection.available true → false** after the expired grant was re-evaluated. It did not pass an all-metadata-equal check. A separate read-only expiry audit verified all Tasks, configuration, DeepSeek state, account, claim, native default values and connection identity, and recorded the unavailable connection explicitly. The saved restart evidence sets `connectionAvailabilityPreserved=false` and `actualAcceptance=BLOCK` rather than rewriting this result as a full connection preservation pass.

The exact restart PID 30992 and its owned tree were then stopped. Ordinary Desktop processes stopped: **0**. The isolated home and all records are retained.

## Helper failures retained

All helper versions remain at their original paths and bytes; new versions use new filenames.

- The initial read-only Renderer inspection ran before the login URL appeared in the private startup log and failed before any RPC. A later inspection passed with seven catalog models and zero model requests.
- Initial helper Spec review blocked missing budget/retry/subscription identity guards; v2 added them but used a source identifier as the provider. Spec blocked that production-shape mismatch. v3 derived the actual account-scoped provider and passed both axes plus the prior actual Task shape.
- v3's first before-restart check incorrectly compared dynamic settings schema UID/refs. v4 excludes only that derived top-level schema and retains strict comparison of every other namespace field, with positive UID drift and negative value/user/revision tests. The successful restore was not rerun.
- The initial single-frame decoder output is retained separately. The all-frames decoded persistence and native failure summary are authoritative.

Independent installed Standards reports process/preservation PASS; installed Spec reports actual T09 BLOCK. Helper preflight PASS does not certify a successful real request.

## Evidence

Detailed helpers, private logs, full snapshots, authorization/grant records, copied native persistence and reports are under `C:/Users/a1500/AppData/Local/Temp/router-implementation/`, using the `t09-v0102b` prefix. The b evidence manifest/checker seals these files and the repository review copies. Earlier 57-file T09-a, 40-file T09-first-attempt and 63-file/two-prefix T14 protection remain authoritative. No credentials or private logs are committed to Git.
