# Development: pollutants

## Configured pollutants
`fetcher/src/openaq/config.js`:
```js
POLLUTANTS: {
  pm25: { parameterId: 2, unit: 'µg/m³', recommendedGuideline: 15 },
  pm10: { parameterId: 1, unit: 'µg/m³', recommendedGuideline: 45 },
  co: { parameterId: 4, unit: 'µg/m³', recommendedGuideline: 4000 },
},
```

| Field | Meaning |
|---|---|
| key (`pm25`) | The OpenAQ parameter name, which must equal `sensor.parameter.name`. It's also the prefix of the database columns (`pm25_average`, `pm25_unit`, `pm25_ratio`). Only `a-z`, `0-9` and `_` are allowed. |
| `parameterId` | The OpenAQ parameter id, sent as `parameters_id` in the `/locations` query |
| `unit` | The unit OpenAQ reports for that sensor, stored in `<key>_unit` |
| `recommendedGuideline` | The WHO 24h guideline in the same unit. `ratio = average / recommendedGuideline`. |

All three are in **µg/m³**. CO's WHO 24h guideline is 4 mg/m³, which is **4000 µg/m³**.

## Database layout: one flat row per city per day
`air_quality` (created by `mysql/migrations/V2__flat_pollutant_columns.sql`), with columns in this order:

```
id, city, target_date,
mean_ratio, max_ratio,
pm25_average, pm25_unit, pm25_ratio,
pm10_average, pm10_unit, pm10_ratio,
co_average,  co_unit,  co_ratio,
created_at
```

| Column | Notes |
|---|---|
| `target_date` | The date part of `period.to`. Unique key: `(city, target_date)`. |
| `mean_ratio` | `NOT NULL`. The mean of the available (non-`NULL`) `<key>_ratio` values of the configured pollutants, rounded to 2 decimals (half away from zero). Calculated in `AirQualityRepository.rowFor`. Added by `V3__add_mean_max_ratio.sql`. |
| `max_ratio` | `NOT NULL`. The largest available `<key>_ratio`. Same source and migration. |
| `<key>_average` | The 24h average of the pollutant, with 1 decimal |
| `<key>_unit` | The unit from `POLLUTANTS` (currently `µg/m³`) |
| `<key>_ratio` | `average / recommendedGuideline`, with 2 decimals. The guideline itself is not stored; it's in `config.js` and in the JSON output. |
| `created_at` | Set on first insert and kept when a re-run updates the row |

The pollutant columns are nullable: `NULL` means there was no data for that pollutant on that day.

Example query:
```bash
docker compose exec mysql mysql -ucleanair -pcleanair cleanair --default-character-set=utf8mb4 \
  -e "SELECT city, target_date, pm25_average, pm10_average, co_average FROM air_quality ORDER BY target_date, city"
```

## Adding a pollutant
1. Find its parameter id and unit at the configured cities (this costs 1 API call per city):
   ```bash
   KEY=$(grep '^OPENAQ_API_KEY=' .env | cut -d= -f2)
   curl -s -H "X-API-Key: $KEY" "https://api.openaq.org/v3/locations?coordinates=42.6977,23.3219&radius=15000&monitor=true&limit=100" \
     | python3 -c "import json,sys;[print(l['name'],sorted({(s['parameter']['name'],s['parameter']['id'],s['parameter']['units']) for s in l['sensors']})) for l in json.load(sys.stdin)['results']]"
   ```
   Known ids near Sofia, Ruse and Varna (all µg/m³): `pm10` 1, `pm25` 2, `o3` 3, `co` 4, `no2` 5, `so2` 6.
2. Add a migration `mysql/migrations/V<next>__add_<key>_columns.sql`. Never edit an applied migration.
   ```sql
   ALTER TABLE air_quality
     ADD COLUMN no2_average DECIMAL(8,1) NULL AFTER co_ratio,
     ADD COLUMN no2_unit VARCHAR(16) NULL AFTER no2_average,
     ADD COLUMN no2_ratio DECIMAL(8,2) NULL AFTER no2_unit;
   ```
   Without `AFTER`, new columns are added at the end, after `created_at`.
   Then run `docker compose run --rm migrate`.
3. Add the entry to `POLLUTANTS`, with the WHO 24h guideline in that unit (for example no2 25, so2 40 µg/m³). O₃ has only an 8-hour guideline (100 µg/m³).
4. Run the job. The repository builds its column list from `POLLUTANTS`, so no code change is needed. If you add the config entry without the migration, the insert fails with "Unknown column".
5. `mean_ratio` and `max_ratio` automatically include the new pollutant's ratio from then on. Rows saved earlier keep their old mean and max until that city and day is fetched again.

Removing a pollutant from `POLLUTANTS` stops filling its columns. Existing values stay.

## API quota
Each pollutant costs, per city, 1 `/locations` call plus at least 1 call per matching sensor (in the first `maxLocationsPerCity` = 3 locations). Measured with pm25, pm10 and co:
- one city (Sofia): **11 calls**
- the 3 configured cities: **29 calls**, about 10–12s

Before this change it was about 9 calls for 3 cities. The count is shown in the `cleanair_job_api_calls` gauge and the Grafana API calls panels.

## Running
These commands are unchanged:
```bash
docker compose exec fetcher node src/job.js
docker compose exec fetcher node src/job.js --city sofia
docker compose exec fetcher node src/job.js --city sofia --date-to 2026-10-14
```
