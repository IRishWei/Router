# T09 v0.10.4e source continuity v2 Standards review

Date: 2026-10-08  
Reviewer: independent non-author, read-only

## Result

**BLOCK.** v2 fixes the substantive v1 coverage and guard-execution defects, but one required audit invariant is still absent.

## Finding

- **P1 — required literal size/count pins are not implemented.** `t09-v0104e-preparation-continuity-check-v2.mjs:13-16,61-70` literal-pins the v2 manifest SHA, original manifest SHA, original checker SHA and archive commit, but it has no literal `36926` v2-manifest byte count, no literal `26518` original-manifest byte count, and no explicit `100` original-entry assertion. The reviewed contract requires all three alongside their hashes. A cryptographic hash already constrains the bytes in practice, so this is an audit-contract gap rather than an observed continuity bypass. Preserve v2 bytes; a successor should add the three literal assertions before parsing/coverage validation and add controlled size/count rejection guards.

## Verified behavior

- v2 manifest is 36926 bytes, SHA-256 `288D7C10056D0C35C6B50FEA84528A95DC5976D5299FADEC72D8C1E902DAD16A`; fixed entry and review copy are byte-identical, SHA-256 `263CA5D64BBF8BCE1C06B67FF7AED702E38E7DD2D78339005648768FEA185C69`.
- Original manifest remains 26518 bytes / 100 entries / SHA-256 `A9D5F0EC0930A638ABB3F008D3C984C6F7831F5821DF30A085209079D4A0198E`; original checker remains SHA-256 `E38C283B074E3C53AB2AB28CD6DC322024FA0FF5B479974DBE013F7FA56AD181`.
- The real checker passed with 5 immutable snapshots and exact 95 remaining paths. The five `relativePath`/`originalPath` mappings are unique and fixed; the 95 remaining paths are unique and exactly derived from the pinned original manifest. Current working-tree drift of the five source paths is not consulted.
- `node --test continuity-guard-v2.test.mjs`: 5/5 PASS. Modified snapshot and original-manifest bytes reach `validateContinuity` and are rejected. Non-five mapping and duplicate remaining-entry fixtures execute `validateManifestShape`, the same production shape validator invoked by `validateContinuity`, and are rejected; these guards are not vacuous.
- No product suite, live state, authentication, DSH, RPC, network, model request or Git operation was used.

## Standards notes

No Fowler smell rises to a blocking design issue. The validator is small, cohesive, fail-closed, and keeps the future-mutable five paths separate from the exact remaining 95-path set. Unused `dirname`/`join` imports at line 6 are minor cleanup only.