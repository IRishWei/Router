# T09 v0.10.2 installed-evidence seal receipt

2026-10-08. The installed-preservation and unapplied next-validation proposal are frozen without additional model requests.

- Manifest: `C:/Users/a1500/AppData/Local/Temp/router-implementation/t09-v0102a-evidence-manifest.json`.
- Manifest size: **13719 bytes**; SHA-256: **`7AE3496ED35BC295979F589589E8678B3BE2E27ECA60CBB24C760185067C2B3B`**.
- Fixed entries: **57**. Includes package copies, stopped installation/restart evidence and logs, independent reviews, temporary claim tools, unapplied proposal/backup, future-run helpers and preflight review.
- Checker: `t09-v0102a-evidence-protection-check.mjs`; SHA-256: **`B8C2319078148AAA1F1E9E1E2CE74BF2BE6896D6ECEF5B0E43B333BABE29AB26`**.
- Mutable live Router state, current ownership and future grant marker are deliberately outside the static manifest. At sealing, the original state SHA and used admission pointer were unchanged and the grant marker was absent.

All three protection checks passed: this 57-file manifest; the earlier 40-file T09 manifest; and the T14 63-file manifest with two sealed log prefixes. The installed home remains at 231 Tasks / 538 Calls, with owned PID 26620 stopped. T09 remains OPEN; the previous real allowance is exhausted and a new real run requires explicit human permission.

The preflight reviewer report is archived verbatim, including its final blank line. The default Git whitespace check reports that formatting-only EOF line; the remaining staged whitespace check passes with `blank-at-eof` excluded. No frozen report was rewritten to normalize formatting.
