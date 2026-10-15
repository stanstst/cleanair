# Verification

Verification was run on 2026-10-15 on branch `01-fetch-data-from-openaq`, against [PLAN.md](PLAN.md).

The JSON report is printed to **stdout**. Status lines (API call count, duration, metrics push) go to **stderr**.

## 1. Pick up the new environment variable
```bash
docker compose up -d fetcher
```
Result: the container was recreated with `OPENAQ_API_KEY` taken from `.env`.

## 2. Unknown city (no API calls)
```bash
docker compose exec -T fetcher node src/job.js nowhere; echo "exit=$?"
```
```
{
  "error": "unknown city 'nowhere'"
}
Number of Api calls: 0
Job finished in 0.003s (success=false)
Metrics pushed to http://pushgateway:9091
exit=2
```
The Pushgateway showed `cleanair_job_last_success 0`.

## 3. Missing API key
```bash
docker compose exec -T -e OPENAQ_API_KEY= fetcher node src/job.js sofia; echo "exit=$?"
```
```
{
  "error": "OPENAQ_API_KEY is not set"
}
Job finished in 0.004s (success=false)
Metrics pushed to http://pushgateway:9091
exit=1
```

## 4. Single city, live
```bash
docker compose exec -T fetcher node src/job.js sofia
```
stderr:
```
Number of Api calls: 3
Job finished in 1.588s (success=true)
Metrics pushed to http://pushgateway:9091
```
stdout:
```json
{
  "pollutant": "pm25",
  "unit": "µg/m³",
  "period": { "from": "2026-10-14T11:00:00Z", "to": "2026-10-15T11:00:00Z" },
  "who_guideline": 15,
  "cleanest": "sofia",
  "ranking": [
    {
      "city": "sofia",
      "pm25_avg": 5.5,
      "who_ratio": 0.37,
      "within_who": true,
      "stations_used": 1,
      "stations": [
        { "location_id": 8846, "name": "AMS Kopitoto", "sensor_id": 6283928, "pm25_avg": 5.5, "hours": 19 },
        { "location_id": 8856, "name": "AMS Hipodruma-Sofia", "sensor_id": 1293779, "pm25_avg": null, "hours": 0 }
      ]
    }
  ],
  "no_data": [],
  "source": "OpenAQ v3 (reference monitors)"
}
```

## 5. Comparison with the PHP script
```bash
docker run --rm -v "$PWD/openaqtest.php:/t.php:ro" php:8.3-cli-alpine php /t.php sofia
```
The PHP script also reported `Number of Api calls: 3`. Its JSON output, with keys sorted, is **identical** to the Node output above: same period, stations, averages and WHO ratio.

## 6. All cities, live
```bash
docker compose exec -T fetcher node src/job.js
```
stderr:
```
Number of Api calls: 17
Job finished in 5.850s (success=true)
Metrics pushed to http://pushgateway:9091
```
Report summary:

| City | PM2.5 avg (µg/m³) | WHO ratio | Within WHO | Stations used |
|---|---|---|---|---|
| sofia | 5.5 | 0.37 | yes | 1/2 |
| varna | 6.6 | 0.44 | yes | 1/1 |
| ruse | 11.7 | 0.78 | yes | 1/1 |

- `cleanest`: `sofia`. The ranking is sorted ascending.
- `no_data`: plovdiv, burgas, stara-zagora, pleven, vidin, shumen, pernik.
- Pushgateway: `cleanair_job_duration_seconds 5.849829137`, `cleanair_job_last_success 1`.

## 7. API call count as a Prometheus gauge
The `Number of Api calls` log line was replaced with the gauge `cleanair_job_api_calls`, which is shown on two new dashboard panels.

```bash
docker compose restart fetcher grafana
docker compose exec -T fetcher node src/job.js sofia
curl -s localhost:9091/metrics | grep '^cleanair_job_api_calls'
docker compose exec -T fetcher node src/job.js nowhere
curl -s localhost:9091/metrics | grep '^cleanair_job_api_calls'
```
- `sofia`: stderr shows only `Job finished in 1.783s (success=true)`, with no call-count line. The Pushgateway shows `cleanair_job_api_calls 3`.
- `nowhere`: exit code 2, and the Pushgateway shows `cleanair_job_api_calls 0`.
- Prometheus: the `cleanair_job_api_calls` query returns `"3"` after another Sofia run.
- Grafana: the logs show `finished to provision dashboards` with no dashboard errors. The provisioned file inside the container contains the new query. The dashboard has the panels Last duration, Last run, Last status, **API calls (last run)**, Job execution time, and **API calls per run**.
- I could not check the Grafana API with `admin/admin`, because the admin password has since been changed.

## Notes
- **API quota:** a full run made 17 API calls, of which a single city took 3. Fetches run one after another, with at most 3 locations per city (`maxLocationsPerCity`).
- **Secrets:** the key is only in `.env`, which git ignores. `.env.example` is the committed template.
