# T09 v0.10.4a installed Standards review

Date: 2026-10-08  
Reviewer: non-author merger (read-only)

## Result

**INSTALLED PRESERVATION: PASS.** The evidence is sufficient for the installed-chain seal gate. **Actual T09 remains BLOCK/OPEN**: this a run performed no OAuth, Task creation, dispatch, or model request, so it does not establish a successful real validation.

The fixed package identity is v0.10.4, 184530 bytes, SHA-256 `E9274C673B4D7B37F1E01C89D8EC8BF97E2795A84EE782B83643DBE4C28662E3`; `installed-hashes.json` records 29 unique file entries, each with bytes and SHA-256. Baseline PID 4380 (0.10.2), install PID 38160, and restart PID 36592 all have exact owned label/stage/home/executable evidence and are stopped. The preserved state has 232 Tasks, 539 Calls, one ChatGPT connection, and claim `8471898a-8454-4085-b79e-a6f6c5f00cc6` at before-upgrade, installed, before-restart, and restart checkpoints.

`before-upgrade.json`, `installed-state.json`, `before-restart.json`, and `restart-evidence.json` all report zero additional Tasks and zero model requests. Restart evidence reports `all232TasksPreserved`, `configurationPreserved`, `accountConnectionCatalogInferenceAndClaimPreserved`, and `nativeDefaultPreserved` true. The initial launcher failure evidence preserves the prior state, and early sealer-v3 evidence rejects premature sealing with `REQUIRED_SEAL_GATE_MISSING`; neither was overwritten.

Controlled evidence review was read-only. No DSH/RPC/model/credential operation, process operation, CLI installation, or Git mutation was performed. The four frozen protection groups remain untouched.

Key evidence hashes: `t09-v0104a-package-identity.json` is verified against the package identity above; `t09-v0104a-installed-hashes.json` SHA-256 `E9274C673B4D7B37F1E01C89D8EC8BF97E2795A84EE782B83643DBE4C28662E3`; `t09-v0104a-early-seal-v3-rejection.json` binds sealer SHA `A0C98E16F9812F3847A59C78E95D64F3022B6B0BE1FBA44321644D36B37F0FA6`.
