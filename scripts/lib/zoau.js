// Helpers for driving ZOAU, IBM's Z Open Automation Utilities, from k6.
//
// ZOAU exposes z/OS data sets, jobs, and operator commands as ordinary z/OS UNIX
// commands: dls lists data sets, dcat reads them, jsub submits JCL, jls queries
// the job queue, opercmd issues console commands. That makes any transport that
// can run a shell command a usable test driver.
//
// Two transports are covered here. Over SSH, k6 runs anywhere and connects in.
// Through k6/x/exec, k6 runs on z/OS itself and forks the command directly.
//
// Command reference: IBM/zoau-samples (Apache-2.0) and the ZOAU command
// documentation. Every command used by the sample scripts is a display or read
// operation.

import { Trend, Counter } from 'k6/metrics';
import { zoau } from './config.js';

export const zoauDuration = new Trend('zoau_command_duration', true);
export const zoauFailures = new Counter('zoau_command_failures');

// A non-interactive SSH session does not run the login profile, so ZOAU is not on
// PATH and the Python libraries it needs are not on LIBPATH. Every command is
// prefixed rather than relying on the remote user's shell setup.
export function withEnvironment(command) {
  return [
    `export ZOAU_HOME=${zoau.home}`,
    `export PATH=${zoau.home}/bin:$PATH`,
    `export LIBPATH=${zoau.home}/lib:$LIBPATH`,
    `export PYTHONPATH=${zoau.pythonPath}:$PYTHONPATH`,
    command,
  ].join('; ');
}

// xk6-ssh returns stdout only. There is no exit status, so failure has to be
// inferred from the output, and ZOAU writes its diagnostics to stderr where this
// cannot see them. Commands are therefore wrapped to redirect stderr into stdout
// and to print the exit code on a final line.
export function instrumented(command) {
  return withEnvironment(`{ ${command} ; } 2>&1 ; echo "__RC=$?"`);
}

export function parseResult(output, name) {
  const match = /__RC=(\d+)\s*$/.exec(output ?? '');
  const rc = match ? Number(match[1]) : null;
  const body = (output ?? '').replace(/__RC=\d+\s*$/, '').trimEnd();

  if (rc !== 0) {
    zoauFailures.add(1, { command: name });
  }

  return { rc, body, lines: body === '' ? [] : body.split('\n') };
}

// jls prints one line per job: NAME JOBID OWNER STATUS RC
export function parseJobList(lines) {
  return lines
    .map((line) => line.trim().split(/\s+/))
    .filter((parts) => parts.length >= 4)
    .map(([name, jobid, owner, status, rc]) => ({ name, jobid, owner, status, rc }));
}

// Display-only operator commands, taken from IBM's published ZOAU one-liners.
export const OPERATOR_PROBES = [
  { name: 'iplinfo', command: "opercmd 'd iplinfo'", expect: 'IEE254I' },
  { name: 'cpu', command: "opercmd 'd m=cpu'", expect: 'IEE174I' },
  { name: 'storage', command: "opercmd 'd m=stor'", expect: 'IEE174I' },
  { name: 'grs contention', command: "opercmd 'd grs,c'", expect: 'ISG343I' },
  { name: 'omvs limits', command: "opercmd 'd omvs,limits'", expect: 'BPXO051I' },
  { name: 'outstanding replies', command: "opercmd 'd r,l'", expect: 'IEE112I' },
  { name: 'address spaces', command: "opercmd 'd a,l'", expect: 'IEE114I' },
];
