# Verification

Verification was run on 2026-10-14 against the stack described in [PLAN.md](PLAN.md).

## Steps and results

### 1. Build and start all services
```bash
docker compose up -d --build
docker compose ps
```
Result: all 4 containers are up (`fetcher`, `pushgateway`, `prometheus`, `grafana`). Ports: 9091, 9090 and 3000.

### 2. Run the job from inside the Node.js container
```bash
docker compose exec fetcher node src/job.js
```
Output from 3 runs:
```
Dummy task sleeping for 1s
Job finished in 1.005s (success=true)
Metrics pushed to http://pushgateway:9091
Dummy task sleeping for 3s
Job finished in 3.011s (success=true)
Metrics pushed to http://pushgateway:9091
Dummy task sleeping for 3s
Job finished in 3.006s (success=true)
Metrics pushed to http://pushgateway:9091
```

### 3. The Pushgateway holds the latest metrics
```bash
curl -s localhost:9091/metrics | grep '^cleanair_job'
```
```
cleanair_job_duration_seconds{instance="",job="cleanair_job"} 3.006131091
cleanair_job_last_run_timestamp_seconds{instance="",job="cleanair_job"} 1.791994278235e+09
cleanair_job_last_success{instance="",job="cleanair_job"} 1
```

### 4. Prometheus collects them
```bash
curl -s 'localhost:9090/api/v1/query?query=cleanair_job_duration_seconds'
```
```json
{"status":"success","data":{"resultType":"vector","result":[{"metric":{"__name__":"cleanair_job_duration_seconds","job":"cleanair_job"},"value":[1791994278.336,"3.010721724"]}]}}
```
The value here is from the previous run (3.0107). Prometheus collects every 5 seconds, so it had not yet picked up the newest push (3.0061) when this was queried. This lag is expected.

### 5. Grafana is set up automatically
```bash
curl -s -u admin:admin 'localhost:3000/api/search?query=CleanAir'
curl -s -u admin:admin localhost:3000/api/datasources/uid/prometheus/health
```
- The dashboard `CleanAir Job` (uid `cleanair-job`) exists at `/d/cleanair-job/cleanair-job`.
- The Prometheus datasource health check returns: `"Successfully queried the Prometheus API."` (status `OK`).

## Manual check
Open http://localhost:3000/d/cleanair-job (admin/admin), run the job a few more times, and confirm that the graph and the stat panels update within about 5 seconds.

## Live code reload (2026-10-15)

`./fetcher/src` is now mounted into the `fetcher` container (see [DEVELOPMENT.md](DEVELOPMENT.md)).

```bash
docker compose up -d fetcher            # recreates the container with the mount
docker compose exec -T fetcher node src/job.js
```
Result: edits made on the host to `fetcher/src/job.js` (a changed log message, and `durationGauge.set(durationSeconds + 10)`) took effect on the next run without a rebuild. The built image still contains the original `Job finished in` text, so the new output had to come from the mounted file:
```
Dummy task sleeping for 1s
Job finishedddd in 1.005s (success=true)
Metrics pushed to http://pushgateway:9091
```
The Pushgateway received the edited value: `cleanair_job_duration_seconds{job="cleanair_job"} 11.004731939`. Its `push_time_seconds` matches this run, and no other process was pushing.

## Rename to `fetcher` (2026-10-15)

The `app/` folder and the Compose service `app` were both renamed to `fetcher`.

```bash
docker compose up -d --build --remove-orphans
docker compose exec -T fetcher node src/job.js
```
Result: the `cleanair-fetcher` image was built and the old `cleanair-app-1` container was removed. `fetcher` is running alongside `pushgateway`, `prometheus` and `grafana`, which kept running throughout. The mount is `/home/stan/projects/cleanair/fetcher/src -> /app/src`.
```
Dummy task sleeping for 2s
Job finished in 2.005s (success=true)
Metrics pushed to http://pushgateway:9091
```

## Container path `/app` → `/fetcher` (2026-10-15)

`WORKDIR` is now `/fetcher`, and the source is mounted at `/fetcher/src`.

```bash
docker compose up -d --build fetcher
docker compose exec -T fetcher sh -c 'pwd; ls'
docker compose exec -T fetcher node src/job.js
```
Result: the working directory is `/fetcher` (it contains `node_modules`, `package.json`, `package-lock.json` and `src`). The mount is `/home/stan/projects/cleanair/fetcher/src -> /fetcher/src`.
```
Dummy task sleeping for 3s
Job finished in 3.006s (success=true)
Metrics pushed to http://pushgateway:9091
```
The Pushgateway received `cleanair_job_duration_seconds 13.005661183`. The extra 10 seconds comes from `durationGauge.set(durationSeconds + 10)`, a test edit that is still in `job.js`, not from the path change.

## Known behaviour
- Each value can take up to one collection interval (5 seconds) to appear in Prometheus and Grafana.
- The Pushgateway keeps the last pushed value until the next run. The duration graph is therefore a series of flat steps, one per run.
