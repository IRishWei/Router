# T09 v0.10.4a installed upgrade and preservation

**Installed preservation: PASS. Actual T09 acceptance: BLOCK / OPEN.**

The isolated target Desktop was upgraded directly from Router 0.10.2 to the frozen 0.10.4 package with the official CLI. Baseline, installed, pre-restart and restarted public snapshots preserve all **232 Tasks / 539 Calls / config572**. This run created **zero Tasks**, made **zero model requests**, and did not start OAuth or rotate the consumed admission claim.

## Source and package

- Fixed base: `3cd256d02b23d03297bf1fa830aac8bab838cacf`.
- Author freeze: `68fc80a0ccba6c317c2cd09aec1316ccfd6dc78f`.
- Non-author merge: `c85b582d80f0dd4038b060184039a33b588be945`.
- Source archive: `a0bcb59cba510ddca5da23af28c80d276d41342c`.
- Build/check PASS; full serial suite **335 passed, 0 failed, 0 skipped, 0 todo**. See `t09-v0104-non-author-merge.md`.
- Package: `artifacts/irishwei-dsh-router-0.10.4.tgz`, **184530 bytes**, SHA-256 `E9274C673B4D7B37F1E01C89D8EC8BF97E2795A84EE782B83643DBE4C28662E3`.
- All **29** installed files match their frozen tar entries. Restart reverified those same bytes.

0.10.4 includes the 0.10.3 safe `TOKEN_EXPIRED` classification and bounded JSON diagnostics for exact `application/json` 2xx non-SSE responses. Diagnostics retain only fixed shape/code/parameter categories within 64 KiB and the original signal/deadline. These source checks do not establish a successful real inference.

## Actual target preservation

Target: Windows DSH Desktop 0.2.0-rc.2, build `04f392c9ddd144fa426da2045178797da6db6c11`, Cordis 4.0.4 / protocol 4. Home: `C:/Users/a1500/AppData/Local/Temp/router-implementation/desktop-validation-home`.

The full Task history, Router configuration, DeepSeek state, ChatGPT account, connection, catalog, inference status and claim are deeply equal across all four stages and the prior 0.10.2b restart evidence. Native default comparison excludes only its dynamically generated top-level settings `schema`. Persisted Task comparison excludes only the public snapshot's derived `ledger`; every persistent Task field is compared.

The consumed claim remains `8471898a-8454-4085-b79e-a6f6c5f00cc6`. The expired connection remains **available=false** throughout; this is preserved metadata, not a successful connection test.

- Baseline owned root PID **4380**, version 0.10.2: captured and stopped.
- Installed owned root PID **38160**, version 0.10.4: verified and stopped.
- Restarted owned root PID **36592**, version 0.10.4: verified and stopped.

Each stop checked exact purpose, label, stage, version, PID, start time, executable, home and owned process tree. Ordinary Desktop processes stopped: **0**. The final owner is stopped; the isolated home and all records remain.

## Retained helper failures and reviews

The first launcher failed its immediate process-path check before owner publication or RPC. Rollback left zero Desktop processes, the prior stopped owner and all persisted history/configuration/claim unchanged. Its script, private logs and failure receipt remain. The corrected launch/restart helpers use exclusive start receipts and a bounded five-second identity probe; all retry evidence uses new `-v2` filenames.

Initial Spec preflight also blocked a sealer that lacked mandatory review/archive prerequisites. The original is retained. Final sealer v3 requires fixed package identity, six independent PASS review records and byte/hash-matching committed archive files before writing a manifest. Missing-gate executions were rejected without creating either seal output.

Source Standards/Spec, helper v3 Standards/Spec, and installed preservation Standards/Spec all PASS. Earlier helper review results are retained at their original bytes. Actual T09 remains BLOCK because neither previous real attempt produced `response.completed`; the last authorized Task stopped before dispatch due to an expired credential. A replacement Task requires fresh explicit authorization and same-account official sign-in.

## Evidence

Detailed snapshots, installed hashes, exclusive receipts and private logs use the `t09-v0104a` prefix under `C:/Users/a1500/AppData/Local/Temp/router-implementation/`. No private snapshot, authorization URL or credential is committed. The T14 63-file/two-prefix, T09-first 40-file, T09-a57 and T09-b75 protection groups remain authoritative and unchanged. The new a seal is created only after these reviews and their repository archive are committed.
