#!/usr/bin/env sh
# Environment probe — answers docs/bugs/ENVIRONMENT.md in one shot.
# Agents run this instead of finding things out piecemeal.
# curl exit codes: 7 = nobody listening, 28 = up but busy/compiling.

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

check() {
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$2")
  rc=$?
  case $rc in
    0)  echo "$1: HTTP $code  ($2)" ;;
    7)  echo "$1: DOWN — nobody listening  ($2)" ;;
    28) echo "$1: UP but busy or still starting  ($2)" ;;
    *)  echo "$1: curl exit $rc  ($2)" ;;
  esac
}

check "n8n (xavi)   " "http://localhost:5679/healthz"
check "ollama native" "http://localhost:11434/api/tags"
check "gateway      " "http://127.0.0.1:8787/healthz"

# Can a container reach the host's Ollama? Bound to 127.0.0.1 it cannot, and
# the summarizing workflows fail with no clue why. Skipped when n8n is down.
printf 'ollama <- n8n : '
docker exec xavi-assistant-n8n-1 wget -qO- -T 3 \
  http://host.docker.internal:11434/api/tags >/dev/null 2>&1 &&
  echo "reachable" ||
  echo "UNREACHABLE — workflows cannot summarize (see OLLAMA_HOST in ENVIRONMENT.md)"

# Matches loosely: the unit adds flags between "cloudflared" and "tunnel run",
# and another cloudflared on this host serves an unrelated project's tunnel.
printf 'tunnel        : '
pgrep -f "cloudflared.*tunnel.*run xavi-assistant" >/dev/null &&
  echo "running (api.<domain> + n8n.<domain>)" ||
  echo "not running — only localhost answers"

printf 'ping webhook  : '
curl -s -X POST "http://localhost:5679/webhook/ping" \
  -H 'content-type: application/json' -d '{"text":"probe"}' --max-time 5 \
  || echo "FAILED"
echo

printf 'ollama models : '
curl -s --max-time 5 "http://localhost:11434/api/tags" |
  grep -o '"name":"[^"]*"' | cut -d'"' -f4 | paste -sd, - || echo "unknown"

echo "repo          : branch $(git -C "$ROOT" branch --show-current), $(git -C "$ROOT" status --porcelain | wc -l) file(s) modified"
