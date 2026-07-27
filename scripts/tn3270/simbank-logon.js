// Logon smoke test against Galasa SimBank.
//
// SimBank is the sample 3270 application shipped with the Galasa test framework.
// It runs in a container on a laptop, which makes it the right target for proving
// a 3270 script works before anyone points it at a real LPAR. See
// environments/simbank for how to start it.
//
//   k6 run -e TN3270_HOST=localhost -e TN3270_PORT=2023 \
//          scripts/tn3270/simbank-logon.js

import { check } from 'k6';
import { withSession, screenHas } from '../lib/tn3270.js';
import { tn3270 as cfg } from '../lib/config.js';

export const options = {
  vus: 1,
  iterations: 1,
  thresholds: {
    checks: [{ threshold: 'rate == 1.0', abortOnFail: true }],
    tn3270_connect_duration: ['p(95) < 5000'],
    tn3270_errors: ['count == 0'],
  },
};

export default function () {
  withSession(function (session) {
    check(session, {
      'logon screen displayed': (s) => screenHas(s, 'SIMPLATFORM', 'Userid'),
    });

    // IBMUSER is 7 characters in an 8-character field, so the cursor does not
    // auto-advance and the tab is required.
    session.type(cfg.user);
    session.tab();
    session.type(cfg.password);
    session.enter();
    session.waitForField();

    check(session, {
      'main menu reached': (s) => screenHas(s, 'SIMPLATFORM MAIN MENU'),
    });
  });
}
