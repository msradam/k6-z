// Keeping RACF credentials out of the script, the shell history, and the process
// list, using k6's secrets API.
//
// The other scripts read ZOS_PASSWORD from the environment, which is fine on a
// laptop and wrong on a shared build agent: environment variables show up in
// process listings and in CI logs when a step echoes its environment. k6 1.3
// added `k6/secrets` for this.
//
//   Local file, one KEY=VALUE per line:
//     k6 run --secret-source=file=zos.secret scripts/zosmf/auth-secrets.js
//
//   From a Grafana Cloud k6 secret store:
//     k6 cloud run --local-execution scripts/zosmf/auth-secrets.js
//
// The value is fetched once per VU rather than once per iteration, because most
// secret sources are a network call.

import http from 'k6/http';
import encoding from 'k6/encoding';
import secrets from 'k6/secrets';
import { check } from 'k6';
import { insecureTLS, zosmf } from '../lib/config.js';

export const options = {
  vus: 1,
  iterations: 3,
  insecureSkipTLSVerify: insecureTLS,
  thresholds: {
    checks: ['rate == 1.0'],
  },
};

let authorization = null;

async function authorizationHeader() {
  if (authorization === null) {
    const user = await secrets.get('zos_user');
    const password = await secrets.get('zos_password');
    authorization = `Basic ${encoding.b64encode(`${user}:${password}`)}`;
  }
  return authorization;
}

export default async function () {
  const res = http.get(`${zosmf.url}/zosmf/info`, {
    headers: {
      Authorization: await authorizationHeader(),
      'X-CSRF-ZOSMF-HEADER': '',
    },
    tags: { name: 'info' },
  });

  check(res, {
    'authenticated against z/OSMF': (r) => r.status === 200,
    'reports a z/OSMF version': (r) => Boolean(r.json('zosmf_version')),
  });
}
