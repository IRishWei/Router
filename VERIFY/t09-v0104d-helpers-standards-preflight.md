# T09 v0.10.4d helper Standards preflight

Date: 2026-10-08  
Reviewer: non-author merger (read-only)

## Result

**Prepared-chain Standards: PASS. Execution status: PENDING NEW HUMAN APPROVAL (BLOCK).**

All 14 frozen d files passed syntax checks: 10/10 `.mjs` with `node --check` and 3/3 `.ps1` with the PowerShell parser. The controlled guard suite passed **11/11**. The incremental fix pins the literal a evidence bytes (`10073229`, SHA-256 `327AACB44DFD924EE715C31F6E4A39BA538F0CBD14C4670B00FB579754E5AD32`) at every production side-effect entrypoint and derives the expected IDs from those bytes. It rejects synchronized prior/live identity drift before creating a proposal or manifest and has no production expected-hash override.

The corrected chain retains c's canonical ledger/possibly-dispatched checks, one-field claim transition, exact same-account identity binding, one waiting-authorization cleanup, owned PID/start/exe/home checks, bounded rollback, fixed package provenance, preserve/restore scope, and separate human-approval gate. The authorization contract remains one new Task, at most two requests, 65536 tokens, 120000 ms, forecast 2048, with extensions/retry/refresh/API fallback/output hard cap disabled. No live helper, RPC, Desktop, CLI, credential, model, or Git operation was performed; actual T09 remains BLOCK/OPEN pending explicit human approval.

## Frozen file SHA-256

`apply-renewed-claim.mjs` D157948DAFE988818FFB95F5FD991750F3066790C90D9325CA7643DF54ED2680; `helper-guard.test.mjs` 5A7A32441057BBF346BD90E656EA64C84388D0AC14414586C1BEAB9A13CC5882; `helper-lib.mjs` 41F2D494D1A45F74252E7B9BB7B725FF62AAD8230DD3F507AFD3A9FC404AA99F; `human-authorization.template.json` 37FC522E3B785804A506D8702C9459A460AE0BEEA3C4A63A4D898B71147A9800; `launch-owned.ps1` D958E374D689C94E1770AD1003FB663AB36F857DCB9CE7909BD51F5711665AFA; `prepare-renewed-claim.mjs` 662AEDD85D802FF8A7AC56A91335CCA545EB10EEECAA063AF5CEA4199B9365D2; `preserve.mjs` F069673E9DC1A8F4C974542DFFAEF3204E64D56F57171B1E57E64A7D35DD1064; `read-native-session.mjs` 961F020B40DAB1A3E6D9BE22960B71905BF41E3AF1CEAE5E86A277ADD1040EAF; `relogin-detect.mjs` F78D1FAE565F7F90562B6B1FF7557088E4BDE22E94B475BDFDF4D84C0631719A; `renewed-claim-guard.test.mjs` D0CD4C9CCE6CCA5362872E710584FDF80695337462D71B14ACC263FCF4595D92; `renewed-claim-lib.mjs` 7F6BD17E22D7C67A41ADCE892B835E1173D4E14F2C6C0743E9AFB9B75823FF94; `restart-launcher.ps1` A8E4970CA1E7F77FEBD1F413DB4957D1630169D0505446ABC18B470643F68F38; `restore-config.mjs` 019E8E3D9FFC9A46396C57A35E2BA97F943A066B98E805F251E3DB4D55C88290; `stop-owned.ps1` 57380D611E46AF32D2F84449E5B8B7F874A042615CD691048964DCC5AD59F467.
