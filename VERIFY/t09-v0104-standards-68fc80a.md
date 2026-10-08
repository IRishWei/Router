# T09 v0.10.4 source Standards review

Read-only review of `68fc80a0ccba6c317c2cd09aec1316ccfd6dc78f` against `3cd256d02b23d03297bf1fa830aac8bab838cacf`. No merge, real DSH, credentials, or model request was performed.

## Findings

The fix classifies only non-SSE responses whose exact media type is `application/json`; parameters are stripped for media classification, so a misleading parameter containing `text/event-stream` cannot pass. Non-JSON bodies are not read. JSON diagnostics consume an async body through `boundedNext`, with the original signal and the fixed 120-second absolute deadline, and enforce a 64 KiB byte bound before parsing. The enclosing dispatch `finally` closes the response resource on success, abort, timeout, malformed chunks and diagnostic failures.

Diagnostic output is shape-only. Codes are limited to the nine official allow-listed values; unknown or absent codes and parameters become `unknown`/`none`. Only the supported request parameter names are emitted. Message, detail, response contents and other arbitrary fields are never copied into the error or its cause. Non-byte chunks become `INVALID_RESPONSE`; aborted reads remain `ABORTED`; deadline expiry becomes `TIMEOUT`. Existing SSE parsing, status/error handling, request IDs, unknown usage and zero-retry policy remain unchanged.

The targeted tests cover all nine allow-listed codes, unknown/absent values, detail/response/other/invalid JSON shapes, oversized JSON, malicious chunk boundaries, secret non-disclosure, resource close, abort, non-JSON no-read behavior and the production CONNECT path. The reported native seam result is 12/14 before the fix with the two expected classification/abort failures; the fixed target suite is 23/23, with build/check and full suite reported passing (335/335). The CONNECT/native retry path remains one dispatch.

## Conclusion

**PASS — no Standards blocker found.** The bounded JSON diagnostic path preserves cancellation, deadline, byte and cleanup guarantees while exposing only an allow-listed, non-sensitive classification. Actual T09 Desktop acceptance remains BLOCK and is outside this source review.

