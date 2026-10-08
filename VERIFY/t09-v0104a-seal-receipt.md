# T09 v0.10.4a seal receipt

The read-only 0.10.2 → 0.10.4 upgrade and restart evidence is sealed after all six source/helper/installed review records passed and their exact bytes were committed in archive `fa6b638ef080580c4eaa3ce48eb4cef21591a957`.

- Manifest: `C:/Users/a1500/AppData/Local/Temp/router-implementation/t09-v0104a-evidence-manifest.json`.
- Manifest size: **20292 bytes**; SHA-256 **`D0BA4960C3E8A5668E23E39F0BF9396A07C8755D11C9D028ADBAA23ED1D88E45`**.
- Frozen entries: **82**.
- Checker: `C:/Users/a1500/AppData/Local/Temp/router-implementation/t09-v0104a-evidence-protection-check.mjs`.
- Checker SHA-256: **`6F0A0534240A28FE12F2CEF9187910310042E48C038697A3C93F9A582FC89229`**.
- Seal gate SHA-256: `C83EF662512F6EAEC44C631693072CE6D4369346168A525FF1F83383CD225C04`.
- Package: 0.10.4, **184530 bytes / 29 files**, SHA-256 `E9274C673B4D7B37F1E01C89D8EC8BF97E2795A84EE782B83643DBE4C28662E3`.

The checker passed immediately after sealing. All four prior protection groups passed: T14 63 files plus two sealed prefixes, first T09 40 files, T09-a57 and T09-b75.

This seal covers zero new Tasks, zero model requests, no OAuth or admission-claim change, and complete preservation of 232 Tasks / 539 Calls / config572. The connection remains expired/unavailable and the consumed claim remains `8471898a-8454-4085-b79e-a6f6c5f00cc6`. The final owned restart PID 36592 and its tree are stopped; ordinary Desktop processes stopped: zero.

Mutable live state/owner and future real-run preparation are excluded. Actual T09 acceptance remains **BLOCK / OPEN**. Further real inference requires a newly authorized Task and fresh same-account official sign-in; this seal does not extend an earlier allowance.
