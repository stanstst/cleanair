#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CTX=minikube
. "$ROOT/deploy/lib/common.sh"

minikube status >/dev/null 2>&1 || minikube start --driver=docker

load_env

if [ -z "${MYSQL_ROOT_PASSWORD:-}" ]; then
  echo "MYSQL_ROOT_PASSWORD is empty in .env, using 'root' for the local cluster" >&2
  MYSQL_ROOT_PASSWORD=root
fi

for app in api fetcher archiver; do
  docker build -t "cleanair-$app:local" "$ROOT/$app"
  minikube image load --overwrite=true "cleanair-$app:local"
done

create_config "$CTX"

kubectl --context "$CTX" -n "$NS" delete job migrate --ignore-not-found
redeploy=false
kubectl --context "$CTX" -n "$NS" get deployment/api >/dev/null 2>&1 && redeploy=true
kubectl --context "$CTX" apply -k "$ROOT/deploy/k8s"
if [ "$redeploy" = true ]; then
  kubectl --context "$CTX" -n "$NS" rollout restart deployment/api deployment/grafana statefulset/prometheus
fi

wait_for_rollouts "$CTX"
