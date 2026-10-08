# T09 0.10.1 acceptance report correction

The sealed `t09-v0101a-desktop-acceptance.md` describes “19 Zstd frames.” The captured Session actually contains **7 compressed Zstd frames**, decoding to **19 JSON records: one header and 18 events**. `t09-v0101a-failed-session-persistence-page.json.frames` and the evidence manifest record the correct frame count of 7.

This corrects only the compression description. The HTTP 200 / non-SSE failures, 1 Task / 2 real requests, unknown usage, preserved history, independent review results and T09 OPEN status are unchanged. The original sealed report and manifest remain intact.
