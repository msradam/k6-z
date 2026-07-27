---
layout: default
title: ZOAU
description: Driving z/OS data sets, JES, and operator commands as shell commands, over SSH or natively.
---

# ZOAU

<p class="lede">IBM Z Open Automation Utilities exposes data sets, jobs, and the operator console
as ordinary z/OS UNIX commands. Any transport that can run a shell command becomes
a usable test driver, which means SSH from anywhere, or a local fork on the host.</p>

## What the scripts cover

| Script | Transport | What it measures |
| --- | --- | --- |
| `ssh/zoau-datasets.js` | SSH | Catalog listing, member listing, member read |
| `ssh/zoau-job.js` | SSH | Submit with `jsub`, poll `jls`, read with `jcat` |
| `ssh/zoau-opercmd.js` | SSH | Operator display commands |
| `exec/zoau-local.js` | Local fork | The same operations, k6 running on z/OS |

## The commands

ZOAU replaces the TSO, JCL, and console interfaces for a large set of operations:

| Command | Does |
| --- | --- |
| `dls` | List data sets, with `-l` for organisation and `-u` for space |
| `dcat` | Read a sequential data set or a PDS member |
| `jsub` | Submit JCL from a data set or a file |
| `jls` | Query the job queue |
| `jcat` | Read a job's output |
| `jdel` | Purge a job |
| `opercmd` | Issue an MVS operator command |
| `mvscmd` | Run a program with DD allocations, no JCL |

The operator commands the samples use are display commands taken from IBM's
published [zoau-samples](https://github.com/IBM/zoau-samples):

```bash
opercmd 'd iplinfo'
opercmd 'd m=cpu'
opercmd 'd grs,c'
opercmd 'd omvs,limits'
```

`opercmd` runs whatever you give it with the authority of the user you signed on
as. Treat the command list as a runbook.

## SSH: one VU, and why

<div class="callout callout-warn">
<p>xk6-ssh registers a single module object that every VU shares. A second VU
calling <code>connect()</code> replaces the first VU's session mid-iteration. All
SSH scripts here run at <code>vus: 1</code> and you should not raise it.</p>
</div>

This is not a bug in the scripts, it is how the extension registers itself with k6.
An extension that implements k6's `Module` interface gets a fresh instance per VU;
one that registers a plain value does not, and xk6-ssh registers a plain value.

To generate real concurrency over SSH, run several k6 processes. If you want
concurrency inside one process, use z/OSMF instead, where every VU has its own HTTP
connection, or run k6 on the host with `k6/x/exec`.

## Environment, not PATH

A non-interactive SSH session does not run the login profile, so ZOAU is not on
`PATH` and the Python libraries it needs are not on `LIBPATH`. Every command is
prefixed rather than relying on the remote user's shell setup:

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

Set `ZOAU_HOME` if yours is not at `/usr/lpp/IBM/zoau`.

## Getting the exit code back

`ssh.run()` returns stdout and nothing else. No exit status, and ZOAU writes its
diagnostics to stderr, where you cannot see them. A failing command comes back as
an empty string with no reason attached.

The fix is to fold both into the output:

```javascript
export function instrumented(command) {
  return withEnvironment(`{ ${command} ; } 2>&1 ; echo "__RC=$?"`);
}
```

`parseResult` then splits the return code off the last line and counts a non-zero
as a failure. It is not elegant, but the alternative is a test that reports success
for every command that fails.

## Submitting a job

```bash
k6 run \
  -e ZOS_SSH_HOST=zos.example.com \
  -e ZOS_USER=IBMUSER -e ZOS_PASSWORD="$ZOS_PASSWORD" \
  -e ZOS_ACCOUNT='ACCT#' \
  scripts/ssh/zoau-job.js
```

The script writes JCL to a temporary USS file, submits it, polls, reads the output,
then purges the job and removes the file. The heredoc is quoted so the shell does
not expand anything inside the JCL, which contains characters it would otherwise
try to interpret:

```javascript
run(`cat > ${path} <<'ENDJCL'\n${jcl}\nENDJCL`, 'stage jcl');
```

`jls` reports a finished job with status `CC` and the return code in the next
column. `ABEND` and `JCLERR` are the two terminal failures.

This is the same measurement as `scripts/zosmf/job-submit.js` taken through a
different door. Running both tells you how much of the turnaround is JES and how
much is the z/OSMF server in front of it.

## Natively, with no SSH hop

`exec/zoau-local.js` uses `k6/x/exec`, which forks a process per call. Unlike
xk6-ssh, it creates a module instance per VU, so it scales with VU count.

```bash
k6 run -e ZOS_VUS=4 scripts/exec/zoau-local.js
```

This needs a k6 built for z/OS with the exec extension. The zopen package is
vanilla k6 and does not include it. See [install]({{ '/install/' | relative_url }})
for the build. The same script runs unchanged on Linux on Z or in zCX against a
locally installed ZOAU.

Because there is no shell in the way, the environment is passed explicitly:

```javascript
exec.command('sh', ['-c', command], {
  env: [`ZOAU_HOME=${zoau.home}`, `PATH=${zoau.home}/bin:/bin:/usr/bin`, ...],
  combine_output: true,
  continue_on_error: true,
});
```

`combine_output` matters for the same reason as the SSH redirect: without it a
failing command returns an empty result and the reason is lost.

## Which transport to use

| Situation | Use |
| --- | --- |
| Load generator off-platform, low volume | SSH |
| You need concurrency | z/OSMF, or exec on the host |
| Measuring ZOAU itself without network in the way | exec on the host |
| No ZOAU licence | z/OSMF only |

ZOAU is a licensed IBM product. If it is not installed, everything on this page is
unavailable and [z/OSMF]({{ '/zosmf/' | relative_url }}) is the route.
