#!/usr/bin/env bash
set -euo pipefail

if [ $# -ne 2 ]; then
  echo "usage: $0 START_DATE END_DATE   (DD-MM-YYYY)" >&2
  exit 2
fi

if command -v kubectl >/dev/null; then
  kubectl() { command kubectl "$@"; }
else
  kubectl() { minikube kubectl -- "$@"; }
fi

sed -e "s/START_DATE/$1/" -e "s/END_DATE/$2/" "$(dirname "$0")/jobs/fetcher-backfill.yaml" | kubectl create -f -
