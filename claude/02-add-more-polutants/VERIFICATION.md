# Verification

Verification was run on 2026-10-16 against [PLAN.md](PLAN.md), starting from commit `6221bc3`. Nothing is committed, and `claude/01-fetch-data-from-openaq/` and `claude/initial-fetcher/` are unchanged.

## 0. Pollutant availability (before implementing)
A `/locations` query for Sofia, Ruse and Varna (radius 15 km, monitors only) showed `pm25` (id 2), `pm10` (id 1) and `co` (id 4). They are all reported in **µg/m³**.

## 1. V2 migration (final layout, after the MySQL-only reset)
The first version of V2 (an in-place `ALTER`, with a single `unit` column and `*_recommended` columns) was replaced by a drop and recreate. Losing the data was accepted, so only the MySQL volume was reset:
```bash
docker compose stop fetcher migrate mysql
docker compose rm -f fetcher migrate mysql
docker volume rm cleanair_mysql-data
docker compose up -d
```
- `migrate` logged `Successfully applied 2 migrations to schema cleanair, now at version v2`, and `mysql` was healthy.
- `cleanair_grafana-data` and `cleanair_prometheus-data` still exist, and Grafana, Prometheus and Pushgateway kept running.

`SHOW CREATE TABLE air_quality` lists, in order:
```
id, city, target_date, pm25_average, pm25_unit, pm25_ratio, pm10_average, pm10_unit, pm10_ratio, co_average, co_unit, co_ratio, created_at
UNIQUE KEY uq_city_date (city, target_date)
```

## 2. Code checks
- In the container, `src/openaq` contains `AirQualityIngestion.js`, `ApiClient.js` and `config.js`. `Pm25Ingestion.js` is gone, and the new code is visible (no stale mount).
- `grep -rn "Pm25\|PM25_PARAM_ID\|RECOMMENDED_PM25_24H\|pm25_avg\|average_value" fetcher/src` finds nothing.

## 3. Sofia, past day
```bash
docker compose exec -T fetcher node src/job.js --city sofia --date-to 2026-10-14
```
```json
{
  "period": { "from": "2026-10-13T00:00:00Z", "to": "2026-10-14T00:00:00Z" },
  "cities": [
    { "city": "sofia", "pollutants": [
      { "pollutant": "pm25", "unit": "µg/m³", "avg": 11.1, "recommended_guideline": 15, "recommended_ratio": 0.74, "within_recommended": true, "stations_used": 2 },
      { "pollutant": "pm10", "unit": "µg/m³", "avg": 12.4, "recommended_guideline": 45, "recommended_ratio": 0.28, "within_recommended": true, "stations_used": 2 },
      { "pollutant": "co", "unit": "µg/m³", "avg": 519.8, "recommended_guideline": 4000, "recommended_ratio": 0.13, "within_recommended": true, "stations_used": 3 }
    ] }
  ],
  "no_data": [],
  "source": "OpenAQ v3 (reference monitors)"
}
```
- The exit code is 0, `cleanair_job_api_calls` is 11 and `cleanair_job_last_success` is 1.
- **pm25 = 11.1 from 2 stations, the same as before the change.**
- After the reset this created row 1:

| id | city | target_date | pm25_average | pm25_unit | pm25_ratio | pm10_average | pm10_unit | pm10_ratio | co_average | co_unit | co_ratio | created_at |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | sofia | 2026-10-14 | 11.1 | µg/m³ | 0.74 | 12.4 | µg/m³ | 0.28 | 519.8 | µg/m³ | 0.13 | 2026-10-16 10:19:22 |

- Running the same command again left a single row with the same `id` (1) and `created_at`, so the upsert works.

## 4. All cities (sofia, ruse, varna), last 24h
```bash
docker compose exec -T fetcher node src/job.js
```
The exit code is 0, with **29 API calls** and `cleanair_job_last_success 1`.

| id | city | target_date | pm25_average | pm25_unit | pm25_ratio | pm10_average | pm10_unit | pm10_ratio | co_average | co_unit | co_ratio | created_at |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | sofia | 2026-10-14 | 11.1 | µg/m³ | 0.74 | 12.4 | µg/m³ | 0.28 | 519.8 | µg/m³ | 0.13 | 2026-10-16 10:19:22 |
| 3 | sofia | 2026-10-16 | 5.1 | µg/m³ | 0.34 | 17.6 | µg/m³ | 0.39 | 537.4 | µg/m³ | 0.13 | 2026-10-16 10:19:42 |
| 4 | ruse | 2026-10-16 | 12.6 | µg/m³ | 0.84 | 16.6 | µg/m³ | 0.37 | 345.0 | µg/m³ | 0.09 | 2026-10-16 10:19:42 |
| 5 | varna | 2026-10-16 | 7.1 | µg/m³ | 0.47 | 11.8 | µg/m³ | 0.26 | 436.8 | µg/m³ | 0.11 | 2026-10-16 10:19:42 |

There is one row per city per day. Id 2 was skipped because the repeated Sofia run in section 3 used up an auto-increment value on `ON DUPLICATE KEY UPDATE`; that's normal for InnoDB.

The error paths in section 5 were checked before the layout change. The repository change doesn't affect them, since they fail before or at the connection.

## 5. Error paths
| Check | Result |
|---|---|
| `--city nowhere` | Exit 2 |
| `docker compose stop mysql`, then `--city varna` | `{"error": "getaddrinfo ENOTFOUND mysql"}`, exit 1. MySQL restarted healthy afterwards. |

## 6. Untouched docs
`git status --short claude/01-fetch-data-from-openaq claude/initial-fetcher` shows no changes.

## 7. Mean and max ratio (V3)
```bash
docker compose run --rm migrate
```
- `migrate` logged `Successfully applied 1 migration to schema cleanair, now at version v3`.
- `SELECT COUNT(*) FROM air_quality` returned 0, so the existing rows were deleted.
- `SHOW CREATE TABLE` shows `mean_ratio decimal(8,2) NOT NULL` and `max_ratio decimal(8,2) NOT NULL` right after `target_date`.
- The container sees the new repository (`grep -c mean_ratio` returns 2).

| Command | Result |
|---|---|
| `--city sofia --date-to 2026-10-14` | Exit 0. Row 6: ratios 0.74 / 0.28 / 0.13, `mean_ratio` **0.38**, `max_ratio` **0.74** |
| Same command again | Still one row, with the same `id` (6) and `created_at`. Exit 0. |
| All cities | Exit 0 |

| id | city | target_date | mean_ratio | max_ratio | pm25_ratio | pm10_ratio | co_ratio |
|---|---|---|---|---|---|---|---|
| 6 | sofia | 2026-10-14 | 0.38 | 0.74 | 0.74 | 0.28 | 0.13 |
| 8 | sofia | 2026-10-16 | 0.29 | 0.40 | 0.34 | 0.40 | 0.13 |
| 9 | ruse | 2026-10-16 | 0.43 | 0.84 | 0.84 | 0.36 | 0.09 |
| 10 | varna | 2026-10-16 | 0.28 | 0.47 | 0.47 | 0.26 | 0.11 |

- A SQL comparison of `mean_ratio` and `max_ratio` against values recomputed from the three ratio columns gives **0 mismatches**.
- Ids continue from 6 because `AUTO_INCREMENT` isn't reset by `DELETE`. Id 7 was used up by the repeated run (`ON DUPLICATE KEY UPDATE`).

Missing-data check, with `rowFor` only and no database write. Sofia has pm25 0.74 and co 0.13, and no pm10:
```
["sofia","2026-10-14",0.44,0.74,11.1,"µg/m³",0.74,null,null,null,519.8,"µg/m³",0.13]
```
- `mean_ratio` is (0.74 + 0.13) / 2 = 0.435, which rounds to **0.44**, and `max_ratio` is **0.74**. Only the available ratios are used, and the pm10 columns are `null`.
- A city with no pollutants throws `no ratios for x`.

`git status --short claude/01-fetch-data-from-openaq claude/initial-fetcher` shows no changes.

