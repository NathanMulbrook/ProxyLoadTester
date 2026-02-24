#!/usr/bin/env bash

PROXY_URL="http://199.100.16.100:3128"
RATE="${RATE:-400}"
DURATION="${DURATION:-30m}"
SCRIPT="${SCRIPT:-$(cd "$(dirname "$0")" && pwd)/script.js}"
METRICS_FILE="/tmp/k6_metrics_$$.jsonl"
AWK_FILE="/tmp/k6_stats_$$.awk"

export K6_HTTP_PROXY="${K6_HTTP_PROXY:-$PROXY_URL}"
export K6_HTTPS_PROXY="${K6_HTTPS_PROXY:-$PROXY_URL}"
export NO_PROXY="${NO_PROXY:-localhost,127.0.0.1}"
export LOG_EVERY=0

# Write awk stats script to a file to avoid quoting/heredoc issues in tmux.
cat > "$AWK_FILE" << 'AWKEOF'
/http_req_duration/ && /"type":"Point"/ {
  if (match($0, /"value":[0-9]+\.?[0-9]*/)) {
    val = substr($0, RSTART+8, RLENGTH-8) + 0
    total++
    # Exclude 0ms (errors/no-response) and near-timeout values (>=59000ms)
    if (val <= 0 || val >= 59000) { skipped++; next }
    count++; sum += val; avg = sum / count
    if (count == 1 || val < min) min = val
    if (val > max) max = val
    printf "\033[H\033[J"
    printf "  +------------------------------------+\n"
    printf "  |      k6  Live  Latency             |\n"
    printf "  +------------------------------------+\n"
    printf "  |  Counted  : %-8d              |\n", count
    printf "  |  Excluded : %-8d (0ms/timeout) |\n", skipped
    printf "  |                                    |\n"
    printf "  |  Avg      : %-8.1f ms            |\n", avg
    printf "  |  Min      : %-8.1f ms            |\n", min
    printf "  |  Max      : %-8.1f ms            |\n", max
    printf "  |  Last     : %-8.1f ms            |\n", val
    printf "  +------------------------------------+\n"
    fflush()
  }
}
AWKEOF

touch "$METRICS_FILE"

cleanup() {
  rm -f "$METRICS_FILE" "$AWK_FILE"
}
trap cleanup EXIT

if ! command -v tmux &>/dev/null; then
  echo "tmux not found. Install with: sudo apt install -y tmux"
  exit 1
fi

SESSION="k6run_$$"
tmux new-session -d -s "$SESSION" -x 220 -y 50

# Bottom pane (35%): live latency stats
tmux split-window -v -p 35 -t "$SESSION:0"
tmux send-keys -t "$SESSION:0.1" \
  "tail -f '$METRICS_FILE' | awk -f '$AWK_FILE'" Enter

# Top pane: k6
tmux send-keys -t "$SESSION:0.0" \
  "k6 run --out json='$METRICS_FILE' --env RATE='$RATE' --env DURATION='$DURATION' '$SCRIPT'; echo; echo '=== k6 finished - press any key to exit ==='; read -r _" Enter

# Give panes time to start before attaching
sleep 0.3
tmux attach-session -t "$SESSION"
