NS=cleanair

if command -v kubectl >/dev/null; then
  kubectl() { command kubectl "$@"; }
else
  kubectl() { minikube kubectl -- "$@"; }
fi

load_env() {
  if [ ! -f "$ROOT/.env" ]; then
    echo ".env not found in $ROOT, copy .env.example and fill it in" >&2
    exit 1
  fi
  set -a
  . "$ROOT/.env"
  set +a
}

apply_generated() {
  local ctx="$1"
  shift
  kubectl --context "$ctx" -n "$NS" "$@" --dry-run=client -o yaml | kubectl --context "$ctx" apply -f -
}

create_config() {
  local ctx="$1"
  kubectl --context "$ctx" apply -f "$ROOT/deploy/k8s/namespace.yaml"
  apply_generated "$ctx" create configmap cleanair-db \
    --from-literal=DB_NAME="$MYSQL_DATABASE" \
    --from-literal=DB_USER="$MYSQL_USER" \
    --from-literal=ARCHIVE_USER="${ARCHIVE_USER:-archiver}"
  apply_generated "$ctx" create secret generic cleanair-secrets \
    --from-literal=OPENAQ_API_KEY="$OPENAQ_API_KEY" \
    --from-literal=MYSQL_ROOT_PASSWORD="$MYSQL_ROOT_PASSWORD" \
    --from-literal=MYSQL_PASSWORD="$MYSQL_PASSWORD" \
    --from-literal=ARCHIVE_PASSWORD="${ARCHIVE_PASSWORD:-archiver}" \
    --from-literal=GRAFANA_ADMIN_PASSWORD="${GRAFANA_ADMIN_PASSWORD:-admin}"
  apply_generated "$ctx" create configmap mysql-migrations --from-file="$ROOT/mysql/migrations"
  apply_generated "$ctx" create configmap prometheus-config --from-file="$ROOT/prometheus/prometheus.yml"
  apply_generated "$ctx" create configmap grafana-datasources --from-file="$ROOT/grafana/provisioning/datasources"
  apply_generated "$ctx" create configmap grafana-dashboards --from-file="$ROOT/grafana/provisioning/dashboards"
}

wait_for_rollouts() {
  local ctx="$1"
  kubectl --context "$ctx" -n "$NS" wait --for=condition=complete job/migrate --timeout=600s
  for workload in statefulset/mysql statefulset/fileserver statefulset/prometheus \
    deployment/pushgateway deployment/grafana deployment/api; do
    kubectl --context "$ctx" -n "$NS" rollout status "$workload" --timeout=600s
  done
  kubectl --context "$ctx" -n "$NS" get pods
}
