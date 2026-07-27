// Thin client over the documented z/OSMF REST services.
//
//   Jobs     PUT/GET/DELETE /zosmf/restjobs/jobs
//   Files    GET/PUT        /zosmf/restfiles/ds and /zosmf/restfiles/fs
//   Console  PUT/GET        /zosmf/restconsoles/consoles
//   Info     GET            /zosmf/info
//
// Reference: IBM z/OSMF programming guide, "z/OSMF REST services".

import http from 'k6/http';
import encoding from 'k6/encoding';
import { sleep } from 'k6';
import { Trend, Counter, Rate } from 'k6/metrics';
import { zosmf } from './config.js';

export const zosmfDuration = new Trend('zosmf_request_duration', true);
export const zosmfErrors = new Counter('zosmf_errors');
export const zosmfSuccess = new Rate('zosmf_success');
export const jobTurnaround = new Trend('zos_job_turnaround', true);

// Credentials go in an Authorization header rather than in the URL. k6 tags every
// request with its URL, so https://user:pass@host would put the password into the
// metric stream and into any exported summary.
const AUTHORIZATION = `Basic ${encoding.b64encode(`${zosmf.user}:${zosmf.password}`)}`;

// z/OSMF rejects any request that does not carry this header. The value is
// deliberately empty; only its presence is checked.
const CSRF = { 'X-CSRF-ZOSMF-HEADER': '' };

// `name` becomes k6's URL grouping tag. Without it, every data set and job id
// produces its own time series and the metric cardinality grows with the test.
export function request(method, path, body, params = {}) {
  const { name, headers, tags, ...rest } = params;

  const res = http.request(method, zosmf.url + path, body, {
    ...rest,
    headers: { Authorization: AUTHORIZATION, ...CSRF, ...headers },
    tags: { name: name ?? path, ...tags },
  });

  const ok = res.status >= 200 && res.status < 300;
  zosmfDuration.add(res.timings.duration, { name: name ?? path });
  zosmfSuccess.add(ok, { name: name ?? path });
  if (!ok) {
    zosmfErrors.add(1, { name: name ?? path, status: String(res.status) });
  }

  return res;
}

export function info() {
  return request('GET', '/zosmf/info', null, { name: 'info' });
}

// Submitting JCL inline needs the internal reader attributes. Fixed 80-byte
// records in text mode is what a card reader has always presented to JES.
export function submitJcl(jcl, params = {}) {
  return request('PUT', '/zosmf/restjobs/jobs', jcl, {
    name: 'submit job',
    headers: {
      'Content-Type': 'text/plain',
      'X-IBM-Intrdr-Class': 'A',
      'X-IBM-Intrdr-Recfm': 'F',
      'X-IBM-Intrdr-Lrecl': '80',
      'X-IBM-Intrdr-Mode': 'TEXT',
    },
    ...params,
  });
}

// The other submit form: point z/OSMF at JCL that already lives on the host.
export function submitDataset(dsname) {
  return request('PUT', '/zosmf/restjobs/jobs', JSON.stringify({ file: `//'${dsname}'` }), {
    name: 'submit job from data set',
    headers: { 'Content-Type': 'application/json' },
  });
}

export function listJobs({ owner = zosmf.user, prefix = '*', max = 100 } = {}) {
  const query = `owner=${owner}&prefix=${prefix}&max-jobs=${max}`;
  return request('GET', `/zosmf/restjobs/jobs?${query}`, null, { name: 'list jobs' });
}

export function jobStatus(jobname, jobid) {
  return request('GET', `/zosmf/restjobs/jobs/${jobname}/${jobid}`, null, {
    name: 'job status',
  });
}

export function spoolFiles(jobname, jobid) {
  return request('GET', `/zosmf/restjobs/jobs/${jobname}/${jobid}/files`, null, {
    name: 'list spool files',
  });
}

export function spoolContent(jobname, jobid, id) {
  return request('GET', `/zosmf/restjobs/jobs/${jobname}/${jobid}/files/${id}/records`, null, {
    name: 'read spool file',
  });
}

export function purgeJob(jobname, jobid) {
  return request('DELETE', `/zosmf/restjobs/jobs/${jobname}/${jobid}`, null, {
    name: 'purge job',
    headers: { 'X-IBM-Job-Modify-Version': '2.0' },
  });
}

// Polls until the job leaves the input and active queues. Returns the last job
// document seen, so callers can read `retcode` whether or not it completed.
export function waitForJob(jobname, jobid, { timeoutSeconds = 120, intervalSeconds = 1 } = {}) {
  const deadline = Date.now() + timeoutSeconds * 1000;
  const started = Date.now();
  let job = null;

  while (Date.now() < deadline) {
    const res = jobStatus(jobname, jobid);
    if (res.status !== 200) {
      return { job, timedOut: false, error: `status ${res.status}` };
    }

    job = res.json();
    if (job.status === 'OUTPUT') {
      jobTurnaround.add(Date.now() - started);
      return { job, timedOut: false, error: null };
    }

    sleep(intervalSeconds);
  }

  return { job, timedOut: true, error: 'timed out waiting for OUTPUT' };
}

export function listDatasets(dslevel) {
  return request('GET', `/zosmf/restfiles/ds?dslevel=${dslevel}`, null, {
    name: 'list data sets',
  });
}

export function listMembers(dsname) {
  return request('GET', `/zosmf/restfiles/ds/${dsname}/member`, null, {
    name: 'list members',
  });
}

export function readDataset(dsname) {
  return request('GET', `/zosmf/restfiles/ds/${dsname}`, null, {
    name: 'read data set',
    headers: { 'X-IBM-Data-Type': 'text' },
  });
}

export function writeDataset(dsname, content) {
  return request('PUT', `/zosmf/restfiles/ds/${dsname}`, content, {
    name: 'write data set',
    headers: { 'Content-Type': 'text/plain', 'X-IBM-Data-Type': 'text' },
  });
}

export function listUss(path) {
  return request('GET', `/zosmf/restfiles/fs?path=${encodeURIComponent(path)}`, null, {
    name: 'list USS directory',
  });
}

export function readUss(path) {
  return request('GET', `/zosmf/restfiles/fs${path}`, null, {
    name: 'read USS file',
    headers: { 'X-IBM-Data-Type': 'text' },
  });
}

export function writeUss(path, content) {
  return request('PUT', `/zosmf/restfiles/fs${path}`, content, {
    name: 'write USS file',
    headers: { 'Content-Type': 'text/plain', 'X-IBM-Data-Type': 'text' },
  });
}

// Issues an MVS operator command through the console service. The response
// carries `cmd-response` for commands that answer immediately, and
// `cmd-response-key` for ones whose messages arrive later.
export function consoleCommand(command, consoleName = zosmf.consoleName) {
  return request(
    'PUT',
    `/zosmf/restconsoles/consoles/${consoleName}`,
    JSON.stringify({ cmd: command }),
    { name: 'console command', headers: { 'Content-Type': 'application/json' } },
  );
}

export function consoleCollect(key, consoleName = zosmf.consoleName) {
  return request('GET', `/zosmf/restconsoles/consoles/${consoleName}/solmsgs/${key}`, null, {
    name: 'collect console messages',
  });
}
