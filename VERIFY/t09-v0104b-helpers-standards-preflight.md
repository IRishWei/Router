# T09 v0.10.4b helper Standards preflight

Date: 2026-10-08  
Reviewer: non-author merger (read-only)

## Result

**Prepared-chain Standards: PASS. Execution gate: BLOCK pending new human approval.**

The 14 frozen b files are syntactically valid (10/10 `.mjs` via `node --check`, 3/3 `.ps1` via PowerShell parser). The chain uses the fixed 0.10.4 package/provenance, exact owned PID/start/executable/home checks, ordinary Desktop rejection, bounded refetch/rollback and `DSH_HOME` cleanup. The launch/restart flow requires the staged manifest and prior evidence. Claim preparation is read-only; apply requires explicit authorization and both manifest and authorization SHA arguments. The template is still `decision: PENDING_NEW_HUMAN_APPROVAL`, with unresolved approval SHA/timestamp, so apply/authentication/detection are correctly blocked.

The reviewed contract preserves all 232 Tasks, 539 Calls, and config 572; retains the historical a836 task's two dispatched/unknown-usage Calls and b prior task `8471898a-8454-4085-b79e-a6f6c5f00cc6`'s single not-dispatched/released Call, while allowing only the one claim scalar transition to null. Re-login requires same-account identity and a fresh callback baseline before one new Task, at most two requests, 65536 tokens, 120000 ms, forecast 2048, no extensions/retry/refresh/API fallback/output hard cap. Provider/billing are dynamically bound to `router-chatgpt-${accountId}` and subscription identity. Restore/preserve checks retain Tasks/config/account/claim and compare native defaults while excluding only derived schema; restart reports availability expiry changes explicitly. Native session reading is all-frame/Zstd-aware and sensitive fields are excluded from evidence.

## Frozen file SHA-256 (bytes)

`apply-renewed-claim.mjs` C7AEC8F01419BF1A8654D392F4C1EF0EB6C469644C11322523BCBF42D31CBBCA; `helper-guard.test.mjs` BEC1F2A39AD5BDDBBB83EF7520D7185E82BA209EBEE28DE3CD56BFD3DA97497D; `helper-lib.mjs` 8DBC9042982E535857E82354065A90DEEAD5F52839B49104F2479FC9709B196A; `human-authorization.template.json` B389704970C47731BF60FBAA358ABF934930713544274B8D54A5452CDA28E783; `launch-owned.ps1` E596650470DA98D782FD9A570DF8FFFBD690AFA618A3F755640FC4BF26D1002D; `prepare-renewed-claim.mjs` D5BBE7BBF00FA7E0F3AAD0E810923EC3DCF5FE819455392E54A9DD44BA4F4B5C; `preserve.mjs` 845724BC74F64218E7EAE6375E2DF8A3D1A30F8C85C06D14FE613E4B986A4408; `read-native-session.mjs` C4048EAFD806B4552B1BBDDCF1DFE93D089C34EEAFD18706D70C628A516BA388; `relogin-detect.mjs` 48F7AF65BC3B2A95DDAF008D96572333B59C3DE8D8262FDBEB08968EB42EC2A3; `renewed-claim-guard.test.mjs` 4401606946053709DB7D54BF0B3744085C7FBAB903DA9A6ADE1F9C893FDBA33D; `renewed-claim-lib.mjs` CC895D76EDEDA654F09F9B192D14CB99469F07AB56BB8581BCF817C2D7E5F50E; `restart-launcher.ps1` F58F426CDE1CB0FC8460B6CF6CC13743C29B31B734C4A84C9E75272A0600F97E; `restore-config.mjs` E22328777F5BBFF8C9DB04E7561B98099EC1960F871E548A34C3E97069D4EA92; `stop-owned.ps1` BB825A4BA884C1C6209AC4E1D2A3C0A8FDACFFBCB1757528F7BD47DB61ECBFCA.

No live DSH, RPC, CLI installation, Desktop, credentials, model request, or Git mutation was performed.
