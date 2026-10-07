# T14 controlled companion 0.3.4 implementation evidence

## Design decisions and invariants

Independent Standards and Spec reviews both blocked companion 0.3.3 on one P2: the declared 32 KiB review envelope was measured after `JSON.parse` by compactly reserializing the object. Legal JSON with large whitespace or long escape spelling could exceed the raw transport bound and still receive a predetermined verdict.

Companion 0.3.4 applies one raw UTF-8 limit before parsing any JSON review prompt:

- Raw review prompt at 32,768 bytes is accepted if its protocol structure is valid.
- Raw review prompt at 32,769 bytes is rejected before any output or usage chunk.
- Leading, trailing, and internal JSON whitespace count.
- Unicode escape spelling counts by its raw UTF-8 representation.
- Non-JSON title requests retain the existing local-title behavior.

The unified 32 KiB limit is a finite transport boundary of this validation fixture. It does not change Router 0.9.3's product research schema, policy, or limits. The existing research schema remains the first accepted schema after parsing, and the strict rubric structure and compact-form bound remain unchanged.

All 0.3.3 invariants remain: exact keys and digests, nonempty fields, unique 1–16 rubric requirements, 16 KiB artifact, 4 KiB rubric, four fixed models, latest actual-human selection, source-less Adapter compatibility, sourced Host-context exclusion, signal propagation, complete fixed usage 8, 65,536 context metadata, and no network/file/environment/credential/tool/publish/permission/budget capability.

## TDD evidence

The new boundary regression covers two legal raw encodings:

1. Research six-key JSON with leading whitespace.
2. Rubric JSON with internal whitespace and Unicode-escaped rubric text.

For each, the test constructs exact 32,768- and 32,769-byte raw prompts. The over-limit path records all emitted chunks so it can prove that neither text nor usage preceded rejection.

RED command:

```powershell
node --test --test-name-pattern "raw research and unicode-escaped" test/companion.test.mjs
```

RED result: 0 passed, 1 failed. The 32,768-byte research prompt succeeded with full usage, but the 32,769-byte prompt was also accepted, leaving the expected error empty.

Minimal fix: after recognizing a potential JSON review via `trimStart`, `parseReview` measures the original `prompt` with `TextEncoder` and rejects values above 32 KiB before `JSON.parse`.

GREEN result for the same command: 1 passed, 0 failed. Both research and escaped-rubric encodings accept exactly 32,768 bytes and reject exactly 32,769 bytes with zero chunks.

## Validation results

- Source `npm test`: 11 passed, 0 failed.
- `node --check lib/index.js`: passed.
- Fresh extracted-package `npm test`: 11 passed, 0 failed.
- The public Adapter and real Router 0.9.3 `AcceptanceCoordinator` rubric regressions remain green.
- Existing research protocol priority and output, rubric pass/conflict/unconfirmed behavior, four models, standard Host, source filtering, signal, usage, and inference ordering remain green.
- Additional negative tests now include duplicate requirement IDs and the exact 4,096/4,097-byte rubric boundary.

Test SHA-256: `466948915BC7F11638FFF0C6711A8ACAF04896B81D6B8EFBF3725C1119602257`.

No Desktop, RPC, Task, network, paid call, credential access, ROOT production edit, or actual v093c validation occurred here.

## Immutable package

The 0.3.4 destination was absent in temp and ROOT artifacts. The package was built in a new staging directory and copied to the temp artifact path with exclusive-create semantics.

- Path: `C:/Users/a1500/AppData/Local/Temp/router-implementation/t14-companion034-source/artifacts/irishwei-dsh-router-native-companion-0.3.4.tgz`
- Size: 3,980 bytes
- SHA-256: `CB5127BAFE4CE2784700BFD6747EC4F60EB07563326B7C6816ACD086213A53B5`
- npm SHA-1: `6c80eb327487c9bf5fb9593054c80a347a0d57da`
- Exact entry count: 4
- Manifest: `artifacts/manifest-0.3.4.json`

| Entry | Source and packed SHA-256 |
|---|---|
| `package/lib/index.js` | `64BF99078E13E30BA436EB6284782464BF1EE67AF1FBBBD67D8E330D245966CB` |
| `package/package.json` | `E83FD9516FC0DA3625B0CA0BEABD7C47846AAA566F5C9CCF2DF472769C5ECB62` |
| `package/README.md` | `85280A67AEA95AE39ED9AE9AD995BE8570A7E662CDF3AC4C4C27776CB460D186` |
| `package/cordis.patch.yml` | `FDB3F97B7396B2D3C8BE1626761E7CAE90CB8F42B5EE7FFB6BB0405C5D73EDB8` |

All four packed entries match source byte-for-byte. Tests, `VALIDATION.md`, manifests, and `node_modules` are excluded from the package closure.

The blocked, never-installed 0.3.3 package remains immutable at 3,877 bytes with SHA-256 `B606AB23EEF596F77C67E40880F6CB317B4AAA568535E414C47E0D82F8A7BA60`.

## Compatibility, risk, and rollback

Only raw JSON review inputs above 32 KiB lose acceptance. Existing Host payloads in this validation are much smaller and already constrained by the 16 KiB artifact bound and Router's 4,096-token review forecast. There is no evidence of a required legal validation input above this finite boundary.

The main remaining risk is future fixture data approaching 32 KiB through a different encoding; the raw byte boundary makes that behavior deterministic. Rollback to 0.3.3 restores the reviewed bypass and must not be used for actual validation.

## Independent reviewer package

Requirement: verify raw bytes are checked before `JSON.parse`, exact 32,768/32,769 behavior for whitespace and Unicode escapes, zero-chunk over-limit rejection, and preservation of both strict review schemas and all prior trust/capability boundaries.

Baseline: immutable 0.3.3 package and its two BLOCK reports. Delta: isolated `t14-companion034-source`, this report, manifest, and immutable 0.3.4 tarball. Neither 0.3.3 source nor its package was edited.

Review重点: check-before-parse ordering; use of original prompt bytes rather than parsed serialization; research-first protocol validation; non-JSON title behavior; exact output/usage absence on failure; four-entry byte closure; fixture-only documentation; no actual-installation claim.

Evidence: focused RED→GREEN, source and extracted package 11/11, syntax check, exclusive-create identity, preserved 0.3.3 identity, and four byte-identical closure hashes. Independent Standards and Spec reviewers must determine acceptance before ROOT copies or installs the package.
