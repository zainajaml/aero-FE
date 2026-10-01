#!/usr/bin/env bash
# Production-mode smoke test: builds the app, migrates a throwaway database from zero, starts
# `node dist/server.js` with NODE_ENV=production and checks a few behaviours over real HTTP.
# Uses the dev compose services (postgres-test on 5435, RustFS on 9100, Mailpit on 1026/8026);
# services this script starts are stopped again, services that were already running are left up.
set -euo pipefail

cd "$(dirname "$0")/.."
COMPOSE=(docker compose -f docker-compose.dev.yml)
SERVICES=(postgres-test storage mailpit)
DB_NAME="azf_smoke_$(date +%s)_test"
APP_ORIGIN="http://localhost:5173"
EMAIL="smoke-$(date +%s)-$RANDOM@example.com"
PASSWORD="smoke-test-password-123"
WORK="$(mktemp -d)"
SERVER_PID=""
FAILURES=0

free_port() {
  for port in $(seq 4310 4399); do
    if ! (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null; then
      echo "$port"
      return
    fi
  done
  echo "no free port in 4310-4399" >&2
  exit 1
}

PORT="${SMOKE_PORT:-$(free_port)}"
BASE="http://127.0.0.1:$PORT"

mapfile -t ALREADY_RUNNING < <("${COMPOSE[@]}" ps --status running --services 2>/dev/null || true)
STARTED=()
for service in "${SERVICES[@]}"; do
  if ! printf '%s\n' "${ALREADY_RUNNING[@]}" | grep -qx "$service"; then STARTED+=("$service"); fi
done

cleanup() {
  local exit_code=$?
  set +e
  if ((exit_code)) && [[ -f "$WORK/server.log" ]]; then
    echo "--- server log"
    cat "$WORK/server.log"
  fi
  if [[ -n "$SERVER_PID" ]]; then
    kill -TERM "$SERVER_PID" 2>/dev/null
    wait "$SERVER_PID" 2>/dev/null
    echo "server stopped"
  fi
  "${COMPOSE[@]}" exec -T postgres-test dropdb -U azf --if-exists --force "$DB_NAME" >/dev/null 2>&1 &&
    echo "dropped database $DB_NAME"
  if ((${#STARTED[@]})); then
    "${COMPOSE[@]}" stop "${STARTED[@]}" >/dev/null 2>&1 && echo "stopped ${STARTED[*]}"
  fi
  rm -rf "$WORK"
}
trap cleanup EXIT

check() {
  local name="$1" expected="$2" actual="$3"
  if [[ "$actual" == "$expected" ]]; then
    printf 'PASS  %-58s %s\n' "$name" "$actual"
  else
    printf 'FAIL  %-58s expected %s, got %s\n' "$name" "$expected" "$actual"
    FAILURES=$((FAILURES + 1))
  fi
}

# status <name> <expected> <curl args...>: body goes to $WORK/body, headers to $WORK/headers.
status() {
  local name="$1" expected="$2"
  shift 2
  local code
  code="$(curl -sS -o "$WORK/body" -D "$WORK/headers" -w '%{http_code}' "$@")"
  check "$name" "$expected" "$code"
}

echo "== services: ${SERVICES[*]} (starting: ${STARTED[*]:-none})"
"${COMPOSE[@]}" up -d --wait "${SERVICES[@]}" >/dev/null
"${COMPOSE[@]}" exec -T postgres-test createdb -U azf "$DB_NAME"
echo "created database $DB_NAME on 127.0.0.1:5435"

export NODE_ENV=production
export PORT
export LOG_LEVEL=warn
export DATABASE_URL="postgres://azf:azf_test_password@127.0.0.1:5435/$DB_NAME"
export APP_URL="$APP_ORIGIN"
export API_URL="$BASE"
export AUTH_SECRET="smoke-only-$(openssl rand -hex 24)"
export SMTP_URL="smtp://127.0.0.1:1026"
export EMAIL_FROM="Space Scope <noreply@smoke.test>"
export S3_ENDPOINT="http://127.0.0.1:9100"
export S3_BUCKET="aero-zenith-flow-smoke"
export S3_ACCESS_KEY_ID="azf_storage"
export S3_SECRET_ACCESS_KEY="azf_storage_secret"
export S3_FORCE_PATH_STYLE=true

echo "== npm run build"
npm run build --silent
echo "== node dist/database/migrate.js"
node dist/database/migrate.js
echo "== node dist/server.js (NODE_ENV=production, port $PORT)"
node dist/server.js >"$WORK/server.log" 2>&1 &
SERVER_PID=$!
for _ in $(seq 1 50); do
  curl -s -o /dev/null "$BASE/health/live" && break
  sleep 0.2
done

echo "== checks"
status "GET /health/live" 200 "$BASE/health/live"
status "GET /health/ready (database reachable)" 200 "$BASE/health/ready"
status "GET /api/v1/me without a session" 401 "$BASE/api/v1/me"
check "  error envelope code" "UNAUTHENTICATED" "$(jq -r '.error.code' "$WORK/body")"
check "  error envelope requestId" "true" "$(jq -r '.meta.requestId | type == "string"' "$WORK/body")"
status "GET /api/docs (disabled in production)" 404 "$BASE/api/docs"
status "GET /api/openapi.json (disabled in production)" 404 "$BASE/api/openapi.json"
check "  helmet header" "nosniff" \
  "$(grep -i '^x-content-type-options:' "$WORK/headers" | cut -d' ' -f2 | tr -d '\r')"

status "POST /api/auth/sign-up/email" 200 -X POST "$BASE/api/auth/sign-up/email" \
  -H "Origin: $APP_ORIGIN" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\",\"name\":\"Smoke Test\"}"
SIGN_IN=(-X POST "$BASE/api/auth/sign-in/email" -H "Origin: $APP_ORIGIN"
  -H 'Content-Type: application/json' -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")
status "POST /api/auth/sign-in/email before verifying" 403 "${SIGN_IN[@]}"

VERIFY_URL=""
for _ in $(seq 1 25); do
  MESSAGE_ID="$(curl -s "http://127.0.0.1:8026/api/v1/search?query=to:$EMAIL" | jq -r '.messages[0].ID // empty')"
  if [[ -n "$MESSAGE_ID" ]]; then
    VERIFY_URL="$(curl -s "http://127.0.0.1:8026/api/v1/message/$MESSAGE_ID" |
      jq -r '.Text + .HTML' | tr -d '\r' | grep -oE "$BASE/api/auth/verify-email\?token=[^\"' <>)]+" | head -1 |
      sed 's/&amp;/\&/g')"
    break
  fi
  sleep 0.2
done
check "verification email delivered to Mailpit" "true" "$([[ -n "$VERIFY_URL" ]] && echo true || echo false)"
if [[ -n "$VERIFY_URL" ]]; then
  CODE="$(curl -s -o /dev/null -w '%{http_code}' "$VERIFY_URL" || true)"
  check "GET verification link (redirects to the app)" "302" "$CODE"
fi

status "POST /api/auth/sign-in/email after verifying" 200 "${SIGN_IN[@]}"
COOKIE="$(grep -i '^set-cookie:' "$WORK/headers" | grep -o '__Secure-azf.session_token=[^;]*' | head -1 || true)"
check "  session cookie is __Secure- prefixed" "true" "$([[ -n "$COOKIE" ]] && echo true || echo false)"
check "  session cookie is Secure; HttpOnly" "true" \
  "$(grep -i '^set-cookie: __Secure-azf.session_token' "$WORK/headers" | grep -qi 'secure' &&
    grep -i '^set-cookie: __Secure-azf.session_token' "$WORK/headers" | grep -qi 'httponly' && echo true || echo false)"
status "GET /api/v1/me with the session" 200 "$BASE/api/v1/me" -H "Cookie: $COOKIE"
check "  /me returns the signed-up email" "$EMAIL" "$(jq -r '.data.email // .data.profile.email // empty' "$WORK/body")"

echo
if ((FAILURES)); then
  echo "SMOKE FAILED: $FAILURES check(s) failed. Server log:"
  cat "$WORK/server.log"
  exit 1
fi
echo "SMOKE PASSED"
