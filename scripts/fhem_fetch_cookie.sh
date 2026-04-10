#!/usr/bin/env bash
set -euo pipefail

SERVICE_URL="${SERVICE_URL:-http://127.0.0.1:58080}"
AUTH_TOKEN="${AUTH_TOKEN:-}"
OUT_FILE="${OUT_FILE:-/opt/fhem/cache/alexa-cookie-external-cookie.txt}"

mkdir -p "$(dirname "$OUT_FILE")"

curl_args=(--fail --silent --show-error)
if [[ -n "$AUTH_TOKEN" ]]; then
  curl_args+=(-H "x-auth-token: $AUTH_TOKEN")
fi

curl "${curl_args[@]}" "$SERVICE_URL/api/cookie.txt" > "$OUT_FILE"
echo "Wrote cookie to $OUT_FILE"
