#!/usr/bin/env bash
set -euo pipefail

API_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

docker run --rm --network none \
  -v "$API_DIR/package.json:/api/package.json:ro" \
  -v "$API_DIR/src:/api/src:ro" \
  -v "$API_DIR/public:/api/public:ro" \
  -v "$API_DIR/test:/api/test:ro" \
  cleanair-api node --disable-warning=ExperimentalWarning --test 'test/feature/**/*.test.js' "$@"
