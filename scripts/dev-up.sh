#!/usr/bin/env sh
set -eu

PROJECT_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"

if [ -f "${PROJECT_ROOT}/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "${PROJECT_ROOT}/.env"
  set +a
fi

BACKEND_BIND_URL="${BACKEND_BIND_URL:-http://0.0.0.0:5172}"
EXPO_HOST="${EXPO_HOST:-lan}"
EXPO_PORT="${EXPO_PORT:-8081}"

BACKEND_PORT="$(echo "${BACKEND_BIND_URL}" | sed -E 's#^.*:([0-9]+)$#\1#')"
EXPO_PUBLIC_BACKEND_PORT="${EXPO_PUBLIC_BACKEND_PORT:-${BACKEND_PORT}}"
export EXPO_PUBLIC_BACKEND_PORT

# Force automatic frontend host detection unless explicit URL overrides are set.
if [ -z "${EXPO_PUBLIC_BACKEND_HTTP_URL:-}" ]; then
  unset EXPO_PUBLIC_BACKEND_HTTP_URL || true
fi
if [ -z "${EXPO_PUBLIC_BACKEND_WS_URL:-}" ]; then
  unset EXPO_PUBLIC_BACKEND_WS_URL || true
fi

if [ -n "${EXPO_PUBLIC_BACKEND_HTTP_URL:-}" ]; then
  BACKEND_HTTP_PUBLIC="${EXPO_PUBLIC_BACKEND_HTTP_URL}"
else
  BACKEND_HTTP_PUBLIC="${BACKEND_BIND_URL}"
fi

if [ -n "${EXPO_PUBLIC_BACKEND_WS_URL:-}" ]; then
  BACKEND_WS_PUBLIC="${EXPO_PUBLIC_BACKEND_WS_URL}"
else
  BACKEND_WS_PUBLIC="${BACKEND_HTTP_PUBLIC%/}"
  BACKEND_WS_PUBLIC="${BACKEND_WS_PUBLIC/http:\/\//ws://}"
  BACKEND_WS_PUBLIC="${BACKEND_WS_PUBLIC/https:\/\//wss://}/ws/terminal"
fi

echo ""
echo "=== oma-app dev up ==="
echo "Backend bind: ${BACKEND_BIND_URL}"
echo "Backend HTTP: ${BACKEND_HTTP_PUBLIC}"
echo "Backend WS:   ${BACKEND_WS_PUBLIC}"
echo "Expo host:    ${EXPO_HOST}"
echo "Expo port:    ${EXPO_PORT}"
echo "Expo Metro:   exp://<your-ip>:${EXPO_PORT}"
echo ""

echo "Starting backend and Expo..."

# Hard cleanup of stale processes from previous runs.
pkill -f "expo start" 2>/dev/null || true
pkill -f "node.*expo" 2>/dev/null || true
pkill -f Oma.App.Api 2>/dev/null || true

free_port_if_in_use() {
  PORT_TO_FREE="$1"
  LABEL="$2"

  if ! command -v ss >/dev/null 2>&1; then
    return 0
  fi

  OLD_PIDS="$(ss -ltnp 2>/dev/null | awk -v p=":${PORT_TO_FREE}" '$4 ~ p {print $0}' | sed -nE 's/.*pid=([0-9]+).*/\1/p' | sort -u)"
  if [ -n "${OLD_PIDS}" ]; then
    echo "Stopping process(es) already using ${LABEL} port ${PORT_TO_FREE}: ${OLD_PIDS}"
    for pid in ${OLD_PIDS}; do
      kill "${pid}" 2>/dev/null || true
    done
    sleep 1
  fi
}

free_port_if_in_use "${BACKEND_PORT}" "backend"
free_port_if_in_use "${EXPO_PORT}" "expo"

cleanup() {
  if [ -n "${BACKEND_PID:-}" ] && kill -0 "${BACKEND_PID}" 2>/dev/null; then
    kill "${BACKEND_PID}" 2>/dev/null || true
  fi

  if [ -n "${EXPO_PID:-}" ] && kill -0 "${EXPO_PID}" 2>/dev/null; then
    kill "${EXPO_PID}" 2>/dev/null || true
  fi
}

trap cleanup INT TERM EXIT

(
  cd "${PROJECT_ROOT}" && \
  dotnet run --project backend/src/Oma.App.Api/Oma.App.Api.csproj --urls "${BACKEND_BIND_URL}"
) 2>&1 | sed 's/^/[backend] /' &
BACKEND_PID=$!

(
  cd "${PROJECT_ROOT}/mobile" && \
  npx expo start --host "${EXPO_HOST}" --port "${EXPO_PORT}" --non-interactive
) 2>&1 | sed 's/^/[expo] /' &
EXPO_PID=$!

while :; do
  if ! kill -0 "${BACKEND_PID}" 2>/dev/null; then
    echo "[dev-up] backend process exited"
    exit 1
  fi

  if ! kill -0 "${EXPO_PID}" 2>/dev/null; then
    echo "[dev-up] expo process exited"
    exit 1
  fi

  sleep 1
done
