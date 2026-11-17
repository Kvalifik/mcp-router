# Read-only code-mode prototype benchmark

Measured 2026-10-23 on macOS arm64, Node v22.14.0. Run again with:

```sh
node scripts/benchmark-read-code.mjs
```

## Result

The prototype substantially reduces data returned to the caller for paginated
filtering, but adds sandbox startup and JSON transfer overhead. It does not yet
reduce upstream calls or improve execution time in this synthetic comparison.

| Dataset | Path | Median elapsed | Returned JSON bytes | Request JSON bytes | Upstream opens | Upstream calls | Matches |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 item | Existing router | 7.76 ms | 5,006 | 150 | 1 | 2 | 1 |
| 1 item | Read-code | 98.75 ms | 131 | 498 | 1 | 2 | 1 |
| 1,200 items | Existing router | 122.08 ms | 5,821,296 | 1,824 | 12 | 24 | 120 |
| 1,200 items | Read-code | 342.59 ms | 5,634 | 498 | 12 | 24 | 120 |

For the larger dataset, returned JSON is about 99.90% smaller, while execution
adds about 221 ms. Twelve caller-level read requests become one code request;
the internal reads and ownership lookups are unchanged. Output equality is
asserted on every trial, including exact IDs, names and ordering.

## Method and interpretation

The benchmark uses the real Router, Store, operation catalog, schema validation
and collection ownership checks with an injected synthetic upstream. It never
reads real projects, OAuth grants, or customer state. Each item has an ID, name,
category and a roughly 4.5 KB synthetic body. Both paths page through the same
items in batches of 100 and select every tenth item. This deliberately exercises
local filtering; production scripts should still use upstream filters when those
can answer the question efficiently.

Each scenario has one warmup pair and five measured pairs, alternating execution
order. Values are medians. Every trial starts with a fresh synthetic store and
normal project preparation; preparation is identical and excluded from the
measurement. Each upstream open and call has a fixed 2 ms simulated delay.
Each read performs a collection ownership lookup plus an item listing, explaining
the 24 calls for 12 pages. The real connection handshake, Webflow guide exchange,
network latency, rate limits, LLM turns, MCP stdio and IPC are not simulated or
included in these timings. The integration tests separately cover MCP stdio.

Returned bytes count serialized response JSON, including the code-mode statistics.
Request bytes include the script or ordinary read arguments. These are UTF-8 byte
measurements, not token counts. The baseline processes each response immediately
in the harness to verify equality but counts the complete response exposed by the
normal tool. A client that already filters results outside the model may achieve
similar context savings without this feature. The fixture's large bodies make the
size reduction especially pronounced; this is not a prediction for every task.

## Scope and next experiment

The prototype is exposed as `read_webflow_code` for Managed projects. Every bridge
read reuses the existing `read_webflow` dispatcher. It supports reviewed reads
within one project, with no workspace/account operations, writes, file exports,
automatic retries or upstream session pooling. Use ordinary reads for small tasks.

A follow-up performance experiment should compare a bounded session reused within
one run against this same baseline, retaining ownership and policy rechecks for
every operation. Measure actual handshake costs and rate limits on an explicitly
selected test project before claiming a live Webflow speedup. Designer operations
that depend on shared page state must remain serialized.

## Validation follow-up — 2026-10-29

The current source suite passed 216 tests, with one Windows ACL test skipped on
macOS. The UI build passed with the existing chunk-size warning. The synthetic
benchmark was rerun and again asserted identical results in every trial.

### Packaged runtime

The existing local macOS arm64 development package contains the prototype. Its
`read-code.js`, worker, router, permissions and stdio source files were compared
byte-for-byte with the checkout and matched. It contains QuickJS 0.32.0 and runs
Node v24.21.0 through Electron. This is a local development package labelled
0.8.10, not evidence that the feature exists in a published release.

Both the general packaged-daemon smoke test and the new
`node scripts/smoke-read-code.mjs` passed. The latter starts an isolated synthetic
store and exercises the packaged MCP stdio client, IPC daemon, router, worker and
WASM dependency. It verifies tool discovery, three-page filtering, rejection of a
known write operation and denial after CMS read permission is revoked. No live
profile or credentials are loaded by this smoke test.

### Bounded live read comparison

Project preparation and exact operation schema discovery were completed through
MCP before testing. The selected sandbox project used Stable and had no enabled
site rules or skills. No project configuration or Webflow content was changed.
Project identifiers and content are deliberately excluded from this report.

The installed router does not expose `read_webflow_code`. Therefore this live
check bridges the actual prototype worker to the installed router's ordinary
`read_webflow` calls through MCP stdio and IPC. The installed daemon retains
OAuth credentials and enforces its existing permissions and ownership checks on
every read. This verifies live response compatibility and worker execution;
it is not an end-to-end test of an installed code-mode release. The complete
prototype dispatcher was tested separately in the synthetic packaged test above.

Three paired trials alternated baseline/worker order. Each trial read five items
in three pages of two, with a stable name sort, and projected the same ID/name-
presence fields. Equality was checked in memory; only aggregate metrics were
printed. There were 18 operation reads in total, with no failures observed at
this cadence and no automatic retries.

| Metric (median) | Ordinary MCP reads | Worker via ordinary MCP reads |
| --- | ---: | ---: |
| Elapsed | 7,465 ms | 6,755 ms |
| Returned JSON bytes | 14,171 | 291 |
| Read operations | 3 | 3 |
| Items | 5 | 5 |

Returned JSON was 97.95% smaller. The worker byte count includes its output
envelope but not production dispatcher statistics. Baseline timings ranged from
6,061–8,491 ms; worker timings ranged from 5,931–6,774 ms. This small sample and
network variance do not establish a speedup. This run includes ordinary MCP/IPC
and actual upstream latency, but no model inference, billing or tokenizer
measurement. Byte reduction must not be presented as measured token savings.

Reproduce with `node scripts/benchmark-read-code-live.mjs` after loading project
instructions and discovering schemas. Supply `BENCH_PROJECT_ID`,
`BENCH_COLLECTION_ID` and `ROUTER_SOCKET` through the environment. The harness
reads at most three pages per run and never writes Webflow data. It prints no
project IDs, item content or credentials. Use an explicitly approved test project.

### Remaining release checks

- Validate the final packaged code-mode build against live Webflow after it is
  deliberately installed; the currently installed release lacks the tool.
- Repeat packaged runtime validation on Mac Intel and Windows; this run covers
  only macOS arm64. Signing/notarization remain normal release checks.
- A larger live dataset, live Beta code-mode execution, and sustained rate-limit
  behavior are not established by this small Stable test. No throttling stress
  test was attempted on the live service.
- Actual conversation token/cost savings require a controlled model/client
  comparison. The current evidence measures returned bytes only.
- Session reuse remains an unimplemented follow-up optimization, not a condition
  for the correctness of this read-only prototype.
