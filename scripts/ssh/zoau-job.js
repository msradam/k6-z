// Batch submission through ZOAU: write JCL to a temporary USS file, submit it with
// jsub, poll jls until it leaves the queue, then read the output with jcat.
//
// This is the same measurement as scripts/zosmf/job-submit.js taken through a
// different door. Comparing the two tells you how much of the turnaround is JES
// and how much is the z/OSMF server in front of it.
//
// One VU only: see the note in scripts/ssh/zoau-datasets.js.
//
//   k6 run -e ZOS_SSH_HOST=zos.example.com -e ZOS_USER=IBMUSER \
//          -e ZOS_PASSWORD=... -e ZOS_ACCOUNT=ACCT# scripts/ssh/zoau-job.js

import ssh from 'k6/x/ssh';
import { check, group, sleep } from 'k6';
import { Trend, Counter } from 'k6/metrics';
import exec from 'k6/execution';
import { instrumented, parseResult, parseJobList, zoauDuration } from '../lib/zoau.js';
import { nullJob } from '../lib/jcl.js';
import { ssh as sshCfg, zos } from '../lib/config.js';

const turnaround = new Trend('zoau_job_turnaround', true);
const jobsFailed = new Counter('zoau_jobs_failed');

const POLL_TIMEOUT = Number(__ENV.ZOS_JOB_TIMEOUT || 120);

export const options = {
  scenarios: {
    submissions: {
      executor: 'constant-vus',
      vus: 1,
      duration: __ENV.ZOS_DURATION || '3m',
    },
  },
  thresholds: {
    checks: ['rate > 0.99'],
    zoau_jobs_failed: ['count == 0'],
    zoau_job_turnaround: ['p(95) < 60000'],
  },
};

function run(command, name) {
  const started = Date.now();
  const output = ssh.run(instrumented(command));
  zoauDuration.add(Date.now() - started, { command: name });
  return parseResult(output, name);
}

export function setup() {
  if (!sshCfg.password && !sshCfg.rsaKey) {
    throw new Error('set ZOS_PASSWORD or ZOS_SSH_KEY');
  }
}

export default function () {
  ssh.connect({
    host: sshCfg.host,
    port: sshCfg.port,
    username: sshCfg.user,
    password: sshCfg.password,
    rsaKey: sshCfg.rsaKey,
    passphrase: sshCfg.passphrase,
  });

  const suffix = String(exec.scenario.iterationInTest % 10000).padStart(4, '0');
  const jobName = `K6${suffix}`;
  const path = `${zos.ussDir}/k6-${jobName}.jcl`;
  const jcl = nullJob(jobName);

  let jobid = null;
  const started = Date.now();

  group('stage jcl', function () {
    // A quoted heredoc stops the shell expanding anything inside the JCL. Job
    // cards contain characters the shell would otherwise try to interpret.
    const result = run(`cat > ${path} <<'ENDJCL'\n${jcl}\nENDJCL`, 'stage jcl');
    check(result, { 'jcl written': (r) => r.rc === 0 });
  });

  group('submit', function () {
    const result = run(`jsub -f ${path}`, 'jsub');
    const ok = check(result, {
      'jsub returned rc 0': (r) => r.rc === 0,
      'job id returned': (r) => /JOB\d+/.test(r.body),
    });

    if (ok) {
      jobid = /JOB\d+/.exec(result.body)[0];
    } else {
      jobsFailed.add(1);
    }
  });

  if (!jobid) {
    run(`rm -f ${path}`, 'cleanup');
    return;
  }

  group('wait for completion', function () {
    const deadline = Date.now() + POLL_TIMEOUT * 1000;
    let job = null;

    while (Date.now() < deadline) {
      const result = run(`jls ${jobid}`, 'jls');
      const jobs = parseJobList(result.lines);
      job = jobs[0] ?? null;

      // ZOAU reports a finished job with a status of CC and the return code in
      // the next column. ABEND and JCLERR are the two terminal failures.
      if (job && ['CC', 'ABEND', 'JCLERR'].includes(job.status)) {
        break;
      }

      sleep(1);
    }

    const ok = check(job, {
      'job completed': (j) => j !== null && j.status === 'CC',
      'return code is zero': (j) => j?.rc === '0000' || j?.rc === '0',
    });

    if (ok) {
      turnaround.add(Date.now() - started);
    } else {
      jobsFailed.add(1);
      console.warn(`${jobid} ended ${job?.status ?? 'unknown'} rc=${job?.rc}`);
    }
  });

  group('read output and purge', function () {
    const output = run(`jcat ${jobid}`, 'jcat');
    check(output, { 'job output readable': (r) => r.rc === 0 });

    // Purging keeps the spool from filling. jdel removes the job from the queue.
    run(`jdel ${jobid}`, 'jdel');
    run(`rm -f ${path}`, 'cleanup');
  });
}
