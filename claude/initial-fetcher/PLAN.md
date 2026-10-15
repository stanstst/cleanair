# Containerized Node.js job with Prometheus + Grafana metrics

> To learn how to apply changes (job.js, dependencies, config), see [DEVELOPMENT.md](DEVELOPMENT.md).

## Context
`/home/stan/projects/cleanair` is empty. We need a Node.js script that will later run as a cron job. For now it's a dummy that sleeps randomly 1, 2 or 3 seconds. Each run must record its execution time (seconds) in Prometheus and show it in Grafana. All services run via Docker Compose, and for now the script is triggered manually from inside the Node container.

**Key design point:** a short-lived script exits before Prometheus can scrape it, so it pushes its metrics to a **Prometheus Pushgateway**, and Prometheus scrapes the Pushgateway. This is the standard pattern for batch and cron jobs, and it will still work once a real cron triggers the job.

## Files to create

```
cleanair/
├── docker-compose.yml
├── fetcher/
│   ├── Dockerfile
│   ├── package.json          # dep: prom-client
│   ├── .dockerignore
│   └── src/job.js
├── prometheus/prometheus.yml
└── grafana/provisioning/
    ├── datasources/prometheus.yml
    └── dashboards/
        ├── dashboards.yml
        └── cleanair-job.json
```

### `fetcher/src/job.js`
- `dummyTask()`: picks a random value from [1, 2, 3] and awaits `setTimeout` for that many seconds.
- Times the run with `process.hrtime.bigint()` and converts to seconds.
- Uses a fresh `prom-client` `Registry` (no default process metrics) with these gauges:
  - `cleanair_job_duration_seconds`: duration of the last run
  - `cleanair_job_last_run_timestamp_seconds`: when the run finished
  - `cleanair_job_last_success`: 1 or 0 (the job sets it in try/catch, so failures get reported too)
- Pushes with `new Pushgateway(PUSHGATEWAY_URL, {}, registry).pushAdd({ jobName: 'cleanair_job' })`. The URL comes from env, defaulting to `http://pushgateway:9091`.
- Logs the duration, and exits non-zero on failure.

### `fetcher/Dockerfile`
`node:22-alpine`, `WORKDIR /fetcher`, copy `package*.json`, `npm install --omit=dev`, copy `src`, default `CMD ["node", "src/job.js"]`.

### `docker-compose.yml`
- **fetcher**: built from `./fetcher`. It sets `command: ["sleep", "infinity"]` so the container stays up and the job can be run on demand with `exec`. It has `PUSHGATEWAY_URL` set and `depends_on: pushgateway`. Later a cron entry (host crontab, or a cron inside the container) can call the same command.
- **pushgateway**: `prom/pushgateway:v1.11.1`, port 9091
- **prometheus**: `prom/prometheus:v3.5.0`, port 9090. It mounts `prometheus.yml` and uses a named volume for data.
- **grafana**: `grafana/grafana:12.1.0`, port 3000. It mounts the provisioning dir, uses a named volume for data, and logs in as admin/admin (set via env).

### `prometheus/prometheus.yml`
`scrape_interval: 5s`, with one scrape job `pushgateway` → `pushgateway:9091` and `honor_labels: true` (this keeps the `job="cleanair_job"` label).

### Grafana provisioning
- The datasource is Prometheus at `http://prometheus:9090` with a fixed `uid: prometheus`, set as the default.
- The dashboard provider loads JSON from `/etc/grafana/provisioning/dashboards`.
- Dashboard "CleanAir Job" has these panels:
  - Time series: `cleanair_job_duration_seconds` (unit: seconds)
  - Stat: last duration
  - Stat: last run time (`cleanair_job_last_run_timestamp_seconds * 1000`, shown as a date/time)
  - Stat: last success (shown as OK/FAILED)
  - Refresh is 5s and the default range is the last 30 minutes.

Note: the Pushgateway keeps the last pushed value. Prometheus therefore re-scrapes the same duration until the next run, so the time series is a step graph where each step is one run.

## Verification
1. `docker compose up -d --build`, then check that `docker compose ps` shows all 4 services up.
2. Run the job a few times: `docker compose exec fetcher node src/job.js`. It should log a duration of about 1, 2 or 3 seconds.
3. Pushgateway: `curl -s localhost:9091/metrics | grep cleanair_job` shows the values.
4. Prometheus: `curl -s 'localhost:9090/api/v1/query?query=cleanair_job_duration_seconds'` returns the value.
5. Grafana: open http://localhost:3000 (admin/admin) → dashboard "CleanAir Job" shows the duration panel updating after each run.
