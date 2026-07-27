// TSO logon and logoff. The oldest availability check there is: if TSO takes
// logons, the system is up and RACF is answering.
//
// Worth running on a schedule rather than under load. Each logon allocates a TSO
// address space, and a burst of them will hit MAXUSERS long before it stresses
// anything interesting.
//
//   k6 run -e TN3270_HOST=tso.example.com -e TN3270_PORT=23 \
//          -e TN3270_USER=... -e TN3270_PASSWORD=... \
//          -e TSO_APPLID=TSO scripts/tn3270/tso-logon.js

import { check, group } from 'k6';
import { Trend } from 'k6/metrics';
import { withSession, screenHas } from '../lib/tn3270.js';
import { tn3270 as cfg } from '../lib/config.js';

const logonDuration = new Trend('tso_logon_duration', true);

const APPLID = __ENV.TSO_APPLID || 'TSO';

export const options = {
  scenarios: {
    logons: {
      executor: 'constant-arrival-rate',
      rate: Number(__ENV.TSO_LOGONS_PER_MINUTE || 6),
      timeUnit: '1m',
      duration: __ENV.TN3270_DURATION || '5m',
      preAllocatedVUs: 3,
      maxVUs: 10,
    },
  },
  thresholds: {
    checks: ['rate > 0.99'],
    tso_logon_duration: ['p(95) < 20000'],
    tn3270_wait_timeouts: ['count == 0'],
  },
};

export default function () {
  const started = Date.now();

  withSession(function (session) {
    group('logon', function () {
      // On a VTAM session manager the applid is typed at the unformatted screen.
      // On a system that presents the TSO logon panel directly, this is a no-op
      // because the screen is already the panel.
      if (!screenHas(session, 'ENTER USERID')) {
        session.clear();
        session.sendCommand(`LOGON APPLID(${APPLID})`, true);
      }

      session.sendCommand(cfg.user, true);

      check(session, {
        'password prompt displayed': (s) => screenHas(s, 'PASSWORD'),
      });

      session.type(cfg.password);
      session.enter();
      session.waitForField();

      // IKJ56425I means the user id is already logged on somewhere else, which is
      // the usual failure when several VUs share one RACF id.
      const screen = session.getScreenText();
      if (screen.includes('IKJ56425I')) {
        console.warn(`${cfg.user} is already logged on; give each VU its own id`);
      }

      check(session, {
        'logon accepted': (s) => screenHas(s, 'LOGON IN PROGRESS') || screenHas(s, 'READY'),
      });
    });

    logonDuration.add(Date.now() - started);

    group('logoff', function () {
      // The ready prompt appears after the logon proceeds. Clearing first gets
      // past any full-screen message panel waiting on an ENTER.
      session.clear();
      session.sendCommand('LOGOFF', false);
    });
  });
}
