# T09 v0.10.2b helper v4 Standards review

Read-only targeted review. No live helper, RPC, process, Desktop, or model execution was performed. v1/v2/v3 files and reports remain untouched.

## Reviewed frozen inputs

- `t09-v0102b-helper-lib-v4.mjs` — SHA-256 `8CFEC9A73C6AE5213CDC310414AC4F2783DC16D9B66333E19233663CF4A86C4F`
- `t09-v0102b-helper-guard-v4.test.mjs` — SHA-256 `94C13AC62E5E573ABB0C4F9369E2D69CD45C8821303D410B639A168F9FA49018`
- `t09-v0102b-preserve-v4.mjs` — SHA-256 `4CFE2309ACB4542B04B3E7BDA776CAC6B8F6662874BE5BB9076D3442D87A0E47`

## Targeted findings

The v4 change is narrowly scoped to the observed false failure: `nativeDefaultStableView` removes only the derived top-level `schema` object, including dynamic `uid`/`refs`. It continues exact comparison of namespace value, user, base, secrets, revision and all other fields. The guard suite includes positive schema-UID variation and negative value/user/revision drift cases.

All v3 production-identity and authorization checks remain: account-scoped `router-chatgpt-${accountId}` provider, subscription billing, captured account/connection/candidate, active selection and per-Call selection snapshots, Call-to-Task binding, exact budget, no extensions, no retry/API fallback and two-request cap. The v3 production-shaped positive clone and prior negative cases remain in the 5/5 guard suite.

The v4 preservation flow is aligned with the observed live state: baseline 231 Tasks/538 Calls/config 566/claim null, renewed state 232 Tasks/539 Calls, and subsequent restore/restart comparisons use the stable native-default view while retaining exact Router/config/Task/DeepSeek/ChatGPT preservation checks. The reported v3 acceptance had 1 renewed Task, 0 dispatches, and explicit UNKNOWN token-expired state; this review does not reinterpret that result.

## Conclusion

**PASS — no remaining Standards blocker found in the v4 helper scope.** The patch excludes only dynamic derived schema identity and retains strict comparison of all meaningful native default fields. Actual cleanup/restart evidence remains subject to execution results.

