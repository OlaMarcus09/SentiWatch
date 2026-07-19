#!/usr/bin/env bash
# One-off manual pipeline trigger for a single entity.
# Usage: KEY="your_internal_api_key" ./trigger_pipeline.sh
set -u

BASE="https://sentiwatch.onrender.com"
EID="30471277-a022-4e6d-9389-bbf287ccfbd8"
NAME="AprokoDoctor"

if [ -z "${KEY:-}" ]; then
  echo "ERROR: set KEY first, e.g.  KEY=\"...\" ./trigger_pipeline.sh"
  exit 1
fi

echo "=== 1. SYNC (scrape sources) ==="
curl -s -w "\n-> HTTP %{http_code}\n" -X POST \
  "$BASE/sync/$EID?brand_name=$NAME" \
  -H "X-Internal-Key: $KEY"

echo ""
echo "=== 2. ANALYZE (score sentiment) ==="
curl -s -w "\n-> HTTP %{http_code}\n" -X POST \
  "$BASE/analyze?entity_id=$EID&brand_name=$NAME" \
  -H "X-Internal-Key: $KEY"

echo ""
echo "=== 3. CALCULATE RISK ==="
curl -s -w "\n-> HTTP %{http_code}\n" -X POST \
  "$BASE/calculate-risk/$EID" \
  -H "X-Internal-Key: $KEY"

echo ""
echo "=== DONE ==="
