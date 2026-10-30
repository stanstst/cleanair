#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CTX=do-fra1-k8s-1-37-0-do-2-fra1-1793344160927
CLUSTER_ID=145fd87c-f614-4046-86fd-ccc223d11558
REGISTRY=registry.digitalocean.com/cleanair
REPO=cleanair
FIREWALL=cleanair-nodeports
NODE_PORTS="30080 30300 30500"
. "$ROOT/deploy/lib/common.sh"

command -v doctl >/dev/null || { echo "doctl not found on PATH" >&2; exit 1; }
command -v jq >/dev/null || { echo "jq not found on PATH" >&2; exit 1; }
doctl account get >/dev/null 2>&1 || { echo "doctl is not authenticated, run doctl auth init" >&2; exit 1; }
kubectl config get-contexts "$CTX" >/dev/null 2>&1 || { echo "kubectl context $CTX not found, run doctl kubernetes cluster kubeconfig save $CLUSTER_ID" >&2; exit 1; }
ready=$(kubectl --context "$CTX" get nodes --no-headers 2>/dev/null | awk '$2 == "Ready"' | wc -l)
if [ "$ready" -lt 1 ]; then
  echo "no Ready node in $CTX" >&2
  exit 1
fi

load_env
if [ -z "${MYSQL_ROOT_PASSWORD:-}" ]; then
  echo "MYSQL_ROOT_PASSWORD is empty in .env, it is required for the DOKS deployment" >&2
  exit 1
fi
if [ -z "${GRAFANA_ADMIN_PASSWORD:-}" ] || [ "$GRAFANA_ADMIN_PASSWORD" = admin ]; then
  echo "GRAFANA_ADMIN_PASSWORD must be set in .env and must not be admin, grafana is public on DOKS" >&2
  exit 1
fi
if [ -z "${ARCHIVE_PASSWORD:-}" ] || [ "$ARCHIVE_PASSWORD" = archiver ]; then
  echo "ARCHIVE_PASSWORD must be set in .env and must not be archiver, the fileserver is public on DOKS" >&2
  exit 1
fi

TAG=$(git -C "$ROOT" rev-parse --short HEAD)
[ -n "$(git -C "$ROOT" status --porcelain)" ] && TAG="$TAG-dirty"

docker_context=$(docker context show)
DOCKER_CONFIG=$(mktemp -d)
trap 'rm -rf "$DOCKER_CONFIG"' EXIT
for dir in contexts buildx cli-plugins; do
  [ -e "$HOME/.docker/$dir" ] && ln -s "$HOME/.docker/$dir" "$DOCKER_CONFIG/$dir"
done
doctl registry docker-config --read-write --expiry-seconds 900 \
  | jq --arg ctx "$docker_context" '. + {currentContext: $ctx}' > "$DOCKER_CONFIG/config.json"
export DOCKER_CONFIG

for app in api fetcher archiver; do
  docker build -t "$REGISTRY/$REPO:$app-$TAG" "$ROOT/$app"
  docker push "$REGISTRY/$REPO:$app-$TAG"
done

create_config "$CTX"
doctl registry kubernetes-manifest --namespace "$NS" --name registry-cleanair | kubectl --context "$CTX" apply -f -

kubectl --context "$CTX" -n "$NS" delete job migrate --ignore-not-found
redeploy=false
kubectl --context "$CTX" -n "$NS" get deployment/api >/dev/null 2>&1 && redeploy=true
kubectl --context "$CTX" kustomize "$ROOT/deploy/doks" | sed "s|-TAG$|-$TAG|" | kubectl --context "$CTX" apply -f -
if [ "$redeploy" = true ]; then
  kubectl --context "$CTX" -n "$NS" rollout restart deployment/grafana statefulset/prometheus
fi

wait_for_rollouts "$CTX"

rules=""
for port in $NODE_PORTS; do
  rules="$rules protocol:tcp,ports:$port,address:0.0.0.0/0,address:::/0"
done
firewall_id=$(doctl compute firewall list -o json | jq -r --arg name "$FIREWALL" '.[] | select(.name == $name) | .id')
if [ -z "$firewall_id" ]; then
  doctl compute firewall create --name "$FIREWALL" --tag-names "k8s:$CLUSTER_ID" --inbound-rules "${rules# }" >/dev/null
  echo "created firewall $FIREWALL for ports $NODE_PORTS"
else
  doctl compute firewall update "$firewall_id" --name "$FIREWALL" --tag-names "k8s:$CLUSTER_ID" --inbound-rules "${rules# }" >/dev/null
  echo "updated firewall $FIREWALL for ports $NODE_PORTS"
fi

old_tags=$(doctl registry repository list-tags "$REPO" -o json \
  | jq -r 'map(select(.tag != null)) | group_by(.tag | sub("-.*$"; "")) | map(sort_by(.updated_at) | reverse | .[2:][] | .tag) | .[]')
if [ -n "$old_tags" ]; then
  doctl registry repository delete-tag "$REPO" $old_tags --force
  echo "deleted old image tags:" $old_tags
fi
doctl registry garbage-collection start --include-untagged-manifests --force >/dev/null 2>&1 \
  && echo "registry garbage collection started" \
  || echo "registry garbage collection not started (one may already be running)" >&2

ip=$(kubectl --context "$CTX" get nodes -o jsonpath='{.items[0].status.addresses[?(@.type=="ExternalIP")].address}')
echo "UI and API: http://$ip:30080/"
echo "Grafana:    http://$ip:30300/"
echo "Fileserver: http://$ip:30500/"
