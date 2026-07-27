// Account enquiry under load. Logon, navigate to the bank menu, browse an
// account, back out, repeat.
//
// The ramp is deliberately slow. A 3270 gateway allocates a terminal per session,
// and terminal pools are finite in a way that HTTP connection pools are not. A
// sharp ramp usually measures the pool, not the application.
//
//   k6 run -e TN3270_HOST=localhost -e TN3270_PORT=2023 \
//          -e TN3270_VUS=10 scripts/tn3270/simbank-browse.js

import { check, group, sleep } from 'k6';
import { Trend } from 'k6/metrics';
import { withSession, screenHas } from '../lib/tn3270.js';
import { tn3270 as cfg } from '../lib/config.js';

const enquiryDuration = new Trend('simbank_enquiry_duration', true);

// SimBank ships with these accounts populated.
const ACCOUNTS = ['123456789', '987654321'];

export const options = {
  scenarios: {
    enquiries: {
      executor: 'ramping-vus',
      startVUs: 1,
      stages: [
        { duration: '1m', target: Number(__ENV.TN3270_VUS || 10) },
        { duration: '2m', target: Number(__ENV.TN3270_VUS || 10) },
        { duration: '30s', target: 0 },
      ],
      gracefulRampDown: '30s',
    },
  },
  thresholds: {
    checks: ['rate > 0.99'],
    tn3270_connect_duration: ['p(95) < 5000'],
    tn3270_wait_duration: ['p(95) < 3000'],
    tn3270_wait_timeouts: ['count == 0'],
    simbank_enquiry_duration: ['p(95) < 8000'],
  },
};

export default function () {
  const started = Date.now();

  withSession(function (session) {
    group('logon', function () {
      session.type(cfg.user);
      session.tab();
      session.type(cfg.password);
      session.enter();
      session.waitForField();

      check(session, { 'main menu reached': (s) => screenHas(s, 'SIMPLATFORM MAIN MENU') });
    });

    group('open bank application', function () {
      session.pf(1);
      session.waitForField();
      session.clear();
      session.sendCommand('BANK', true);

      check(session, { 'bank menu displayed': (s) => screenHas(s, 'SIMBANK MAIN MENU') });
    });

    group('account enquiry', function () {
      session.sendPF(1, true);
      check(session, { 'account menu displayed': (s) => screenHas(s, 'SIMBANK ACCOUNT MENU') });

      const account = ACCOUNTS[Math.floor(Math.random() * ACCOUNTS.length)];
      session.sendCommand(account, true);

      check(session, {
        'account found': (s) => screenHas(s, 'Account Found'),
        'balance shown': (s) => screenHas(s, 'Balance'),
      });

      session.sendPF(3, true);
    });
  });

  enquiryDuration.add(Date.now() - started);

  // Real operators read the screen before pressing the next key. Removing this
  // turns the test into a protocol benchmark rather than a workload model.
  sleep(Number(__ENV.TN3270_THINK_TIME || 3));
}
