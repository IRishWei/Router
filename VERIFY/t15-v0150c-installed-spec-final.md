# T15 installed evidence — final independent Spec review

**PASS — 0 findings.** Issue #16 may be closed for the explicitly documented finite source/controlled Desktop multimodal engineering scope. This does not certify production vision quality or waive final #22/#25 gates.

## Fixed identity

- Independent Spec reviewer `/root/t11_real_spec`; did not implement the feature.
- Root source HEAD verified: `2219efb7211bd4965777d919374bac10767bcee0`; original source BASE `216b49684a80d2350b730549f8c8402fe77ea0ed`. Earlier source and three external harness-delta Spec reviews remain preserved.
- Version 0.15.0; frozen package 219760 bytes, 36 files, SHA-256 `1DFA02BBA32F7C937139A00ABA3400CC88D3B94292B76D83AEF4206270F4FD24`.
- Final `t15-v0150c-validation-frozen.json` SHA-256 `88DD1C7F019D81BE47E0121C9AE23F4A53EC8A2A6BDD73609AEED69FBA036EEB`: independently checked all 59 listed evidence files' bytes/hash, with no mismatch. Package bytes/hash and all 36 installed file identities independently matched.
- Authorities: shared Issue #1/#16 snapshots and approved sequence amendment. The amendment changes development sequence, not T15 functional requirements; official API/second-account gates stay #25 and real effectiveness stays #22.

## Issue requirements and actual evidence

Issue #16: “保持输入图像与任务要求，图像任务不分给无法接收该输入的文本候选；能力未知明确处理。”

The installed public Desktop SessionController/AgentLoop/native Adapter path admits the original image reference and binds user message/request origin, immutable attachment/hash and requirements. Independently checked origin/hash consistency across public proof and actual Adapter request image metadata. The executed fixture uses public attachment `readImage` and records actual bytes/dataHash (`t15-v0150c-executed-fixture.mjs:57`). Both unknown-image pool and text-only pool image Tasks pause with zero Task Call and zero actual stream. Their explicit setup Tasks are separately accounted for; none is hidden in zero-dispatch claims. Source admission and gates remain as reviewed (`src/acceptance.mjs:124`, `src/image-acceptance.mjs:29`, `src/index.mjs:478`).

Issue #16: “支持识别/定位/解释的参考样例和歧义样例，不把开放式推测当作已知事实。” / “已知答案、明确要求与必要评审分别记录，冲突或不足保持无法确认。”

Public proof covers three finite recognition/localization/explanation answers, a deterministic mismatch and ambiguous identity. Known case passes exact declared references; wrong answer fails without a review override; ambiguity stays unconfirmed. Reference, explicit-rubric, binding and answer-match records remain distinct. Normal image review is passed after one actual multimodal review; high-risk conflicting reviews and wrong image-hash results each remain unconfirmed after two. Raw contribution is not mistaken for canonical reviewed evidence. Shared-limit case has two ordinary reviews, zero image-review streams and exact canonical `REVIEW_ATTEMPT_LIMIT`/unconfirmed with those two Call IDs (`src/acceptance.mjs:399`). Strict artifact/requirement/image response validation remains the reviewed source at `src/acceptance.mjs:637`.

Issue #16: “图像请求、返回及评审消耗进入账本，能力/格式不匹配在调用或交接前可见。” / Issue #1: “判断、咨询、执行、任务内评审、重试和重做全部计入任务。”

Independent arithmetic on full Desktop evidence: 26 Tasks = 13 image Tasks + 13 explicit setup Tasks; 44 Calls = 44 recorded actual local Adapter streams = 44 entries in public proof. All Calls complete on `router-t15-controlled-fixture`; usage sum and Task ledger sum both equal 352 preset fixture tokens. Maximum reviews per Task is two; budget extension entries are zero. Anonymous review identity checks are all false, and actual image-read hashes match attachment identifiers. Unsupported image reviewer, absent visual pricing, unsupported format and insufficient capacity retain execution outputs with zero review Calls/streams and visible exact reasons. Actual spend remains unknown for Tasks with Calls; no preset token or visual forecast is promoted to confirmed billing/quota (`src/acceptance.mjs:507`, `:521`; installed document states these limitations).

Issue #16: “受控完整任务和目标桌面兼容模型路径分别验证；不扩展到图片生成。”

Previous 39 full Task source tests and this separately installed actual rc.2 Desktop native Adapter/RPC path establish the finite engineering behavior. Final restart receipts and public logs show restart/RPC and installed Renderer verification actually passed. Restart branch strictly compares all 26 Tasks/Calls/ledgers, config, fixture counter and native default; it sends no prompts or new streams. Configuration/default restoration is documented without claiming restoration of a monotonically advancing configuration version. Installed Renderer file hash is verified; its verified ID order independently equals exactly the last 20 stored Tasks reversed. Six early Tasks are explicitly outside the existing window (`src/client.js:287`), and no screenshot/visual appearance claim is made. Both owned stage stop receipts retain exact owners and child counts (4 controlled, 6 restart). No production adapter image support or generation path is claimed.

## Failure preservation and boundaries

The a argument-shape failure, b canonical-evidence assertion failure and c recent-window Renderer assertion failure remain unchanged and separately labeled. Their 12/19/28 captured files are covered by preserved manifests and the final complete-preservation receipt. The explicit pre-restart sealed-state plan and copy bind the original c state entry; complete-preservation checks that exact substitution instead of rewriting the original manifest, and records live state equal to sealed bytes. This closes the preservation follow-up from the earlier Renderer delta review.

Independently rehashed the older 76 + 90 = 166 frozen entries and 19 + 20 = 39 T07 entries, all matching; old Go/compatible package bytes/hash also match. The earlier 9114595-byte historical state identity remains recorded in preservation evidence. No old failure was relabeled a successful completed run.

The final document's claims stay within observed data. The controlled native Adapter Desktop path is a compatibility/engineering path, not real Go vision. Go/custom-compatible/ChatGPT production adapters remain text-only. Declared 64 visual tokens per occurrence and preset eight-token stream usage certify neither production image-token bounds nor vision accuracy, spend, quota or routing gains. Official APIs/second-account final #25 and real effectiveness #22 remain required. Under that stated finite scope, no remaining Spec defect blocks closing #16; closing it must retain these limits visibly.

No models, Desktop processes, RPC, installations or tests were executed in this review. No keys/private logs/Codex configuration were read. No root, frozen artifact or Issue was modified; only this requested shared review was written.
