// Data set access over the files service: catalog search, member listing, read,
// and an optional write.
//
// Catalog searches are the expensive part. A dslevel of HLQ.** walks every entry
// under that qualifier, so the p95 here tracks catalog contention more than it
// tracks z/OSMF itself. Keep the qualifier as specific as the test allows.
//
//   k6 run -e ZOSMF_URL=... -e ZOS_USER=... -e ZOS_PASSWORD=... \
//          -e ZOS_HLQ=IBMUSER scripts/zosmf/datasets.js

import { check, group, sleep } from 'k6';
import { Trend } from 'k6/metrics';
import {
  listDatasets,
  listMembers,
  readDataset,
  writeDataset,
} from '../lib/zosmf.js';
import { insecureTLS, requireCredentials, zos } from '../lib/config.js';

const catalogEntries = new Trend('zos_catalog_entries');

const DSLEVEL = __ENV.ZOS_DSLEVEL || `${zos.hlq}.**`;
const ALLOW_WRITE = __ENV.ZOS_ALLOW_WRITE === 'true';
const THINK_TIME = Number(__ENV.ZOS_THINK_TIME ?? 1);

export const options = {
  insecureSkipTLSVerify: insecureTLS,
  vus: Number(__ENV.ZOS_VUS || 5),
  duration: __ENV.ZOS_DURATION || '1m',
  thresholds: {
    'zosmf_request_duration{name:list data sets}': ['p(95) < 10000'],
    'zosmf_request_duration{name:read data set}': ['p(95) < 3000'],
    zosmf_success: ['rate > 0.99'],
  },
};

// Discovery happens in setup because k6 forbids network calls in the init
// context, which rules out loading the list into a SharedArray.
export function setup() {
  requireCredentials();

  const res = listDatasets(DSLEVEL);
  if (res.status !== 200) {
    throw new Error(`catalog search for ${DSLEVEL} failed: ${res.status} ${res.body}`);
  }

  const partitioned = (res.json('items') ?? [])
    .filter((d) => String(d.dsorg ?? '').startsWith('PO'))
    .map((d) => d.dsname);

  if (partitioned.length === 0) {
    throw new Error(`no partitioned data sets under ${DSLEVEL}`);
  }

  console.log(`found ${partitioned.length} partitioned data sets under ${DSLEVEL}`);
  return { partitioned };
}

export default function (data) {
  const { partitioned } = data;

  group('catalog search', function () {
    const res = listDatasets(DSLEVEL);
    const ok = check(res, {
      'catalog search returned 200': (r) => r.status === 200,
      'returnedRows present': (r) => r.json('returnedRows') !== undefined,
    });
    if (ok) {
      catalogEntries.add(res.json('returnedRows'));
    }
  });

  const dsname = partitioned[Math.floor(Math.random() * partitioned.length)];

  group('list members', function () {
    const res = listMembers(dsname);
    check(res, { 'member listing returned 200': (r) => r.status === 200 });

    if (res.status !== 200) {
      return;
    }

    const members = res.json('items') ?? [];
    if (members.length === 0) {
      return;
    }

    const member = members[Math.floor(Math.random() * members.length)].member;
    const content = readDataset(`${dsname}(${member})`);
    check(content, {
      'member read returned 200': (r) => r.status === 200,
      'member has content': (r) => r.body.length > 0,
    });
  });

  if (!ALLOW_WRITE) {
    // Paced by default. Unpaced, five VUs against a real LPAR is several thousand
    // catalog searches a minute. Set ZOS_THINK_TIME=0 for maximum rate.
    sleep(THINK_TIME);
    return;
  }

  group('write', function () {
    // Guarded behind ZOS_ALLOW_WRITE because a load test that writes to a
    // cataloged data set on someone else's LPAR is an incident, not a test.
    const target = __ENV.ZOS_WRITE_TARGET;
    if (!target) {
      throw new Error('ZOS_ALLOW_WRITE is set but ZOS_WRITE_TARGET is not');
    }

    const line = `K6 WROTE THIS AT ${new Date().toISOString()}`;
    const res = writeDataset(target, `${line}\n`);
    check(res, { 'write accepted': (r) => r.status === 204 || r.status === 201 });
  });

  sleep(THINK_TIME);
}

