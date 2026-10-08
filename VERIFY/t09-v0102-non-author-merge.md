# T09 v0.10.2 non-author merge verification

## Integration

- Starting HEAD: `4126cc5076e4675cd08da3ffbe1bb58fb527cb05`.
- Author source fix: `0665b4135587958476c464caa9bcf505379e5ea6` (independent standards/spec PASS).
- Independent test fixture: `930543ba03e09a3b91f480d3fd55ebf55239165b` (includes `5814808`, independent standards/spec PASS).
- Non-author merge commits, in order: `092d901` (source fix), `9c143b6` (TLS fixture tests).
- Final HEAD: `9c143b6`.

## Verification

- `npm run build`: PASS. Log: `C:\Users\a1500\AppData\Local\Temp\router-implementation\t09-v0102-non-author-build-20261008.log`.
- `npm run check`: PASS. Log: `C:\Users\a1500\AppData\Local\Temp\router-implementation\t09-v0102-non-author-check-20261008.log`.
- Full serial `node --test --test-concurrency=1 test/*.test.mjs`: **331 passed, 0 failed, 0 skipped, 0 todo**. Log: `C:\Users\a1500\AppData\Local\Temp\router-implementation\t09-v0102-non-author-full-tests-20261008.log`.
- Integrated package coverage reports a closed built relative-import graph and loadable package entrypoint; no package build/import failure was observed.
- `t09-v0101a-evidence-protection-check.mjs`: PASS, 40 frozen files and manifest identity preserved.
- `t14-v093e-final-evidence-protection-check.mjs`: PASS, 63 frozen evidence files, 2 sealed log prefixes and manifest identity preserved.
- Protection log: `C:\Users\a1500\AppData\Local\Temp\router-implementation\t09-v0102-non-author-evidence-protection-20261008.log`.

## Frozen package

Copied with exclusive create from the frozen source package to `artifacts/irishwei-dsh-router-0.10.2.tgz`.

- Size: `183603` bytes.
- SHA-256: `9527C25C9C0A0CE0525E06705A91CA2C24E0E2A63EC5F402E708B36895B9DA2B`.
- Existing 0.10.1, historical 0.10.0, and verified recovery 0.9.3 packages were retained.

## Desktop evidence archive

The four parent-prepared `t09-v0101a-*` reports were added to `VERIFY/` without modifying the three frozen report contents. The erratum records the corrected compression description: **7 Zstd frames decode to 19 JSON records (one header plus 18 events)**. It leaves the HTTP 200 non-SSE failures, one Task/two real requests, unknown usage, preserved history and T09 OPEN status unchanged.

## Acceptance boundary

The 0.10.2 source fix and controlled tests pass: resolved zero-retry policy, fixed non-SSE response classification, native retry regression, proxy TLS and controlled PEM coverage. This does not convert the earlier real Desktop result into a pass. The authorized 0.10.1 Desktop Task used one OAuth account and 7 catalog models, but both real requests returned HTTP 200 non-SSE and no `response.completed`; the allowance is exhausted, the owned Host is stopped, and no new Desktop/model request was made.

T09 remains **OPEN**, with **9/24** Issues closed. Actual successful subscription inference and complete result persistence remain unverified. No credentials were read, no Desktop was started or stopped by this integration run, no Issue was closed, and nothing was pushed.

