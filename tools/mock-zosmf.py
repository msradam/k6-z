#!/usr/bin/env python3
"""A stand-in for z/OSMF, good enough to run the sample scripts against.

Implements the shapes the scripts depend on: the info service, the jobs service
with a queue that moves jobs from INPUT to ACTIVE to OUTPUT over a few seconds,
the files service for data sets and USS, and the console service. It rejects
requests that are missing the CSRF header or the Authorization header, so a
script that forgets either fails here rather than on a real system.

It is not an emulator. Nothing it returns should be treated as evidence about how
a real z/OSMF behaves under load.

    python3 tools/mock-zosmf.py --port 10443
    k6 run -e ZOSMF_URL=http://localhost:10443 -e ZOS_PASSWORD=any \\
        scripts/zosmf/info.js
"""

import argparse
import json
import re
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs, unquote

JOBS = {}
JOBS_LOCK = threading.Lock()
JOB_SEQUENCE = [0]

# How long a submitted job spends in each queue before it moves on.
INPUT_SECONDS = 0.5
ACTIVE_SECONDS = 1.5

DATASETS = [
    {"dsname": "IBMUSER.JCL", "dsorg": "PO", "recfm": "FB", "lrecl": 80},
    {"dsname": "IBMUSER.CNTL", "dsorg": "PO", "recfm": "FB", "lrecl": 80},
    {"dsname": "IBMUSER.LOAD", "dsorg": "PO-E", "recfm": "U", "lrecl": 0},
    {"dsname": "IBMUSER.REPORT", "dsorg": "PS", "recfm": "FB", "lrecl": 133},
]

MEMBERS = ["COMPILE", "LINK", "RUNJOB", "CLEANUP"]

USS_ENTRIES = [
    {"name": ".", "mode": "drwxr-xr-x", "size": 8192},
    {"name": "..", "mode": "drwxr-xr-x", "size": 8192},
    {"name": "profile", "mode": "-rw-r--r--", "size": 412},
    {"name": "run.sh", "mode": "-rwxr-xr-x", "size": 1044},
    {"name": "logs", "mode": "drwxr-xr-x", "size": 8192},
]

CONSOLE_RESPONSES = {
    "D IPLINFO": "IEE254I 12.00.01 IPLINFO DISPLAY 001\n SYSTEM IPLED AT 09.14.02 ON 07/27/2026",
    "D T": "IEE136I LOCAL: TIME=12.00.01 DATE=2026.208  UTC: TIME=16.00.01",
    "D M=CPU": "IEE174I 12.00.01 DISPLAY M 002\n PROCESSOR STATUS\n ID  CPU   SERIAL\n 00  +    0ABCDE",
    "D A,L": "IEE114I 12.00.01 ACTIVE 003\n JOBS     M/S    TS USERS    SYSAS    INITS",
    "D GRS,C": "ISG343I 12.00.01 GRS STATUS 004\n NO REQUESTS OUTSTANDING",
    "D OMVS,LIMITS": "BPXO051I 12.00.01 DISPLAY OMVS 005\n MAXPROCSYS 4096  CURRENT 210",
    "D R,L": "IEE112I 12.00.01 PENDING REQUESTS 006\n NO OUTSTANDING REQUESTS",
}


def next_job_id():
    JOB_SEQUENCE[0] += 1
    return f"JOB{JOB_SEQUENCE[0]:05d}"


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        if self.server.verbose:
            super().log_message(fmt, *args)

    def send_json(self, status, payload):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_text(self, status, text):
        body = text.encode()
        self.send_response(status)
        self.send_header("Content-Type", "text/plain")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def authorized(self):
        """z/OSMF rejects requests without both of these. So does this."""
        if "X-CSRF-ZOSMF-HEADER" not in self.headers:
            self.send_json(400, {"reason": "missing X-CSRF-ZOSMF-HEADER"})
            return False
        if not self.headers.get("Authorization", "").startswith("Basic "):
            self.send_response(401)
            self.send_header("WWW-Authenticate", 'Basic realm="zOSMF"')
            self.send_header("Content-Length", "0")
            self.end_headers()
            return False
        return True

    def read_body(self):
        length = int(self.headers.get("Content-Length", 0))
        return self.rfile.read(length).decode(errors="replace") if length else ""

    def do_GET(self):
        if not self.authorized():
            return

        parsed = urlparse(self.path)
        path, query = parsed.path, parse_qs(parsed.query)

        if path == "/zosmf/info":
            return self.send_json(200, {
                "zosmf_version": "2.7",
                "zosmf_hostname": "MOCK",
                "zosmf_saf_realm": "SAFRealm",
                "zos_version": "04.28.00",
                "api_version": "1",
            })

        if path == "/zosmf/restjobs/jobs":
            with JOBS_LOCK:
                jobs = [self.job_document(job) for job in JOBS.values()]
            prefix = query.get("prefix", ["*"])[0].rstrip("*")
            jobs = [j for j in jobs if j["jobname"].startswith(prefix)]
            return self.send_json(200, jobs[: int(query.get("max-jobs", ["1000"])[0])])

        job_match = re.fullmatch(r"/zosmf/restjobs/jobs/([^/]+)/([^/]+)", path)
        if job_match:
            job = self.lookup(job_match.group(2))
            if job is None:
                return self.send_json(400, {"reason": "job not found"})
            return self.send_json(200, self.job_document(job))

        files_match = re.fullmatch(r"/zosmf/restjobs/jobs/([^/]+)/([^/]+)/files", path)
        if files_match:
            if self.lookup(files_match.group(2)) is None:
                return self.send_json(400, {"reason": "job not found"})
            return self.send_json(200, [
                {"ddname": "JESMSGLG", "id": 2, "records-url": "", "lrecl": 133},
                {"ddname": "JESJCL", "id": 3, "records-url": "", "lrecl": 136},
                {"ddname": "JESYSMSG", "id": 4, "records-url": "", "lrecl": 137},
            ])

        records_match = re.fullmatch(
            r"/zosmf/restjobs/jobs/([^/]+)/([^/]+)/files/(\d+)/records", path
        )
        if records_match:
            jobid = records_match.group(2)
            if self.lookup(jobid) is None:
                return self.send_json(400, {"reason": "job not found"})
            return self.send_text(200,
                f"J E S 2  J O B  L O G\n"
                f"IEF403I {jobid} - STARTED\n"
                f"IEF404I {jobid} - ENDED\n"
                f"$HASP395 {jobid} ENDED - RC=0000\n")

        if path == "/zosmf/restfiles/ds":
            level = query.get("dslevel", [""])[0].split(".")[0]
            items = [d for d in DATASETS if d["dsname"].startswith(level)] or DATASETS
            return self.send_json(200, {"items": items, "returnedRows": len(items),
                                        "JSONversion": 1})

        member_match = re.fullmatch(r"/zosmf/restfiles/ds/([^/]+)/member", path)
        if member_match:
            items = [{"member": m} for m in MEMBERS]
            return self.send_json(200, {"items": items, "returnedRows": len(items),
                                        "JSONversion": 1})

        if path.startswith("/zosmf/restfiles/ds/"):
            name = unquote(path[len("/zosmf/restfiles/ds/"):])
            return self.send_text(200,
                f"//* CONTENT OF {name}\n//STEP1    EXEC PGM=IEFBR14\n")

        if path == "/zosmf/restfiles/fs":
            return self.send_json(200, {"items": USS_ENTRIES,
                                        "returnedRows": len(USS_ENTRIES),
                                        "JSONversion": 1})

        if path.startswith("/zosmf/restfiles/fs/"):
            return self.send_text(200, f"contents of {path[len('/zosmf/restfiles/fs'):]}\n")

        solmsgs = re.fullmatch(r"/zosmf/restconsoles/consoles/([^/]+)/solmsgs/(.+)", path)
        if solmsgs:
            return self.send_json(200, {"cmd-response": "", "cmd-response-key": solmsgs.group(2)})

        return self.send_json(404, {"reason": f"no mock route for {path}"})

    def do_PUT(self):
        if not self.authorized():
            return

        path = urlparse(self.path).path
        body = self.read_body()

        if path == "/zosmf/restjobs/jobs":
            name_match = re.search(r"^//(\S{1,8})\s+JOB", body, re.MULTILINE)
            jobname = name_match.group(1) if name_match else "K6JOB"
            jobid = next_job_id()

            with JOBS_LOCK:
                JOBS[jobid] = {"jobname": jobname, "jobid": jobid,
                               "submitted": time.monotonic()}
                job = JOBS[jobid]

            return self.send_json(201, self.job_document(job))

        console = re.fullmatch(r"/zosmf/restconsoles/consoles/([^/]+)", path)
        if console:
            command = json.loads(body or "{}").get("cmd", "").upper()
            response = CONSOLE_RESPONSES.get(command)
            if response is None:
                return self.send_json(200, {
                    "cmd-response": f"IEE305I {command} COMMAND INVALID",
                    "cmd-response-key": "",
                })
            return self.send_json(200, {"cmd-response": response, "cmd-response-key": ""})

        if path.startswith("/zosmf/restfiles/"):
            self.send_response(204)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return

        return self.send_json(404, {"reason": f"no mock route for {path}"})

    def do_DELETE(self):
        if not self.authorized():
            return

        job_match = re.fullmatch(r"/zosmf/restjobs/jobs/([^/]+)/([^/]+)", urlparse(self.path).path)
        if job_match:
            with JOBS_LOCK:
                JOBS.pop(job_match.group(2), None)
            return self.send_json(200, {"status": "0", "message": "Request was successful."})

        return self.send_json(404, {"reason": "no mock route"})

    @staticmethod
    def lookup(jobid):
        with JOBS_LOCK:
            return JOBS.get(jobid)

    @staticmethod
    def job_document(job):
        age = time.monotonic() - job["submitted"]
        if age < INPUT_SECONDS:
            status, retcode = "INPUT", None
        elif age < INPUT_SECONDS + ACTIVE_SECONDS:
            status, retcode = "ACTIVE", None
        else:
            status, retcode = "OUTPUT", "CC 0000"

        return {
            "jobname": job["jobname"],
            "jobid": job["jobid"],
            "owner": "IBMUSER",
            "type": "JOB",
            "class": "A",
            "status": status,
            "retcode": retcode,
            "subsystem": "JES2",
        }


def seed_jobs():
    """A few jobs already on the output queue, so read-only scripts have
    something to browse without a submission having run first."""
    with JOBS_LOCK:
        for name in ("CICSPROD", "DB2MSTR", "K6SEED"):
            jobid = next_job_id()
            JOBS[jobid] = {
                "jobname": name,
                "jobid": jobid,
                # Backdated so these report OUTPUT immediately.
                "submitted": time.monotonic() - 3600,
            }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=10443)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()

    seed_jobs()
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    server.verbose = args.verbose
    print(f"mock z/OSMF listening on http://{args.host}:{args.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()


if __name__ == "__main__":
    main()
