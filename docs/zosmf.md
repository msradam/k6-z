---
layout: default
title: z/OSMF REST
description: Driving jobs, data sets, USS files, and operator commands over the documented z/OSMF REST services.
---

# z/OSMF REST

<p class="lede">The z/OS Management Facility exposes JES, the catalog, the file system, and the
operator console as REST services over HTTPS. It needs no extension, so plain
upstream k6 can drive it, and it is the right place to start.</p>

## What the scripts cover

| Script | What it measures |
| --- | --- |
| `info.js` | Smoke test. Host answers, credentials work, TLS negotiates |
| `job-submit.js` | JES turnaround: submit, poll to completion, read spool, purge |
| `job-query.js` | Read-only browsing of the output queue and spool |
| `datasets.js` | Catalog search, member listing, member read |
| `uss.js` | z/OS UNIX directory listing and file read |
| `console.js` | MVS operator display commands |
| `mixed-workload.js` | All three profiles at once, each with its own thresholds |
| `auth-secrets.js` | Credentials from a secret source instead of the environment |

All of them share `scripts/lib/zosmf.js`, a thin client over the documented
endpoints.

## Endpoints used

Nothing here is undocumented. These are the published z/OSMF REST services:

| Service | Path |
| --- | --- |
| Information | `GET /zosmf/info` |
| Submit a job | `PUT /zosmf/restjobs/jobs` |
| Job status | `GET /zosmf/restjobs/jobs/{jobname}/{jobid}` |
| Spool files | `GET /zosmf/restjobs/jobs/{jobname}/{jobid}/files` |
| Spool content | `GET .../files/{id}/records` |
| Purge a job | `DELETE /zosmf/restjobs/jobs/{jobname}/{jobid}` |
| Catalog search | `GET /zosmf/restfiles/ds?dslevel=` |
| Member list | `GET /zosmf/restfiles/ds/{dsname}/member` |
| Read a data set | `GET /zosmf/restfiles/ds/{dsname}` |
| List a directory | `GET /zosmf/restfiles/fs?path=` |
| Operator command | `PUT /zosmf/restconsoles/consoles/{name}` |

## Two things that catch people out

**Every request needs the CSRF header.** z/OSMF rejects requests without
`X-CSRF-ZOSMF-HEADER`. The value is ignored; only its presence is checked. The
mock server in `tools/` enforces the same rule, so a script that forgets it fails
locally rather than against the LPAR.

**Do not put credentials in the URL.** k6 tags every request with its URL, so
`https://user:pass@host` puts the password into the metric stream and into any
exported summary. The library builds an `Authorization` header instead:

```javascript
const AUTHORIZATION = `Basic ${encoding.b64encode(`${zosmf.user}:${zosmf.password}`)}`;
```

## Metric cardinality

Data set names and job ids vary per iteration. If they end up in the URL that k6
tags with, every one of them becomes its own time series and the metric stream
grows with the test. Passing a stable `name` tag fixes it:

```javascript
request('GET', `/zosmf/restfiles/ds/${dsname}`, null, { name: 'read data set' });
```

Thresholds can then target one operation without naming any particular data set:

```javascript
thresholds: {
  'zosmf_request_duration{name:list data sets}': ['p(95) < 10000'],
  'zosmf_request_duration{name:read data set}': ['p(95) < 3000'],
}
```

## Submitting a job

The internal reader needs record attributes on the request. Fixed 80-byte records
in text mode is what a card reader has always presented to JES:

```javascript
export function submitJcl(jcl) {
  return request('PUT', '/zosmf/restjobs/jobs', jcl, {
    headers: {
      'Content-Type': 'text/plain',
      'X-IBM-Intrdr-Class': 'A',
      'X-IBM-Intrdr-Recfm': 'F',
      'X-IBM-Intrdr-Lrecl': '80',
      'X-IBM-Intrdr-Mode': 'TEXT',
    },
  });
}
```

The default job is `IEFBR14`, which does nothing and returns zero. That is
deliberate. It isolates submission, scheduling, and spool handling from whatever an
application would have done, which is the number you want when you are sizing JES
rather than testing a program. Set `ZOS_JOB_WITH_OUTPUT=true` for an `IEBGENER` job
that produces real spool output instead.

```bash
k6 run \
  -e ZOSMF_URL=https://zosmf.example.com \
  -e ZOS_USER=IBMUSER -e ZOS_PASSWORD="$ZOS_PASSWORD" \
  -e ZOS_ACCOUNT='ACCT#' \
  -e ZOS_JOBS_PER_MINUTE=12 \
  scripts/zosmf/job-submit.js
```

Arrival rate, not VU count, is the knob. JES queue behaviour is a function of how
fast work shows up, not how many connections are open, so the script uses
`constant-arrival-rate`.

<div class="callout callout-warn">
<p>The script purges the jobs it submits. Leaving thousands of held output data
sets behind is how a load test turns into a spool-full incident on a shared LPAR.
If you change the script to skip the purge, make sure something else cleans up.</p>
</div>

## Operator commands

`console.js` issues display commands and checks for the message id in the response.
Every command in its list reads system state and changes nothing:

```javascript
const COMMANDS = [
  { cmd: 'D IPLINFO', expect: 'IEE254I' },
  { cmd: 'D T',       expect: 'IEE136I' },
  { cmd: 'D M=CPU',   expect: 'IEE174I' },
  { cmd: 'D GRS,C',   expect: 'ISG343I' },
];
```

The console service runs whatever you send it with the authority of the user you
authenticated as. Treat any change to that list the way you would treat a change to
a production runbook.

Concurrency stays low on purpose. Operator commands are serialised by the console,
so running many at once measures the console's queue rather than the system's
ability to answer.

## Writes are opt-in

`datasets.js` and `uss.js` are read-only unless you set `ZOS_ALLOW_WRITE=true` and
name a target. A load test that writes to a cataloged data set on someone else's
LPAR is an incident, not a test.

## Running a realistic profile

`mixed-workload.js` is the shape most mainframe tests actually need: batch
submission, catalog searches, and operator commands running at the same time, each
with its own arrival pattern and its own thresholds.

```javascript
scenarios: {
  batch:    { executor: 'constant-arrival-rate', exec: 'batchSubmission', rate: 4, timeUnit: '1m', ... },
  catalog:  { executor: 'ramping-vus', exec: 'catalogSearch', stages: [...] },
  operator: { executor: 'constant-vus', exec: 'operatorCommand', vus: 1, startTime: '1m', ... },
}
```

Running them as one flat VU count hides which of the three is the bottleneck.
Per-scenario tags let each one carry its own budget:

```javascript
thresholds: {
  'zosmf_request_duration{workload:batch}':   ['p(95) < 5000'],
  'zosmf_request_duration{workload:catalog}': ['p(95) < 15000'],
}
```

## Testing without a mainframe

`tools/mock-zosmf.py` answers the same request shapes as the real service, with a
job queue that moves submissions from `INPUT` through `ACTIVE` to `OUTPUT` over a
few seconds. It is stdlib Python with no dependencies.

```bash
python3 tools/mock-zosmf.py --port 10443 --verbose
make test
```

It is not an emulator. Nothing it returns is evidence about how a real z/OSMF
behaves under load. What it is good for is checking that a script does what you
think before it touches a real system, and for letting someone review the scripts
without needing access to anything.
