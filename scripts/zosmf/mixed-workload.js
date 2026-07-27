// A realistic z/OSMF profile: several kinds of work running at once, each with its
// own arrival pattern and its own thresholds.
//
// This is the shape most mainframe load tests actually need. Batch submission is
// bursty and low volume, catalog searches are steady and expensive, console
// commands are rare and serialised. Running them as one flat VU count hides which
// of the three is the bottleneck.
//
//   k6 run -e ZOSMF_URL=... -e ZOS_USER=... -e ZOS_PASSWORD=... \
//          scripts/zosmf/mixed-workload.js

import { check, group } from 'k6';
import { listDatasets, consoleCommand, submitJcl, waitForJob, purgeJob } from '../lib/zosmf.js';
import { nullJob } from '../lib/jcl.js';
import { insecureTLS, requireCredentials, zos } from '../lib/config.js';

const DSLEVEL = __ENV.ZOS_DSLEVEL || `${zos.hlq}.**`;

export const options = {
  insecureSkipTLSVerify: insecureTLS,
  scenarios: {
    batch: {
      executor: 'constant-arrival-rate',
      exec: 'batchSubmission',
      rate: 4,
      timeUnit: '1m',
      duration: '3m',
      preAllocatedVUs: 3,
      maxVUs: 10,
      tags: { workload: 'batch' },
    },
    catalog: {
      executor: 'ramping-vus',
      exec: 'catalogSearch',
      startVUs: 1,
      stages: [
        { duration: '1m', target: 8 },
        { duration: '1m', target: 8 },
        { duration: '1m', target: 0 },
      ],
      tags: { workload: 'catalog' },
    },
    operator: {
      executor: 'constant-vus',
      exec: 'operatorCommand',
      vus: 1,
      duration: '3m',
      // Starts a minute in, so the console load lands while the catalog scenario
      // is already at its peak.
      startTime: '1m',
      tags: { workload: 'operator' },
    },
  },
  // Per-workload thresholds. A slow catalog search should not fail the run because
  // the batch scenario has a tighter budget.
  thresholds: {
    'zosmf_request_duration{workload:batch}': ['p(95) < 5000'],
    'zosmf_request_duration{workload:catalog}': ['p(95) < 15000'],
    'zosmf_request_duration{workload:operator}': ['p(95) < 5000'],
    'zosmf_success{workload:batch}': ['rate > 0.99'],
    'zosmf_success{workload:catalog}': ['rate > 0.99'],
    'zosmf_success{workload:operator}': ['rate > 0.99'],
    zos_job_turnaround: ['p(95) < 60000'],
  },
};

export function setup() {
  requireCredentials();
}

export function batchSubmission() {
  const res = submitJcl(nullJob('K6MIX'));
  if (!check(res, { 'job submitted': (r) => r.status === 201 })) {
    return;
  }

  const job = res.json();
  const { job: finished } = waitForJob(job.jobname, job.jobid, { timeoutSeconds: 90 });
  check(finished, { 'job ended with CC 0000': (j) => j?.retcode === 'CC 0000' });
  purgeJob(job.jobname, job.jobid);
}

export function catalogSearch() {
  group('catalog', function () {
    const res = listDatasets(DSLEVEL);
    check(res, { 'catalog search returned 200': (r) => r.status === 200 });
  });
}

export function operatorCommand() {
  const res = consoleCommand('D A,L');
  check(res, { 'operator command answered': (r) => r.status === 200 });
}

// Returning a value from handleSummary replaces k6's own stdout summary, so this
// prints the numbers a capacity discussion actually turns on and writes the full
// report to disk for the pipeline to keep.
export function handleSummary(data) {
  const metric = (name) => data.metrics?.[name]?.values ?? {};
  const p95 = (name) => Math.round(metric(name)['p(95)'] ?? 0);

  const lines = [
    '',
    'z/OS mixed workload',
    `  batch p95            ${p95('zosmf_request_duration{workload:batch}')} ms`,
    `  catalog p95          ${p95('zosmf_request_duration{workload:catalog}')} ms`,
    `  operator p95         ${p95('zosmf_request_duration{workload:operator}')} ms`,
    `  job turnaround p95   ${p95('zos_job_turnaround')} ms`,
    `  z/OSMF errors        ${metric('zosmf_errors').count ?? 0}`,
    '',
  ];

  return {
    stdout: lines.join('\n'),
    'summary.json': JSON.stringify(data, null, 2),
  };
}
