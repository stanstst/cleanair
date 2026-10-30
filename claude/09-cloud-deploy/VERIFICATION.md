# Deploy to DigitalOcean Kubernetes (DOKS): verification

Run on 2026-10-30 against context `do-fra1-k8s-1-37-0-do-2-fra1-1793344160927`, node IP `167.99.241.201`.

1. **Local unchanged.**
   - `kubectl kustomize deploy/k8s` renders 20 objects, as before.
   - `./deploy/local-deploy.sh` on minikube: all pods Running, `migrate` Completed.
   - The archiver CronJob shows `0 22 * * *` and the fetcher `0 23 * * *`.
2. **Overlay renders.** `kubectl kustomize deploy/doks` gives 20 objects:
   - images `registry.digitalocean.com/cleanair/cleanair:{api,fetcher,archiver}-TAG`;
   - NodePort 30080, 30300 and 30500;
   - the dufs args end with `$(ARCHIVE_USER):$(ARCHIVE_PASSWORD)@/:rw`, with no `@/`;
   - the mysql request is 256Mi;
   - `registry-cleanair` is on the ServiceAccount;
   - the grafana anonymous and sign-up vars are present.
3. **Guards.** With a copy of `deploy/` and a test `.env`, each of `ARCHIVE_PASSWORD=archiver`, `ARCHIVE_PASSWORD=` and `GRAFANA_ADMIN_PASSWORD=admin` exits 1 with its message, before any build.
4. **Deploy.** `./deploy/doks-deploy.sh` pushed `api-d6daeae-dirty`, `fetcher-d6daeae-dirty` and `archiver-d6daeae-dirty`.
   - No `ImagePullBackOff`. All 6 long-running pods are Running and `migrate` is Completed.
   - The 3 PVCs are 1Gi and Bound on `do-block-storage`.
   - The first run stopped at the tag-cleanup step with `jq: null (null) cannot be matched`, after the firewall was created. Cause: the registry lists a manifest without a tag. Fixed with `map(select(.tag != null))`, and the second run exited 0.
5. **Public access.**

   | Request | Result |
   |---|---|
   | `http://167.99.241.201:30080/` | 200 |
   | `/cleanest-city?date-from=2026-10-26&date-to=2026-10-30` | 200 `{"city":"varna",...}` |
   | Grafana `/login` | 200 |
   | Grafana `/api/user` as `admin:admin` | 401 |
   | Grafana `/api/user` with the `.env` password | 200 |
   | Grafana anonymous `/api/search` | 401 |
   | Fileserver without credentials | 401 |
   | Fileserver with `ARCHIVE_USER` / `ARCHIVE_PASSWORD` | 200 |

6. **Nothing else exposed.**
   - `get svc`: NodePort only for api, fileserver and grafana. mysql, prometheus and pushgateway are ClusterIP.
   - TCP from the laptop: 30080, 30300 and 30500 are open. 10250, 22, 3306, 9090 and 30001 are closed.
7. **Jobs.**
   - `fetcher-manual`: `Job finished in 8.281s (success=true)`.
   - `archiver-manual`: `Archive finished ... files=0, records=0, success=true`. Nothing was older than 36 months.
   - `./deploy/run-backfill.sh 26-10-2026 28-10-2026 <ctx>` used the image `registry.digitalocean.com/cleanair/cleanair:fetcher-d6daeae-dirty` and logged `Backfill finished in 69.293s (days=3, api_calls=87, success=true)`.
   - While the backfill ran, the node had 852m CPU (92%) and 1286Mi (87%) requested.
8. **Redeploy.**
   - The second `./deploy/doks-deploy.sh` exited 0: grafana and prometheus restarted, the firewall was updated and the registry GC started.
   - Each app has 1 tag, so nothing was deleted. The cleanup filter was checked on sample data: with `api-a`, `api-b`, `api-c`, `fetcher-a` and an entry without a tag, it deletes only `api-a`.
   - GC status was `waiting for write JWTs to expire`. The push token expiry was lowered from 3600s to 900s so the registry is not read-only for an hour.
9. **Persistence.** `kubectl delete pod mysql-0`: `air_quality` had 12 rows before and 12 after the restart.
10. **Cost.**
    - `doctl compute load-balancer list`: 0.
    - Volumes: the 3 PVC volumes of 1 GiB each.
    - Node pool: `pool-yjo6nqeqv` with 1 × `s-1vcpu-2gb`.
    - Registry: Starter.
