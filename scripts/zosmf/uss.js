// z/OS UNIX file access over the files service. Same REST family as data sets,
// different resource: /zosmf/restfiles/fs instead of /zosmf/restfiles/ds.
//
// Worth measuring separately from data sets. USS reads go through the file system
// and hierarchical file system caching; data set reads go through the catalog and
// VSAM. They fail in different ways and they scale differently.
//
//   k6 run -e ZOSMF_URL=... -e ZOS_USER=... -e ZOS_PASSWORD=... \
//          -e ZOS_USS_DIR=/u/ibmuser scripts/zosmf/uss.js

import { check, group, sleep } from 'k6';
import { Trend } from 'k6/metrics';
import { listUss, readUss, writeUss } from '../lib/zosmf.js';
import { insecureTLS, requireCredentials, zos } from '../lib/config.js';

const directoryEntries = new Trend('zos_uss_entries');

const DIR = __ENV.ZOS_USS_DIR || zos.ussDir;
const ALLOW_WRITE = __ENV.ZOS_ALLOW_WRITE === 'true';
const THINK_TIME = Number(__ENV.ZOS_THINK_TIME ?? 1);

export const options = {
  insecureSkipTLSVerify: insecureTLS,
  vus: Number(__ENV.ZOS_VUS || 5),
  duration: __ENV.ZOS_DURATION || '1m',
  thresholds: {
    'zosmf_request_duration{name:list USS directory}': ['p(95) < 3000'],
    'zosmf_request_duration{name:read USS file}': ['p(95) < 3000'],
    zosmf_success: ['rate > 0.99'],
  },
};

export function setup() {
  requireCredentials();

  const res = listUss(DIR);
  if (res.status !== 200) {
    throw new Error(`cannot list ${DIR}: ${res.status} ${res.body}`);
  }

  // Directories and symlinks are skipped. Mode strings start with 'd' for a
  // directory and 'l' for a link, the same convention ls uses.
  const files = (res.json('items') ?? [])
    .filter((e) => !String(e.mode ?? '').startsWith('d') && !String(e.mode ?? '').startsWith('l'))
    .filter((e) => e.name !== '.' && e.name !== '..')
    .map((e) => `${DIR.replace(/\/$/, '')}/${e.name}`);

  if (files.length === 0) {
    throw new Error(`no regular files in ${DIR}`);
  }

  console.log(`found ${files.length} files in ${DIR}`);
  return { files };
}

export default function (data) {
  group('list directory', function () {
    const res = listUss(DIR);
    const ok = check(res, {
      'directory listing returned 200': (r) => r.status === 200,
      'returnedRows present': (r) => r.json('returnedRows') !== undefined,
    });
    if (ok) {
      directoryEntries.add(res.json('returnedRows'));
    }
  });

  group('read file', function () {
    const path = data.files[Math.floor(Math.random() * data.files.length)];
    const res = readUss(path);

    // 403 is the normal answer for a file the test user cannot read. Counting it
    // as a failure would make the result depend on the directory's permissions
    // rather than on z/OSMF's behaviour.
    if (res.status === 403) {
      return;
    }

    check(res, { 'file read returned 200': (r) => r.status === 200 });
  });

  if (!ALLOW_WRITE) {
    // Paced by default so that pointing this at a real system does not produce
    // thousands of requests a minute. Set ZOS_THINK_TIME=0 for maximum rate.
    sleep(THINK_TIME);
    return;
  }

  group('write file', function () {
    const target = `${DIR.replace(/\/$/, '')}/k6-write-probe.txt`;
    const res = writeUss(target, `written by k6 at ${new Date().toISOString()}\n`);
    check(res, { 'write accepted': (r) => r.status === 204 || r.status === 201 });
  });

  sleep(THINK_TIME);
}
