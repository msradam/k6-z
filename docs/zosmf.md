---
layout: default
title: z/OSMF REST
description: Load testing jobs, data sets, USS files, and operator commands through the z/OSMF REST services.
---

# z/OSMF REST

<p class="lede">The z/OS Management Facility exposes JES, the catalog, the z/OS UNIX file system, and
the operator console as REST services over HTTPS. These scripts need no k6
extension, so any k6 binary can run them.</p>

## Scripts

| Script | Executor | Measures |
| --- | --- | --- |
| `info.js` | 1 iteration | Host reachable, credentials valid, TLS negotiated |
| `job-submit.js` | `constant-arrival-rate` | JES turnaround: submit, poll, read spool, purge |
| `job-query.js` | `ramping-vus` | Reading the output queue and spool. Read-only |
| `datasets.js` | `constant-vus` | Catalog search, member listing, member read |
| `uss.js` | `constant-vus` | Directory listing and file read |
| `console.js` | `constant-vus` | MVS operator display commands |
| `mixed-workload.js` | three scenarios | All three profiles concurrently |
| `auth-secrets.js` | 3 iterations | Authentication using a k6 secret source |

All of them import `scripts/lib/zosmf.js`, a client over the endpoints below.

## Endpoints

| Operation | Method and path |
| --- | --- |
| Server information | `GET /zosmf/info` |
| Submit a job | `PUT /zosmf/restjobs/jobs` |
| List jobs | `GET /zosmf/restjobs/jobs?owner=&prefix=&max-jobs=` |
| Job status | `GET /zosmf/restjobs/jobs/{jobname}/{jobid}` |
| List spool files | `GET /zosmf/restjobs/jobs/{jobname}/{jobid}/files` |
| Read a spool file | `GET /zosmf/restjobs/jobs/{jobname}/{jobid}/files/{id}/records` |
| Purge a job | `DELETE /zosmf/restjobs/jobs/{jobname}/{jobid}` |
| Search the catalog | `GET /zosmf/restfiles/ds?dslevel={pattern}` |
| List PDS members | `GET /zosmf/restfiles/ds/{dsname}/member` |
| Read a data set | `GET /zosmf/restfiles/ds/{dsname}` |
| List a directory | `GET /zosmf/restfiles/fs?path={path}` |
| Read a USS file | `GET /zosmf/restfiles/fs{path}` |
| Issue a console command | `PUT /zosmf/restconsoles/consoles/{name}` |

## Required request headers

z/OSMF rejects any request without `X-CSRF-ZOSMF-HEADER`. The value is ignored;
only the header's presence is checked. `scripts/lib/zosmf.js` adds it to every
request:

```javascript
const CSRF = { 'X-CSRF-ZOSMF-HEADER': '' };
```

Credentials go in an `Authorization` header rather than in the URL. k6 tags every
request with its URL, so `https://user:pass@host` would put the password into the
metric stream and into any exported summary.

```javascript
const AUTHORIZATION = `Basic ${encoding.b64encode(`${zosmf.user}:${zosmf.password}`)}`;
```

The mock server enforces both rules, so a script that omits either fails locally.

## Control metric cardinality with the name tag

k6 tags each request with its URL. Data set names and job ids vary per iteration,
so tagging on the raw URL creates one time series per resource. Pass a stable
`name` tag instead:

```javascript
request('GET', `/zosmf/restfiles/ds/${dsname}`, null, { name: 'read data set' });
```

Thresholds can then target a single operation without naming a resource:

```javascript
thresholds: {
  'zosmf_request_duration{name:list data sets}': ['p(95) < 10000'],
  'zosmf_request_duration{name:read data set}': ['p(95) < 3000'],
}
```

## Metrics

`scripts/lib/zosmf.js` defines these in addition to k6's built-in HTTP metrics.

| Metric | Type | Description |
| --- | --- | --- |
| `zosmf_request_duration` | Trend (ms) | Per-request duration, tagged with `name` |
| `zosmf_success` | Rate | Proportion of requests returning 2xx |
| `zosmf_errors` | Counter | Non-2xx responses, tagged with `name` and `status` |
| `zos_job_turnaround` | Trend (ms) | Submit to `OUTPUT`, recorded by `waitForJob()` |

## Submit a job and wait for it

To submit JCL inline, set the internal reader attributes on the request. Fixed
80-byte records in text mode is what JES expects from a card reader:

```javascript
export function submitJcl(jcl) {
  return request('PUT', '/zosmf/restjobs/jobs', jcl, {
    headers: {
      'Content-Type': 'text/plain; charset=utf8',
      'X-IBM-Intrdr-Recfm': 'F',
      'X-IBM-Intrdr-Lrecl': '80',
      'X-IBM-Intrdr-Mode': 'TEXT',
    },
  });
}
```

| Header | Value | Purpose |
| --- | --- | --- |
| `Content-Type` | `text/plain; charset=utf8` | Body encoding. Without the charset, z/OSMF applies its own default |
| `X-IBM-Intrdr-Recfm` | `F` | Fixed-length records |
| `X-IBM-Intrdr-Lrecl` | `80` | 80-byte records |
| `X-IBM-Intrdr-Mode` | `TEXT` | Text rather than binary |

z/OSMF also accepts `X-IBM-Intrdr-Class` to set the internal reader class. The
scripts do not send it, because job class is already on the JOB card that
`scripts/lib/jcl.js` builds from `ZOS_JOB_CLASS`. Sending both invites the two
values to disagree.

This header set matches the one Zowe CLI sends in `submitJclCommon`.

A successful submit returns 201 and a job document containing `jobname` and
`jobid`. `waitForJob()` polls `GET /zosmf/restjobs/jobs/{jobname}/{jobid}` until
`status` becomes `OUTPUT`, then records `zos_job_turnaround`.

Run the script:

```bash
k6 run \
  -e ZOSMF_URL=https://zosmf.example.com \
  -e ZOS_USER=IBMUSER -e ZOS_PASSWORD="$ZOS_PASSWORD" \
  -e ZOS_ACCOUNT='ACCT#' \
  -e ZOS_JOBS_PER_MINUTE=12 \
  scripts/zosmf/job-submit.js
```

The script uses `constant-arrival-rate` rather than a VU count, because JES queue
depth is a function of submission rate.

The default job is `IEFBR14`, which allocates nothing and returns zero, so the
measurement covers submission, scheduling, and spool handling rather than any
application. Set `ZOS_JOB_WITH_OUTPUT=true` to submit an `IEBGENER` job that
produces real spool output.

To submit JCL that already exists on the host, use the JSON form:

```javascript
submitDataset("IBMUSER.JCL(COMPILE)");
// PUT /zosmf/restjobs/jobs  {"file": "//'IBMUSER.JCL(COMPILE)'"}
```

<div class="callout callout-warn">
<p>The script purges every job it submits. A run at 12 jobs a minute for an hour
leaves 720 held output data sets if the purge is removed. If you change that
step, arrange for something else to clean up.</p>
</div>

## Issue operator commands

`console.js` sends display commands and asserts on the message id in the
response:

```javascript
const COMMANDS = [
  { cmd: 'D IPLINFO', expect: 'IEE254I' },
  { cmd: 'D T',       expect: 'IEE136I' },
  { cmd: 'D M=CPU',   expect: 'IEE174I' },
  { cmd: 'D GRS,C',   expect: 'ISG343I' },
];
```

The response body contains `cmd-response` for commands that answer immediately.
Commands whose messages arrive later return `cmd-response-key`, which the script
passes to `GET /zosmf/restconsoles/consoles/{name}/solmsgs/{key}`.

The console service runs any command you send with the authority of the
authenticated user. The list above contains display commands only.

`setup()` issues `D T` first and fails with a clear message if the user lacks
CONSOLE authority in RACF.

Concurrency defaults to 2 VUs because the console serialises commands. Higher
values measure the console's queue rather than the system's response.

## Enable writes explicitly

`datasets.js` and `uss.js` are read-only unless you set both variables:

```bash
k6 run -e ZOS_ALLOW_WRITE=true -e ZOS_WRITE_TARGET='IBMUSER.K6.TEST' \
  scripts/zosmf/datasets.js
```

Without `ZOS_WRITE_TARGET`, the script throws rather than guessing a data set
name.

## Run several load profiles at once

`mixed-workload.js` runs three scenarios concurrently, each with its own executor
and its own `workload` tag:

```javascript
scenarios: {
  batch:    { executor: 'constant-arrival-rate', exec: 'batchSubmission', rate: 4, timeUnit: '1m' },
  catalog:  { executor: 'ramping-vus', exec: 'catalogSearch' },
  operator: { executor: 'constant-vus', exec: 'operatorCommand', vus: 1, startTime: '1m' },
}
```

Because each scenario tags its requests, thresholds can hold each to a separate
budget:

```javascript
thresholds: {
  'zosmf_request_duration{workload:batch}':   ['p(95) < 5000'],
  'zosmf_request_duration{workload:catalog}': ['p(95) < 15000'],
}
```

The script also defines `handleSummary()` to print the four numbers a capacity
review needs and write the full report to `summary.json`.

## Run without a mainframe

`tools/mock-zosmf.py` implements the endpoints above using only the Python
standard library. Its job queue moves a submission from `INPUT` through `ACTIVE`
to `OUTPUT` over about two seconds, and it seeds three jobs at startup so the
read-only scripts have something to browse.

```bash
python3 tools/mock-zosmf.py --port 10443 --verbose
```

To run the whole z/OSMF set against it:

```bash
make test
```

The mock is not an emulator. Its response times say nothing about a real z/OSMF.
Use it to verify that a script behaves as expected before it reaches a real
system.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| 401 on every request | `ZOS_PASSWORD` unset or wrong, or the user is revoked in RACF |
| 400 with `missing X-CSRF-ZOSMF-HEADER` | Request built without `scripts/lib/zosmf.js` |
| TLS handshake failure | z/OSMF certificate not in the load generator's trust store. Confirm with `ZOS_TLS_INSECURE=true`, then fix the trust store |
| 403 from the console service | User lacks CONSOLE authority in RACF |
| `job-query.js` throws in `setup()` | No jobs match `ZOS_JOB_OWNER` and `ZOS_JOB_PREFIX` |
| Catalog search times out | `ZOS_DSLEVEL` is too broad. Narrow the qualifier |
