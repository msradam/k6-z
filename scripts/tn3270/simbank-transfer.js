// Funds transfer: a write transaction rather than an enquiry.
//
// Transfers move money between two accounts, so unlike the browse script this one
// changes state. Against SimBank that is harmless. Against anything else, read the
// script before you run it.
//
//   k6 run -e TN3270_HOST=localhost -e TN3270_PORT=2023 \
//          scripts/tn3270/simbank-transfer.js

import { check, group, sleep } from 'k6';
import { Counter } from 'k6/metrics';
import { withSession, fillFields, screenHas } from '../lib/tn3270.js';
import { tn3270 as cfg } from '../lib/config.js';

const transfersCompleted = new Counter('simbank_transfers_completed');
const transfersRejected = new Counter('simbank_transfers_rejected');

const ACCOUNT_A = __ENV.SIMBANK_ACCOUNT_A || '123456789';
const ACCOUNT_B = __ENV.SIMBANK_ACCOUNT_B || '987654321';
const AMOUNT = __ENV.SIMBANK_AMOUNT || '10.00';

export const options = {
  scenarios: {
    transfers: {
      executor: 'constant-arrival-rate',
      rate: Number(__ENV.TN3270_TPS || 2),
      timeUnit: '1s',
      duration: __ENV.TN3270_DURATION || '2m',
      preAllocatedVUs: 10,
      maxVUs: 40,
    },
  },
  thresholds: {
    checks: ['rate > 0.99'],
    simbank_transfers_rejected: ['count == 0'],
    tn3270_wait_timeouts: ['count == 0'],
    tn3270_session_duration: ['p(95) < 15000'],
  },
};

export default function () {
  withSession(function (session) {
    group('logon', function () {
      session.type(cfg.user);
      session.tab();
      session.type(cfg.password);
      session.enter();
      session.waitForField();
    });

    group('open bank application', function () {
      session.pf(1);
      session.waitForField();
      session.clear();
      session.sendCommand('BANK', true);
      check(session, { 'bank menu displayed': (s) => screenHas(s, 'SIMBANK MAIN MENU') });
    });

    group('transfer', function () {
      session.sendPF(4, true);
      check(session, { 'transfer screen displayed': (s) => screenHas(s, 'SIMBANK TRANSFER MENU') });

      // From and To are both 9 characters and both filled exactly, so the cursor
      // auto-advances between them. fillFields tabs only where it has to.
      fillFields(session, [ACCOUNT_A, ACCOUNT_B, AMOUNT]);
      session.enter();
      session.waitForField();

      const ok = check(session, {
        'transfer accepted': (s) => screenHas(s, 'Transfer Successful'),
      });

      if (ok) {
        transfersCompleted.add(1);
      } else {
        transfersRejected.add(1);
        console.warn(`transfer rejected:\n${session.getScreenText()}`);
      }

      session.sendPF(3, true);
    });
  });

  sleep(Number(__ENV.TN3270_THINK_TIME || 2));
}
