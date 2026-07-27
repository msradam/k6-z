GOOS ?= $(shell go env GOOS)
GOARCH ?= $(shell go env GOARCH)
DIST ?= dist
MOCK_PORT ?= 10443

K6Z_VERSION := $(shell awk '/go\.k6\.io\/k6\/v2 v/ {print $$2}' bundles/k6z/go.mod)
K6Z3270_VERSION := $(shell awk '/go\.k6\.io\/k6 v/ {print $$2}' bundles/k6z-3270/go.mod)

.PHONY: help build k6z k6z-3270 s390x check test mock lint clean versions

help:
	@echo "build      build both bundles for $(GOOS)/$(GOARCH)"
	@echo "s390x      build both bundles for linux/s390x"
	@echo "check      compile every sample script with k6 archive"
	@echo "test       run the z/OSMF samples against the mock server"
	@echo "mock       run the mock z/OSMF server on port $(MOCK_PORT)"
	@echo "versions   show the k6 version each bundle pins"

versions:
	@echo "k6-z        k6 $(K6Z_VERSION)"
	@echo "k6-z-3270   k6 $(K6Z3270_VERSION)"

build: k6z k6z-3270

k6z:
	@mkdir -p $(DIST)
	cd bundles/k6z && CGO_ENABLED=0 GOOS=$(GOOS) GOARCH=$(GOARCH) \
		go build -trimpath -ldflags="-s -w" -o ../../$(DIST)/k6-z .

k6z-3270:
	@mkdir -p $(DIST)
	cd bundles/k6z-3270 && CGO_ENABLED=0 GOOS=$(GOOS) GOARCH=$(GOARCH) \
		go build -trimpath -ldflags="-s -w" -o ../../$(DIST)/k6-z-3270 .

s390x:
	$(MAKE) build GOOS=linux GOARCH=s390x DIST=$(DIST)/linux-s390x

# k6 archive compiles a script and resolves every import without running it, which
# catches a bad import or a syntax error without needing a mainframe.
check: build
	@set -e; \
	for f in scripts/zosmf/*.js; do \
		$(DIST)/k6-z archive --quiet -O /dev/null $$f >/dev/null && echo "ok   $$f"; \
	done; \
	for f in scripts/tn3270/*.js scripts/ssh/*.js scripts/exec/*.js; do \
		$(DIST)/k6-z-3270 archive --quiet -O /dev/null $$f >/dev/null && echo "ok   $$f"; \
	done

test: build
	@python3 tools/mock-zosmf.py --port $(MOCK_PORT) & \
	MOCK=$$!; \
	sleep 2; \
	set -e; \
	for s in info job-submit datasets uss console job-query; do \
		ZOSMF_URL=http://127.0.0.1:$(MOCK_PORT) ZOS_USER=IBMUSER ZOS_PASSWORD=mock \
		ZOS_HLQ=IBMUSER ZOS_ACCOUNT='ACCT#' \
		$(DIST)/k6-z run --quiet --summary-mode=compact \
			-e ZOS_DURATION=8s -e ZOS_JOBS_PER_MINUTE=30 -e ZOS_VUS=2 \
			-e ZOS_THINK_TIME=0 scripts/zosmf/$$s.js || { kill $$MOCK; exit 1; }; \
	done; \
	kill $$MOCK

mock:
	python3 tools/mock-zosmf.py --port $(MOCK_PORT) --verbose

lint:
	cd bundles/k6z && go vet ./...
	cd bundles/k6z-3270 && go vet ./...
	python3 -m py_compile tools/mock-zosmf.py

clean:
	rm -rf $(DIST)
