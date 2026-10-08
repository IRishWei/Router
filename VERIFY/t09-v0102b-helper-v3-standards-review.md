# T09 v0.10.2b helper v3 Standards review

Read-only targeted review. No live helper, RPC, process, Desktop, or model execution was performed. The v1/v2 helper files and reports remain byte-for-byte untouched.

## Reviewed frozen inputs

- `t09-v0102b-helper-lib-v3.mjs` — SHA-256 `9789DEA01B153B5202EAB5122EEBAC00D4BF9846EFB281610B2546CAF9E0120D`
- `t09-v0102b-helper-guard-v3.test.mjs` — SHA-256 `B46F58E27702C4937F5E076616FA5E006FC1512F6578F815054D3564CB02ED9E`
- `t09-v0102b-preserve-v3.mjs` — SHA-256 `42035FB75C7BD1B06E07498603ABC1993DF6D55CB22E9475567C6D101F0EA1A2`
- `t09-v0102b-restore-config-v3.mjs` — SHA-256 `10C0EB112102E4A5AAF7E99D1441E55D3C6EFBF1290F1B759358051BAB90810C`

## Targeted findings

The v3 helper derives the actual production provider as `router-chatgpt-${baseline.state.chatGpt.account.accountId}`. It binds the captured account and connection, subscription billing path, candidate, active selection, every Call selection/snapshot, and every Call `taskId` to the renewed Task. It therefore accepts the observed production identity shape and rejects the prior static `openai-chatgpt-oauth` source identity.

The exact v2 authorization guards remain present: 65536 tokens, 120000 ms, empty money limits, no extensions, maxCalls 2, output forecast 2048, no retry purpose, no API fallback, and no account/provider/model/candidate/snapshot drift. Historical Tasks are deep-compared; the prior failed Task and Calls remain intact. Restore and restart preserve the renewed Task, claim, account/connection, Router configuration and native default.

The v3 guard suite includes a production-shaped positive clone from the frozen baseline Task and Calls, plus the v2 negative cases and an explicit rejection of the static source provider. The reported guard result is 4/4 PASS.

## Conclusion

**PASS — no remaining Standards blocker found in the v3 helper scope.** The prior v2 Spec blocker is resolved by account-scoped provider derivation and `Call.taskId` binding. Actual detect/restore/restart evidence remains pending and must be assessed after execution.

