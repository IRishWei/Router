# T17 fresh-label assertion correction after b

Label t17-v0160b is strictly stopped and frozen with 42 original captured files.
The first execution Call settled failed/undispatched with released reservation;
there were zero Adapter streams. Its one raw middleware observation is the
non-native session-title request with no tools. That title observation does not
prove the native source tool catalog was empty.

The b fixture added a strict deepEqual of native Array.map results against a
fixture-local array before recording the actual native request. DSH runs profile
plugins in a module VM. Identical array values across module realms can fail
Node's strict deep equality because of different array prototypes. The recorded
error is UNKNOWN; no stronger diagnosis is inferred from that code alone.

Before the next fresh label, the exact two-tool criterion is expressed as equality
of JSON.stringify(sorted names), preserving the full name/count assertion while
removing irrelevant realm prototype comparison. The complete raw native request
is now recorded before that assertion, together with sorted native tool names
and whether its public tools array shares the fixture realm's Array.prototype.
The created callback also observes and asserts the public schemas(agent) catalog
before any queued input is released. These observations make another divergence
diagnosable without discarding it.

All source/package identities, budgets, preset responses, full-history/DTO checks,
ledger, refusal, Renderer and restart requirements remain as previously declared.
These are external fixture/assertion changes only, using a new label and no
production requests. The prior a/b frozen bytes remain hash checked.
