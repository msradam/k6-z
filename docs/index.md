---
layout: default
title: Why k6 on z/OS
description: Load testing IBM z/OS with Grafana k6, using only publicly documented APIs and commands.
---

<p class="eyebrow">Grafana k6 on IBM z/OS</p>

# Load testing the mainframe with k6

<p class="lede">Sample k6 scripts for the interfaces a z/OS system actually exposes, plus prebuilt
binaries for s390x that upstream k6 does not publish. Everything here uses public
APIs and public documentation, so it can be read, copied, and run outside IBM.</p>

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

## The problem

Mainframe load testing has been solved for a long time, and that is most of the
trouble. IBM's Teleprocessing Network Simulator shipped in 1976. Its successor,
Workload Simulator for z/OS, was announced in 2002 and last had a release in 2018.
Both work. Both drive 3270 data streams from scripts written in STL, run on the
host, and produce reports that live on the host.

That model was correct when the system under test was the only system. It fits
badly now. The scripts are hard to review because they do not live in the same
repository as the application. The results are hard to compare because they do not
land in the same dashboards as everything else. And the skills needed to write
them are concentrated in the people who have the least time.

JMeter covers the HTTP surface, and plenty of shops drive z/OSMF with it. It is
less comfortable everywhere else: test plans are XML edited through a GUI, the
3270 story depends on third-party plugins, and a JVM per load generator is a real
cost when you want many of them.

## Why k6

k6 is a single static binary that runs test scripts written in JavaScript. That
combination turns out to fit the mainframe unusually well.

Tests are code. A k6 script is a file in the same repository as the application,
reviewed in the same pull request, with the same history. Someone who has never
touched a mainframe can read what the test does.

Load shape is declared, not improvised. k6 models arrival rate and VU count
separately through [executors](https://grafana.com/docs/k6/latest/using-k6/scenarios/executors/).
Batch submission is bursty, catalog searches are steady, operator commands are
serialised. You can run all three at once, each with its own profile, in one test.

Pass and fail are part of the test. [Thresholds](https://grafana.com/docs/k6/latest/using-k6/thresholds/)
turn a p95 or an error rate into an exit code, which is what a pipeline needs.

Results go where your other results go. k6 writes to Prometheus, OpenTelemetry,
InfluxDB, JSON, or Grafana Cloud. Mainframe latency ends up on the same dashboard
as everything else, which is the only way anyone will look at it.

The protocol surface is extensible. Go extensions add protocols k6 does not ship,
which is how TN3270 and SSH get covered here.

<div class="callout">
<p>Background reading, both by the author of this repository:
<a href="https://medium.com/grafana-labs/big-iron-under-load-how-to-test-ibm-z-mainframes-with-k6-922a6a8ad8e3">Big Iron under load: how to test IBM Z mainframes with k6</a>
and <a href="https://medium.com/theropod/go-ing-native-porting-grafana-k6-to-z-os-with-go-f7f73267c1c">Going native: porting Grafana k6 to z/OS with Go</a>.</p>
</div>

## What is in this repository

Three families of sample script, one per interface a z/OS system exposes to a test
driver:

| Surface | Transport | Extension needed |
| --- | --- | --- |
| [z/OSMF REST]({{ '/zosmf/' | relative_url }}) | HTTPS | None, k6 core |
| [TN3270]({{ '/tn3270/' | relative_url }}) | TCP, RFC 1576 and RFC 2355 | xk6-tn3270 |
| [ZOAU over SSH]({{ '/zoau/' | relative_url }}) | SSH | xk6-ssh |
| [ZOAU natively]({{ '/zoau/' | relative_url }}) | Local process | xk6-exec |

Alongside them: prebuilt binaries including `linux/s390x`, and a mock z/OSMF server
so the scripts can be run and reviewed by someone with no mainframe access at all.

## Try it without a mainframe

The repository ships a stand-in z/OSMF that answers the same request shapes as the
real one. It is enough to see the scripts work end to end.

```bash
git clone https://github.com/msradam/k6-z.git
cd k6-z
make build

python3 tools/mock-zosmf.py &

ZOSMF_URL=http://127.0.0.1:10443 ZOS_USER=IBMUSER ZOS_PASSWORD=mock \
  ./dist/k6-z run scripts/zosmf/job-submit.js
```

That submits JCL, polls the job to completion, reads its spool, and purges it,
with thresholds on turnaround time. Against a real system the only thing that
changes is `ZOSMF_URL`.

## Against a real system

Start with the smoke test. It confirms the host answers, the credentials work, and
TLS negotiates, and it aborts on the first failed check rather than running for
twenty minutes to tell you the password was wrong.

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

Everything here comes from published IBM documentation and from open-source
projects. The z/OSMF endpoints are the documented REST services. The ZOAU commands
are display and read commands drawn from IBM's public
[zoau-samples](https://github.com/IBM/zoau-samples). The TN3270 scripts target
[Galasa SimBank](https://galasa.dev), which runs on a laptop. No internal system,
naming convention, or configuration appears anywhere in this repository.

The scripts are starting points, not a benchmark suite. Nothing here produces a
number you should compare against another shop's number.
