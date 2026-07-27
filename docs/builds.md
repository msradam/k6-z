---
layout: default
title: Builds and s390x
description: How the s390x binaries are built, why xk6 cannot build them, and what the z/OS story is.
---

# Builds and s390x

<p class="lede">Upstream k6 publishes binaries for linux amd64 and arm64, macOS, and Windows. It
publishes nothing for s390x. This repository fills that gap, and the way it does so
is worth explaining because the obvious route does not work.</p>

## What gets published

Every release builds two bundles for four platforms.

| Archive | k6 | Extensions |
| --- | --- | --- |
| `k6-z` | 2.1.0 | xk6-ssh |
| `k6-z-3270` | 1.6.1 | xk6-tn3270, xk6-ssh, xk6-exec |

Platforms: `linux/s390x`, `linux/amd64`, `linux/arm64`, `darwin/arm64`.

`linux/s390x` covers Linux on Z under z/VM, a native Linux LPAR, and
[z/OS Container Extensions](https://www.ibm.com/products/zcx). It does not cover
z/OS UNIX, which is a different operating system target entirely. See
[z/OS](#z-os) below.

## Why there are two bundles

k6 2.0 changed its Go module path to `go.k6.io/k6/v2`. Extensions that still import
`go.k6.io/k6` cannot be linked into a 2.x binary, because those are two different
modules as far as Go is concerned.

Current state of the extensions used here:

| Extension | Imports | k6 2.x ready |
| --- | --- | --- |
| xk6-ssh v0.2.2 | `go.k6.io/k6/v2` | Yes |
| xk6-tn3270 v0.1.0 | `go.k6.io/k6` | No |
| xk6-exec v0.5.1 | `go.k6.io/k6` | No |

So one binary tracks current k6 and one stays on 1.6.1 to keep TN3270. The
migration for the two remaining extensions is mechanical, a find and replace of
`go.k6.io/k6/` to `go.k6.io/k6/v2/`, plus dropping any reliance on easyjson-
generated methods, which 2.0 removed in favour of `encoding/json`. When that lands,
the two archives become one.

## Why not xk6

The documented way to build a custom k6 is `xk6 build`. It refuses:

```console
$ GOOS=linux GOARCH=s390x xk6 build v2.1.0 --with github.com/grafana/xk6-ssh
ERR invalid platform: linux/s390x
```

xk6 validates the target against an allow-list in
[k6foundry](https://github.com/grafana/k6foundry), and that list has six entries:
linux amd64 and arm64, windows amd64 and arm64, darwin amd64 and arm64. No s390x,
and no `zos` either.

The restriction is in the builder, not in k6 or in Go. Go itself cross-compiles to
`linux/s390x` without complaint, and k6 is pure Go with cgo disabled.

## What this repository does instead

xk6 generates a small main package that imports k6's command package and
blank-imports each extension, then builds it. That generated package is about
fifteen lines, so it is committed here rather than generated:

```go
package main

import (
	"go.k6.io/k6/v2/cmd"

	_ "github.com/grafana/xk6-ssh"
)

func main() { cmd.Execute() }
```

Alongside it, a `go.mod` and a committed `go.sum` that pin k6, every extension, and
every transitive dependency by version and checksum. Building is then plain Go with
no allow-list in the way:

```bash
cd bundles/k6z
CGO_ENABLED=0 GOOS=linux GOARCH=s390x go build -trimpath -ldflags="-s -w" -o k6 .
```

Or through the Makefile:

```bash
make build GOOS=linux GOARCH=s390x
make s390x
make versions
```

The result is a static big-endian ELF:

```console
$ file dist/k6-z
dist/k6-z: ELF 64-bit MSB executable, IBM S/390, version 1 (SYSV),
statically linked, stripped
```

Committing `go.sum` is the part that matters. It is what makes a release
reproducible from public sources, which is also how the AGPL obligation on the
binaries is met.

## Adding an extension

```bash
cd bundles/k6z
go mod edit -require=github.com/grafana/xk6-sql@v1.0.4
# add `_ "github.com/grafana/xk6-sql"` to main.go
go mod tidy
go build -o ../../dist/k6-z .
```

If `go mod tidy` pulls in a conflicting k6 major version, the extension is not
compatible with that bundle and belongs in the other one.

## Verifying a release

Each archive is checksummed, and each binary carries a GitHub build provenance
attestation:

```bash
sha256sum -c checksums.txt --ignore-missing
gh attestation verify k6 --repo msradam/k6-z
```

The attestation ties the binary to the workflow run and the commit that produced
it. Worth checking before you copy something onto a mainframe.

## z/OS {#z-os}

z/OS is not Linux, and `linux/s390x` binaries do not run on it. Go targets it as
`GOOS=zos GOARCH=s390x`, which needs
[IBM Open Enterprise SDK for Go](https://www.ibm.com/products/open-enterprise-sdk-go-zos).

The supported way to get k6 on z/OS UNIX is the z/OS Open Tools port:

```bash
zopen install k6
```

That is vanilla k6, currently tracking 1.5.0, with no extensions. It covers z/OSMF
over HTTPS, including against `localhost`, which is the most useful thing to do
from the host.

Building on z/OS with extensions is possible but not packaged here. One of k6's
dependencies, `afero`, needs build tags for z/OS that are not upstream; the zopen
port [carries the patches](https://github.com/zopencommunity/k6port/tree/main/patches).
An upstream attempt to add those tags was
[not merged](https://github.com/grafana/k6/pull/5548). The build environment the
port uses is:

```bash
export CGO_ENABLED=0 GOOS=zos GOARCH=s390x GOTOOLCHAIN=local
find . -name '*.go'   -exec chtag -tc 1208 {} \;
find . -name 'go.mod' -exec chtag -tc 1208 {} \;
find . -name 'go.sum' -exec chtag -tc 1208 {} \;
```

The tagging matters: z/OS UNIX tracks file encoding, and untagged Go source is read
as EBCDIC. The same applies to your test scripts.

For most tests, running off-platform or in zCX is both simpler and a better
measurement, because it keeps the load generator's own CPU consumption out of the
system under test.

## Release process

Tag and push. The workflow builds eight archives, attests each binary, and creates
the release.

```bash
git tag v1.0.0
git push origin v1.0.0
```

CI on every pull request compiles both bundles, cross-compiles for s390x, amd64,
and arm64, runs `k6 archive` over every sample script, and runs the z/OSMF samples
against the mock server. A script that does not compile, or an s390x build that
breaks, fails before it reaches a release.
