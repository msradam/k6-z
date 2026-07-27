---
layout: default
title: Why k6 on z/OS
description: Load testing IBM z/OS with Grafana k6. Sample scripts for z/OSMF REST, TN3270, and ZOAU, plus s390x builds.
---

<p class="eyebrow">z/OSMF · TN3270 · ZOAU · s390x</p>

# Load testing the mainframe with k6

<p class="lede">Sample k6 scripts for the interfaces a z/OS system actually exposes, plus prebuilt
binaries for s390x that upstream k6 does not publish.</p>

<ul class="cards">
  <li><a class="card" href="{{ '/install/' | relative_url }}">
    <span class="card-title">Install</span>
    <span class="card-note">Off-platform, Linux on Z, zCX, or z/OS UNIX through zopen.</span>
  </a></li>
  <li><a class="card" href="{{ '/zosmf/' | relative_url }}">
    <span class="card-title">z/OSMF REST</span>
    <span class="card-note">Jobs, data sets, USS files, and operator commands over HTTPS.</span>
  </a></li>
  <li><a class="card" href="{{ '/tn3270/' | relative_url }}">
    <span class="card-title">TN3270</span>
    <span class="card-note">Green screen transactions against CICS, TSO, or Galasa SimBank.</span>
  </a></li>
  <li><a class="card" href="{{ '/zoau/' | relative_url }}">
    <span class="card-title">ZOAU</span>
    <span class="card-note">Data sets and JES driven as shell commands, over SSH or natively.</span>
  </a></li>
</ul>

## Existing tools

IBM's Teleprocessing Network Simulator shipped in 1976. Its successor, Workload
Simulator for z/OS, was announced in 2002 and last had a release in 2018. Both
drive 3270 data streams from scripts written in STL, run on the host, and write
reports that stay on the host.

They work. The friction is that the scripts sit apart from the application they
test, the reports sit apart from every other performance number in the
organisation, and STL is a language most of the team cannot read.

JMeter covers the HTTP surface, and plenty of shops drive z/OSMF with it. Its 3270
support depends on third-party plugins, its test plans are XML edited through a
GUI, and it needs a JVM per load generator.

## What k6 gives you

k6 is a single static binary that runs test scripts written in JavaScript. A
script is a file in the application's repository, reviewed in the same pull
request.

[Executors](https://grafana.com/docs/k6/latest/using-k6/scenarios/executors/)
declare arrival rate and concurrency separately, so bursty batch submission and
steady catalog queries can run in one test with different profiles.
[Thresholds](https://grafana.com/docs/k6/latest/using-k6/thresholds/) turn a p95
or an error rate into a process exit code, which is what a pipeline reads. Output
goes to Prometheus, OpenTelemetry, InfluxDB, JSON, or Grafana Cloud, so mainframe
latency lands on the same dashboards as the services around it. Go extensions add
protocols k6 does not ship, which is how TN3270 and SSH are covered here.

<div class="callout">
<p>Background reading, both by the author of this repository:
<a href="https://medium.com/grafana-labs/big-iron-under-load-how-to-test-ibm-z-mainframes-with-k6-922a6a8ad8e3">Big Iron under load: how to test IBM Z mainframes with k6</a>
and <a href="https://medium.com/theropod/go-ing-native-porting-grafana-k6-to-z-os-with-go-f7f73267c1c">Going native: porting Grafana k6 to z/OS with Go</a>.</p>
</div>

## What is in this repository

Sample scripts for four interfaces:

| Surface | Transport | Extension needed |
| --- | --- | --- |
| [z/OSMF REST]({{ '/zosmf/' | relative_url }}) | HTTPS | None, k6 core |
| [TN3270]({{ '/tn3270/' | relative_url }}) | TCP, RFC 1576 and RFC 2355 | xk6-tn3270 |
| [ZOAU over SSH]({{ '/zoau/' | relative_url }}) | SSH | xk6-ssh |
| [ZOAU natively]({{ '/zoau/' | relative_url }}) | Local process | xk6-exec |

Plus prebuilt binaries including `linux/s390x`, and a mock z/OSMF server for
running the scripts without a mainframe.

## Try it without a mainframe

The mock server answers the same request shapes as z/OSMF, with a job queue that
moves submissions from `INPUT` through `ACTIVE` to `OUTPUT` over a few seconds.

```bash
git clone https://github.com/msradam/k6-z.git
cd k6-z
make build

python3 tools/mock-zosmf.py &

ZOSMF_URL=http://127.0.0.1:10443 ZOS_USER=IBMUSER ZOS_PASSWORD=mock \
  ./dist/k6-z run scripts/zosmf/job-submit.js
```

That submits JCL, polls the job to completion, reads its spool, and purges it,
with thresholds on turnaround time. To run it against a real system, change
`ZOSMF_URL`.

## Against a real system

Start with the smoke test. It checks that the host answers, that the credentials
work, and that TLS negotiates. Its checks threshold is set to `abortOnFail`, so a
bad password stops the run immediately.

```bash
./dist/k6-z run \
  -e ZOSMF_URL=https://zosmf.example.com \
  -e ZOS_USER=IBMUSER -e ZOS_PASSWORD="$ZOS_PASSWORD" \
  scripts/zosmf/info.js
```

Then read [z/OSMF REST]({{ '/zosmf/' | relative_url }}) for the rest of the scripts,
or [install]({{ '/install/' | relative_url }}) if you need a binary with the TN3270
or SSH extensions in it.

## Scope

The z/OSMF endpoints are the documented REST services. The ZOAU commands are
display and read commands drawn from IBM's
[zoau-samples](https://github.com/IBM/zoau-samples). The TN3270 scripts target
[Galasa SimBank](https://galasa.dev), which runs on a laptop, so you can get one
working before going near an LPAR.

Treat the scripts as starting points. The numbers they produce depend on your
LPAR, your workload, and where the load generator sits, so they are not comparable
across installations. Host names, user ids, and qualifiers all come from the
environment.
