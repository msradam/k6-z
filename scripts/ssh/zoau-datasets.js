// Data set operations through ZOAU over SSH: catalog listing, member listing, and
// reading a member.
//
// One VU only. xk6-ssh registers a single module object that every VU shares, so
// a second VU calling connect() replaces the first VU's session mid-iteration. To
// generate concurrency, run several k6 processes, or drive the same operations
// through z/OSMF where each VU has its own HTTP connection.
//
//   k6 run -e ZOS_SSH_HOST=zos.example.com -e ZOS_USER=IBMUSER \
//          -e ZOS_PASSWORD=... -e ZOS_HLQ=SYS1 scripts/ssh/zoau-datasets.js

import ssh from 'k6/x/ssh';
import { check, group } from 'k6';
import { instrumented, parseResult, zoauDuration } from '../lib/zoau.js';
import { ssh as sshCfg, zos } from '../lib/config.js';

const HLQ = __ENV.ZOS_HLQ || zos.hlq;

export const options = {
  scenarios: {
    datasets: {
      executor: 'constant-vus',
      vus: 1,
      duration: __ENV.ZOS_DURATION || '1m',
    },
  },
  thresholds: {
    checks: ['rate > 0.99'],
    zoau_command_failures: ['count == 0'],
    'zoau_command_duration{command:dls}': ['p(95) < 10000'],
  },
};

function run(command, name) {
  const started = Date.now();
  const output = ssh.run(instrumented(command));
  zoauDuration.add(Date.now() - started, { command: name });
  return parseResult(output, name);
}

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

  let partitioned = [];

  group('list catalog', function () {
    // dls -l prints the data set organisation, which is how PO (partitioned) is
    // told apart from PS (sequential) without a second call per data set.
    const result = run(`dls -l "${HLQ}.**"`, 'dls');

    check(result, {
      'dls returned rc 0': (r) => r.rc === 0,
      'catalog is not empty': (r) => r.lines.length > 0,
    });

    partitioned = result.lines
      .map((line) => line.trim().split(/\s+/))
      .filter((parts) => parts[0] === 'PO' || parts[0] === 'PO-E')
      .map((parts) => parts[parts.length - 1]);
  });

  if (partitioned.length === 0) {
    return;
  }

  const dsname = partitioned[Math.floor(Math.random() * partitioned.length)];

  group('list members', function () {
    const result = run(`dls "${dsname}(*)"`, 'dls members');
    check(result, { 'member listing returned rc 0': (r) => r.rc === 0 });

    if (result.rc !== 0 || result.lines.length === 0) {
      return;
    }

    const member = result.lines[Math.floor(Math.random() * result.lines.length)].trim();

    const content = run(`dcat "${member}"`, 'dcat');
    check(content, {
      'dcat returned rc 0': (r) => r.rc === 0,
      'member has content': (r) => r.body.length > 0,
    });
  });

  group('data set attributes', function () {
    // dls -ldu adds allocation and used-space columns, which is the ZOAU
    // equivalent of an ISPF 3.4 listing with space.
    const result = run(`dls -ldu "${dsname}"`, 'dls attributes');
    check(result, { 'attribute query returned rc 0': (r) => r.rc === 0 });
  });
}
