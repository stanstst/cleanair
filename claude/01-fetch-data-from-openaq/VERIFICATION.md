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

## 8. Slimmer output: no `cleanest`, no `stations`
`cleanest` was removed from the report (by the user), and `stations` was removed from each city entry. The WHO fields and the report-level fields are kept.

```bash
docker compose exec -T fetcher node src/job.js sofia
```
```json
{
  "pollutant": "pm25",
  "unit": "µg/m³",
  "period": { "from": "2026-10-14T12:00:00Z", "to": "2026-10-15T12:00:00Z" },
  "who_guideline": 15,
  "ranking": [
    { "city": "sofia", "pm25_avg": 5.5, "who_ratio": 0.37, "within_who": true, "stations_used": 1 }
  ],
  "no_data": [],
  "source": "OpenAQ v3 (reference monitors)"
}
```
- `pm25_avg` is unchanged (5.5), and the exit code is 0.
- The Pushgateway shows `cleanair_job_api_calls 3` and `cleanair_job_last_success 1`.

## 9. Renamed "who" to "recommended"
The names were changed as follows; the values and the logic are the same:

| Old | New |
|---|---|
| `WHO_PM25_24H` | `RECOMMENDED_PM25_24H` |
| `who_guideline` | `recommended_guideline` |
| `who_ratio` | `recommended_ratio` |
| `within_who` | `within_recommended` |

```bash
docker compose exec -T fetcher node src/job.js sofia
```
```json
{
  "pollutant": "pm25",
  "unit": "µg/m³",
  "period": { "from": "2026-10-14T13:00:00Z", "to": "2026-10-15T13:00:00Z" },
  "recommended_guideline": 15,
  "ranking": [
    { "city": "sofia", "pm25_avg": 5.5, "recommended_ratio": 0.37, "within_recommended": true, "stations_used": 1 }
  ],
  "no_data": [],
  "source": "OpenAQ v3 (reference monitors)"
}
```
- The exit code is 0, and the Pushgateway shows `cleanair_job_last_success 1`.
- The only remaining "WHO" in `fetcher/src` is in the user's comment on `Pm25Ingestion.js:26`.

## 10. Optional `--date-to` (a past day)
`Pm25Ingestion.run(cityArg, dateTo)` and `node src/job.js [city] [--date-to <date>]`. `timeWindow()` is unchanged, including `from = to - 24h`, as `git diff` confirms.

Error cases (no API calls):

| Command | Output | Exit |
|---|---|---|
| `--date-to nonsense` | `invalid date-to 'nonsense'` | 2 |
| `sofia --date-to 2030-01-01` | `invalid date-to '2030-01-01' is in the future` | 2 |
| `--bogus` | `Unknown option '--bogus'. …` | 2 |
| `sofia varna` | `unexpected arguments: varna` | 2 |

Live runs for Sofia:

| Command | Period | pm25_avg | Stations used |
|---|---|---|---|
| `sofia` | `2026-10-14T15:00:00Z` → `2026-10-15T15:00:00Z` | 5.4 | 1 |
| `sofia --date-to 2026-10-14` | `2026-10-13T00:00:00Z` → `2026-10-14T00:00:00Z` | 11.1 | 2 |
| `sofia --date-to 2026-10-14T06:30:00Z` | `2026-10-13T06:00:00Z` → `2026-10-14T06:00:00Z` | 10.1 | 2 |

- With no date, the window still ends at the current UTC hour. A date-only value covers the full previous UTC day, and a time is truncated to the hour.
- The Pushgateway shows `cleanair_job_api_calls 3` and `cleanair_job_last_success 1` after the last run.
- I did not compare this with PHP, because `openaqtest.php` has no date parameter.

## 11. City as a named option: `--city`
The CLI is now `node src/job.js [--city <name>] [--date-to <date>]`. `parseArgs` no longer accepts positional arguments, so the `positionals` handling and the `UsageError` class were removed from `job.js`.

Usage errors (no API calls):

| Command | Output | Exit |
|---|---|---|
| `sofia` | `Unexpected argument 'sofia'. This command does not take positional arguments` | 2 |
| `--city nowhere` | `unknown city 'nowhere'` | 2 |
| `--city` | `Option '--city <value>' argument missing` | 2 |
| `--bogus` | `Unknown option '--bogus'` | 2 |

Live runs:

| Command | Period | pm25_avg | Exit |
|---|---|---|---|
| `--city sofia` | `2026-10-14T15:00:00Z` → `2026-10-15T15:00:00Z` | 5.4 | 0 |
| `--city sofia --date-to 2026-10-14` | `2026-10-13T00:00:00Z` → `2026-10-14T00:00:00Z` | 11.1 | 0 |
| `--city SOFIA` | `2026-10-14T15:00:00Z` → `2026-10-15T15:00:00Z` | 5.4 | 0 |

The results match section 10, which used the old positional form.

## 12. MySQL storage (`air_quality`, Flyway)
```bash
docker compose up -d --build
docker compose logs migrate
docker compose run --rm migrate
```
- `mysql` became healthy. `migrate` exited with code 0 and logged `Successfully applied 1 migration to schema cleanair, now at version v1`.
- Running it again logged `Schema cleanair is up to date. No migration necessary.`

**First run failed, then fixed.** `--city sofia --date-to 2026-10-14` failed with `Column 'average_value' cannot be null`. The per-city field had been renamed from `pm25_avg` to `avg` (commit `55ba875`). Two places were updated to match:
- `AirQualityRepository` now reads `c.avg`.
- `Pm25Ingestion.run()` now filters on `r.avg`. It had still filtered on `r.pm25_avg`, which was always `undefined`, so cities without data would have ended up in `cities` with `avg: null` and `no_data` would always have been empty.

After the fix:

| Step | Result |
|---|---|
| `--city sofia --date-to 2026-10-14` | Exit 0. Row `1 \| sofia \| pm25 \| 11.1 \| µg/m³ \| 2026-10-14 \| 2026-10-15 17:01:01 \| 15.0 \| 0.74` |
| Same command again | Still one row, with the same `id` 1 and `created_at`. The upsert works. |
| `--city sofia` (no date) | New row with `target_date` 2026-10-15 and value 5.3. Its id is 3, because InnoDB uses up an auto-increment value on every `INSERT … ON DUPLICATE KEY UPDATE`; that's normal. |
| `unit` stored bytes | `HEX(unit)` = `C2B5672F6DC2B3`, which is correct UTF-8 for `µg/m³`. Use `--default-character-set=utf8mb4` in the `mysql` client to display it. |
| `docker compose stop mysql`, then run | `{"error": "getaddrinfo ENOTFOUND mysql"}`, exit 1, `cleanair_job_last_success 0`. MySQL restarted healthy afterwards. |
| `docker compose down` / `up -d` | Rows kept (the `mysql-data` volume), and `migrate` reported up to date. |
| All cities (3 configured: sofia, ruse, varna) | Saved sofia 5.3 (the existing row was updated), ruse 12.3 and varna 6.7, all for 2026-10-15. `no_data` is empty. |

## 13. Fixed MySQL passwords (`cleanair` / `root`)
The generated passwords were replaced with `MYSQL_PASSWORD=cleanair` and `MYSQL_ROOT_PASSWORD=root` in `.env` and `.env.example`. The volume already existed, so the accounts were changed first, as root, using the old root password:
```sql
ALTER USER 'cleanair'@'%' IDENTIFIED BY 'cleanair';
ALTER USER 'root'@'%' IDENTIFIED BY 'root';
ALTER USER 'root'@'localhost' IDENTIFIED BY 'root';
```
Then `docker compose up -d` recreated `mysql`, `migrate` and `fetcher`.

| Check | Result |
|---|---|
| `docker compose ps` | `mysql` healthy (the healthcheck uses the new password), `migrate` exited 0 with `Schema cleanair is up to date`, `fetcher` up |
| `mysql -ucleanair -pcleanair cleanair` | `SELECT COUNT(*) FROM air_quality` → 4, so no data was lost |
| `mysql -uroot -proot` | Works |
| Old `cleanair` password | `ERROR 1045 (28000): Access denied` |
| `node src/job.js --city sofia` | Exit 0. Today's Sofia row (id 3) was updated in place; the rows are unchanged. |

## 14. `target_date` via a Date object
`AirQualityRepository.saveReport()` changed from `report.period.to.slice(0, 10)` to `new Date(report.period.to).toISOString().split('T')[0]`.

| Command | Result |
|---|---|
| `--city sofia --date-to 2026-10-14` | Exit 0. Row 1 (`2026-10-14`) was updated in place, with the same `id` and `created_at`. |
| `--city sofia` | Exit 0. Row 3 (`2026-10-15`) was updated in place. |
| `SELECT COUNT(*) FROM air_quality` | Still 4, so no new rows. The new formatting produces exactly the same dates as before. |

## Notes
- **API quota:** a full run made 17 API calls, of which a single city took 3. Fetches run one after another, with at most 3 locations per city (`maxLocationsPerCity`).
- **Secrets:** the key is only in `.env`, which git ignores. `.env.example` is the committed template.
