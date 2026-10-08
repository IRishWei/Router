# T09 v0.10.4a helper v3 Standards preflight

Read-only review; no live helper/RPC/Desktop/CLI/model operation was performed.

## Result: PASS

Reviewed frozen updates:

- launch-owned v2 — SHA-256 `EB5A6554639B0C4915AE158D943F2582862F26486657ED3D34E9EA22EBB544B6`
- restart-launcher v2 — SHA-256 `02274F6833F08D5B6E570183F36D52FB314A15BF4B8524CC996EACD21ABE76E2`
- seal-evidence v3 — SHA-256 `A0C98E16F9812F3847A59C78E95D64F3022B6B0BE1FBA44321644D36B37F0FA6`
- initial launch failure receipt — SHA-256 `9EE352EDDB544DB66E1F2A040BBF71C7F53353C56EAA1FFA3B016939D82D8776`

The v2 launchers record requested executable, PID, start time, home and log receipt, then perform a bounded five-second identity probe. They reject PID reuse, exited processes, unavailable/incorrect executable paths and timeout; rollback is limited to the exact PID/start/exe. Per-attempt logs and prior-owner records are exclusive. Existing evidence records the initial path-check failure with 232 Tasks/539 Calls/config 572/claim unchanged and zero model requests.

The v3 sealer changes only the required helper review names from v2 to v3. It retains the pre-created gate, package identity, actual T09 BLOCK, six review/hash checks, archive ancestor and committed-byte checks, prior protection checks, final stopped owner, 232/539/config572/claim assertions, and exclusive manifest/checker creation. The early-v3 missing-gate rejection was recorded with no output files.

No Standards blocker found. Actual T09 remains BLOCK.

