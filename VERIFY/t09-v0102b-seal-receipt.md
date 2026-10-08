# T09 v0.10.2b evidence seal receipt

2026-10-08. The expired-before-dispatch real Task, restoration, restart audit, cleanup, helper versions and independent reviews are frozen.

- Manifest: `C:/Users/a1500/AppData/Local/Temp/router-implementation/t09-v0102b-evidence-manifest.json`.
- Entries: **75**; size: **17490 bytes**.
- Manifest SHA-256: **`8B6BF830893283FD864A0077F77818050E6298B62036CF9446DF0E3815FD8EC8`**.
- Checker: `t09-v0102b-evidence-protection-check.mjs`; SHA-256 **`FC1F4A70544BD0743BA9FA23DA10A1B1233A9573AEC1B450FD3F3365A7A594F4`**.

The static manifest includes the explicit human grant, applied renewal marker, full evidence and private logs, source helper variants and failures, native session copies/decoding, independent review originals/copies, 0.10.2 package and previous 57-file manifest/checker. Mutable live Router state and current ownership are excluded. At sealing, the home contained 232 Tasks / 539 Calls / config572, the claim referenced the sole renewed Task, and owned restart PID30992 was stopped.

The first sealer compared persistence objects against public snapshots, whose derived `ledger` field is absent from persistence; assertion formatting exhausted its buffer before creating a manifest. That script and its failure record are retained. The replacement compares every persistent Task field exactly after excluding only the public derived ledger and bounds assertion output. No state or prior evidence changed.

Actual acceptance remains BLOCK: one authorized Task, one released not-dispatched Call, zero model requests, expired access token persisted as UNKNOWN. Connection identity was retained across restart while availability changed to false; the evidence records that change explicitly. No successful inference or full connection-equality claim is made.
