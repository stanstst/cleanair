# Populator: development notes

## Components (`dummy-dev-populator/`)
- `src/job.js` is the entry point. It parses `--date-from`, sets `date_to` to today (UTC), and inserts one day at a time.
- `src/db/AirQualityRepository.js`:
  - `insertIgnoringDuplicates(rows)` runs a bulk `INSERT … VALUES ? ON DUPLICATE KEY UPDATE id = id` and returns the number of inserted rows.
  - It connects with `dateStrings: true` and `flags: ['-FOUND_ROWS']`.
- `src/dummy/DummyRecordGenerator.js`:
  - `rowsFor(targetDate)` returns 3 rows, one each for `sofia`, `ruse` and `varna`.
  - The random source is injectable (`new DummyRecordGenerator({ random })`).

## Usage
```bash
docker compose up -d --build dummy-dev-populator
docker compose exec dummy-dev-populator node src/job.js --date-from 01-10-2026
```
The `src/` folder is mounted read-only, so code edits apply without a rebuild. A change to `package.json` needs `--build`.

## Field values
| Field | Value |
|---|---|
| `city` | `sofia`, `ruse`, `varna` (one row each per day) |
| `target_date` | every day from `--date-from` to today (UTC), inclusive |
| `pm25_average`, `pm10_average`, `co_average` | random 5–15, 1 decimal |
| `pm25_unit`, `pm10_unit`, `co_unit` | `µg/m³` |
| `pm25_ratio`, `pm10_ratio`, `co_ratio` | random 0.3–3.3, 2 decimals |
| `mean_ratio` | mean of the 3 ratios, rounded to 2 decimals |
| `max_ratio` | max of the 3 ratios |

The decimals match the column types (`DECIMAL(8,1)` for averages, `DECIMAL(8,2)` for ratios). Because `mean_ratio` and `max_ratio` come from the pollutant ratios, they also fall within 0.3–3.3, and `max_ratio ≥ mean_ratio` always holds.

## Duplicates
- Each row that hits the unique key `uq_city_date (city, target_date)` is skipped, and the existing row keeps its values and `created_at`. This applies to real fetcher rows too.
- `ON DUPLICATE KEY UPDATE id = id` is used instead of `INSERT IGNORE`, because it only ignores the unique-key conflict. `INSERT IGNORE` would also turn errors such as truncation into warnings.
- **The `-FOUND_ROWS` flag:** mysql2 enables `CLIENT_FOUND_ROWS` by default. With it, MySQL reports 1 affected row for a duplicate whose no-op update matched, so skipped rows were counted as inserted. With the flag off, MySQL reports 1 for an inserted row and 0 for a skipped one, so `affectedRows` is the inserted count.
- Re-running with the same or an overlapping range is safe. It only fills the days that are missing.

## Output and exit codes
- stdout gets one final line: `Populate finished in Xs (date_from=YYYY-MM-DD, date_to=YYYY-MM-DD, days=N, inserted=N, skipped=N, success=…)`, where `skipped = days × 3 − inserted`.
- stderr gets the error message.
- Exit codes:
  - `0`: OK.
  - `2`: usage error, which is a missing `--date-from`, a format other than `DD-MM-YYYY`, an invalid date (e.g. `31-02-2026`), a date in the future, or an unknown option.
  - `1`: any other error (DB).
- No external API calls are made, and no metrics are pushed to Pushgateway.

## Tests
None, by choice. `main()` takes `now`, `connectRepository` and `createGenerator`, and the generator takes `random`, so feature tests in the step 04 style can be added later.
