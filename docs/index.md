---
layout: default
title: Overview
description: k6-z is a set of Grafana k6 test scripts and prebuilt binaries for load testing IBM z/OS.
---

<p class="eyebrow">z/OSMF · TN3270 · ZOAU · s390x</p>

# k6-z

<p class="lede">k6-z is a set of <a href="https://k6.io">Grafana k6</a> test scripts and prebuilt
binaries for load testing IBM z/OS. It covers the four interfaces a z/OS system
exposes to a test driver, and it ships k6 binaries for <code>s390x</code>, which
upstream k6 does not publish.</p>

## What you can test

| Surface | Transport | Extension required | Scripts |
| --- | --- | --- | --- |
| [z/OSMF REST]({{ '/zosmf/' | relative_url }}) | HTTPS | None | `scripts/zosmf/` |
| [TN3270]({{ '/tn3270/' | relative_url }}) | TCP (RFC 1576, RFC 2355) | xk6-tn3270 | `scripts/tn3270/` |
| [ZOAU over SSH]({{ '/zoau/' | relative_url }}) | SSH | xk6-ssh | `scripts/ssh/` |
| [ZOAU on the host]({{ '/zoau/' | relative_url }}) | Local process | xk6-exec | `scripts/exec/` |

Start with z/OSMF. It needs no extension, so any k6 binary can run those scripts.

## Why k6 for z/OS

- Tests are JavaScript files that live in the application's repository and go through the same review as the application.
- [Executors](https://grafana.com/docs/k6/latest/using-k6/scenarios/executors/) set arrival rate and concurrency independently, so batch submission, catalog queries, and operator commands can run in one test with separate load profiles.
- [Thresholds](https://grafana.com/docs/k6/latest/using-k6/thresholds/) turn a p95 or an error rate into a process exit code, so a test can gate a pipeline.
- Results stream to Prometheus, OpenTelemetry, InfluxDB, JSON, or Grafana Cloud while the test runs.
- One static binary runs on Linux, macOS, Linux on Z, and zCX, with no JVM and no runtime dependencies.

For a comparison with WSim, TPNS, and JMeter, see [From JMeter and TPNS]({{ '/migrating/' | relative_url }}).

## Requirements

| To run | You need |
| --- | --- |
| The z/OSMF scripts | Any k6 binary, and a z/OSMF server you can reach |
| The TN3270 scripts | A binary built with xk6-tn3270 |
| The ZOAU scripts | A binary built with xk6-ssh or xk6-exec, and ZOAU installed on the host |
| The mock server | Python 3.9 or later |
| Building from source | Go 1.25 or later |

## Get started

The repository includes a mock z/OSMF server, so you can run the z/OSMF scripts
without a mainframe.

1. Clone the repository and build both binaries.

   ```bash
   git clone https://github.com/msradam/k6-z.git
   cd k6-z
   make build
   ```

2. Start the mock server. It listens on port 10443 and answers the same request
   shapes as z/OSMF.

   ```bash
   python3 tools/mock-zosmf.py &
   ```

3. Run a script against it. This one submits JCL, polls the job until it reaches
   the output queue, reads its spool, and purges it.

   ```bash
   ZOSMF_URL=http://127.0.0.1:10443 ZOS_USER=IBMUSER ZOS_PASSWORD=mock \
     ./dist/k6-z run scripts/zosmf/job-submit.js
   ```

k6 prints a summary with the thresholds the script declares, including
`zos_job_turnaround`.

## Run against a z/OS system

Run the smoke test first. It calls `GET /zosmf/info` and verifies that the host
answers, that the credentials authenticate, and that TLS negotiates. Its `checks`
threshold uses `abortOnFail`, so a bad password stops the run at the first
iteration.

```bash
./dist/k6-z run \
  -e ZOSMF_URL=https://zosmf.example.com \
  -e ZOS_USER=IBMUSER \
  -e ZOS_PASSWORD="$ZOS_PASSWORD" \
  scripts/zosmf/info.js
```

If your z/OSMF uses a certificate your load generator does not trust, add
`-e ZOS_TLS_INSECURE=true` to confirm connectivity, then fix the trust store.

Every setting comes from an environment variable. See
[configuration]({{ '/configuration/' | relative_url }}) for the full list.

## Next steps

- [Install]({{ '/install/' | relative_url }}) covers the release archives, building your own binary, and running k6 on z/OS UNIX.
- [z/OSMF REST]({{ '/zosmf/' | relative_url }}) documents the eight z/OSMF scripts.
- [Configuration]({{ '/configuration/' | relative_url }}) lists every environment variable.

## Sources

The z/OSMF scripts use the documented z/OSMF REST services. The ZOAU scripts use
display and read commands from IBM's
[zoau-samples](https://github.com/IBM/zoau-samples). The TN3270 scripts target
[Galasa SimBank](https://galasa.dev).

The scripts are starting points. The numbers they produce depend on your LPAR,
your workload, and where the load generator runs, so they are not comparable
across installations.
