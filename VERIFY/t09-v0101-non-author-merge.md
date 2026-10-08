# T09 v0.10.1 non-author merge verification

- Role: non-author integration and evidence archive.
- Author freeze: `7813bac6b47eafbf412187c0902f7d8b06439cd8`.
- Non-author merge commit: `3a86691585d3e8ed0cc54b42716abe0887cb3b8a`.
- Final HEAD: `3a86691585d3e8ed0cc54b42716abe0887cb3b8a`.

## Verification

- `npm run build`: PASS. Log: `C:\Users\a1500\AppData\Local\Temp\router-implementation\t09-v0101-non-author-build-20261008.log`.
- `npm run check`: PASS. Log: `C:\Users\a1500\AppData\Local\Temp\router-implementation\t09-v0101-non-author-check-20261008.log`.
- Full serial `node --test --test-concurrency=1 test/*.test.mjs`: **326 passed, 0 failed, 0 skipped, 0 todo**. Log: `C:\Users\a1500\AppData\Local\Temp\router-implementation\t09-v0101-non-author-full-tests-20261008.log`.
- Frozen package relative-import closure and package entrypoint coverage are also exercised by the integrated package test (`the built Host has a closed relative import graph and its package entrypoint loads`).
- T14 evidence protection check: PASS (`63` frozen evidence files, `2` sealed log prefixes, manifest identity preserved). Log: `C:\Users\a1500\AppData\Local\Temp\router-implementation\t09-v0101-non-author-protection-20261008.log`.

## Frozen package

Copied with exclusive create from:
`C:\Users\a1500\AppData\Local\Temp\router-implementation\t09-package-20261008-0.10.1\irishwei-dsh-router-0.10.1.tgz`

- Artifact: `artifacts/irishwei-dsh-router-0.10.1.tgz`
- Size: `183381` bytes.
- SHA-256: `644BE21C30A985C4EA79E7282121DF07828C0027EDCB52A854BBE0BCA7B4EAEE`.
- Prior verified recovery target: `artifacts/irishwei-dsh-router-0.9.3.tgz`; historical 0.10.0 remains a failed review artifact and is not a recovery target.

## Archived reviews

The four source reports were copied byte-for-byte into `VERIFY/`:

- `t09-v0100-standards-fdc68f9.md` (initial BLOCK)
- `t09-v0100-spec-fdc68f9.md` (initial BLOCK)
- `t09-v0101-standards-7813bac.md` (PASS)
- `t09-v0101-spec-7813bac.md` (PASS)

## External launcher read-only review

Inspected `t09-v0101a-isolated-launcher.ps1` without execution; SHA-256 is `36DDE804E0C38AFDE421FBD009502DA3D45FC7B21C5277815BBD94A0837B0987`. The script checks the frozen package before any stop, rejects ordinary Desktop processes, accepts only the exact owned PID/start time/executable/home, uses an exclusive evidence label and historical 0.9.3 baseline, and restores `DSH_HOME` in `finally`. Syntax had already parsed with zero errors. This is preparation only; the actual Desktop/OAuth acceptance remains pending.

## Status and limits

T09 remains open because the actual target Desktop authorization, subscription-scope model call, and recovery acceptance are still pending. The project remains at **9/24 closed**; this merge does not close an Issue, push, authenticate, or run Desktop.

