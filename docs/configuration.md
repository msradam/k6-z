---
layout: default
title: Configuration
description: Every environment variable the k6-z scripts read, with types and defaults.
---

# Configuration

<p class="lede">Every setting the scripts use comes from an environment variable. No script contains
a host name, user id, or password. Pass variables with <code>k6 run -e NAME=value</code>
or export them into the environment.</p>

## Connection

| Variable | Type | Default | Description |
| --- | --- | --- | --- |
| `ZOSMF_URL` | string | `https://zosmf.example.com` | Base URL of the z/OSMF server, including scheme and port |
| `ZOS_USER` | string | `IBMUSER` | User id for z/OSMF, SSH, and as the default for `ZOS_HLQ` |
| `ZOS_PASSWORD` | string | empty | Password. The z/OSMF scripts fail in `setup()` if unset |
| `ZOS_TLS_INSECURE` | boolean | `false` | Sets `insecureSkipTLSVerify`. Use only to confirm connectivity |
| `ZOSMF_CONSOLE` | string | `defcn` | Console name for `/zosmf/restconsoles/consoles/{name}` |

## z/OS resources

| Variable | Type | Default | Description |
| --- | --- | --- | --- |
| `ZOS_HLQ` | string | value of `ZOS_USER` | High-level qualifier for catalog searches |
| `ZOS_ACCOUNT` | string | `ACCT#` | Accounting field on the generated JOB card |
| `ZOS_JOB_CLASS` | string | `A` | `CLASS=` on the JOB card |
| `ZOS_MSG_CLASS` | string | `H` | `MSGCLASS=` on the JOB card |
| `ZOS_USS_DIR` | string | `/tmp` | z/OS UNIX directory the USS and ZOAU scripts work in |

## Load profile

These apply to the z/OSMF scripts. Each script uses the subset relevant to its
executor.

| Variable | Type | Default | Description |
| --- | --- | --- | --- |
| `ZOS_VUS` | integer | `5` | VU count for the scripts that use `constant-vus` or `ramping-vus` |
| `ZOS_DURATION` | duration | `1m` | Test duration |
| `ZOS_THINK_TIME` | seconds | `1` | Sleep at the end of each iteration in `datasets.js` and `uss.js`. Set to `0` for maximum rate |
| `ZOS_JOBS_PER_MINUTE` | integer | `6` | Arrival rate for `job-submit.js` |
| `ZOS_JOB_TIMEOUT` | seconds | `120` | How long to poll a job before giving up |

## Script-specific

| Variable | Used by | Default | Description |
| --- | --- | --- | --- |
| `ZOS_JOB_WITH_OUTPUT` | `job-submit.js` | `false` | Submit an `IEBGENER` job that produces spool output instead of `IEFBR14` |
| `ZOS_JOB_OWNER` | `job-query.js` | value of `ZOS_USER` | `owner=` filter on the job listing |
| `ZOS_JOB_PREFIX` | `job-query.js` | `*` | `prefix=` filter on the job listing |
| `ZOS_MAX_JOBS` | `job-query.js` | `50` | `max-jobs=` on the job listing |
| `ZOS_DSLEVEL` | `datasets.js`, `mixed-workload.js` | `<ZOS_HLQ>.**` | Catalog search pattern |
| `ZOS_ALLOW_WRITE` | `datasets.js`, `uss.js` | `false` | Enable the write step. Both scripts are read-only otherwise |
| `ZOS_WRITE_TARGET` | `datasets.js` | none | Data set to write to. Required when `ZOS_ALLOW_WRITE=true` |

## TN3270

| Variable | Type | Default | Description |
| --- | --- | --- | --- |
| `TN3270_HOST` | string | `localhost` | Terminal host |
| `TN3270_PORT` | integer | `2023` | Terminal port. SimBank uses 2023, a real system usually 23 or 992 |
| `TN3270_USER` | string | `IBMUSER` | User id typed into the logon screen |
| `TN3270_PASSWORD` | string | `SYS1` | Password typed into the logon screen |
| `TN3270_MODEL` | 2–5 | `2` | Terminal model. 2 is 24×80, 3 is 32×80, 4 is 43×80, 5 is 27×132 |
| `TN3270_CODEPAGE` | string | `cp037` | EBCDIC code page. `cp037` or `cp1047` |
| `TN3270_TLS` | boolean | `false` | Connect with TLS |
| `TN3270_TLS_INSECURE` | boolean | `false` | Skip certificate verification |
| `TN3270_TRACE` | boolean | `false` | Log the 3270 data stream. Passwords are masked |
| `TN3270_VUS` | integer | `10` | Peak VUs for `simbank-browse.js` |
| `TN3270_TPS` | integer | `2` | Arrival rate for `simbank-transfer.js` |
| `TN3270_DURATION` | duration | `2m` | Test duration |
| `TN3270_THINK_TIME` | seconds | varies | Sleep between iterations |

### CICS and TSO

| Variable | Used by | Default | Description |
| --- | --- | --- | --- |
| `CICS_TRAN` | `cics-transaction.js` | none | Transaction to run. Required |
| `CICS_EXPECT` | `cics-transaction.js` | none | String that appears on a successful response screen. Required |
| `CICS_SIGNON_TRAN` | `cics-transaction.js` | `CESN` | Signon transaction |
| `CICS_TPS` | `cics-transaction.js` | `5` | Peak arrival rate |
| `CICS_MAX_VUS` | `cics-transaction.js` | `50` | VU ceiling for the arrival-rate executor |
| `TSO_APPLID` | `tso-logon.js` | `TSO` | Applid used in `LOGON APPLID(...)` |
| `TSO_LOGONS_PER_MINUTE` | `tso-logon.js` | `6` | Logon arrival rate |
| `SIMBANK_ACCOUNT_A` | `simbank-transfer.js` | `123456789` | Source account |
| `SIMBANK_ACCOUNT_B` | `simbank-transfer.js` | `987654321` | Destination account |
| `SIMBANK_AMOUNT` | `simbank-transfer.js` | `10.00` | Transfer amount |

## SSH and ZOAU

| Variable | Type | Default | Description |
| --- | --- | --- | --- |
| `ZOS_SSH_HOST` | string | `zos.example.com` | SSH host |
| `ZOS_SSH_PORT` | integer | `22` | SSH port |
| `ZOS_SSH_KEY` | string | empty | Private key, as a path or inline PEM. Used instead of a password |
| `ZOS_SSH_PASSPHRASE` | string | empty | Passphrase for `ZOS_SSH_KEY` |
| `ZOAU_HOME` | string | `/usr/lpp/IBM/zoau` | ZOAU install path. Sets `PATH` and `LIBPATH` |
| `ZOAU_PYTHONPATH` | string | `/usr/lpp/IBM/zoau/lib` | Added to `PYTHONPATH` |

The SSH scripts authenticate with `ZOS_PASSWORD` or `ZOS_SSH_KEY`. `setup()` fails
if neither is set.

## Use a secret source instead

To keep the password out of the environment, use k6's secrets API. Write the
values to a file:

```
zos_user=IBMUSER
zos_password=your-password
```

Then run `auth-secrets.js`, which reads them with `secrets.get()`:

```bash
k6 run --secret-source=file=zos.secret scripts/zosmf/auth-secrets.js
```

See [k6 2.x features]({{ '/k6-features/' | relative_url }}) for the other secret
sources.

## Where the defaults come from

`scripts/lib/config.js` reads and validates the variables, applies the defaults in
the tables above, and exports them as `zosmf`, `zos`, `tn3270`, `ssh`, and `zoau`
objects. Scripts import from it rather than reading `__ENV` directly, apart from
the per-script variables in the tables above.
