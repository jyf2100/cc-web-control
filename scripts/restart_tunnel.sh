#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

TMUX_SESSION="${CC_WEB_TMUX_SESSION:-cc-web-control}"
HOST="${CC_WEB_HOST:-127.0.0.1}"
PORT="${CC_WEB_PORT:-7684}"
PROJECT_ROOTS="${CC_WEB_PROJECT_ROOTS:-/Volumes/work/workspace}"
PROXY_URL="${CC_WEB_PROXY_URL:-}"
CLAUDE_CONTINUE="${CC_WEB_CLAUDE_CONTINUE:-1}"
CLOUDFLARED_PROTOCOL="${CC_WEB_CLOUDFLARED_PROTOCOL:-http2}"
CLOUDFLARED_EDGE_IP_VERSION="${CC_WEB_CLOUDFLARED_EDGE_IP_VERSION:-4}"

ENV_FILE="${CC_WEB_ENV_FILE:-/tmp/${TMUX_SESSION}-env.sh}"
TUNNEL_LOG_FILE="${CC_WEB_TUNNEL_LOG_FILE:-/tmp/${TMUX_SESSION}-tunnel.log}"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing command: $1" >&2
    exit 1
  fi
}

single_quote() {
  # Escape a string so it can be safely wrapped in single quotes.
  # Example: foo'bar -> 'foo'"'"'bar'
  local s="${1-}"
  s="$(printf "%s" "$s" | sed "s/'/'\"'\"'/g")"
  printf "'%s'" "$s"
}

extract_trycloudflare_url() {
  local f="$1"
  [[ -f "$f" ]] || return 1
  grep -Eo 'https://[a-z0-9-]+\.trycloudflare\.com' "$f" | head -n 1
}

require_cmd tmux
require_cmd node
require_cmd cloudflared
require_cmd openssl
require_cmd tee

TOKEN="$(openssl rand -hex 16)"

# Store secrets in a temp file to avoid leaking in `ps` command line.
umask 077
cat >"$ENV_FILE" <<EOF
export CC_WEB_AUTH_TOKEN=$(single_quote "$TOKEN")
export CC_WEB_PROJECT_ROOTS=$(single_quote "$PROJECT_ROOTS")
export CC_WEB_HOST=$(single_quote "$HOST")
export CC_WEB_PORT=$(single_quote "$PORT")
export CC_WEB_CLAUDE_CONTINUE=$(single_quote "$CLAUDE_CONTINUE")
export CC_WEB_NO_OPEN=1
export CC_WEB_NO_ATTACH=1
EOF

rm -f "$TUNNEL_LOG_FILE"

if tmux has-session -t "$TMUX_SESSION" 2>/dev/null; then
  tmux kill-session -t "$TMUX_SESSION"
fi

server_inner="set -euo pipefail; source \"$ENV_FILE\"; cd \"$ROOT_DIR\"; node server.js --no-open --no-attach"
proxy_export=""
if [[ -n "$PROXY_URL" ]]; then
  proxy_export="HTTP_PROXY=\"$PROXY_URL\" HTTPS_PROXY=\"$PROXY_URL\" ALL_PROXY=\"$PROXY_URL\" NO_PROXY='127.0.0.1,localhost' "
fi
tunnel_inner="set -euo pipefail; rm -f \"$TUNNEL_LOG_FILE\"; ${proxy_export}cloudflared tunnel --no-autoupdate --protocol \"$CLOUDFLARED_PROTOCOL\" --edge-ip-version \"$CLOUDFLARED_EDGE_IP_VERSION\" --url http://$HOST:$PORT 2>&1 | tee -a \"$TUNNEL_LOG_FILE\""

tmux new-session -d -s "$TMUX_SESSION" -n server "bash -lc $(single_quote "$server_inner")"
tmux new-window -t "$TMUX_SESSION" -n tunnel "bash -lc $(single_quote "$tunnel_inner")"

deadline=$((SECONDS + 40))
URL=""
while [[ -z "$URL" && $SECONDS -lt $deadline ]]; do
  URL="$(extract_trycloudflare_url "$TUNNEL_LOG_FILE" || true)"
  [[ -n "$URL" ]] && break
  sleep 0.5
done

echo
echo "URL:   ${URL:-<pending, check tmux logs>}"
echo "TOKEN: $TOKEN"
echo
echo "Attach logs: tmux attach -t $TMUX_SESSION"
echo "Stop all:    tmux kill-session -t $TMUX_SESSION"
