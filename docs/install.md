---
layout: default
title: Install
description: Getting a k6 binary that can talk to z/OS, whether you run it off-platform, on Linux on Z, or on z/OS UNIX itself.
---

# Install

<p class="lede">The binary you need depends on where the load generator runs and which z/OS
interfaces you want to drive. This page covers the release archives, building your
own, and running k6 on z/OS UNIX.</p>

## Choose a binary

| You need | Use |
| --- | --- |
| z/OSMF REST only | Upstream k6, any platform |
| z/OSMF plus ZOAU over SSH | `k6-z` from [releases](https://github.com/msradam/k6-z/releases) |
| TN3270 | `k6-z-3270` from releases |
| k6 running on z/OS UNIX | `zopen install k6` |

Two release archives exist because they cannot be one binary. k6 2.0 moved its Go
module path to `go.k6.io/k6/v2`. xk6-ssh has followed; xk6-tn3270 and xk6-exec have
not yet. A single binary can link one or the other, not both, so `k6-z` tracks
current k6 and `k6-z-3270` stays on k6 1.x until the extensions move. See
[builds]({{ '/builds/' | relative_url }}).

## Install off-platform

The common arrangement is k6 on x86 or ARM, driving the mainframe over the network.
That is the right default. It keeps load off the system under test, it lets you run
many generators, and it puts the results next to your other results.

```bash
curl -LO https://github.com/msradam/k6-z/releases/latest/download/k6-z-v1.0.0-linux-amd64.tar.gz
tar xzf k6-z-v1.0.0-linux-amd64.tar.gz
./k6-z-v1.0.0-linux-amd64/k6 version
```

Substitute `darwin-arm64` or `linux-arm64` as needed. `k6 version` prints the
extensions compiled in.

If you only need z/OSMF, plain upstream k6 works and you should prefer it:

```bash
brew install k6
# or see https://grafana.com/docs/k6/latest/set-up/install-k6/
```

## Install on Linux on Z or zCX

Upstream k6 publishes no `s390x` binary. This repository does.

```bash
curl -LO https://github.com/msradam/k6-z/releases/latest/download/k6-z-v1.0.0-linux-s390x.tar.gz
tar xzf k6-z-v1.0.0-linux-s390x.tar.gz
./k6-z-v1.0.0-linux-s390x/k6 version
```

The same archive works on a Linux on Z guest under z/VM, on a native LPAR, and
inside [z/OS Container Extensions](https://www.ibm.com/products/zcx), which runs
Linux `s390x` containers on z/OS. zCX puts the load generator on the same box as
the system under test without putting it in z/OS UNIX, which removes network
latency from the measurement.

## Install on z/OS UNIX

k6 runs natively on z/OS. The port is maintained by the
[z/OS Open Tools](https://zopen.community) community:

```bash
zopen install k6
```

That package is upstream k6 with no extensions, and it currently tracks k6 1.5.0
rather than 2.x. It covers z/OSMF over HTTPS, including against `localhost`, which
is the most useful thing to do from the host. It does not include xk6-tn3270,
xk6-ssh, or xk6-exec.

Tag your scripts as UTF-8 before running them, or the reader will treat them as
EBCDIC:

```bash
chtag -tc 1208 test.js
k6 run test.js
```

### Building on z/OS with extensions

To get [`scripts/exec/zoau-local.js`]({{ '/zoau/' | relative_url }}) working, which
runs ZOAU commands directly with no SSH hop, you need a z/OS build that includes
xk6-exec. That means building on the host:

1. Install [IBM Open Enterprise SDK for Go](https://www.ibm.com/products/open-enterprise-sdk-go-zos), which provides `GOOS=zos GOARCH=s390x`.
2. Apply the `afero` patches from [zopencommunity/k6port](https://github.com/zopencommunity/k6port/tree/main/patches). One of k6's dependencies needs build tags for z/OS that are not upstream yet.
3. Build from `bundles/k6z-3270` with the environment the zopen port uses.

```bash
export CGO_ENABLED=0 GOOS=zos GOARCH=s390x GOTOOLCHAIN=local
find . -name '*.go' -exec chtag -tc 1208 {} \;
cd bundles/k6z-3270 && go build -o k6 .
```

This path is more involved than the others and there is no prebuilt archive for it.
For most tests, running off-platform or in zCX is both easier and a better
measurement.

## Build your own binary

The two release bundles are ordinary Go modules under `bundles/`. Each is a
`main.go` that imports k6's command package and blank-imports the extensions, plus
a `go.mod` and `go.sum` that pin every version and checksum.

```bash
make build                          # both bundles, host platform
make build GOOS=linux GOARCH=s390x  # cross-compile
make versions                       # which k6 version each bundle pins
```

Adding an extension means adding an import and a require:

```bash
cd bundles/k6z
go mod edit -require=github.com/grafana/xk6-sql@v1.0.4
# add `_ "github.com/grafana/xk6-sql"` to main.go
go mod tidy && go build -o ../../dist/k6-z .
```

The usual `xk6 build` route works too, but not for s390x: `xk6` validates the
target against an allow-list in `k6foundry` that has no `s390x` entry. Plain
`go build` has no such restriction, which is why the bundles are ordinary modules.

<div class="callout">
<p>The released binaries are builds of Grafana k6 and are distributed under
AGPL-3.0, not under this repository's Apache-2.0 license. The pinned module files
under <code>bundles/</code> make every release reproducible from public sources.
See <a href="https://github.com/msradam/k6-z/blob/main/NOTICE">NOTICE</a>.</p>
</div>

## Verify a download

Every release ships `checksums.txt` and a build provenance attestation.

```bash
sha256sum -c checksums.txt --ignore-missing
gh attestation verify k6 --repo msradam/k6-z
```

## Supply credentials

No script in this repository contains a password. Credentials come from the
environment:

| Variable | Used by |
| --- | --- |
| `ZOSMF_URL` | z/OSMF scripts |
| `ZOS_USER`, `ZOS_PASSWORD` | all scripts |
| `TN3270_HOST`, `TN3270_PORT` | TN3270 scripts |
| `ZOS_SSH_HOST`, `ZOS_SSH_KEY` | SSH scripts |

On a shared build agent, environment variables are visible in process listings and
leak into logs whenever a step dumps its environment. k6 1.3 added a secrets API
for exactly this, and `scripts/zosmf/auth-secrets.js` shows it:

```bash
k6 run --secret-source=file=zos.secret scripts/zosmf/auth-secrets.js
```

See [k6 2.x features]({{ '/k6-features/' | relative_url }}).
