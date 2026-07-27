// Operator commands through ZOAU over SSH.
//
// Every command in the list is a display command from IBM's published ZOAU
// one-liners. They read system state and change nothing. opercmd will run whatever
// you give it with the authority of the user you signed on as, so treat any change
// to this list as a change to a production runbook.
//
// One VU only: see the note in scripts/ssh/zoau-datasets.js.
//
//   k6 run -e ZOS_SSH_HOST=zos.example.com -e ZOS_USER=IBMUSER \
//          -e ZOS_PASSWORD=... scripts/ssh/zoau-opercmd.js

import ssh from 'k6/x/ssh';
import { check, sleep } from 'k6';
import { instrumented, parseResult, zoauDuration, OPERATOR_PROBES } from '../lib/zoau.js';
import { ssh as sshCfg } from '../lib/config.js';

export const options = {
  scenarios: {
    operators: {
      executor: 'constant-vus',
      vus: 1,
      duration: __ENV.ZOS_DURATION || '2m',
    },
  },
  thresholds: {
    checks: ['rate > 0.99'],
    zoau_command_failures: ['count == 0'],
    zoau_command_duration: ['p(95) < 10000'],
  },
};

export function setup() {
  if (!sshCfg.password && !sshCfg.rsaKey) {
    throw new Error('set ZOS_PASSWORD or ZOS_SSH_KEY');
  }
}

export default function () {
  ssh.connect({
    host: sshCfg.host,
    port: sshCfg.port,
    username: sshCfg.user,
    password: sshCfg.password,
    rsaKey: sshCfg.rsaKey,
    passphrase: sshCfg.passphrase,
  });

  const probe = OPERATOR_PROBES[Math.floor(Math.random() * OPERATOR_PROBES.length)];

  const started = Date.now();
  const output = ssh.run(instrumented(probe.command));
  zoauDuration.add(Date.now() - started, { command: probe.name });

  const result = parseResult(output, probe.name);

  check(result, {
    [`${probe.name} returned rc 0`]: (r) => r.rc === 0,
    [`${probe.name} response contains ${probe.expect}`]: (r) => r.body.includes(probe.expect),
  });

  sleep(1);
}
