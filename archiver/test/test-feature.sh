#!/usr/bin/env bash
set -euo pipefail

ARCHIVER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

docker run --rm --network none \
  -v "$ARCHIVER_DIR/package.json:/archiver/package.json:ro" \
  -v "$ARCHIVER_DIR/src:/archiver/src:ro" \
  -v "$ARCHIVER_DIR/test:/archiver/test:ro" \
  cleanair-archiver node --disable-warning=ExperimentalWarning --test 'test/feature/**/*.test.js' "$@"
