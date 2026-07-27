// Smoke test. Confirms the z/OSMF server answers, the credentials work, and TLS
// negotiates. Run this first: every other z/OSMF script assumes it passes.
//
//   k6 run -e ZOSMF_URL=https://zosmf.example.com:443 \
//          -e ZOS_USER=IBMUSER -e ZOS_PASSWORD=... \
//          scripts/zosmf/info.js

import { check } from 'k6';
import { info } from '../lib/zosmf.js';
import { insecureTLS, requireCredentials } from '../lib/config.js';

export const options = {
  vus: 1,
  iterations: 1,
  insecureSkipTLSVerify: insecureTLS,
  thresholds: {
    // A failed smoke test should stop the run rather than produce a red summary
    // twenty minutes later.
    checks: [{ threshold: 'rate == 1.0', abortOnFail: true }],
    zosmf_request_duration: ['p(95) < 2000'],
  },
};

export function setup() {
  requireCredentials();
}

export default function () {
  const res = info();

  check(res, {
    'z/OSMF answered 200': (r) => r.status === 200,
    'response is JSON': (r) => String(r.headers['Content-Type']).includes('json'),
    'reports a z/OSMF version': (r) => Boolean(r.json('zosmf_version')),
  });

  if (res.status === 200) {
    const body = res.json();
    console.log(
      `z/OSMF ${body.zosmf_version} on ${body.zos_version ?? 'unknown z/OS'}, ` +
        `host ${body.zosmf_hostname ?? 'unreported'}`,
    );
  }
}
