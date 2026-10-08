# T09 v0.10.4c helper Standards preflight

Date: 2026-10-08  
Reviewer: non-author merger (read-only)

## Result

**Prepared-chain Standards: PASS. Execution status: PENDING HUMAN APPROVAL (BLOCK).**

All 14 frozen c files passed syntax checks: 10/10 `.mjs` with `node --check` and 3/3 `.ps1` with the PowerShell parser. The controlled guard suite passed 10/10 tests. The corrected chain binds prepare/apply/marker to the reviewed a manifest identity (`accountId`, `issuedClientId`, `connectionId`) and SHA, derives the production provider from that account, verifies the canonical source ledger before accepting dispatch/usage, and rejects a possibly-dispatched null-usage call as zero-known. Failure cleanup cancels exactly one still-waiting authorization, preserves the original error, and disposes the renderer.

The launcher/restart chain retains fixed package provenance, exact owned process identity, bounded start polling and rollback, ordinary Desktop rejection, and cleanup. The renderer requires a separate approved human authorization, fresh same-account OAuth identity, callback-to-detection within 30 seconds, one new Task, at most two requests, 65536 tokens, 120000 ms, forecast 2048, and no extensions/retry/refresh/API fallback/output hard cap. Preserve/restore checks retain the historical state and exclude only derived native-default schema. No live helper, RPC, Desktop, CLI, credential, model, or Git operation was performed; therefore actual T09 remains BLOCK/OPEN.

## Frozen file SHA-256

`apply-renewed-claim.mjs` 4D7FC654A5069FE5002F361E8814E3EED36F89710B4A3800F323D444631307FB; `helper-guard.test.mjs` ADDC03A1164D65C6497E080E9911E4983008C615027A17DD959F2D55D68E1525; `helper-lib.mjs` 41F2D494D1A45F74252E7B9BB7B725FF62AAD8230DD3F507AFD3A9FC404AA99F; `human-authorization.template.json` 384F6A143F27022D44FE30E2816E0F9772AB94F3BBB9D817D8B0F1B123EAE85F; `launch-owned.ps1` EE888B5566F2E0746687AA7BD2EB72BC7CEBB279A1871169670250165F877E05; `prepare-renewed-claim.mjs` D8FDBFEADA18D4156FAAB49B2F421E8A0A185A6C745E82F681AF204B43F76DFB; `preserve.mjs` 05911392590C8CAD4EB314D60884D7528EBE12AA6A64472915E4F1E6550C023B; `read-native-session.mjs` 7AE23D88EE16A4CCC177F9EF6FD467177599D2AD0B8A7FF12ADF766F918B9A34; `relogin-detect.mjs` FED6ABCEC26E839E891A96457F037AADA28617D0DA422C4A406F2FF3D4531820; `renewed-claim-guard.test.mjs` C619A393BD3420C12EEAC19919DFB3A2E4D9951A364AAD78D56599554DA2FB60; `renewed-claim-lib.mjs` D436EC80734203E4F5E42D30F6479E2CD5EAB4DD49A2C020B9A80D60D233D2AA; `restart-launcher.ps1` 1C9AD8A8154E98CFE800728C92E7665E8EEFF26B5E70BC1A27A7D41AB250E338; `restore-config.mjs` 34A1F1F5D572D3A1A079BB7E6E1D61FDF56DD463696CDBFC0F9CF13B77520BA7; `stop-owned.ps1` 8886A26F3534FDFBB0BF21D4BB6543822B19CB1D390524FFEC58D3BAF73EDA0E.
