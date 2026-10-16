# Development: backfill

## Usage
```bash
docker compose exec fetcher node src/job-backfill.js --start-date 11-10-2026 --end-date 15-10-2026
```
- Both options are required and use the format **`DD-MM-YYYY`**. The range is inclusive.
- The dates are parsed explicitly as day-month-year, because `new Date('11-10-2026')` would read the date as 10 November.
- Every configured city (`CITIES` in `fetcher/src/openaq/config.js`) is fetched. There is no `--city` option.
- There are no Prometheus metrics and nothing is pushed to Pushgateway. A single summary line goes to stderr:
  `Backfill finished in 114.306s (days=5, api_calls=145, success=true)`
- Each day's report JSON is printed to stdout as soon as that day is saved.

## Dates → `target_date`
For each day `d` from start to end, the backfill calls `AirQualityIngestion.run(undefined, 'YYYY-MM-DD')`. This is the same as `job.js --date-to YYYY-MM-DD`:
- The window is `d-1 00:00Z → d 00:00Z`.
- `air_quality.target_date` = `d`.

So `11-10-2026 … 15-10-2026` makes 5 `run` calls and fills target dates 2026-10-11 to 2026-10-15.

## Re-running
Rows are saved with the same `INSERT … ON DUPLICATE KEY UPDATE` on `(city, target_date)` as `job.js`:
- A re-run updates values in place and keeps `id` and `created_at`.
- If a run fails part-way, the days already saved stay. Run the same range again to finish it.

## API quota and rate limit
- About **29 calls per day** for the 3 cities (pm25, pm10, co), so a 5-day backfill is about 145 calls.
- OpenAQ allows **60 calls per fixed 60s window**. On HTTP 429, `ApiClient` waits `x-ratelimit-reset` seconds (60 if that header is missing) and retries. A backfill therefore slows down instead of failing: 5 days took about 115–125s.

## Exit codes
| Case | Exit |
|---|---|
| Success | 0 |
| Missing `--start-date` / `--end-date`, a malformed or impossible date (`2026-10-11`, `32-10-2026`, `31-02-2026`), start after end, an unknown option or a positional argument | 2 |
| A date in the future (`invalid date-to '…' is in the future`, raised by `AirQualityIngestion.run` on that day) | 2 |
| `OPENAQ_API_KEY` missing, a database error or an API failure | 1 |
