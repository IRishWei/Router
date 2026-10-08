# T09 v0.10.4e real desktop acceptance

Date: 2026-10-08. Actual T09 result: **BLOCK / OPEN**. Original progress: **9/24**.

The new human reply `确认` explicitly approved the prepared 0.10.4 round. Its UTF-8 SHA-256 is `36F33ADAF0942634A8ECE1EEC4A6F30D44DEC73E1EF8704B29D983A57F2E09AE`. The authorization was written exclusively at `2026-10-08T15:31:50.314Z`, 641 bytes, SHA-256 `86B76BBF12DCDF4AC18FD3906EF1169A4D65F68D4F663B4FD573D5F5186D695F`. All six existing protection checks passed before applying the already reviewed proposal. Applying it changed only the consumed admission claim to null; original Task and Call data were retained.

The installed 0.10.4 client ran through the native Renderer and real Typert/public RPC carrier in an independently owned target DSH instance. The official system browser performed fresh same-account OAuth. Account, issued client and connection identities stayed the same; seven models were discovered. The post-login baseline was captured at `15:32:35.108Z`; the Task started at `15:32:35.742Z`, 634 ms later. Neither Codex credentials nor an API Key were used.

## Real result and limits

- Model: `gpt-6.1-sol`, from the same account's discovered ChatGPT subscription connection.
- Task: `eefbe023-a0a9-4320-85c3-a5817bdfa41e`.
- Session: `session-87956473-4b84-4c7b-aae6-e904d9e30fe3`.
- Detection Call: `9b2b6b41-e7e7-4e1e-b647-239f54ae7824`, failed with `INVALID_RESPONSE`, elapsed 2991 ms.
- Auxiliary title Call: `70301018-9f54-4b26-ac23-961c653c76b0`, failed with `INVALID_RESPONSE`, elapsed 2600 ms.
- Both were actually dispatched. Native diagnostics contain the fixed classification `Responses endpoint did not return an event stream (content type: missing)`. This establishes the adapter's observed classification; the original upstream-versus-reader cause is not yet established.
- No `response.completed`, no accepted result, and no matching `CHATGPT_CONNECTION_OK` result were obtained. Task lifecycle is paused, acceptance is unconfirmed. Known-token subtotals of zero do not mean zero use: all aggregate token fields are null, both Calls have unknown token usage and unknown price, and cash cost or subscription quota is not invented.
- Limits remained one new Task, at most two requests including title, 65536 tokens, absolute 120000 ms, full input reservation and output forecast 2048. No output hard cap is claimed. No extension, automatic retry, refresh or API billing fallback occurred. Task elapsed time was 4177 ms. This round's one-Task/two-request allowance is consumed; no replacement Task or extra model request is authorized.

## Preservation and cleanup

The original 232 Tasks / 539 Calls were retained exactly. The round added one Task and two Calls, giving **233 Tasks / 541 Calls**. Configuration values and the native default were restored, while the revision advanced from 572 to **578**. The new consumed claim remains the new Task ID. Fresh connection availability stayed true across the controlled restart; historical usage and failures were not edited.

The native session was copied exclusively and decoded across **7 Zstd frames / 19 JSON records**. Reading persistence, restoring configuration, preservation checks and restart added zero Tasks and zero model requests.

Only the exact owned acceptance PID 23592 and restart PID 31700, with verified start time, executable, home and process trees, were stopped. Five owned processes were recorded in each tree; ordinary Desktop processes stopped: zero. The final owner is `t09-v0104e/restart`, version 0.10.4, stopped=true. Target package provenance remained 29 matching files and the frozen 184530-byte package SHA-256 `E9274C673B4D7B37F1E01C89D8EC8BF97E2795A84EE782B83643DBE4C28662E3`.

Final raw state: **9045336 bytes**, SHA-256 `E7B1C7763BF5EB13A9AF02D6A974BC9CF917D4C084F33AB984D9A50DE3CF54F3`.

The flow establishes fresh authorization, bounded real dispatch, honest failure accounting, historical preservation and cleanup. Successful inference remains unverified, so T09 stays open. Independent installed Standards/Spec reports accompany this record; a source-level diagnosis may continue without another live request.
