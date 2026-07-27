---
layout: default
title: k6 2.x features
description: The parts of current k6 that matter most when the system under test is a mainframe.
---

# k6 2.x features

<p class="lede">k6 2.0 landed in May 2026 and 2.1 in June. Most of what changed is cleanup, but a
few things matter directly for mainframe work, and one of them decides which binary
you can use.</p>

## The module path change, and why there are two bundles

k6 2.0 moved its Go module path from `go.k6.io/k6` to `go.k6.io/k6/v2`. For an
extension author this is a find and replace. For anyone assembling a binary it is a
hard split: an extension that still imports `go.k6.io/k6` cannot be linked into a
k6 2.x binary at all.

As of now, xk6-ssh has moved. xk6-tn3270 and xk6-exec have not. That is why this
repository ships two archives rather than one:

| Archive | k6 | Extensions |
| --- | --- | --- |
| `k6-z` | 2.1.0 | xk6-ssh |
| `k6-z-3270` | 1.6.1 | xk6-tn3270, xk6-ssh, xk6-exec |

When the remaining extensions migrate, the two collapse into one. See
[builds]({{ '/builds/' | relative_url }}).

## Secrets

k6 1.3 added `k6/secrets`. Putting a RACF password in an environment variable is
fine on a laptop, but on a shared build agent environment variables appear in
process listings and in logs whenever a step dumps its environment.

```javascript
import secrets from 'k6/secrets';

const user = await secrets.get('zos_user');
const password = await secrets.get('zos_password');
```

```bash
k6 run --secret-source=file=zos.secret scripts/zosmf/auth-secrets.js
```

Sources include a local file, a URL-backed store, and Grafana Cloud's secret store.
As of k6 2.0, cloud secrets are available automatically in
`k6 cloud run --local-execution`.

Fetch the value once per VU rather than once per iteration. Most sources are a
network call, and you do not want that in the measurement.

## Scenarios and executors

Not new in 2.x, but central to how these scripts are written.

```javascript
scenarios: {
  batch:    { executor: 'constant-arrival-rate', exec: 'batchSubmission', rate: 4, timeUnit: '1m' },
  catalog:  { executor: 'ramping-vus', exec: 'catalogSearch', stages: [] },
  operator: { executor: 'constant-vus', exec: 'operatorCommand', vus: 1, startTime: '1m' },
}
```

Different work has different arrival patterns. Batch submission is bursty, catalog
searches are steady, operator commands are serialised by the console. Running them
as one flat VU count hides which of the three is the bottleneck. Per-scenario tags
then let each carry its own budget:

```javascript
thresholds: {
  'zosmf_request_duration{workload:batch}':   ['p(95) < 5000'],
  'zosmf_request_duration{workload:catalog}': ['p(95) < 15000'],
}
```

One thing 2.0 removed: the `externally-controlled` executor, along with
`k6 pause`, `k6 resume`, `k6 scale`, and `k6 status`. If you had a harness driving
those, it needs rewriting around the normal executors.

## Thresholds set the exit code

```javascript
thresholds: {
  checks: [{ threshold: 'rate == 1.0', abortOnFail: true }],
  zos_job_turnaround: ['p(95) < 30000'],
  tn3270_wait_timeouts: ['count == 0'],
}
```

`abortOnFail` stops the run at the first failed check, which is useful on smoke
tests where a failed logon makes the remaining twenty minutes pointless.

k6 2.1 tightened threshold parsing: a percentile outside 0 to 100 is now a parse
error instead of being silently accepted, which used to make a typo look like a
passing test.

## Feature flags and native histograms

New in 2.1. Trend metrics can use native histograms:

```bash
k6 run --features native-histograms scripts/zosmf/mixed-workload.js
k6 features
```

Relevant here because mainframe latency distributions have long tails and the
interesting behaviour is at p99 and beyond. Fixed bucket boundaries either lose
resolution where you need it or cost cardinality everywhere else. Still
experimental, so measure before relying on it.

## Automatic extension resolution

k6 sees an import of `k6/x/something` and provisions a binary that has it, without
you running `xk6 build`:

```javascript
import sql from 'k6/x/sql';
```

This works for extensions in the official registry. xk6-tn3270 is not registered,
so it needs an explicit build from `bundles/`.

Two environment variables went away in 2.0: `K6_BINARY_PROVISIONING` and
`K6_ENABLE_COMMUNITY_EXTENSIONS`. Resolution is on by default and the catalogs are
merged server-side.

## Output

```bash
k6 run --out experimental-prometheus-rw scripts/zosmf/mixed-workload.js
k6 run --out opentelemetry scripts/tn3270/simbank-browse.js
k6 run --out json=results.json scripts/zosmf/job-submit.js
```

The OpenTelemetry exporter gained HTTP basic auth in 2.1, through
`K6_OTEL_HTTP_EXPORTER_USERNAME` and `K6_OTEL_HTTP_EXPORTER_PASSWORD`, which
matters when the collector sits behind a gateway.

Two 2.0 changes to note: `K6_OTEL_EXPORTER_TYPE` is now
`K6_OTEL_EXPORTER_PROTOCOL` with values `grpc` or `http/protobuf`, and rate metrics
always export as a single counter with a `condition` attribute.

## Custom summaries

```javascript
export function handleSummary(data) {
  const p95 = (name) => Math.round(data.metrics?.[name]?.values?.['p(95)'] ?? 0);

  return {
    stdout: `job turnaround p95  ${p95('zos_job_turnaround')} ms\n`,
    'summary.json': JSON.stringify(data, null, 2),
  };
}
```

Returning a value replaces k6's own stdout summary rather than adding to it, which
lets you print a short set of numbers for a capacity review and write the full
report to a file.

`--summary-mode` is now `compact` (the default), `full`, or `disabled`. The old
`--no-summary` flag and `--summary-mode=legacy` were removed in 2.0.

## Other 2.0 removals

| Removed | Replacement |
| --- | --- |
| `k6 login cloud` | `k6 cloud login` |
| `k6 cloud script.js` | `k6 cloud run script.js` |
| `--upload-only` | `k6 cloud upload script.js` |
| `--no-summary` | `--summary-mode=disabled` |
| `options.ext.loadimpact` | `options.cloud` |
| `k6/experimental/redis` | `k6/x/redis` |
| HTTP API on by default | pass `--address` to enable |

Full detail in the [k6 v2.0.0 release notes](https://github.com/grafana/k6/releases/tag/v2.0.0).

## For agents driving k6

k6 2.1 made `k6 x` self-describing: running it lists the extension subcommands the
binary has, including `k6 x mcp`, an MCP server, and `k6 x docs`. An agent driving
k6 can use that to enumerate the available subcommands.
