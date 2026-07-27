// A CICS transaction under load, using only the signon and signoff transactions
// IBM documents: CESN to sign on, CESF LOGOFF to sign off.
//
// The transaction to drive is yours to supply. Nothing here knows anything about
// any particular application, and that is the point: point CICS_TRAN at a
// read-only enquiry in your own region and set CICS_EXPECT to a string that
// appears on a successful response screen.
//
//   k6 run -e TN3270_HOST=cics.example.com -e TN3270_PORT=23 \
//          -e TN3270_USER=... -e TN3270_PASSWORD=... \
//          -e CICS_TRAN=MYTX -e CICS_EXPECT='ENQUIRY COMPLETE' \
//          scripts/tn3270/cics-transaction.js

import { check, group, sleep } from 'k6';
import { Trend, Counter } from 'k6/metrics';
import { withSession, screenHas } from '../lib/tn3270.js';
import { tn3270 as cfg } from '../lib/config.js';

const transactionDuration = new Trend('cics_transaction_duration', true);
const transactionAbends = new Counter('cics_transaction_abends');

const TRAN = __ENV.CICS_TRAN;
const EXPECT = __ENV.CICS_EXPECT;
const SIGNON_TRAN = __ENV.CICS_SIGNON_TRAN || 'CESN';

export const options = {
  scenarios: {
    transactions: {
      executor: 'ramping-arrival-rate',
      startRate: 1,
      timeUnit: '1s',
      preAllocatedVUs: 10,
      maxVUs: Number(__ENV.CICS_MAX_VUS || 50),
      stages: [
        { duration: '1m', target: Number(__ENV.CICS_TPS || 5) },
        { duration: '3m', target: Number(__ENV.CICS_TPS || 5) },
        { duration: '1m', target: 0 },
      ],
    },
  },
  thresholds: {
    checks: ['rate > 0.99'],
    cics_transaction_duration: ['p(95) < 3000', 'p(99) < 5000'],
    cics_transaction_abends: ['count == 0'],
    tn3270_wait_timeouts: ['count == 0'],
  },
};

export function setup() {
  if (!TRAN || !EXPECT) {
    throw new Error('set CICS_TRAN and CICS_EXPECT; this script does not guess your application');
  }
}

export default function () {
  withSession(function (session) {
    group('signon', function () {
      session.clear();
      session.sendCommand(SIGNON_TRAN, true);

      check(session, { 'signon screen displayed': (s) => screenHas(s, 'Userid') });

      // CESN puts the cursor in the Userid field. Password follows on the next
      // unprotected field.
      session.type(cfg.user);
      session.tab();
      session.type(cfg.password);
      session.enter();
      session.waitForField();

      check(session, {
        'signon accepted': (s) => !screenHas(s, 'DFHCE3504') && !screenHas(s, 'DFHCE3546'),
      });
    });

    group('transaction', function () {
      const started = Date.now();

      session.clear();
      session.sendCommand(TRAN, true);

      transactionDuration.add(Date.now() - started);

      // CICS reports abends as DFHAC2206 on the terminal. Catching it here
      // distinguishes an application failure from a protocol timeout.
      const screen = session.getScreenText();
      if (screen.includes('DFHAC2206') || screen.includes('DFHAC2001')) {
        transactionAbends.add(1);
        console.warn(`transaction ${TRAN} abended:\n${screen}`);
        return;
      }

      check(session, {
        [`response contains ${EXPECT}`]: (s) => screenHas(s, EXPECT),
      });
    });

    group('signoff', function () {
      session.clear();
      session.sendCommand('CESF LOGOFF', true);
    });
  });

  sleep(Number(__ENV.TN3270_THINK_TIME || 1));
}
