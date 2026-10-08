# T09 v0.10.2b helper Standards pre-review

Read-only review only. No live helper, RPC, process, Desktop, or model execution was performed.

## Reviewed inputs

- `t09-v0102b-helper-lib.mjs` — SHA-256 `09738A61EBC41D4CC45490076653E2D75A90984E7D1F96EB569F753F30B0F571`
- `t09-v0102b-helper-guard.test.mjs` — SHA-256 `52E794B1721CC5D294E69BD39CC2B685077AB8E1016DD0B35E0437B5837C830A`
- `t09-v0102b-preserve.mjs` — SHA-256 `410ECF585E89A4E2DC3917A5F66321E502E6BE4F4FE38B473FC76074E95AFA28`
- `t09-v0102b-restore-config.mjs` — SHA-256 `D0A71B1BEC19259D978D4B198F4B5B88F09C4BA16F24E9D5FBA0F5A32A65E98F`
- `t09-v0102b-stop-owned.ps1` — SHA-256 `02486B8D50FC28C183A999B11F70DE81BF3B7CACC442EF5525F37D3F99B9C76B`

## Standards findings

- Capture asserts the new owned 0.10.2 host, 231 Tasks, 538 Calls, config version 566, `lastDetectionTaskId === null`, terminal historical Tasks, unchanged historical Tasks/config/DeepSeek/default, and the prior failed Task with `maxCalls=2` and exactly two Calls.
- The renewed-task guard requires exactly one additional Task, preserves every old Task byte-for-byte, binds the claim to the new Task, requires a terminal lifecycle, limits it to two Calls/possible dispatches, and caps the complete ledger at 538 + 2 Calls.
- Configuration restore uses an allow-list of public RPC/settings routes. It restores Router values and the native default while preserving the renewed Task, claim, ChatGPT account/connection and model state; it rejects changes to the renewed Task history and claim.
- Before-restart and restart checks deep-compare Tasks, Router config, DeepSeek state, ChatGPT account/connection, renewed claim, and native deployment default. Evidence records zero additional model requests.
- Stop helper requires the exact running `t09-v0102b` owner, PID/start time/executable/home, required preservation evidence, and rejects any foreign Desktop process before stopping. It records the owned process tree and reports zero ordinary Desktop processes stopped.
- Frozen restart launcher `t09-v0102b-restart-launcher.ps1` (SHA-256 `E1CAECB05F3D8685C16D26D1081638C0B53D88BA5CD172313450B254210125AC`) requires the stopped owner plus `before-restart` and owned-stop evidence, verifies the 0.10.2 package and 29 installed files, rejects existing Desktop processes, uses fresh restart labels, and restores `DSH_HOME` in `finally`. If publication fails after launch, it can stop only the just-started process after matching PID, executable and start time.
- The author-reported PowerShell parser and synthetic guard checks are PASS; this review did not rerun them or execute the helpers.

## Conclusion

No Standards blocker found in the reviewed helper code. The live detect/restore/restart/stop evidence remains pending and must be judged from actual evidence after execution.

