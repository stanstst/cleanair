#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NS=cleanair

if command -v kubectl >/dev/null; then
  kubectl() { command kubectl "$@"; }
else
  kubectl() { minikube kubectl -- "$@"; }
fi

minikube status >/dev/null 2>&1 || minikube start --driver=docker

if [ ! -f "$ROOT/.env" ]; then
  echo ".env not found in $ROOT, copy .env.example and fill it in" >&2
  exit 1
fi
set -a
. "$ROOT/.env"
set +a

if [ -z "${MYSQL_ROOT_PASSWORD:-}" ]; then
  echo "MYSQL_ROOT_PASSWORD is empty in .env, using 'root' for the local cluster" >&2
  MYSQL_ROOT_PASSWORD=root
fi

for app in api fetcher archiver; do
  docker build -t "cleanair-$app:local" "$ROOT/$app"
  minikube image load --overwrite=true "cleanair-$app:local"
done

kubectl apply -f "$ROOT/deploy/k8s/namespace.yaml"

apply_generated() { kubectl -n "$NS" "$@" --dry-run=client -o yaml | kubectl apply -f -; }

apply_generated create configmap cleanair-db \
  --from-literal=DB_NAME="$MYSQL_DATABASE" \
  --from-literal=DB_USER="$MYSQL_USER" \
  --from-literal=ARCHIVE_USER="${ARCHIVE_USER:-archiver}"
apply_generated create secret generic cleanair-secrets \
  --from-literal=OPENAQ_API_KEY="$OPENAQ_API_KEY" \
  --from-literal=MYSQL_ROOT_PASSWORD="$MYSQL_ROOT_PASSWORD" \
  --from-literal=MYSQL_PASSWORD="$MYSQL_PASSWORD" \
  --from-literal=ARCHIVE_PASSWORD="${ARCHIVE_PASSWORD:-archiver}" \
  --from-literal=GRAFANA_ADMIN_PASSWORD="${GRAFANA_ADMIN_PASSWORD:-admin}"
apply_generated create configmap mysql-migrations --from-file="$ROOT/mysql/migrations"
apply_generated create configmap prometheus-config --from-file="$ROOT/prometheus/prometheus.yml"
apply_generated create configmap grafana-datasources --from-file="$ROOT/grafana/provisioning/datasources"
apply_generated create configmap grafana-dashboards --from-file="$ROOT/grafana/provisioning/dashboards"

kubectl -n "$NS" delete job migrate --ignore-not-found
redeploy=false
kubectl -n "$NS" get deployment/api >/dev/null 2>&1 && redeploy=true
kubectl apply -f "$ROOT/deploy/k8s/"
if [ "$redeploy" = true ]; then
  kubectl -n "$NS" rollout restart deployment/api deployment/grafana statefulset/prometheus
fi

kubectl -n "$NS" wait --for=condition=complete job/migrate --timeout=600s
for workload in statefulset/mysql statefulset/fileserver statefulset/prometheus \
  deployment/pushgateway deployment/grafana deployment/api; do
  kubectl -n "$NS" rollout status "$workload" --timeout=300s
done
kubectl -n "$NS" get pods
