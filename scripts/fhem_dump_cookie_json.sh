#!/usr/bin/env bash
set -euo pipefail

SERVICE_URL="${SERVICE_URL:-http://127.0.0.1:8080}"
AUTH_TOKEN="${AUTH_TOKEN:-}"
OUT_FILE="${OUT_FILE:-/opt/fhem/cache/alexa-cookie-external-state.json}"

mkdir -p "$(dirname "$OUT_FILE")"

curl_args=(--fail --silent --show-error)
if [[ -n "$AUTH_TOKEN" ]]; then
  curl_args+=(-H "x-auth-token: $AUTH_TOKEN")
fi

curl "${curl_args[@]}" "$SERVICE_URL/api/state?raw=1" > "$OUT_FILE"
echo "Wrote state JSON to $OUT_FILE"
