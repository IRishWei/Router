# T09 v0.10.2b installed Standards review

Read-only review of the completed b evidence. No live helper, RPC, process, Desktop, or model execution was performed during this review.

## Evidence reviewed

- Baseline, grant, human authorization, full-task, config-restored, before-restart, restart-evidence and owned-stop records under the `t09-v0102b` label.
- Complete failed session source: `t09-v0102b-failed-session-original.v4.jsonl.zstd`, 966 bytes, SHA `276306...`; the all-frames private decode and summary are retained, with the complete decode treated as authoritative.
- Restart expiry audit: `t09-v0102b-restart-expiry-audit.mjs`. It restricts its RPC wrapper to `router/snapshot` and `settings/describe`, verifies the exact owner PID `30992`, and explicitly records the expiry-induced availability change rather than declaring all connection fields unchanged.

## Standards result

- The renewed validation used exactly one Task, `8471898a-8454-4085-b79e-a6f6c5f00cc6`, with one proposed/not-dispatched Call `07606...`; the Call was released, `dispatchStarted=false`, and no model request was made.
- The controlled result is preserved as `UNKNOWN` with exact message `ChatGPT access token expired; sign in again`. This is an actual subscription-account expiry outcome, distinct from the earlier HTTP 200 non-SSE failure and from source-level classification fixes.
- Baseline had 231 Tasks/538 Calls, config version 566 and null claim. After the renewed Task and restore, state has 232 Tasks/539 Calls and config version 572; all 231 prior Tasks remain byte-for-byte unchanged and the renewed Task remains unchanged through restore.
- Native default is compared through the approved v4 stable view, excluding only dynamic schema identity. Router configuration, DeepSeek state, account, claim and connection identity remain preserved.
- The strict v4 restart comparison correctly fails only because `connection.available` changed from `true` to `false` after the real token-expiry outcome. The audit separately asserts all other connection fields are equal and records `connectionAvailabilityPreserved: false`; it does not forge a full connection-equality pass.
- Restart used the verified 29-file 0.10.2 installation and was followed by exact stop of PID `30992` and its owned process tree. The owned-stop record reports zero ordinary Desktop processes stopped.

## Acceptance boundary

This is a Standards PASS for evidence handling, preservation, bounded authorization and precise failure reporting. Actual T09 acceptance remains **BLOCK/OPEN**: the b allowance used one Task with zero model requests, while the earlier authorized allowance of two requests is exhausted; no complete successful inference result exists. The source expiry-classification fix is separate future work and is not mixed into this installed acceptance.

