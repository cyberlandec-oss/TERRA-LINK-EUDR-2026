#!/usr/bin/env bash
set -u

repo_root=${1:-/repo}
log_dir=${2:-$repo_root/validation-offline-polygon}
test_target=${3:-tests/offline-polygon.spec.ts}
mkdir -p "$log_dir"

e2e_db="${DATABASE_URL%/*}/terra_link_e2e"
# Docker Desktop: desde el contenedor QA, localhost es el propio contenedor. Las dependencias
# permanecen en el host/Compose operativo y se acceden por el alias estable de Docker Desktop.
e2e_db="${e2e_db/localhost/host.docker.internal}"
api_log="$log_dir/api.log"
web_log="$log_dir/web.log"
result="$log_dir/result.txt"

DATABASE_URL="$e2e_db" API_PORT=4100 WEB_ORIGIN=http://localhost:3100 \
  REDIS_URL=redis://host.docker.internal:6379 REDIS_KEY_PREFIX=tl-e2e-prestarted \
  S3_ENDPOINT=http://host.docker.internal:9000 SCANNER_HOST=host.docker.internal \
  S3_BUCKET="${TL_QA_S3_BUCKET:-terra-link-e2e}" SSO_ENABLED=false \
  JWT_SECRET=offline-polygon-qa-jwt-secret-0123456789-abcdefghijklmnopqrstuvwxyz \
  PII_KEYS=k1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA \
  PII_ACTIVE_KEY_ID=k1 PII_INDEX_KEY=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA \
  node "$repo_root/apps/api/dist/main.js" >"$api_log" 2>&1 &
api_pid=$!
printf 'API_PID=%s\nAPI_ENTRY=%s\n' "$api_pid" "$repo_root/apps/api/dist/main.js" | tee "$log_dir/api-process.txt"
if [ ! -f "$repo_root/apps/api/dist/main.js" ]; then
  echo 'API_ENTRY_MISSING' | tee -a "$log_dir/api-process.txt"
  exit 1
fi
sleep 1
if ! kill -0 "$api_pid" 2>/dev/null; then
  wait "$api_pid"; api_code=$?
  echo "API_EXIT_CODE=$api_code" | tee -a "$log_dir/api-process.txt"
  exit "$api_code"
fi
npx next start "$repo_root/apps/web" -p 3100 >"$web_log" 2>&1 &
web_pid=$!
printf 'WEB_PID=%s\n' "$web_pid" | tee "$log_dir/web-process.txt"

cleanup() {
  kill "$api_pid" "$web_pid" 2>/dev/null || true
}
trap cleanup EXIT

ready=1
for _ in $(seq 1 90); do
  if curl -fsS http://127.0.0.1:4100/health/live >/dev/null 2>&1 && curl -fsS http://127.0.0.1:3100/ >/dev/null 2>&1; then
    ready=0
    break
  fi
  sleep 2
done
if [ "$ready" -ne 0 ]; then
  if ! kill -0 "$api_pid" 2>/dev/null; then wait "$api_pid"; echo "API_EXIT_CODE=$?" | tee -a "$log_dir/api-process.txt"; fi
  if ! kill -0 "$web_pid" 2>/dev/null; then wait "$web_pid"; echo "WEB_EXIT_CODE=$?" | tee -a "$log_dir/web-process.txt"; fi
  echo "QA_SERVICES_NOT_READY" | tee "$result"
  exit 1
fi

set +e
E2E_REUSE_SERVER=true npm run test -w e2e -- $test_target 2>&1 | tee "$result"
code=${PIPESTATUS[0]}
set -e
echo "E2E_EXIT_CODE=$code" | tee -a "$result"
exit "$code"
