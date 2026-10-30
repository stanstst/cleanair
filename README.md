# Clean Air Finder

The answer is based on real public measurements of three pollutants: **PM2.5, PM10 and CO**.

---

## Business domain assumptions

The three pollutants can't be compared directly. For example, 20 µg/m³ of PM2.5 is far more harmful than 20 µg/m³ of CO. So the ranking works in three steps: aggregate, normalize, combine.

### 1. Aggregate measurements for the selected period

For each city, the measurements for each pollutant are reduced to one value over the selected period: the **mean of daily means**.

**Multiple stations:** if a city has more than one station, the station values are averaged for each pollutant.

### 2. Normalize each pollutant to a ratio

Each aggregated value is divided by its reference limit:

```
ratio = measured_value / reference_limit
```

| Ratio | Meaning |
|---|---|
| `< 1` | Below the limit (good) |
| `= 1` | At the limit |
| `> 1` | Exceeds the limit |

**Reference limits** 

| Pollutant | Limit |
|-----------|-------|
| PM2.5     | 15    |
| PM10      | 45    |
| CO        | 4000  |

### 3. Combine the ratios into a city score

Each city gets two scores. Both are calculated per day, then averaged over the selected period:

- **Max ratio (primary):** the ratio of the worst pollutant.
  ```
  daily max_ratio  = max(ratio_PM25, ratio_PM10, ratio_CO)   (available pollutants only)
  period max_ratio = average of the daily max_ratio values
  ```
- **Mean ratio (tie-breaker):** the average of the ratios of the available pollutants.
  ```
  daily mean_ratio  = sum(available ratios) / number of available pollutants
  period mean_ratio = average of the daily mean_ratio values
  ```

Averaging the daily max values keeps a bad day for any pollutant in the score, even when a different pollutant is the worst on other days.

**Ranking rule:**

1. Cities are sorted by `max_ratio`, lowest first.
2. If two cities have the same `max_ratio`, the one with the lower `mean_ratio` ranks higher.
3. The first city in the list has the cleanest air.

**Why max first?** It follows the logic of official air quality indices such as the US AQI and the European AQI: air is only as clean as its worst pollutant. A city with one pollutant at three times the limit is not "clean" just because its other pollutants are low. The mean only breaks ties, so it can never override the max.

---

## Data quality rules

| Rule | Behaviour                                                                                                                                                      |
|---|----------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Missing pollutant** | Not counted. It is **never treated as 0**, because that would make the city look cleaner than it is. Scores are calculated from the available pollutants only. |
| **Minimum required data** | A city is ranked only if it has data for at least one pollutant.                                                                                               |
| **Invalid values** | Negative values and missing values are discarded before aggregation.                                                                                           |

---

## Example

Selected period: 1–31 January

| City | PM2.5 | PM10 | CO   | Max ratio | Mean ratio |
|---|---|---|-----|---|----------|
| Varna | 1.2 | 0.9 | 0.8 | **1.2** | 0.97     |
| Burgas | 1.2 | 1.1 | 0.4 | **1.2** | 0.90     |
| Sofia | 2.1 | 1.6 | 1.4 | 2.1 | 1.70     |
| Smolyan | — | 0.7 | —   | 0.7 | 0.70    |

**Result:**

1. **Smolyan:** max ratio 0.7.
2. **Burgas:** max ratio 1.2. Wins the tie with Varna because its mean ratio is lower (0.90 vs 0.97).
3. **Varna:** max ratio 1.2.
4. **Sofia:** max ratio 2.1.

---

## Configuration
The reference limits are set in `fetcher/src/openaq/config.js`, in `recommendedGuideline` (µg/m³) for each pollutant:

 ```js
 POLLUTANTS: {
   pm25: { parameterId: 2, unit: 'µg/m³', recommendedGuideline: 15 },
   pm10: { parameterId: 1, unit: 'µg/m³', recommendedGuideline: 45 },
   co: { parameterId: 4, unit: 'µg/m³', recommendedGuideline: 4000 },
 }
 ```
---

---

## Running the jobs and processes

### Start all the containers

```bash
docker compose up -d
```

### Run the `fetcher` process:
Fetches the last 24h, or the day ending at `--date-to`
on PROD Must be scheduled at the very end of the day after 23 o'clock

```bash
docker compose exec fetcher node src/job.js
docker compose exec fetcher node src/job.js --city sofia --date-to 2026-10-14
```
### Run the `backfill` process:
Fills a date range (`DD-MM-YYYY`, inclusive).
```bash

docker compose exec fetcher node src/job-backfill.js --start-date 11-10-2026 --end-date 15-10-2026
```

### Archiving old records process

The `archiver` service moves `air_quality` rows whose `target_date` is older than `--months` (default 36) into CSV files and deletes them from the table. It writes one file per target date, `<target_date>-archive.csv`, and uploads it to the `fileserver` service ([dufs](https://github.com/sigoden/dufs)).

```bash
docker compose exec archiver node src/job.js
docker compose exec archiver node src/job.js --months 12
```
To view the archives, open http://localhost:5000. No login is needed to view or download them. The files are stored on the host in `./.tmp/archive-files`, and only the `ARCHIVE_USER` / `ARCHIVE_PASSWORD` account (default `archiver`/`archiver`, set in `.env`) can upload.

### Populating dummy data

The `dummy-dev-populator` service fills `air_quality` with random records for `sofia`, `ruse` and `varna`: one row per city for every day from `--date-from` (`DD-MM-YYYY`) to today. It makes no API calls. Rows that already exist for a `(city, target_date)` are kept as they are, so re-running it is safe.

```bash
docker compose exec dummy-dev-populator node src/job.js --date-from 01-10-2026
```

### API and UI

The `api` service serves `GET /cleanest-city` and a web page with a date picker. For each city it averages the daily `max_ratio` and `mean_ratio` over the selected period (both dates inclusive, `YYYY-MM-DD`). It returns the city with the lowest average max, using the lower average mean to break a tie.
UI URL localhost:8080

```bash

curl 'http://localhost:8080/cleanest-city?date-from=2025-10-06&date-to=2026-10-06'
```

```json
{ "city": "ruse", "period_max_polution": 2.219375, "period_mean_polution": 1.492708 }
```

## Grafana URL http://localhost:3000/d/cleanair-job

* Fetcher last duration
* Fetcher last run
* Fetcher Last status
* Fetcher API calls (last run)
* ![Screenshot From 2026-10-19 15-18-34.png](docs/screenshots/Screenshot%20From%202026-10-19%2015-18-34.png)

* API Endpoint cleanest-city requests per minute
* API Endpoint cleanest-city average response time
* API Endpoint cleanest-city failed requests per hour
* API Endpoint cleanest-city last failed request
![Screenshot From 2026-10-19 15-22-46.png](docs/screenshots/Screenshot%20From%202026-10-19%2015-22-46.png)

* Archiver last run
* Archiver last status
![Screenshot From 2026-10-19 15-19-36.png](docs/screenshots/Screenshot%20From%202026-10-19%2015-19-36.png)

## Production Deployment Guidelines

| Service             | Kubernetes workload                                                                             |
|---------------------|-------------------------------------------------------------------------------------------------|
| `api`               | Deployment + Service                                                                            |
| `fetcher`           | CronJob (`job.js` as entry point) Must be scheduled at the very end of the day after 23 o'clock |
| `fetcher-backfill`  | Job                                                                                             |
| `archiver`          | CronJob                                                                                         |
| `migrate` (flyway)  | Job (Helm pre-install/pre-upgrade hook or initContainer)                                        |
| `mysql`             | StatefulSet + PVC + headless Service                                                            |
| `fileserver` (dufs) | StatefulSet (1 replica) + PVC                                                                   |
| `pushgateway`       | Deployment (1 replica) + Service                                                                |
| `prometheus`        | StatefulSet + PVC                                                                               |
| `grafana`           | Deployment (1 replica)                                                                          |

## Deployment to local minikube

Plain Kubernetes manifests in `deploy/k8s/` (a kustomize base), applied with `kubectl apply -k` (no Helm), in the namespace `cleanair`.
Needs minikube (docker driver) and `.env` in the project root. Without a `kubectl` binary the scripts use `minikube kubectl --`.

### Deploy or update
Builds the `api`, `fetcher` and `archiver` images, loads them into minikube, creates the secrets and config from `.env`, `mysql/migrations`, `prometheus/` and `grafana/provisioning`, and applies the manifests.
```bash
./deploy/local-deploy.sh
kubectl get pods -n cleanair
```

### Open the services
```bash
kubectl port-forward -n cleanair svc/api 8080:8080         # UI and API http://localhost:8080
kubectl port-forward -n cleanair svc/grafana 3000:3000     # http://localhost:3000/d/cleanair-job
kubectl port-forward -n cleanair svc/prometheus 9090:9090
kubectl port-forward -n cleanair svc/fileserver 5000:5000  # archived CSV files
kubectl port-forward -n cleanair pod/mysql-0 3307:3306     # MySQL on 127.0.0.1:3307, credentials from .env
```

### Run the jobs on demand
`fetcher` is a CronJob that runs every day at 23:00 (UTC), `archiver` a CronJob that runs every day at 22:00 (UTC), so they do not overlap.
```bash
kubectl create job -n cleanair --from=cronjob/fetcher fetcher-manual
kubectl create job -n cleanair --from=cronjob/archiver archiver-manual
./deploy/run-backfill.sh 26-10-2026 28-10-2026   # start and end date, DD-MM-YYYY, optional 3rd argument: kubectl context
kubectl logs -n cleanair job/fetcher-manual
```

### Delete
Deletes the namespace with all data.
```bash
kubectl delete -k deploy/k8s
```

## Deployment to DigitalOcean (DOKS)

Cluster `k8s-1-37-0-do-2-fra1-1793344160927` in `fra1`, 1 node `s-1vcpu-2gb`, kubectl context `do-fra1-k8s-1-37-0-do-2-fra1-1793344160927`.
Uses the same manifests through the kustomize overlay `deploy/doks`: images from the registry `registry.digitalocean.com/cleanair` (free Starter plan, 1 repository `cleanair` with tags `api-<sha>`, `fetcher-<sha>`, `archiver-<sha>`), NodePort Services for the public services, no load balancer.
Needs `doctl` (logged in with `doctl auth init`), `jq`, and in `.env`: `MYSQL_ROOT_PASSWORD`, `GRAFANA_ADMIN_PASSWORD` (not `admin`) and `ARCHIVE_PASSWORD` (not `archiver`).

### Deploy or update
Builds and pushes the 3 images tagged with the git short sha, creates the secrets, config and registry pull secret, applies the overlay, opens the 3 NodePorts in the cloud firewall `cleanair-nodeports`, keeps the 2 newest image tags per app and starts the registry garbage collection.
```bash
./deploy/doks-deploy.sh            # prints the 3 public URLs
kubectl --context do-fra1-k8s-1-37-0-do-2-fra1-1793344160927 get pods -n cleanair
```

### Open the services
Public on the node IP (`kubectl get nodes -o wide`, EXTERNAL-IP), plain http, no TLS:
* UI and API `http://<node ip>:30080/`
* Grafana `http://<node ip>:30300/`, login `admin` / `GRAFANA_ADMIN_PASSWORD`
* Fileserver `http://<node ip>:30500/`, login `ARCHIVE_USER` / `ARCHIVE_PASSWORD`

Not public, through port-forward:
```bash
kubectl --context do-fra1-k8s-1-37-0-do-2-fra1-1793344160927 port-forward -n cleanair svc/prometheus 9090:9090
kubectl --context do-fra1-k8s-1-37-0-do-2-fra1-1793344160927 port-forward -n cleanair pod/mysql-0 3307:3306
```

### Run the jobs on demand
```bash
kubectl --context do-fra1-k8s-1-37-0-do-2-fra1-1793344160927 create job -n cleanair --from=cronjob/fetcher fetcher-manual
kubectl --context do-fra1-k8s-1-37-0-do-2-fra1-1793344160927 create job -n cleanair --from=cronjob/archiver archiver-manual
./deploy/run-backfill.sh 26-10-2026 28-10-2026 do-fra1-k8s-1-37-0-do-2-fra1-1793344160927
```
The backfill does not push metrics to Grafana and logs only when it is finished. Follow its progress with the rows per date in MySQL:
```bash
kubectl --context do-fra1-k8s-1-37-0-do-2-fra1-1793344160927 -n cleanair exec mysql-0 -- sh -c 'mysql -N -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE" -e "select target_date, count(*) from air_quality group by target_date"'
```

### Delete
Deletes the namespace with all data and the 3 volumes.
```bash
kubectl --context do-fra1-k8s-1-37-0-do-2-fra1-1793344160927 delete -k deploy/doks
```

### Change the node size
Pods move to the new node by themselves, no redeploy. The node IP changes, the firewall follows the cluster tag.
```bash
doctl kubernetes cluster node-pool create 145fd87c-f614-4046-86fd-ccc223d11558 --name pool-2vcpu --size s-2vcpu-4gb --count 1
kubectl get nodes      # wait until the new node is Ready
doctl kubernetes cluster node-pool delete 145fd87c-f614-4046-86fd-ccc223d11558 pool-yjo6nqeqv
```

## Processes Diagram

```
                        ┌──────────────────┐
                        │   OpenAQ API     │  (external)
                        └────────▲─────────┘
                                 │ GET /locations, /sensors/{id}/hours
                                 │ (X-API-Key)
┌─────────────┐         ┌────────┴─────────┐
│   Browser   │         │     FETCHER      │  src/job.js  (CronJob)
│   (UI)      │         │  fetch last 24h, │  src/job-backfill.js (Job)
└──────┬──────┘         │  compute ratios  │
       │                └───┬──────────┬───┘
       │ GET /                 │ INSERT   │ push: duration, last run,
       │ GET /cleanest-city    │          │       status, API calls
       ▼  ?date-from&date-to   ▼          │
┌─────────────┐        ┌─────────────┐    │
│     API     │ SELECT │    MySQL    │    │
│  Express    ├───────►│ air_quality │    │
│  :8080      │        └──────▲──────┘    │
│  /metrics   │               │ SELECT    │
└──────▲──────┘               │ older than│
       │                      │ --months, │
       │               ┌──────┴──────┐ DELETE
       │               │  ARCHIVER   │    │
       │               │ src/job.js  │    │   (CronJob)
       │               │ 1 CSV per   │    │
       │               │ target_date │    │
       │               └──┬───────┬──┘    │
       │   PUT CSV (auth) │       │ push: │
       │                  ▼       │ last run, status
       │         ┌──────────────┐ │       │
       │         │  fileserver  │ │       │
       │         │  (dufs)      │ │       │
       │         │  :5000       │ │       │
       │         └──────────────┘ ▼       ▼
       │                     ┌───────────────┐
       │ scrape /metrics     │  Pushgateway  │
       │ every 5s            │    :9091      │
       │                     └───────▲───────┘
       │                             │ scrape every 5s
       │      ┌──────────────────────┴┐
       └──────┤      Prometheus       │
              │        :9090          │
              └───────────▲───────────┘
                          │ PromQL
              ┌───────────┴───────────┐
              │        Grafana        │  "CleanAir Job" dashboard
              │        :3000          │
              └───────────────────────┘
```

### How it flows

- **Fetcher**:
  - Pulls hourly sensor data for each city from OpenAQ.
  - Saves one `air_quality` row per city per day in MySQL.
  - Pushes run metrics to the Pushgateway, because it's a short job that exits before Prometheus could collect from it directly.
- **API**:
  - Serves the UI and `GET /cleanest-city`, which reads `air_quality` to find the city with the lowest pollution for the date range.
  - Exposes its own `/metrics`: request count, response time and last failure. Prometheus pulls these directly because the API is always running.
- **Archiver**:
  - Selects rows older than `--months` (default 36).
  - Uploads one CSV per `target_date` to the dufs fileserver, then deletes those rows from MySQL.
  - Pushes its last run time and status to the Pushgateway.
- **Monitoring**: Prometheus collects from the Pushgateway and the API every 5s, and Grafana charts it all on the CleanAir Job dashboard.


## Running tests

The tests run inside the service images, with no network access, against an in-memory SQLite database and the captured OpenAQ responses in `fetcher/test/fixtures`. Build the images first, and rebuild them after changing a `package.json`:

```bash
docker compose build fetcher archiver api
```

### Feature tests

```bash
fetcher/test/test-feature.sh
archiver/test/test-feature.sh
api/test/test-feature.sh
```

### Fetcher unit tests

```bash
docker run --rm --network none \
  -v "$PWD/fetcher/package.json:/fetcher/package.json:ro" \
  -v "$PWD/fetcher/src:/fetcher/src:ro" \
  -v "$PWD/fetcher/test:/fetcher/test:ro" \
  cleanair-fetcher node --test 'test/unit/**/*.test.js'
```
