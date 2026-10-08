# T09 v0.10.3 non-author merge verification

## Integration

- Author source freeze: `bb86707460ad2bf8a7b9a0ccf1be51f72abb9a77`.
- Base: `20693babb652c350ad334103b8f0a57a82ad9429`.
- Non-author merge commit: `d8384a320618433b8650e5a37a475789222cfb62`.
- The merge contains only the declared package metadata, ChatGPT Responses credential-error boundary fix, and T09 integration regression tests.

## Verification

- `npm run build`: PASS. Log: `C:\Users\a1500\AppData\Local\Temp\router-implementation\t09-v0103-non-author-build-20261008.log`.
- `npm run check`: PASS. Log: `C:\Users\a1500\AppData\Local\Temp\router-implementation\t09-v0103-non-author-check-20261008.log`.
- Full serial `node --test --test-concurrency=1 test/*.test.mjs`: **333 passed, 0 failed, 0 skipped, 0 todo**. Log: `C:\Users\a1500\AppData\Local\Temp\router-implementation\t09-v0103-non-author-full-tests-20261008.log`.
- Package tar listing: 29 files; built `lib/index.js` entrypoint loaded successfully. The integrated package test also verifies the built Host relative-import graph and package entrypoint.
- Protection checks: T09 b75 PASS (75 frozen), T09 a57 PASS (57 frozen), T09 prior 40 PASS, T14 PASS (63 frozen + 2 sealed prefixes). Combined log: `C:\Users\a1500\AppData\Local\Temp\router-implementation\t09-v0103-non-author-protection-20261008.log`.

## Frozen package

- Artifact: `artifacts/irishwei-dsh-router-0.10.3.tgz`
- Source package: `C:\Users\a1500\AppData\Local\Temp\router-implementation\t09-package-20261008-0.10.3\irishwei-dsh-router-0.10.3.tgz`
- Size: `183680` bytes.
- SHA-256: `22411110950D89CD377B4DAE0B5B72A2AFB73222864B2839052C7184D90543F5`.
- Copied with exclusive create; old 0.10.2, 0.10.1, 0.10.0 and 0.9.3 packages remain retained.

## Acceptance boundary

The source change is locally verified and preserves the real b failure boundary: expired credential errors become a fixed `TOKEN_EXPIRED` error without dispatch, retry or API fallback; unknown callback failures remain `UNKNOWN`. Actual b Desktop acceptance remains BLOCK/OPEN: its one permitted Task made zero model requests because the subscription token was expired. No Desktop, OAuth, credential or real model action was performed during this merge.

