# Source-path succession v1 review

Result: **BLOCK**. Reviewer: primary agent, independent of the author. This review changes no source or frozen evidence.

- The succession checker verifies a self-consistent manifest/checker hash pair, but does not pin the new manifest's bytes with a literal external identity. Synchronized manifest/checker edits could therefore change the intended evidence mapping.
- The remaining-entry loop verifies membership and a count of 95, without ensuring exact unique coverage of the original 100 minus the fixed five. The five relative names are fixed, but their original paths are not individually bound to the corresponding repository path.
- Negative guards compare hashes or sets directly instead of executing the production validation logic. They do not establish that the checker rejects those fixtures.

Preserve all v1 bytes. A new v2 must pin the new manifest literally, enforce exact path mapping and coverage, and exercise the production verifier on controlled negative fixtures. No Task, model request, OAuth or additional permission is involved. Actual T09 remains BLOCK/OPEN.
