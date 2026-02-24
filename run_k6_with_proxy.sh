#!/usr/bin/env bash
set -euo pipefail

PROXY_URL="http://199.100.16.100:3128"
RATE=${RATE:-400}
DURATION=${DURATION:-30m}
SCRIPT=${SCRIPT:-script.js}
METRICS_FILE="/tmp/k6_metrics_$$.jsonl"

export K6_HTTP_PROXY="${K6_HTTP_PROXY:-$PROXY_URL}"
export K6_HTTPS_PROXY="${K6_HTTPS_PROXY:-$PROXY_URL}"
export NO_PROXY="${NO_PROXY:-localhost,127.0.0.1}"

# Silence per-iteration logs; the stats pane handles live display.
export LOG_EVERY=0

cleanup() { rm -f "$METRICS_FILE"; }
trap cleanup EXIT

# AWK script: reads k6 JSON stream and keeps a rolling latency display.
read -r -d '' AWK_STATS << 'AWKEOF'
/http_req_duration/ && /"type":"Point"/ {
  if (match($0, /"value":[0-9]+\.?[0-9]*/)) {
    val = substr($0, RSTART+8, RLENGTH-8) + 0
    count++; sum += val; avg = sum / count
    if (val < min || count == 1) min = val
    if (val > max) max = val
    printf "\033[2J\033[H"
    printf "  +---------------------------------+\n"
    printf "  |      k6  Live  Latency          |\n"
    printf "  +---------------------------------+\n"
    printf "  |  Requests : %-8d           |\n", count
    printf "  |  Avg      : %-8.1f ms         |\n", avg
    printf "  |  Min      : %-8.1f ms         |\n", min
    printf "  |  Max      : %-8.1f ms         |\n", max
    printf "  |  Last     : %-8.1f ms         |\n", val
    printf "  +---------------------------------+\n"
    fflush()
  }
}
AWKEOF

K6_CMD="k6 run --out json=\"$METRICS_FILE\" --env RATE=\"$RATE\" --env DURATION=\"$DURATION\" \"$SCRIPT\""
STATS_CMD="touch \"$METRICS_FILE\"; tail -f \"$METRICS_FILE\" | awk '$AWK_STATS'"

if command -v tmux &>/dev/null; then
  SESSION="k6_$$"
  tmux new-session -d -s "$SESSION" -x 220 -y 50
  # Bottom 35% pane: live stats
  tmux split-window -v -p 35 -t "$SESSION"
  tmux send-keys -t "$SESSION:0.1" "eval $STATS_CMD" Enter
  # Top pane: k6
  tmux send-keys -t "$SESSION:0.0" "eval $K6_CMD; echo '--- k6 done ---'" Enter
  tmux attach-session -t "$SESSION"
else
  echo "tmux not found; falling back to plain k6 run"
  eval "$K6_CMD"
fi
