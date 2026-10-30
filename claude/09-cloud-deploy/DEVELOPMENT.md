# Deploy to DigitalOcean Kubernetes (DOKS): development notes

## Layout (`deploy/`)
- `k8s/`: the 08 manifests, now a kustomize **base** (`kustomization.yaml` lists the 12 files). The only manifest change is the archiver schedule, `0 22 * * *`.
- `doks/`: the **overlay** for DOKS.
  - `kustomization.yaml` maps the 3 app images to `registry.digitalocean.com/cleanair/cleanair` with the placeholder tags `api-TAG`, `fetcher-TAG` and `archiver-TAG`.
  - `serviceaccount-pull-secret.yaml` adds `imagePullSecrets: registry-cleanair` to the ServiceAccount `wait-for-migrate`, which every app pod uses (api, fetcher, archiver, backfill).
  - `services-nodeport.yaml` makes `api`, `grafana` and `fileserver` NodePort Services on 30080, 30300 and 30500.
  - `fileserver-no-anonymous.yaml` is a JSON patch. A `test` op checks that arg 6 is `@/`, then the patch removes args 6 and 5 (`-a "@/"`). If the base args ever change, the build fails instead of removing the wrong arg.
  - `grafana-no-anonymous.yaml` pins `GF_AUTH_ANONYMOUS_ENABLED=false` and `GF_USERS_ALLOW_SIGN_UP=false`.
  - `mysql-requests.yaml` lowers the mysql memory request to 256Mi. The limit stays 768Mi.
- `lib/common.sh`: shared script code.
  - The `kubectl` / `minikube kubectl --` fallback.
  - `load_env`.
  - `apply_generated CTX ...`.
  - `create_config CTX`: the namespace, `cleanair-db`, `cleanair-secrets` and the 4 file ConfigMaps.
  - `wait_for_rollouts CTX`.
- `local-deploy.sh`: minikube. It behaves as in 08, but sources `lib/common.sh` and applies with `apply -k deploy/k8s`.
- `doks-deploy.sh`: DOKS.
- `run-backfill.sh START END [CONTEXT]`: the backfill Job. The image comes from the deployed CronJob `fetcher`.

## Why kustomize
`kubectl` has kustomize built in, so this needs no new tool and no Helm. The overlay patches only what differs on DOKS, so no YAML is copied.

A folder containing `kustomization.yaml` can't be applied with `-f`, so local apply and delete are now `-k`. The base renders the same 20 objects as before.

## Resource budget
The node is `s-1vcpu-2gb`. It can hand out 920m CPU and 1465Mi of memory, and the DOKS system pods request 512m and 582Mi of that.

| | CPU | Memory |
|---|---|---|
| Our long-running pods, with mysql at 256Mi | 290m | 640Mi |
| Measured with the backfill Job running | 852m (92%) | 1286Mi (87%) |

With the base mysql request of 384Mi, the `migrate` Job (128Mi) would not fit during a deploy. The app pods are already scheduled while their initContainer waits for `migrate`, so the deploy would hang.

The archiver at 22:00 and the fetcher at 23:00 never run at the same time.

Limits are overcommitted (276% of memory). If the pods together use too much memory, the kernel kills a container. In that case, change the node size, as described in the README.

## `doks-deploy.sh`
1. **Checks.**
   - `doctl` and `jq` are installed, and `doctl account get` works.
   - The context `do-fra1-k8s-1-37-0-do-2-fra1-1793344160927` exists, and at least 1 node is Ready.
2. **`.env` checks.**
   - `MYSQL_ROOT_PASSWORD` must be non-empty.
   - `GRAFANA_ADMIN_PASSWORD` must be set and not `admin`.
   - `ARCHIVE_PASSWORD` must be set and not `archiver`.
   - Otherwise the script exits 1 before any build.
3. **`TAG`.** `git rev-parse --short HEAD`, plus `-dirty` when the tree has changes.
4. **Registry login without `~/.docker`.**
   - Docker Desktop's `credsStore: desktop` needs `pass`, which is not set up, so the script uses a temporary `DOCKER_CONFIG`.
   - It links `contexts/`, `buildx/` and `cli-plugins/` from `~/.docker`.
   - `config.json` comes from `doctl registry docker-config --read-write --expiry-seconds 900`, with `currentContext` added by `jq`.
   - A `trap` removes the folder on exit.
   - The token lives for 15 minutes. The registry garbage collection waits until all write tokens have expired ("waiting for write JWTs to expire"), so a 1-hour token kept the registry read-only for up to an hour.
5. **Build and push.** `docker build` and `docker push` `registry.digitalocean.com/cleanair/cleanair:<app>-$TAG` for each app. Builds are native amd64, with no buildx platform flag.
6. **Config.**
   - `create_config`.
   - The pull secret: `doctl registry kubernetes-manifest --namespace cleanair --name registry-cleanair | kubectl apply -f -`. It is a read-only token and is never written to a file.
7. **Apply.**
   - Delete the old `migrate` Job.
   - Run `kubectl kustomize deploy/doks | sed "s|-TAG$|-$TAG|" | kubectl apply -f -`.
   - On a redeploy, `rollout restart` grafana and prometheus so they pick up the ConfigMaps. The api rolls when its image tag changes.
8. **Wait.** `wait_for_rollouts`, with 600s timeouts.
9. **Firewall `cleanair-nodeports`.**
   - It is created, or updated if it exists, with inbound TCP 30080, 30300 and 30500 from `0.0.0.0/0` and `::/0`.
   - It is attached to the tag `k8s:145fd87c-f614-4046-86fd-ccc223d11558`, so a new node gets it automatically.
   - DOKS's own firewalls stay as they are. `k8s-...-worker` allows only private ranges, and `k8s-public-access-...` has no inbound rules.
10. **Registry cleanup.**
    - Tags are grouped by app prefix. The 2 newest per app are kept and the rest are deleted.
    - Entries without a tag are skipped. The registry lists manifests without a tag, such as an image index from an earlier push. Without this filter, `jq` failed on the first deploy.
    - Then `doctl registry garbage-collection start --include-untagged-manifests --force`. If a GC is already running, the script prints a warning and continues.
11. **Print** the 3 URLs, built from the node's ExternalIP.

## Registry on the free Starter plan
The plan allows 1 repository and 500 MB, so all 3 images share the repository `cleanair`, and the app name is part of the tag. The images share the `node:22-alpine` base layers, so 3 images take little more space than 1. Keeping 2 tags per app plus GC keeps the registry under the limit.

## Public access
- **Public, as NodePorts:** api (UI and API), grafana and fileserver.
- **ClusterIP only:** mysql, prometheus and pushgateway.
- **Logins:**
  - Grafana needs the admin password from `.env`.
  - The fileserver needs `ARCHIVE_USER` / `ARCHIVE_PASSWORD` for reading too.
  - The archiver uploads inside the cluster to `http://fileserver:5000` with the same credentials.
- **No TLS**, since there is no domain.

## Cluster resources
| Resource | Name | Notes |
|---|---|---|
| Cluster | `k8s-1-37-0-do-2-fra1-1793344160927` | fra1, 1.37.0-do.2, created by the user |
| Node pool | `pool-yjo6nqeqv` | 1 × `s-1vcpu-2gb` |
| Registry | `cleanair` | fra1, Starter |
| Firewall | `cleanair-nodeports` | created by `doks-deploy.sh` |
| Volumes | 3 × 1 GiB | created by the PVCs, deleted with the namespace (reclaim policy Delete) |

The firewall `cleanair-public` (tag `openair`, SSH only) was there before and is not used by the cluster.
