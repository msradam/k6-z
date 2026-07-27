// Issues MVS operator commands through the console service.
//
// The commands below are all display commands taken from IBM's published ZOAU
// samples. They read system state and change nothing. Do not point this script at
// a production LPAR with a modified command list: the console service will happily
// run whatever you send it, with the authority of the user you authenticated as.
//
//   k6 run -e ZOSMF_URL=... -e ZOS_USER=... -e ZOS_PASSWORD=... \
//          scripts/zosmf/console.js

import { check, group, sleep } from 'k6';
import { consoleCommand, consoleCollect } from '../lib/zosmf.js';
import { insecureTLS, requireCredentials } from '../lib/config.js';

// Display-only commands. Each returns immediately with a response body.
const COMMANDS = [
  { cmd: 'D IPLINFO', expect: 'IEE254I' },
  { cmd: 'D T', expect: 'IEE136I' },
  { cmd: 'D M=CPU', expect: 'IEE174I' },
  { cmd: 'D A,L', expect: 'IEE114I' },
  { cmd: 'D GRS,C', expect: 'ISG343I' },
  { cmd: 'D OMVS,LIMITS', expect: 'BPXO051I' },
];

export const options = {
  insecureSkipTLSVerify: insecureTLS,
  scenarios: {
    // Operator commands are serialised by the console. Running many at once
    // measures the console's queue, not the system's ability to answer, so this
    // stays deliberately low.
    operators: {
      executor: 'constant-vus',
      vus: Number(__ENV.ZOS_VUS || 2),
      duration: __ENV.ZOS_DURATION || '1m',
    },
  },
  thresholds: {
    'zosmf_request_duration{name:console command}': ['p(95) < 5000'],
    zosmf_success: ['rate > 0.99'],
  },
};

export function setup() {
  requireCredentials();

  const res = consoleCommand('D T');
  if (res.status !== 200) {
    throw new Error(
      `console service rejected D T with ${res.status}. ` +
        'The user needs CONSOLE authority in RACF. Body: ' +
        res.body,
    );
  }
}

export default function () {
  const probe = COMMANDS[Math.floor(Math.random() * COMMANDS.length)];

  group('issue command', function () {
    const res = consoleCommand(probe.cmd);

    const ok = check(res, {
      'command accepted': (r) => r.status === 200,
      'response returned': (r) => Boolean(r.json('cmd-response')),
    });

    if (!ok) {
      return;
    }

    check(res, {
      [`response contains ${probe.expect}`]: (r) =>
        String(r.json('cmd-response')).includes(probe.expect),
    });

    // Commands whose messages arrive asynchronously return a key instead of a
    // complete response. Collecting it is a second round trip.
    const key = res.json('cmd-response-key');
    if (key) {
      sleep(1);
      const collected = consoleCollect(key);
      check(collected, { 'collected late messages': (r) => r.status === 200 });
    }
  });

  sleep(1);
}
