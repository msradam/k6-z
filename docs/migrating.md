---
layout: default
title: From JMeter and TPNS
description: What moves cleanly from WSim, TPNS, and JMeter to k6, and what does not.
---

# From JMeter and TPNS

<p class="lede">Most of what a WSim or JMeter test plan does has a direct equivalent in k6. The
parts that do not are the ones that decide whether the migration is worth doing.</p>

## What the old tools do well

TPNS and WSim speak 3270 natively, run on the host with no network between the
driver and the system under test, and carry decades of operational knowledge. If
you have working WSim scripts and people who maintain them, there is no urgency
here.

JMeter handles HTTP well, has a large plugin ecosystem, and its GUI lets people
who do not write code build test plans.

What usually motivates a move is that mainframe test results end up isolated from
every other performance result in the organisation.

## The mapping

| WSim / TPNS | JMeter | k6 |
| --- | --- | --- |
| STL script | Test plan (XML) | JavaScript module in the app repo |
| Network / device deck | Thread Group | `scenarios` with an executor |
| Rate control via `DELAY` | Constant Throughput Timer | `constant-arrival-rate` |
| Ramping decks | Ultimate Thread Group plugin | `ramping-vus`, `ramping-arrival-rate` |
| `IF`/`WHEN` on screen content | Response Assertion | `check()` |
| Manual review of the report | Assertion failure | `thresholds`, which set the exit code |
| Message log analysis | Listeners, HTML report | Prometheus, OpenTelemetry, JSON, Grafana Cloud |
| Host-resident execution | JVM per load generator | One static binary, anywhere including s390x |

## Concept by concept

### Load shape

WSim controls arrival with delays inside the script. JMeter mostly controls it with
thread count. Those are not the same: more threads under a slow response time
produces less load, not more.

k6 separates the two. `constant-arrival-rate` holds the request rate steady no
matter what the response time does, which is what you want when the question is
"what happens at 40 jobs a minute". `ramping-vus` holds concurrency, which is what
you want when the question is "what happens with 200 signed-on terminals".

```javascript
scenarios: {
  batch: {
    executor: 'constant-arrival-rate',
    rate: 40, timeUnit: '1m', duration: '30m',
    preAllocatedVUs: 20, maxVUs: 100,
  },
},
```

Pick the one that matches the question you are asking.

### Assertions

A WSim script checks screen content and branches. A k6 `check()` records a pass or
fail without stopping the iteration:

```javascript
check(session, {
  'account found': (s) => screenHas(s, 'Account Found'),
});
```

Checks tell you what happened. Thresholds decide whether the run failed:

```javascript
thresholds: {
  checks: ['rate > 0.99'],
  cics_transaction_duration: ['p(95) < 3000'],
  tn3270_wait_timeouts: ['count == 0'],
},
```

If a threshold is breached, k6 exits non-zero, which is what lets a mainframe test
gate a pipeline. Neither WSim nor a JMeter GUI run does that without extra work.

### Screen handling

This is the closest correspondence. A WSim script types into fields, sends an AID
key, and waits for the host. So does a k6 TN3270 script:

```javascript
session.type('IBMUSER');
session.tab();
session.type(password);
session.enter();
session.waitForField();
```

The field auto-advance rule is the same one WSim scripts deal with. See
[TN3270]({{ '/tn3270/' | relative_url }}).

### Results

WSim writes a message log you analyse afterwards with its own tooling. k6 streams
metrics out while the test runs:

```bash
k6 run --out experimental-prometheus-rw scripts/tn3270/simbank-browse.js
k6 run --out opentelemetry scripts/zosmf/mixed-workload.js
```

Mainframe response time ends up on the same Grafana dashboard as the API in front
of it and the database behind it.

## What does not move

**Native 3270 printer and non-SNA device simulation.** WSim simulates a wide range
of terminal and printer device types. xk6-tn3270 does displays, models 2 through 5.
If your test depends on printer sessions or SNA specifics, WSim still wins.

**Running on the host with no network.** The zopen k6 port runs on z/OS UNIX, but
it does not include the TN3270 extension, so a native 3270 test needs a build you
make yourself. See [install]({{ '/install/' | relative_url }}). Running in zCX is
usually the easier way to get the load generator onto the same box.

**Your existing STL.** There is no converter. Scripts get rewritten. For a large
WSim estate, migrate the tests you actually run rather than all of them, and expect
the rewrite to surface assumptions nobody remembered were there.

**The GUI.** If test authoring has to be point and click, k6 is the wrong tool.

## Where to start

Take one transaction you already have a WSim or JMeter test for, write the k6
version, and run both against the same environment at the same load.

Comparing the two results tells you whether the k6 script measures what the old one
measured, and gives you evidence for the people who have to approve replacing a
tool that has worked since 1976. After the first transaction matches, the rest go
faster, since the connection handling and thresholds are already written.
