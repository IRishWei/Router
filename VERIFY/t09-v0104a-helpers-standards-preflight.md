# T09 v0.10.4a helper Standards preflight

Read-only review; no DSH/RPC/CLI install, Desktop, OAuth, credential or model operation was performed.

Reviewed frozen files and SHA-256:

- `t09-v0104a-package-identity.json` — `84810094BD09F711DB5D7D73B231ABDB6E2C731C950B94350D4F6C56F0770F79`
- `t09-v0104a-launch-owned.ps1` — `CF11B629A10F21379C6FAE2ECC74C00A5FB74BFF44B8EF2FED287EB1391A917E`
- `t09-v0104a-preserve.mjs` — `D24C0C65E6B358F1357A7D396987E790954CE11B296CE8D4FBFD79D1847E4940`
- `t09-v0104a-stop-owned.ps1` — `3C2ED610C0E68D41512C188835C9F30DB9CA039A7C4198292225CDC8C947BCBC`
- `t09-v0104a-restart-launcher.ps1` — `5E576D601FDF7925069F82744F78C8B1346D3F93EFD856CBE5FDB11625AB1ADD`
- `t09-v0104a-seal-evidence.mjs` — `350C21EE1347CBAE0B82F93E828405B45CFE7FAF29C8FC5CD90D70AA62525B10`

## Result: PASS

The chain enforces 0.10.2 baseline → exact owned stop → official 0.10.4 install → 29-file provenance/full-state check → pre-restart → owned stop → restart → restart-check → final owned stop → post-review seal. Package identity is filled with 184530 bytes, SHA `E9274C673B4D7B37F1E01C89D8EC8BF97E2795A84EE782B83643DBE4C28662E3`, 29 files.

Evidence helpers allow only `router/snapshot` and `settings/describe`; assert 232 Tasks/539 Calls/config 572/claim `8471898a-8454-4085-b79e-a6f6c5f00cc6`, preserve account/connection/catalog/inference/claim and native default, and compare native default while excluding only top-level derived `schema`. Persistence comparison excludes only RPC-derived Task `ledger`. All evidence writes use exclusive creation; old manifests and protected groups are checked unchanged.

Launch/stop helpers require exact PID/start/exe/home ownership, reject ordinary or path-unreadable Desktop processes, verify owned trees, use fresh labels, and restore `DSH_HOME` in `finally`. Restart rollback can stop only the just-started process after matching PID/exe/start time. Seal runs only after installed review/archive and records zero new Tasks/model requests. No reserved `$HOME` variable is used.

Actual T09 acceptance remains BLOCK because the consumed grant had an expired token; this preflight does not change that result.

