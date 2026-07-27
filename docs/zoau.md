---
layout: default
title: ZOAU
description: Load testing z/OS data sets, JES, and operator commands through Z Open Automation Utilities.
---

# ZOAU

<p class="lede">IBM Z Open Automation Utilities exposes data sets, jobs, and the operator console as
z/OS UNIX commands. Any transport that can run a shell command can drive them, so
k6 reaches them either over SSH with xk6-ssh or by forking locally with
xk6-exec.</p>

ZOAU is a licensed IBM product. Without it, use
[z/OSMF]({{ '/zosmf/' | relative_url }}) instead.

## Scripts

| Script | Transport | Executor | Measures |
| --- | --- | --- | --- |
| `ssh/zoau-datasets.js` | SSH | `constant-vus`, 1 VU | Catalog listing, member listing, member read |
| `ssh/zoau-job.js` | SSH | `constant-vus`, 1 VU | `jsub`, poll `jls`, read `jcat` |
| `ssh/zoau-opercmd.js` | SSH | `constant-vus`, 1 VU | Operator display commands |
| `exec/zoau-local.js` | Local fork | `ramping-vus` | The same operations, k6 running on z/OS |

## Commands used

| Command | Description |
| --- | --- |
| `dls` | List data sets. `-l` adds organisation, `-u` adds space |
| `dcat` | Read a sequential data set or a PDS member |
| `jsub` | Submit JCL from a data set or a file |
| `jls` | Query the job queue |
| `jcat` | Read a job's output |
| `jdel` | Purge a job |
| `opercmd` | Issue an MVS operator command |
| `mvscmd` | Run a program with DD allocations, without JCL |

The samples issue these operator commands, all of which are display commands from
IBM's [zoau-samples](https://github.com/IBM/zoau-samples):

```bash
opercmd 'd iplinfo'
opercmd 'd m=cpu'
opercmd 'd grs,c'
opercmd 'd omvs,limits'
```

`opercmd` runs any command you give it with the authority of the signed-on user.
Treat the command list in `scripts/lib/zoau.js` the way you would treat a
production runbook.

## Choose a transport

| Situation | Transport |
| --- | --- |
| Load generator off-platform, low request volume | SSH |
| You need concurrency | z/OSMF, or exec on the host |
| Measuring ZOAU without network latency in the result | exec on the host |
| No ZOAU licence | z/OSMF only |

<div class="callout callout-warn">
<p>The SSH scripts run at <code>vus: 1</code> and you should not raise it. xk6-ssh
registers a single module object shared by every VU, so a second VU calling
<code>connect()</code> replaces the first VU's session mid-iteration.</p>
</div>

The cause is how the extension registers with k6. An extension implementing k6's
`Module` interface gets a fresh instance per VU; one that registers a plain value
does not, and xk6-ssh registers a plain value. To generate concurrency over SSH,
run several k6 processes.

## Set the ZOAU environment explicitly

A non-interactive SSH session does not run the login profile, so ZOAU is not on
`PATH` and its Python libraries are not on `LIBPATH`. `scripts/lib/zoau.js`
prefixes every command rather than relying on the remote user's shell setup:

```javascript
export function withEnvironment(command) {
  return [
    `export ZOAU_HOME=${zoau.home}`,
    `export PATH=${zoau.home}/bin:$PATH`,
    `export LIBPATH=${zoau.home}/lib:$LIBPATH`,
    `export PYTHONPATH=${zoau.pythonPath}:$PYTHONPATH`,
    command,
  ].join('; ');
}
```

Set `ZOAU_HOME` if your installation is not at `/usr/lpp/IBM/zoau`.

## Recover the exit code

`ssh.run()` returns stdout only. There is no exit status, and ZOAU writes
diagnostics to stderr, so a failing command returns an empty string with no
indication of why.

`instrumented()` redirects stderr into stdout and appends the return code:

```javascript
export function instrumented(command) {
  return withEnvironment(`{ ${command} ; } 2>&1 ; echo "__RC=$?"`);
}
```

`parseResult()` splits the return code off the last line, returns the remaining
output, and increments `zoau_command_failures` when the code is non-zero.

## Submit a job

The script writes JCL to a temporary z/OS UNIX file, submits it with `jsub`, polls
`jls` until the job leaves the queue, reads the output with `jcat`, then purges
the job and removes the file.

```bash
k6 run \
  -e ZOS_SSH_HOST=zos.example.com \
  -e ZOS_USER=IBMUSER -e ZOS_PASSWORD="$ZOS_PASSWORD" \
  -e ZOS_ACCOUNT='ACCT#' \
  scripts/ssh/zoau-job.js
```

The heredoc is quoted so the shell does not expand anything inside the JCL:

```javascript
run(`cat > ${path} <<'ENDJCL'\n${jcl}\nENDJCL`, 'stage jcl');
```

`jls` reports a completed job with status `CC` and the return code in the next
column. `ABEND` and `JCLERR` are the two terminal failure states:

```javascript
if (job && ['CC', 'ABEND', 'JCLERR'].includes(job.status)) {
  break;
}
```

This measures the same thing as `scripts/zosmf/job-submit.js` over a different
transport. Running both separates JES turnaround from z/OSMF's own overhead.

## Run on the host with no SSH hop

`exec/zoau-local.js` uses `k6/x/exec`, which forks a process per call. xk6-exec
implements k6's `Module` interface, so it creates an instance per VU and scales
with VU count.

```bash
k6 run -e ZOS_VUS=4 scripts/exec/zoau-local.js
```

This needs a k6 built for z/OS that includes xk6-exec. The zopen package is
vanilla k6 and does not include it; see [install]({{ '/install/' | relative_url }}).
The same script runs unchanged on Linux on Z or in zCX against a local ZOAU.

There is no shell wrapping the call, so the environment is passed as an argument:

```javascript
exec.command('sh', ['-c', command], {
  env: [`ZOAU_HOME=${zoau.home}`, `PATH=${zoau.home}/bin:/bin:/usr/bin`],
  combine_output: true,
  continue_on_error: true,
});
```

`combine_output` folds stderr into the result for the same reason as the SSH
redirect. Without it, a failing command returns an empty string.

## Metrics

| Metric | Type | Description |
| --- | --- | --- |
| `zoau_command_duration` | Trend (ms) | Per-command duration, tagged with `command` |
| `zoau_command_failures` | Counter | Commands returning a non-zero code |
| `zoau_job_turnaround` | Trend (ms) | Submit to completion, `zoau-job.js` only |
| `zoau_catalog_entries` | Trend | Data sets returned by `dls`, `zoau-local.js` only |

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| `dls: command not found` | `ZOAU_HOME` is wrong, or ZOAU is not installed |
| Every command returns rc 0 with empty output | `LIBPATH` is not set, so the ZOAU binaries cannot load their libraries |
| SSH results interleave between VUs | VU count above 1. The SSH scripts are single-VU by design |
| `setup()` fails immediately | Neither `ZOS_PASSWORD` nor `ZOS_SSH_KEY` is set |
| `opercmd` returns an authority error | The user lacks console authority in RACF |
