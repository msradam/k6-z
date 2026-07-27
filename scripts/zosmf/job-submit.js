// Measures JES turnaround: submit JCL through the internal reader, poll until the
// job reaches the output queue, read its spool, then purge it.
//
// The default job is IEFBR14, which does nothing. That is intentional. It isolates
// the cost of submission, scheduling, and spool handling from whatever an
// application would have done, which is the number you want when you are sizing
// JES rather than testing a program.
//
//   k6 run -e ZOSMF_URL=... -e ZOS_USER=... -e ZOS_PASSWORD=... \
//          -e ZOS_ACCOUNT=ACCT# scripts/zosmf/job-submit.js

import { check, group, fail } from 'k6';
import { Counter } from 'k6/metrics';
import exec from 'k6/execution';
import { submitJcl, waitForJob, spoolFiles, spoolContent, purgeJob } from '../lib/zosmf.js';
import { nullJob, copyJob } from '../lib/jcl.js';
import { insecureTLS, requireCredentials } from '../lib/config.js';

const jobsCompleted = new Counter('zos_jobs_completed');
const jobsFailed = new Counter('zos_jobs_failed');

const WITH_OUTPUT = __ENV.ZOS_JOB_WITH_OUTPUT === 'true';

export const options = {
  insecureSkipTLSVerify: insecureTLS,
  scenarios: {
    // Arrival rate rather than VU count: JES queue behaviour is a function of how
    // fast work shows up, not how many connections are open.
    submissions: {
      executor: 'constant-arrival-rate',
      rate: Number(__ENV.ZOS_JOBS_PER_MINUTE || 6),
      timeUnit: '1m',
      duration: __ENV.ZOS_DURATION || '2m',
      preAllocatedVUs: 5,
      maxVUs: 20,
    },
  },
  thresholds: {
    zos_job_turnaround: ['p(95) < 30000'],
    zos_jobs_failed: ['count == 0'],
    checks: ['rate > 0.99'],
  },
};

export function setup() {
  requireCredentials();
}

export default function () {
  // A unique job name per iteration keeps the JES output queue readable and stops
  // one iteration purging another's output.
  const suffix = String(exec.scenario.iterationInTest % 10000).padStart(4, '0');
  const jobName = `K6${suffix}`;
  const jcl = WITH_OUTPUT ? copyJob(jobName) : nullJob(jobName);

  let submitted;

  group('submit', function () {
    const res = submitJcl(jcl);
    const ok = check(res, {
      'submit accepted': (r) => r.status === 201,
      'job id returned': (r) => Boolean(r.json('jobid')),
    });

    if (!ok) {
      jobsFailed.add(1);
      fail(`submit failed with ${res.status}: ${res.body}`);
    }

    submitted = res.json();
  });

  group('wait for completion', function () {
    const { job, timedOut } = waitForJob(submitted.jobname, submitted.jobid, {
      timeoutSeconds: Number(__ENV.ZOS_JOB_TIMEOUT || 120),
    });

    const ok = check(
      { job, timedOut },
      {
        'job reached OUTPUT': (r) => !r.timedOut && r.job?.status === 'OUTPUT',
        'return code is zero': (r) => r.job?.retcode === 'CC 0000',
      },
    );

    if (ok) {
      jobsCompleted.add(1);
    } else {
      jobsFailed.add(1);
      console.warn(`${submitted.jobid} ended ${job?.status ?? 'unknown'} rc=${job?.retcode}`);
    }
  });

  group('read spool', function () {
    const files = spoolFiles(submitted.jobname, submitted.jobid);
    check(files, { 'spool listing returned': (r) => r.status === 200 });

    if (files.status !== 200) {
      return;
    }

    // JESMSGLG carries the allocation and termination messages, which is where a
    // failure shows up first.
    const log = files.json().find((f) => f.ddname === 'JESMSGLG');
    if (log) {
      const content = spoolContent(submitted.jobname, submitted.jobid, log.id);
      check(content, {
        'JESMSGLG readable': (r) => r.status === 200,
        'job logged as ended': (r) => r.body.includes('ENDED'),
      });
    }
  });

  group('purge', function () {
    // Leaving thousands of held output data sets behind is how a load test turns
    // into a spool-full incident on a shared LPAR.
    const res = purgeJob(submitted.jobname, submitted.jobid);
    check(res, { 'purge accepted': (r) => r.status === 200 || r.status === 202 });
  });
}
