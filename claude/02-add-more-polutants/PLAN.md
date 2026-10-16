# Multiple pollutants (pm25, pm10, co), configurable, stored in one flat row per city/day

## Context
The ingestion only handles PM2.5:
- `Pm25Ingestion.js:85` skips every sensor that isn't `pm25`.
- The `/locations` query filters on `PM25_PARAM_ID`.
- The report has a single top-level `pollutant`, `unit` and `recommended_guideline`.

The user wants a configurable list of pollutants, starting with **pm25, pm10 and co**, stored in MySQL as **one flat row per city per day** with a column set for each pollutant.

A live OpenAQ check of the Sofia, Ruse and Varna locations showed all three use **µg/m³** (OpenAQ parameter ids: pm10 = 1, pm25 = 2, co = 4), so no unit conversion is needed. The WHO 24h guidelines are pm25 15, pm10 45 and co 4 mg/m³, which is 4000 µg/m³.

Decisions:
- **JSON output:** pollutants are nested inside each city.
- **Class:** `Pm25Ingestion` is renamed to `AirQualityIngestion`.
- **Database:** one row per `(city, target_date)`, with columns in this order: `id, city, target_date, pm25_average, pm25_unit, pm25_ratio, pm10_average, pm10_unit, pm10_ratio, co_average, co_unit, co_ratio, created_at`.
  - `average_value` → `pm25_average`, `unit` → `pm25_unit` (each pollutant has its own `_unit`), `recommended_ratio` → `pm25_ratio`.
  - `pollutant` and the recommended guideline columns are not stored.

Rules (from `claude/01-fetch-data-from-openaq/PLAN.md`, which is read only):
- **No git commits.** Claude does not create or switch branches either.
- **No code comments.** The user's existing comments stay, except where the code they describe is removed or would make them wrong (see below).
- **Nothing in `claude/01-fetch-data-from-openaq/` or `claude/initial-fetcher/` changes.**

The code starts from commit `6221bc3`, and the working tree is clean.

## Changes

### `fetcher/src/openaq/config.js`
Replace `PM25_PARAM_ID` and `RECOMMENDED_PM25_24H` (and the `// µg/m³` comment on that line) with:
```js
POLLUTANTS: {
  pm25: { parameterId: 2, unit: 'µg/m³', recommendedGuideline: 15 },
  pm10: { parameterId: 1, unit: 'µg/m³', recommendedGuideline: 45 },
  co: { parameterId: 4, unit: 'µg/m³', recommendedGuideline: 4000 },
},
```
`API_BASE`, `RADIUS_M` and `CITIES` (with the user's commented-out cities) stay unchanged.

### `fetcher/src/openaq/Pm25Ingestion.js` → `AirQualityIngestion.js`
Rename the file and class. `UnknownCityError`, `InvalidDateToError`, `round`, `toNumber`, `mean`, `isoSeconds`, `timeWindow` (including the `from` line) and `sensorHours` stay unchanged.
- `constructor(client, { cities = CITIES, pollutants = POLLUTANTS, maxLocationsPerCity = 3 })`
- `cityPm25` becomes `cityPollutant(city, lat, lon, pollutant, from, to)`. It's the same logic, run once per pollutant:
  - `/locations` is called with `parameters_id: this.pollutants[pollutant].parameterId`, and the first `maxLocationsPerCity` results are kept. The user's quota comment stays.
  - **Line 85** becomes `if (sensor.parameter?.name !== pollutant) continue;`.
  - Per-station `pm25_avg` is renamed `avg`. The ratio and `within_recommended` use that pollutant's `recommendedGuideline`.
  - It returns `{ pollutant, unit, avg, recommended_guideline, recommended_ratio, within_recommended, stations_used }`.
- `run()` keeps its validation and window logic. It loops over cities, then over `Object.keys(this.pollutants)`, one call at a time:
  - Each city has `pollutants` holding only the entries with data.
  - A city with no data for any pollutant goes into `no_data`.
- New report:
  ```json
  { "period": {…}, "cities": [ { "city": "sofia", "pollutants": [ { "pollutant": "pm25", "unit": "µg/m³", "avg": 11.1, "recommended_guideline": 15, "recommended_ratio": 0.74, "within_recommended": true, "stations_used": 2 }, … ] } ], "no_data": [], "source": "…" }
  ```
  The top-level `pollutant`, `unit` and `recommended_guideline` are removed.
- The user's comments that would become wrong are removed with the PM2.5-only code they describe: the class comment (lines 32–33, "finds PM2.5 monitors…") and the `sensorHours` JSDoc ("Hourly PM2.5 values…").
- Export `{ AirQualityIngestion, UnknownCityError, InvalidDateToError }`.

### `mysql/migrations/V2__flat_pollutant_columns.sql` (new)
V1 has already been applied, so it is not edited. V2 drops the table and recreates it with the final layout, in an exact column order. **The user accepted losing the existing data.**
```sql
DROP TABLE air_quality;

CREATE TABLE air_quality (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  city VARCHAR(64) NOT NULL,
  target_date DATE NOT NULL,
  pm25_average DECIMAL(8,1) NULL,
  pm25_unit VARCHAR(16) NULL,
  pm25_ratio DECIMAL(8,2) NULL,
  pm10_average DECIMAL(8,1) NULL,
  pm10_unit VARCHAR(16) NULL,
  pm10_ratio DECIMAL(8,2) NULL,
  co_average DECIMAL(8,1) NULL,
  co_unit VARCHAR(16) NULL,
  co_ratio DECIMAL(8,2) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_city_date (city, target_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```
The pollutant columns are nullable, because a city may lack a pollutant on a given day.

**Revision.** The first V2 of this step was an in-place `ALTER` with a single `unit` column and `*_recommended` columns. The user then asked for:
- `unit` renamed to `pm25_unit`, with a `_unit` column for each pollutant
- the `*_recommended` columns removed
- the column order above

V2 had not been committed, so it was rewritten rather than followed by a V3. Flyway had already recorded the old V2 checksum, so **only the MySQL volume** was reset; Grafana and Prometheus kept their volumes:
```bash
docker compose stop fetcher migrate mysql
docker compose rm -f fetcher migrate mysql
docker volume rm cleanair_mysql-data
docker compose up -d
```

### `fetcher/src/db/AirQualityRepository.js`
- `constructor(connection, pollutants = POLLUTANTS)`. `connect(…)` passes it through.
- The column list is built from the config keys: `city, target_date` plus `${key}_average`, `${key}_unit` and `${key}_ratio` for each pollutant. Keys are checked against `/^[a-z0-9_]+$/` before they're used as column names.
- `saveReport(report)` writes one row per city in `report.cities`:
  - Values come from the matching entry in `city.pollutants` (`avg`, `unit`, `recommended_ratio`), or `null` if that pollutant has no data.
  - `target_date` uses `new Date(…).toISOString().split('T')[0]`.
- It runs `INSERT … VALUES ? ON DUPLICATE KEY UPDATE` for every pollutant column. `id` and `created_at` stay as they are.
- The JSON output still includes `recommended_guideline` for each pollutant. Only the database doesn't store it.
- Adding a pollutant later needs a config entry **and** a migration that adds its three columns.

### `fetcher/src/job.js`
Change the import and the constructor call to `AirQualityIngestion`. Nothing else changes.

### API quota
Each pollutant costs one `/locations` call plus one or more calls per sensor, per city. That's roughly 11 calls for one city and about 30 for the 3 configured cities, compared with about 9 before. The `cleanair_job_api_calls` gauge shows it.

### Docs: new folder `claude/02-add-more-polutants/`
- `PLAN.md`: this plan.
- `DEVELOPMENT.md`:
  - The `POLLUTANTS` config fields.
  - How to add a pollutant: a config entry, a `V<n>` migration with its three columns, and finding the parameter id and unit with a `/locations` query.
  - The units and the CO guideline in µg/m³.
  - The flat row layout and an example query.
  - The API quota cost.
  - The run commands, which are unchanged.
- `VERIFICATION.md`: the commands and results of the checks below.

## Verification
All edits are made in place. Check the container sees them with `docker compose exec -T fetcher ls src/openaq`. If anything looks stale, run `docker compose restart fetcher`.
1. After the MySQL-only reset, `migrate` should apply V1 and V2 (`now at version v2`). `SHOW CREATE TABLE air_quality` should list the columns in exactly the order above, with `uq_city_date`. Grafana and Prometheus should keep their volumes.
2. `node src/job.js --city sofia --date-to 2026-10-14` should exit with code 0, with JSON for Sofia listing pm25, pm10 and co. **pm25 should be 11.1 from 2 stations**, the same as before. The row should have all three `_average`, `_unit` and `_ratio` groups filled. A second run should keep the same `id` and `created_at`.
3. `node src/job.js` for all cities should exit with code 0 and give one row per city for today, with all three pollutant groups filled where there's data. Note the API call count.
4. `--city nowhere` should exit with code 2, and MySQL being down should give exit code 1.
5. `grep -rn "Pm25\|PM25_PARAM_ID\|RECOMMENDED_PM25_24H\|pm25_avg\|average_value\|recommended_guideline\b" fetcher/src` should find nothing outside the JSON field names, which keep `recommended_guideline`.
6. `git status --short claude/01-fetch-data-from-openaq claude/initial-fetcher` should show no changes.

## Mean and max ratio (V3)
Added after step 02 was committed (`81a3fa9`). There are two new `NOT NULL` columns right after `target_date`:
- `mean_ratio`: the mean of the pollutant ratios (`pm25_ratio`, `pm10_ratio`, `co_ratio`)
- `max_ratio`: the largest of them

Both are calculated in `AirQualityRepository`.

### `mysql/migrations/V3__add_mean_max_ratio.sql`
The user asked for the existing rows to be deleted, so there's no backfill. The `NOT NULL` columns are added to an empty table, and the job refills it.
```sql
DELETE FROM air_quality;

ALTER TABLE air_quality
  ADD COLUMN mean_ratio DECIMAL(8,2) NOT NULL AFTER target_date,
  ADD COLUMN max_ratio DECIMAL(8,2) NOT NULL AFTER mean_ratio;
```
Column order: `id, city, target_date, mean_ratio, max_ratio, pm25_average, pm25_unit, pm25_ratio, pm10_average, pm10_unit, pm10_ratio, co_average, co_unit, co_ratio, created_at`.

### `fetcher/src/db/AirQualityRepository.js`
- `rowFor` collects the non-`NULL` ratios of the configured pollutants. Pollutants without data are skipped, as the user chose.
  - `mean_ratio` is the mean of those ratios, rounded to 2 decimals with a local `round` helper (half away from zero, the same as `AirQualityIngestion`).
  - `max_ratio` is `Math.max` of them.
  - It throws `no ratios for <city>` if there are none, which can't happen for saved cities.
- The insert columns and `ON DUPLICATE KEY UPDATE` include `mean_ratio` and `max_ratio`.
- The JSON output doesn't change.

