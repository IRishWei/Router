# T09 v0.10.3 source Standards review

Read-only review of the author freeze `bb86707460ad2bf8a7b9a0ccf1be51f72abb9a77` against base `20693babb652c350ad334103b8f0a57a82ad9429`. No merge, DSH execution, credential access, real model request or push was performed.

## Findings

`credentialError` preserves an existing `LlmError` by identity. For other `Error` values it reads only an own data property descriptor named `code`; inherited codes and accessor getters are ignored, and descriptor access failures are caught. Only the exact own value `TOKEN_EXPIRED` maps to the fixed safe `LlmError` message/code. Unknown values are returned unchanged for the native boundary to classify as `UNKNOWN`. The mapping does not copy arbitrary message, cause, token or response body data, does not refresh credentials, retry, fall back to API billing, or perform login.

The new integration coverage verifies the expired grant path produces a paused Task with `TOKEN_EXPIRED`, one proposed Call, released reservation, null usage, zero transport requests and no retry; it also verifies an unrecognized credential failure remains `UNKNOWN` with zero dispatch. It checks the account-scoped Router provider and subscription billing identity. The reported native seam result is 6 pass / 1 expected fail (`UNKNOWN` before the fix), integration is 8/8, combined Responses/integration/proxy is 21/21, with build/check passing.

The package version is consistently advanced to 0.10.3 in `package.json` and `package-lock.json`. The patch is local to the credential callback boundary, its integration regression coverage and version metadata.

## Conclusion

**PASS — no Standards blocker found.** The source fix keeps existing typed errors intact, maps only a safe own data `TOKEN_EXPIRED` code, and preserves the required zero-dispatch/released-Call behavior. Real target Desktop and subscription validation remain outside this source review.

