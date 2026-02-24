#!/usr/bin/env bash
set -euo pipefail

PROXY_URL="http://199.100.16.100:3128"
RATE=${RATE:-400}
DURATION=${DURATION:-30m}
SCRIPT=${SCRIPT:-script.js}

export K6_HTTP_PROXY="${K6_HTTP_PROXY:-$PROXY_URL}"
export K6_HTTPS_PROXY="${K6_HTTPS_PROXY:-$PROXY_URL}"
# Add internal hosts to NO_PROXY if needed
export NO_PROXY="${NO_PROXY:-localhost,127.0.0.1}"

k6 run --env RATE="$RATE" --env DURATION="$DURATION" "$SCRIPT"
