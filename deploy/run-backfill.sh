#!/usr/bin/env bash
set -euo pipefail

if [ $# -lt 2 ] || [ $# -gt 3 ]; then
  echo "usage: $0 START_DATE END_DATE [CONTEXT]   (DD-MM-YYYY)" >&2
  exit 2
fi

if command -v kubectl >/dev/null; then
  kubectl() { command kubectl "$@"; }
else
  kubectl() { minikube kubectl -- "$@"; }
fi

CTX="${3:-$(kubectl config current-context)}"
image=$(kubectl --context "$CTX" -n cleanair get cronjob fetcher -o jsonpath='{.spec.jobTemplate.spec.template.spec.containers[0].image}')

sed -e "s/START_DATE/$1/" -e "s/END_DATE/$2/" -e "s|image: cleanair-fetcher:local|image: $image|" \
  "$(dirname "$0")/jobs/fetcher-backfill.yaml" | kubectl --context "$CTX" create -f -
