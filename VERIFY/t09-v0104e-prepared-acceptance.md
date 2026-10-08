# T09 v0.10.4e prepared acceptance

Date: 2026-10-08  
Reviewer: non-author merger

0.10.4 source validation is complete at 335/335. The installed read-only a run produced zero new Tasks and zero LLM requests, with 232 Tasks, 539 Calls, config 572, and the old claim preserved. DSH is stopped. The e helper chain passed its 14-file syntax review and 11/11 controlled guards; the e helper Standards and Spec preflights and the e prepared-proposal Standards and Spec audits all pass.

The prepare-only proposal is not applied. Its manifest is 2860 bytes, SHA-256 `7F8E1928B216EA2DAF44221FD4A66CF96C5C9934FC3671C84468C036D3F10074`; raw backup is 9022698 bytes, SHA-256 `F8D4B0CE2C0D6A2D07426C03EB98F5F88E9063CBCC4F77B8ECC5BE847D47C410`; proposal is 9022664 bytes, SHA-256 `CB5E9A9C5692B5109E9F8172367A04B77F30136F84D31EB70EB6A5320F7FBD3B`. The sole proposed diff is `/chatGpt/lastDetectionTaskId`: `8471898a-8454-4085-b79e-a6f6c5f00cc6` → `null`. Human authorization and claim marker are absent, so apply, browser OAuth, and Task creation remain gated.

Both earlier one-Task allowances have been consumed. The second attempt created a Task but dispatched zero model requests because the credential had expired; unused requests do not authorize a replacement Task.

The proposed fresh authorization is for one new Task and at most two requests, 65536 tokens, 120000 ms, forecast 2048, same-account official re-login and detection within 30 seconds, with extensions, retry, refresh, API fallback, and server output hard cap disabled. Earlier b/c/d chains remain retained historical evidence and are not executable; e is the only current chain. T09 remains BLOCK/OPEN, 9/24 complete.

Archived report byte/hash bindings:

- `t09-v0104c-helpers-spec-preflight.md` — 2193 bytes, `381424F7678F2DF3213F2FF2CAC5AAD35A8471C8184AC76D5564EFA978AEDEC6`
- `t09-v0104c-helpers-standards-preflight.md` — 2766 bytes, `206C470F80CF3FB34E1AD7922F1A2E0E608999BC179843202F4E996F10E58006`
- `t09-v0104d-helpers-spec-preflight.md` — 2766 bytes, `047C31C05AE3F8082298044536EC79C8691E2C358B3C59454667AC5981BF89F2`
- `t09-v0104d-helpers-standards-preflight.md` — 2657 bytes, `20FF241358367D8419E68355B5C2EB312256B6E2C70DB5F080FAEC2DADCBA08A`
- `t09-v0104e-helpers-spec-preflight.md` — 2808 bytes, `6E73F139331B0C7845C2C1C9EF2F3B48DF1324C671E455C54847D21375FFF515`
- `t09-v0104e-helpers-standards-preflight.md` — 2842 bytes, `C367DF4A68C55282A24D41484AA449A34DA1AF3179D9C5726648E17CD7BB7A4D`
- `t09-v0104e-proposal-spec.md` — 1700 bytes, `C7654CFFADA08AEA8C75E7CBEFCC0787EA614BBE26BE926FA5F39B8858DF7731`
- `t09-v0104e-proposal-standards.md` — 1529 bytes, `D6BA6A6912E5151EB090E203F44B12AE91257FA42223AB62DAA0649F468A3A23`
