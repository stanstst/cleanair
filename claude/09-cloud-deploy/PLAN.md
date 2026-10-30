# Step 09: deploy to DigitalOcean Kubernetes (DOKS)

## Context
Step 08 runs the whole app on a local minikube from plain manifests in `deploy/k8s/`, with images built locally and loaded with `minikube image load`. Step 09 deploys the same app to the existing DOKS cluster in fra1, with no extra cost: no load balancer, no extra node, the free registry plan. The UI and API, Grafana and the fileserver are reached on NodePorts of the node's public IP.

**Already in place (checked):**
- **Cluster:** `k8s-1-37-0-do-2-fra1-1793344160927` (id `145fd87c-f614-4046-86fd-ccc223d11558`), running, Kubernetes 1.37.0. kubectl context `do-fra1-k8s-1-37-0-do-2-fra1-1793344160927`.
- **Node:** pool `pool-yjo6nqeqv`, 1 × `s-1vcpu-2gb` (amd64), Ready, public IP `167.99.241.201`.
- **Storage:** default storage class `do-block-storage`.
- **Registry:** DOCR `cleanair`, endpoint `registry.digitalocean.com/cleanair`, fra1, Starter plan (1 repository, 500 MB), empty. `doctl registry kubernetes-manifest` works.
- **Tools:** `doctl` 2.1.0, logged in. kubectl 1.37.0. Docker Desktop, context `desktop-linux`, linux/x86_64, so no cross-build is needed.
- **Docker credentials:** `~/.docker/config.json` has `"credsStore": "desktop"`, which needs `pass` and fails to store logins.

**Rules carried over:**
- No commits and no code comments.
- App code and Dockerfiles stay unchanged, and so do the earlier `claude/0*` folders.
- The minikube deploy keeps working.

## Resource budget on the 1 node
The node can hand out 920m CPU and about 1465 Mi of memory. DigitalOcean's system pods already request 512m and 582 Mi, which leaves about **408m CPU and 882 Mi**.

| Pods | CPU | Memory |
|---|---|---|
| Long-running pods (base): api 50/64, grafana 50/128, fileserver 20/32, mysql 100/384, prometheus 50/128, pushgateway 20/32 | 290m | 768 Mi |
| plus `migrate` while deploying | 340m | 896 Mi: **does not fit** |

The api, fetcher and archiver pods are scheduled while their initContainer still waits for `migrate`, so their requests already count. The overlay therefore lowers the **mysql memory request from 384 Mi to 256 Mi** and keeps the limit at 768 Mi.

| Scenario | CPU | Memory |
|---|---|---|
| Long-running pods, after the change | 290m | 640 Mi |
| plus `migrate` and an api rollout pod during a deploy | 390m | 832 Mi |
| plus 1 nightly Job (fetcher or archiver, 50m / 64 Mi) | 340m | 704 Mi |

Every scenario fits. The archiver runs at 22:00 and the fetcher at 23:00, so only one Job runs at a time. A backfill started by hand should not be run during a deploy.

## Approach: kustomize base + DOKS overlay
`kubectl` has kustomize built in (`kubectl apply -k`), so there is still no Helm. The 08 manifests become the base, and the DOKS overlay patches only what differs, so no YAML is copied.

### 1. `deploy/k8s/kustomization.yaml` (new, base)
- `resources:` lists the 12 existing YAML files.
- With a `kustomization.yaml` in the folder, `kubectl apply -f deploy/k8s/` fails on it, so the local commands switch to `-k`:
  - `local-deploy.sh` runs `kubectl apply -k "$ROOT/deploy/k8s"`;
  - in the README, teardown is `kubectl delete -k deploy/k8s`.
- The base manifests stay as they are, apart from the archiver schedule `0 22 * * *` that is already changed.

### 2. `deploy/doks/` (new, overlay)
`kustomization.yaml` has `resources: [../k8s]` plus the following.

**`images:`** sends all 3 app images to the single Starter repository, with placeholder tags:

| Base image | New name | Tag |
|---|---|---|
| `cleanair-api` | `registry.digitalocean.com/cleanair/cleanair` | `api-TAG` |
| `cleanair-fetcher` | `registry.digitalocean.com/cleanair/cleanair` | `fetcher-TAG` |
| `cleanair-archiver` | `registry.digitalocean.com/cleanair/cleanair` | `archiver-TAG` |

**`patches:`**
- **`serviceaccount-pull-secret.yaml`** adds `imagePullSecrets: [{name: registry-cleanair}]` to the ServiceAccount `wait-for-migrate`. Every app pod runs as that ServiceAccount (api, fetcher, archiver, backfill), so this one patch covers them all. The third-party images are public and need no secret.
- **`services-nodeport.yaml`** sets `type: NodePort` with fixed ports:

  | Service | NodePort |
  |---|---|
  | `api` | 8080 → 30080 |
  | `grafana` | 3000 → 30300 |
  | `fileserver` | 5000 → 30500 |

  `mysql`, `prometheus` and `pushgateway` stay ClusterIP.
- **`fileserver-no-anonymous.yaml`** is a JSON patch on StatefulSet `fileserver` that removes the last two args, `-a` and `"@/"`. Anonymous read is then off, and only `$(ARCHIVE_USER):$(ARCHIVE_PASSWORD)@/:rw` is left. The archiver already logs in with these credentials.
- **`grafana-no-anonymous.yaml`** adds `GF_AUTH_ANONYMOUS_ENABLED=false` and `GF_USERS_ALLOW_SIGN_UP=false` to grafana. These are Grafana's defaults, but now they are pinned.
- **`mysql-requests.yaml`** sets the mysql memory request to `256Mi`, as described in the resource budget.

**Unchanged:** the namespace, CronJob schedules, PVC sizes (`do-block-storage` is the default class), the RBAC, `migrate` and the initContainers.

### 3. `deploy/lib/common.sh` (new, shared)
These move out of `local-deploy.sh`:
- the `kubectl` / `minikube kubectl --` fallback;
- `load_env`, which reads `.env`;
- `apply_generated CTX ...`;
- `create_config CTX`, which creates the namespace, `cleanair-db`, `cleanair-secrets` and the 4 file ConfigMaps;
- `wait_for_rollouts CTX`.

`local-deploy.sh` sources this file and keeps its behaviour, including the `root` and `archiver` / `admin` fallbacks for minikube.

### 4. `deploy/doks-deploy.sh` (new)
1. **Checks.**
   - `doctl` is installed and `doctl account get` works.
   - Context `CTX=do-fra1-k8s-1-37-0-do-2-fra1-1793344160927` exists, and every kubectl call passes `--context $CTX`.
   - At least 1 node is Ready.
2. **`.env` checks.**
   - `MYSQL_ROOT_PASSWORD` must be non-empty.
   - `GRAFANA_ADMIN_PASSWORD` must be set and not `admin`.
   - `ARCHIVE_PASSWORD` must be set and not `archiver`.
   - Otherwise the script exits 1 before building anything.
3. **`TAG`.** `git rev-parse --short HEAD`, plus `-dirty` when `git status --porcelain` is not empty.
4. **Login.** Uses a temporary `DOCKER_CONFIG` (made with `mktemp -d` and removed by a `trap` on exit).
   - Link `contexts/`, `buildx/` and `cli-plugins/` from `~/.docker`.
   - `doctl registry docker-config --read-write --expiry-seconds 900` writes the registry auth. `jq` adds `currentContext` from `docker context show`.
   - No password goes in `.env` or `~/.docker`.
5. **Build and push.** For each app: `docker build -t registry.digitalocean.com/cleanair/cleanair:<app>-$TAG <app>/` and then `docker push`.
6. **Config.**
   - `create_config $CTX`.
   - The pull secret: `doctl registry kubernetes-manifest --namespace cleanair --name registry-cleanair | kubectl --context $CTX apply -f -`. This is a read-only registry token that goes straight to the cluster, never to a file.
7. **Apply.**
   - Delete the old `migrate` Job.
   - Run `kubectl kustomize deploy/doks | sed "s|-TAG$|-$TAG|" | kubectl --context $CTX apply -f -`.
   - On a redeploy, `rollout restart` grafana and prometheus so they read the new ConfigMaps, as `local-deploy.sh` does. The api picks up the new image tag by itself.
8. **Wait.** `wait_for_rollouts $CTX`, with longer timeouts (600s), because creating the volumes takes a minute.
9. **Firewall.** Find the firewall `cleanair-nodeports` with `doctl compute firewall list`, then create it, or update it if it exists:
   - `--tag-names k8s:145fd87c-f614-4046-86fd-ccc223d11558`, the cluster tag, so a replaced or resized node is covered too;
   - `--inbound-rules` for TCP 30080, 30300 and 30500 from `0.0.0.0/0` and `::/0`;
   - no other inbound rules.

   DOKS's own worker firewall stays as it is. DigitalOcean cloud firewalls are free.
10. **Registry cleanup.**
    - `doctl registry repository list-tags cleanair`. For each app, keep the 2 newest tags (the one just deployed and the previous one) and delete the rest with `doctl registry repository delete-tag cleanair ... --force`.
    - Then `doctl registry garbage-collection start cleanair --include-untagged-manifests --force`. It runs after the rollouts, because GC makes the registry read-only for a short time.
    - If a GC is already running, print a warning and continue.
11. **Print access.** Read the node's ExternalIP from `kubectl get nodes` and print:
    - `UI and API: http://<ip>:30080/`
    - `Grafana: http://<ip>:30300/`
    - `Fileserver: http://<ip>:30500/`

### 5. `deploy/run-backfill.sh`
- Add an optional 3rd argument, the kubectl context (default: the current context).
- Read the image from the deployed CronJob `fetcher` (`.spec.jobTemplate.spec.template.spec.containers[0].image`) and replace `cleanair-fetcher:local` in the Job template with it. On DOKS the backfill then runs the deployed DOCR image and tag, and on minikube it keeps `cleanair-fetcher:local`.
- There is no limit on the date range.

### 6. `README.md`
- **Local section:** apply and delete with `-k`.
- **New section "Deployment to DigitalOcean (DOKS)":**
  - prerequisites (`doctl auth init`, `.env` passwords);
  - `./deploy/doks-deploy.sh`;
  - the 3 public URLs;
  - port-forward for mysql and prometheus;
  - jobs on demand and backfill with the context;
  - delete with `kubectl --context ... delete -k deploy/doks`, which also deletes the volumes;
  - how to change the node size later (create a new pool, delete the old one, no redeploy);
  - the no-TLS warning.

### 7. Docs in `claude/09-cloud-deploy/`
`DEVELOPMENT.md` covers the layout, the script steps, the resource budget, the registry tag scheme and its cleanup, and the firewall. `VERIFICATION.md` records the checks below with their actual results.

## Verification
1. **Local unchanged.**
   - `kubectl kustomize deploy/k8s` renders the same objects as before.
   - `./deploy/local-deploy.sh` on minikube: all pods Running, and the archiver CronJob shows `0 22 * * *`.
2. **Overlay renders.** `kubectl kustomize deploy/doks` shows:
   - the 3 DOCR image names with tags `<app>-TAG`;
   - the 3 NodePort Services with 30080, 30300 and 30500;
   - no `@/` arg on dufs;
   - mysql requesting 256Mi;
   - the pull secret on the ServiceAccount.
3. **Guards.**
   - With `ARCHIVE_PASSWORD` unset or `archiver`, or `GRAFANA_ADMIN_PASSWORD=admin`, the script exits 1 before any build.
   - With a wrong context, it exits 1.
4. **Deploy.** `./deploy/doks-deploy.sh` exits 0.
   - The registry has `api-<sha>`, `fetcher-<sha>` and `archiver-<sha>`.
   - There is no `ImagePullBackOff`.
   - All pods are Running and `migrate` is Completed.
   - The 3 PVCs are Bound on `do-block-storage`.
   - No pod is Pending. Check `kubectl describe node` for requests below 100%.
5. **Public access.** From the laptop:
   - `curl http://<ip>:30080/` returns the UI and `/cleanest-city?...` returns 200 JSON;
   - `:30300` shows the Grafana login page; `admin/admin` fails and the `.env` password works;
   - `:30500` returns 401 without credentials and lists files with `ARCHIVE_USER/ARCHIVE_PASSWORD`.
6. **Nothing else exposed.**
   - `kubectl get svc -n cleanair` shows NodePort only for api, grafana and fileserver.
   - `nc -zv -w3 <ip>` succeeds on 30080, 30300 and 30500.
   - It times out on the kubelet port 10250, on a random NodePort, and on mysql/prometheus via port 3306/9090.
7. **Jobs.**
   - `kubectl create job --from=cronjob/fetcher` writes today's rows.
   - `--from=cronjob/archiver` uploads CSVs to the fileserver.
   - `./deploy/run-backfill.sh 26-10-2026 28-10-2026 <ctx>` completes with the DOCR image.
8. **Redeploy.**
   - A second `./deploy/doks-deploy.sh` after a code-free change gets a new tag and the api rolls.
   - Old tags beyond 2 per app are deleted and GC starts.
   - The registry stays under 500 MB.
9. **Persistence.** `kubectl delete pod mysql-0`: the row count is unchanged after the restart.
10. **Cost.**
    - `doctl compute load-balancer list` is empty.
    - `doctl compute volume list` shows only the 3 PVC volumes.
    - The registry is still on the Starter plan.
    - The node pool still has 1 `s-1vcpu-2gb` node.

## Prerequisites before implementation
- `ARCHIVE_PASSWORD` added to `.env` (and not `archiver`).
- `minikube update-context` if the minikube context is missing again.
