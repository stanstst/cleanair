# Deploy to local minikube: verification (2026-10-29)

1. **Prerequisites.**
   - `minikube status`: host, kubelet and apiserver are Running, and the node is Ready on Kubernetes v1.35.1.
   - There is no `kubectl` binary, so every command ran as `minikube kubectl --`, which the scripts fall back to.
   - `.env` exists.
2. **Deploy.**
   - The first run failed: `mysql-0` went into CrashLoopBackOff with `Database is uninitialized and password option is not specified`, because `MYSQL_ROOT_PASSWORD` is empty in `.env`. The script now defaults it to `root` with a warning.
   - After that fix, `deploy/local-deploy.sh` exited 0, and `namespace/cleanair` exists.
3. **Images.** `minikube image ls | grep cleanair` lists `cleanair-api:local`, `cleanair-fetcher:local` and `cleanair-archiver:local`. No pod was in `ErrImagePull`.
4. **Secrets.**
   - `kubectl get secret -n cleanair` shows `cleanair-secrets` with 5 keys.
   - `git status --short` shows only `?? claude/08-deploy/`, `?? deploy/` and ` M README.md`. No secret file was written.
5. **Pods and volumes.**
   - `api`, `fileserver-0`, `grafana`, `mysql-0`, `prometheus-0` and `pushgateway` are Running, and `migrate` is Completed.
   - `data-mysql-0`, `data-fileserver-0` and `data-prometheus-0` are Bound (1Gi, `standard`).
6. **Migrations.**
   - The `migrate` log says `Successfully applied 4 migrations to schema cleanair, now at version v4`.
   - `flyway_schema_history` has versions 1–4 with `success=1`.
   - `SHOW TABLES` lists `air_quality`, and `SHOW INDEX` lists `idx_target_date`.
7. **Workloads match README.**
   - `kubectl get deploy,sts,cronjob,job` shows:
     - Deployments: api, grafana, pushgateway;
     - StatefulSets: fileserver, mysql, prometheus;
     - CronJobs: archiver, fetcher;
     - Job: migrate.
   - dummy-dev-populator is not deployed.
8. **CronJob schedules.** `fetcher` and `archiver` both show `0 23 * * *`. No time zone is set, so this is 23:00 UTC.
9. **Fetcher on demand.**
   - `kubectl create job --from=cronjob/fetcher fetcher-manual` printed `Job finished in 10.797s (success=true)`.
   - `air_quality` gained 3 rows for 2026-10-29: sofia 0.34/0.44, ruse 0.35/0.49 and varna 0.20/0.33 (mean/max ratio).
10. **Backfill.**
    - `deploy/run-backfill.sh 26-10-2026 28-10-2026` created `fetcher-backfill-jkwgm`, which printed `Backfill finished in 72.901s (days=3, api_calls=87, success=true)`.
    - Every date from 2026-10-26 to 2026-10-29 has 3 rows. `COUNT(*)=12` and `COUNT(DISTINCT city, target_date)=12`, so there are no duplicates.
11. **Archiver on demand.**
    - I inserted 2 rows (sofia and ruse) dated 2022-01-01. `kubectl create job --from=cronjob/archiver archiver-manual` printed:
      ```
      Archived 2 records to 2022-01-01-archive.csv
      Archive finished in 0.107s (cutoff=2023-10-29, files=1, records=2, success=true)
      ```
    - Rows older than the cutoff: 2 before, 0 after. The total is back to 12.
    - Through `port-forward svc/fileserver 5000:5000`, the listing shows `2022-01-01-archive.csv`, which has the header and 2 rows with `µg/m³` intact.
    - An anonymous `PUT` returns 401.
12. **API and UI.** Through `port-forward svc/api 8080:8080`:
    - `cleanest-city?date-from=2026-10-26&date-to=2026-10-29` returned 200 `{"city":"varna","period_max_polution":0.445,"period_mean_polution":0.2675}`;
    - `GET /` returned 200;
    - `date-from=2026-02-31` returned 400 `date-from and date-to are required in YYYY-MM-DD format`.
13. **Monitoring.**
    - Prometheus: the `api` and `pushgateway` targets are `up`. Pushgateway holds `cleanair_job_*` (fetcher: api_calls 29, success 1) and `cleanair_archiver_*` (success 1). Prometheus has `cleanair_api_cleanest_city_*`.
    - Grafana: `/api/health` reports database ok on 12.1.0. The `Prometheus` datasource points to `http://prometheus:9090`. Dashboard `cleanair-job` is provisioned with all 10 panels (Fetcher ×4, API ×4, Archiver ×2).
    - The panels were **not** checked visually in a browser.
14. **Persistence.**
    - `kubectl delete pod mysql-0 fileserver-0`: after both pods were Ready again, the `air_quality` count was still 12.
    - `2022-01-01-archive.csv` still returns 200.
15. **Teardown and redeploy.**
    - `kubectl delete -f deploy/k8s/` removed the namespace with all its objects and PVCs (`namespaces "cleanair" not found`).
    - `deploy/local-deploy.sh` then brought every pod back (migrate Completed, the rest Running).
    - A second run of the script (the redeploy path) restarted api, grafana and prometheus, re-ran migrate, and exited 0.
16. **`git status --short`.** Only `README.md`, `deploy/` and `claude/08-deploy/` changed. The `fetcher/`, `archiver/` and `api/` code is unchanged.
