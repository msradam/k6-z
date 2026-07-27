// Session helpers shared by the TN3270 scripts.
//
// Requires a k6 binary built with xk6-tn3270. See docs/install for the bundle
// that includes it, or build one with:
//   xk6 build v1.6.1 --with github.com/msradam/xk6-tn3270@v0.1.0

import { TN3270 } from 'k6/x/tn3270';
import { tn3270 as cfg } from './config.js';

export function openSession(options = {}) {
  const { host = cfg.host, port = cfg.port, timeout = 30 } = options;

  const session = TN3270();
  session.setModel(cfg.model);
  session.setCodePage(cfg.codePage);
  if (__ENV.TN3270_TRACE === 'true') {
    session.setTrace(true);
  }

  if (cfg.tls) {
    session.connectTLS(host, port, __ENV.TN3270_TLS_INSECURE === 'true', timeout);
  } else {
    session.connect(host, port, timeout);
  }

  session.waitForField(timeout);
  return session;
}

// Sessions hold a socket and a screen buffer for as long as the VU lives. Without
// this in a finally block, a thrown check leaks the connection until the iteration
// ends, and on a 3270 gateway that shows up as exhausted terminal pools long
// before it shows up as a k6 error.
export function withSession(fn, options = {}) {
  const session = openSession(options);
  try {
    return fn(session);
  } finally {
    session.disconnect();
  }
}

// Field-boundary behaviour is the thing that trips people moving from a scripted
// emulator. type() auto-advances into the next unprotected field only when the
// current field is filled exactly. A 7-character user id in an 8-character field
// does not advance, so the tab is explicit.
export function fillFields(session, values) {
  values.forEach((value, index) => {
    session.type(value);
    if (index < values.length - 1) {
      session.tab();
    }
  });
}

export function screenHas(session, ...needles) {
  const screen = session.getScreenText();
  return needles.every((needle) => screen.includes(needle));
}
