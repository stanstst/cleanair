#!/usr/bin/env bash
set -euo pipefail

FETCHER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

docker run --rm --network none \
  -v "$FETCHER_DIR/package.json:/fetcher/package.json:ro" \
  -v "$FETCHER_DIR/src:/fetcher/src:ro" \
  -v "$FETCHER_DIR/test:/fetcher/test:ro" \
  cleanair-fetcher node --disable-warning=ExperimentalWarning --test 'test/feature/**/*.test.js' "$@"
