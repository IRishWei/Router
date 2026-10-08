# T09 v0.10.2b helper v2 Standards review

Read-only targeted review. No live helper, RPC, process, Desktop, or model execution was performed. The original helper files and prior Standards report remain byte-for-byte untouched.

## Reviewed frozen inputs

- `t09-v0102b-helper-lib-v2.mjs` — SHA-256 `F230C08C60E69A14923C8646417CD8A98D30026F5E85710653DCC4576E5FE17B`
- `t09-v0102b-helper-guard-v2.test.mjs` — SHA-256 `B54945427E3A0F43A712CA220E05088855F55077A24511A704454CB4B9AD7658`
- `t09-v0102b-preserve-v2.mjs` — SHA-256 `0EC172866E16561EA835715F99ABA16057881E41A13EEB6F1E5F753DD1138C34`
- `t09-v0102b-restore-config-v2.mjs` — SHA-256 `97FEA96BB53610D49DA95000D3ADA1EB7D7BE0FD9FD32267E88DF07F4FB4B298`

## Targeted findings

The v2 guards close the prior Spec gap. A renewed Task now requires the exact authorized budget `{ tokens: 65536, durationMs: 120000, money: [] }`, an empty `extensions` list, `maxCalls: 2`, and `outputForecastTokens: 2048` as an estimate. It rejects retry purposes, API billing fallback, account/provider/model drift, candidate drift, and selection-snapshot identity drift.

The captured identity is required to use the ChatGPT OAuth provider and `chatgpt-subscription` billing path, with the baseline account and connection. The active selection and every Call selection/snapshot must match the captured candidate and complete identity. Prior validation Calls must remain settled. The guard test includes negative cases for budget drift, extensions, retry, API fallback, account/provider/model/candidate drift and snapshot drift; the reported red/green guard results are consistent with these assertions.

Capture remains read-only and requires 231 Tasks, 538 Calls, config version 566, null claim, unchanged historical Tasks/config/DeepSeek/native default and the prior failed Task. Later preservation checks apply the v2 constraints only after capture. Restore remains limited to public RPC/settings and preserves the renewed Task, claim, account/connection, configuration and native default.

## Conclusion

**PASS — no remaining Standards blocker found in the v2 helper scope.** The earlier Spec P1 was specifically addressed by the exact budget, no-extension, non-retry, subscription billing and identity binding assertions. Actual detect/restore/restart evidence remains pending and must be assessed after execution.

