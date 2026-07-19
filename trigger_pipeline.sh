#!/usr/bin/env bash
# One-off manual pipeline trigger for a single entity.
#
# First create the brand in the UI (it needs your login), then grab its
# entity_id from the URL / entity selector and run:
#
#   KEY="your_internal_api_key" ./trigger_pipeline.sh <entity_id> "<brand_name>"
#
# Example:
#   KEY="abc123" ./trigger_pipeline.sh 30471277-a022-4e6d-9389-bbf287ccfbd8 "AprokoDoctor"
set -u

BASE="${BASE:-https://sentiwatch.onrender.com}"
EID="${1:-}"
NAME="${2:-}"

if [ -z "${KEY:-}" ]; then
  echo "ERROR: set KEY first, e.g.  KEY=\"...\" ./trigger_pipeline.sh <entity_id> \"<brand_name>\""
  exit 1
fi

if [ -z "$EID" ] || [ -z "$NAME" ]; then
  echo "ERROR: pass entity_id and brand_name as arguments."
  echo "Usage: KEY=\"...\" ./trigger_pipeline.sh <entity_id> \"<brand_name>\""
  exit 1
fi

# URL-encode the brand name so multi-word names work as query params.
urlencode() {
  local s="$1" i c out=""
  for (( i=0; i<${#s}; i++ )); do
    c="${s:$i:1}"
    case "$c" in
      [a-zA-Z0-9._~-]) out+="$c" ;;
      *) out+=$(printf '%%%02X' "'$c") ;;
    esac
  done
  printf '%s' "$out"
}
ENC_NAME=$(urlencode "$NAME")

echo "Entity: $EID  |  Brand: $NAME"
echo "Backend: $BASE"
echo ""

echo "=== 1. SYNC (scrape sources) ==="
curl -s -w "\n-> HTTP %{http_code}\n" -X POST \
  "$BASE/sync/$EID?brand_name=$ENC_NAME" \
  -H "X-Internal-Key: $KEY"

echo ""
echo "=== 2. ANALYZE (score sentiment) ==="
curl -s -w "\n-> HTTP %{http_code}\n" -X POST \
  "$BASE/analyze?entity_id=$EID&brand_name=$ENC_NAME" \
  -H "X-Internal-Key: $KEY"

echo ""
echo "=== 3. CALCULATE RISK ==="
curl -s -w "\n-> HTTP %{http_code}\n" -X POST \
  "$BASE/calculate-risk/$EID" \
  -H "X-Internal-Key: $KEY"

echo ""
echo "=== DONE ==="
