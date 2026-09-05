#!/usr/bin/env bash
# Isolated selftest: boots its own dev server on a private port with a throwaway
# data dir + build dir, so it can run while the real preview stays up and untouched.
set -uo pipefail
PORT="${PORT:-3123}"
DIST=".next-selftest-$PORT"
DATA="$(mktemp -d "${TMPDIR:-/tmp}/studio-selftest.XXXXXX")"
LOG="$DATA/next.log"
PID=""

cleanup() {
  # the server is its own process group (setsid), so one group-kill takes the whole tree —
  # killing the wrapper alone leaves next-server bound to the port and the next run races it
  [ -n "$PID" ] && kill -TERM -"$PID" 2>/dev/null
  sleep 1
  [ -n "$PID" ] && kill -KILL -"$PID" 2>/dev/null
  wait "$PID" 2>/dev/null
  rm -rf "$DIST" "$DATA"
}
trap cleanup EXIT INT TERM

# static guard first: a component that calls a prop it never destructured throws on click,
# which no HTTP assertion can see (the request never happens)
for guard in check-prop-contract check-client-imports; do
  # both catch failures that never reach the network: a bad destructure throws on click, and a
  # node import inside a client module breaks the bundle — no HTTP assertion can see either
  node "scripts/$guard.mjs" || { echo "  ✗ $guard failed — fix that before running the suite"; exit 1; }
done

echo "  booting throwaway server on :$PORT (data: $DATA)"
setsid env STUDIO_DIST_DIR="$DIST" DATA_DIR="$DATA" npx next dev -p "$PORT" -H 0.0.0.0 >"$LOG" 2>&1 &
PID=$!

for _ in $(seq 1 90); do
  code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/login" 2>/dev/null || true)
  [ "$code" = "200" ] && break
  kill -0 "$PID" 2>/dev/null || { echo "  server died:"; tail -20 "$LOG"; exit 1; }
  sleep 1
done

if [ "${code:-0}" != "200" ]; then echo "  server never became ready:"; tail -20 "$LOG"; exit 1; fi

node scripts/selftest.mjs "http://127.0.0.1:$PORT"
status=$?
echo
[ $status -eq 0 ] && echo "  ✓ selftest green against an isolated store (nothing of yours was touched)"
exit $status
