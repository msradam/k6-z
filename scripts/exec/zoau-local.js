// ZOAU commands run directly, for a k6 binary executing on z/OS UNIX itself.
//
// No SSH, no network hop, and no shared-session limit: k6/x/exec creates a module
// instance per VU and forks a process per call, so this scales with VU count in a
// way the SSH scripts cannot.
//
// This needs a k6 built for z/OS with the exec extension. The zopen package
// (`zopen install k6`) is vanilla k6 and does not include it. See docs/install for
// how to build one with IBM Open Enterprise SDK for Go.
//
// The same script runs unchanged on Linux on Z or in zCX against a locally
// installed ZOAU.
//
//   k6 run -e ZOS_HLQ=IBMUSER scripts/exec/zoau-local.js

import exec from 'k6/x/exec';
import { check, group } from 'k6';
import { Trend } from 'k6/metrics';
import { parseResult, zoauDuration, OPERATOR_PROBES } from '../lib/zoau.js';
import { zoau, zos } from '../lib/config.js';

const catalogEntries = new Trend('zoau_catalog_entries');

const HLQ = __ENV.ZOS_HLQ || zos.hlq;

// exec.command takes an argv array, so the shell is not involved and the ZOAU
// environment has to be passed explicitly rather than exported by a profile.
const ENVIRONMENT = [
  `ZOAU_HOME=${zoau.home}`,
  `PATH=${zoau.home}/bin:/bin:/usr/bin`,
  `LIBPATH=${zoau.home}/lib`,
  `PYTHONPATH=${zoau.pythonPath}`,
];

export const options = {
  scenarios: {
    commands: {
      executor: 'ramping-vus',
      startVUs: 1,
      stages: [
        { duration: '30s', target: Number(__ENV.ZOS_VUS || 4) },
        { duration: '1m', target: Number(__ENV.ZOS_VUS || 4) },
        { duration: '30s', target: 0 },
      ],
    },
  },
  thresholds: {
    checks: ['rate > 0.99'],
    zoau_command_failures: ['count == 0'],
    'zoau_command_duration{command:dls}': ['p(95) < 5000'],
  },
};

function run(name, command, args = []) {
  const started = Date.now();

  // combine_output folds stderr into the returned string. Without it a failing
  // ZOAU command returns an empty result and the reason is lost.
  const output = exec.command('sh', ['-c', `{ ${[command, ...args].join(' ')} ; } ; echo "__RC=$?"`], {
    env: ENVIRONMENT,
    combine_output: true,
    continue_on_error: true,
  });

  zoauDuration.add(Date.now() - started, { command: name });
  return parseResult(output, name);
}

export default function () {
  group('catalog', function () {
    const result = run('dls', 'dls', ['-l', `"${HLQ}.**"`]);

    const ok = check(result, {
      'dls returned rc 0': (r) => r.rc === 0,
      'catalog is not empty': (r) => r.lines.length > 0,
    });

    if (ok) {
      catalogEntries.add(result.lines.length);
    }
  });

  group('operator command', function () {
    const probe = OPERATOR_PROBES[Math.floor(Math.random() * OPERATOR_PROBES.length)];
    const result = run(probe.name, probe.command);

    check(result, {
      [`${probe.name} returned rc 0`]: (r) => r.rc === 0,
      [`${probe.name} response contains ${probe.expect}`]: (r) => r.body.includes(probe.expect),
    });
  });

  group('job queue', function () {
    const result = run('jls', 'jls');
    check(result, { 'jls returned rc 0': (r) => r.rc === 0 });
  });
}
