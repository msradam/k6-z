// Read-only job browsing: list the output queue, then fetch spool content for the
// jobs found. Nothing is submitted and nothing is purged, so this is the script to
// point at a production LPAR when you want a load profile without side effects.
//
//   k6 run -e ZOSMF_URL=... -e ZOS_USER=... -e ZOS_PASSWORD=... \
//          -e ZOS_JOB_OWNER='*' -e ZOS_JOB_PREFIX='CICS*' scripts/zosmf/job-query.js

import { check, group } from 'k6';
import { Trend } from 'k6/metrics';
import { listJobs, spoolFiles, spoolContent } from '../lib/zosmf.js';
import { insecureTLS, requireCredentials, zosmf } from '../lib/config.js';

const jobsReturned = new Trend('zos_jobs_returned');

const OWNER = __ENV.ZOS_JOB_OWNER || zosmf.user;
const PREFIX = __ENV.ZOS_JOB_PREFIX || '*';
const MAX_JOBS = Number(__ENV.ZOS_MAX_JOBS || 50);

export const options = {
  insecureSkipTLSVerify: insecureTLS,
  scenarios: {
    browsing: {
      executor: 'ramping-vus',
      startVUs: 1,
      stages: [
        { duration: '30s', target: Number(__ENV.ZOS_VUS || 5) },
        { duration: '1m', target: Number(__ENV.ZOS_VUS || 5) },
        { duration: '30s', target: 0 },
      ],
    },
  },
  thresholds: {
    'zosmf_request_duration{name:list jobs}': ['p(95) < 3000'],
    'zosmf_request_duration{name:read spool file}': ['p(95) < 5000'],
    zosmf_success: ['rate > 0.99'],
  },
};

export function setup() {
  requireCredentials();

  const res = listJobs({ owner: OWNER, prefix: PREFIX, max: MAX_JOBS });
  if (res.status !== 200) {
    throw new Error(`cannot list jobs: ${res.status} ${res.body}`);
  }

  const jobs = res.json().map((j) => ({ jobname: j.jobname, jobid: j.jobid }));
  if (jobs.length === 0) {
    throw new Error(`no jobs match owner=${OWNER} prefix=${PREFIX}; nothing to browse`);
  }

  console.log(`browsing ${jobs.length} jobs matching ${OWNER}/${PREFIX}`);
  return { jobs };
}

export default function (data) {
  group('list output queue', function () {
    const res = listJobs({ owner: OWNER, prefix: PREFIX, max: MAX_JOBS });
    const ok = check(res, { 'listing returned 200': (r) => r.status === 200 });
    if (ok) {
      jobsReturned.add(res.json().length);
    }
  });

  group('browse one job', function () {
    const job = data.jobs[Math.floor(Math.random() * data.jobs.length)];

    const files = spoolFiles(job.jobname, job.jobid);
    // A job purged between setup and now returns 400, which is expected on a busy
    // system and should not count as a failure.
    if (files.status === 400) {
      return;
    }

    const ok = check(files, { 'spool listing returned 200': (r) => r.status === 200 });
    if (!ok) {
      return;
    }

    const spool = files.json();
    if (spool.length === 0) {
      return;
    }

    const file = spool[Math.floor(Math.random() * spool.length)];
    const content = spoolContent(job.jobname, job.jobid, file.id);
    check(content, {
      'spool content returned 200': (r) => r.status === 200,
      'spool content not empty': (r) => r.body.length > 0,
    });
  });
}
