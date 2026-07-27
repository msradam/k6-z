# Galasa SimBank

SimBank is the sample 3270 application that ships with the [Galasa](https://galasa.dev)
test framework. It presents a logon screen, a menu, an account enquiry, and a funds
transfer over TN3270, and it runs in a JVM on a laptop with no mainframe involved.
That makes it the right target for proving a 3270 script works before anyone points
it at an LPAR.

The TN3270 sample scripts in this repository are written against it.

## Start it

SimBank is built from source. Galasa does not publish a public container image for
it, so the documented path is the one below.

```bash
git clone https://github.com/galasa-dev/simplatform.git
cd simplatform
./build-locally.sh
./run-locally.sh --server
```

The server listens on:

| Port | Protocol |
| --- | --- |
| 2023 | TN3270 terminal |
| 2080 | Web services |
| 2027 | Derby SQL |

Sign on with `IBMUSER` / `SYS1`.

## Run the scripts

```bash
k6 run -e TN3270_HOST=localhost -e TN3270_PORT=2023 scripts/tn3270/simbank-logon.js
k6 run -e TN3270_HOST=localhost -e TN3270_PORT=2023 scripts/tn3270/simbank-browse.js
```

Both need a k6 binary built with xk6-tn3270. See [install](https://msradam.github.io/k6-z/install/).

## Check it by hand

Any 3270 emulator will connect, which is worth doing once to see the screens the
scripts are matching against:

```bash
c3270 localhost:2023
x3270 localhost:2023
```

## Accounts

SimBank is seeded with these accounts, and the sample scripts use them:

| Account | Sort code |
| --- | --- |
| 123456789 | 11-01-45 |
| 987654321 | 11-01-45 |

## License

SimBank is published by the Galasa project under EPL-2.0. Nothing from it is
vendored here. The scripts in this repository only connect to it and read the
screens it sends.
