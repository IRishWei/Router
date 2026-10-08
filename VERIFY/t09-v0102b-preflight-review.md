# T09 v0.10.2b preflight review

Read-only review completed without running either helper, starting Desktop, or making model requests.

## Inputs

- `t09-v0102b-launch-owned.ps1` SHA-256: `732E8005B2E5F84B392F770E798A1C0968BAA5D1C94872878FA45822B4AA2296`
- `t09-v0102b-renderer.mjs` SHA-256: `EC7BA3A5F739327CB1B0BFC7A9DCDE3DF9875C34E65A466C07B89CFD9C8464B4`
- Staged proposal manifest SHA expected by the launcher/renderer: `89dbb6f501676d32d30361cf23636ab9c3805cabbddfdaa9a4f6751fbd310366`.

## Findings

- Launcher requires the stopped `t09-v0102a` 0.10.2 owner, frozen package identity `183603` bytes / SHA `9527C25C9C0A0CE0525E06705A91CA2C24E0E2A63EC5F402E708B36895B9DA2B`, 29 installed files, the staged manifest, proposal-state SHA, and renewed grant marker. It rejects any existing Desktop process, does not stop a process, writes a new `t09-v0102b` owner, and restores `DSH_HOME` in `finally`.
- Renderer requires the new grant marker and manifest provenance, the installed 0.10.2 client, 231 Tasks and 538 Calls, and the prior failed Task `a836c60e-05dd-4de9-a340-07e1b0a7cb5e` with `maxCalls=2` and two Calls. The detect phase creates at most one new Task and two requests, uses `65536` token reservation and `120000` ms deadline, preserves all historical Tasks/configuration, and retains the old helper's loading wait.
- Authorization and read-only inspection phases assert no new Task or inference request; browser navigation is limited to the official HTTPS authorization URL and rendered state does not retain it.
- No `t09-v0102b` marker, owner, or evidence label was executed or created during this review. Human authorization for the new real acceptance is still required.

## Boundary

Preflight is structurally consistent with the stated grant and preservation constraints. This note does not certify the staged marker, grant, Desktop launch, OAuth flow, or model result; those remain pending and must be performed only after explicit authorization.

