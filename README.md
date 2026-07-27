# k6-z

Load testing IBM z/OS with [Grafana k6](https://k6.io). Sample scripts for the
interfaces a z/OS system actually exposes, and prebuilt binaries for `s390x`, which
upstream k6 does not publish.

**Documentation: [msradam.github.io/k6-z](https://msradam.github.io/k6-z/)**

## Try it without a mainframe

The repository ships a stand-in z/OSMF server, so the scripts can be run and
reviewed by someone with no mainframe access.

```bash
git clone https://github.com/msradam/k6-z.git
cd k6-z
make build

python3 tools/mock-zosmf.py &

ZOSMF_URL=http://127.0.0.1:10443 ZOS_USER=IBMUSER ZOS_PASSWORD=mock \
  ./dist/k6-z run scripts/zosmf/job-submit.js
```

That submits JCL, polls the job to completion, reads its spool, and purges it, with
thresholds on turnaround time. Against a real system the only thing that changes is
`ZOSMF_URL`.

## Against a real system

Start with the smoke test:

```bash
./dist/k6-z run \
  -e ZOSMF_URL=https://zosmf.example.com \
  -e ZOS_USER=IBMUSER -e ZOS_PASSWORD="$ZOS_PASSWORD" \
  scripts/zosmf/info.js
```

## What is here

| Surface | Scripts | Extension needed |
| --- | --- | --- |
| [z/OSMF REST](https://msradam.github.io/k6-z/zosmf/) | `scripts/zosmf/` | None, k6 core |
| [TN3270](https://msradam.github.io/k6-z/tn3270/) | `scripts/tn3270/` | xk6-tn3270 |
| [ZOAU over SSH](https://msradam.github.io/k6-z/zoau/) | `scripts/ssh/` | xk6-ssh |
| [ZOAU natively](https://msradam.github.io/k6-z/zoau/) | `scripts/exec/` | xk6-exec |

```
scripts/       samples, grouped by interface
bundles/       two Go modules that build the release binaries
tools/         mock z/OSMF server, stdlib Python
environments/  how to run Galasa SimBank locally for the TN3270 scripts
docs/          the documentation site
```

## Install

Download from [releases](https://github.com/msradam/k6-z/releases), or build:

```bash
make build                          # both bundles, host platform
make build GOOS=linux GOARCH=s390x  # cross-compile
make check                          # compile every sample script
make test                           # run the z/OSMF samples against the mock
```

Two archives are published because k6 2.0 changed its Go module path and not every
extension has followed. `k6-z` tracks current k6 with xk6-ssh; `k6-z-3270` stays on
k6 1.x to keep TN3270. Platforms: `linux/s390x`, `linux/amd64`, `linux/arm64`,
`darwin/arm64`.

For k6 on z/OS UNIX itself, use the z/OS Open Tools port:

```bash
zopen install k6
```

See [install](https://msradam.github.io/k6-z/install/) for the details, including
building on z/OS with extensions.

## Scope

The z/OSMF endpoints are the documented REST services. The ZOAU commands are
display and read commands drawn from IBM's
[zoau-samples](https://github.com/IBM/zoau-samples). The TN3270 scripts target
[Galasa SimBank](https://galasa.dev), which runs on a laptop, so you can get one
working before going near an LPAR.

The scripts are starting points, not a benchmark suite. Nothing here produces a
number you should compare against another shop's number. Every host name, user id,
and qualifier comes from the environment, so the scripts describe a shape of test
rather than a particular system.

## License

Repository content is Apache-2.0.

The binaries on the releases page are builds of Grafana k6 and are distributed
under AGPL-3.0. The pinned module files under `bundles/` make every release
reproducible from public sources. See [NOTICE](NOTICE).
