# Backfill: `job-backfill.js` fills `air_quality` for a date range

## Context
`fetcher/src/job.js` fetches a single 24h window, which is either the last 24h or the day ending at `--date-to`. It stores one row per city in `air_quality`, and `target_date` is the date part of `period.to`. Filling past days currently means running the job once per day by hand. The user wants a separate entry point, `job-backfill.js`, that takes `--start-date` and `--end-date` (format `DD-MM-YYYY`). It calls `AirQualityIngestion.run` once per target date in that range, inclusive, and saves each report. For example, `--start-date 11-10-2026 --end-date 15-10-2026` gives **5 calls** and target dates 2026-10-11 to 2026-10-15. There are **no Prometheus metrics**.

Rules carried over from earlier steps:
- No git commits or branch changes. The work is on `03-backfill`.
- No code comments.
- Nothing in `claude/01-*`, `claude/02-*` or `claude/initial-fetcher/` changes.

## Changes

### `fetcher/src/job-backfill.js` (new)
CommonJS, structured like `job.js`, reusing `ApiClient`, `API_BASE`, `AirQualityIngestion`, `UnknownCityError`, `InvalidDateToError` and `OpenAQRepository`. There is no `prom-client` and no Pushgateway.
- `parseArgs` options: `start-date` and `end-date`, both strings and both required. A missing option gives a usage error.
- `parseDate(value)`:
  - Matches `/^(\d{2})-(\d{2})-(\d{4})$/` as `DD-MM-YYYY` and builds the date with `Date.UTC(y, m - 1, d)`.
  - Rejects dates that don't round-trip, such as `31-02-2026`.
  - Rejects bad input by throwing `InvalidDateToError` (exit 2).
  - The format is parsed explicitly, because `new Date('11-10-2026')` would read it as 10 November.
- `start-date > end-date` → usage error, exit 2.
- `main()`:
  1. Validate the args and check `OPENAQ_API_KEY`.
  2. Create one `ApiClient`, one `AirQualityIngestion` and one `OpenAQRepository.connect(...)`, using the same env vars as `job.js`.
  3. Loop `d` from start to end in steps of 1 UTC day. Each pass:
     - calls `ingestion.run(undefined, isoDate(d))`, where `isoDate` gives `YYYY-MM-DD`. As at `job.js:59`, the window is `d-1 00:00Z → d 00:00Z`, so `target_date = d`;
     - then `repository.saveReport(report)` and `printJson(report)`.
  4. A future end date fails on that day through the existing `InvalidDateToError` from `run` (exit 2). Days already saved stay, and a re-run is safe because the upsert is idempotent.
- Errors use the same `isUsageError` logic as `job.js`: usage errors exit 2, others exit 1, and the message is printed as `{"error": …}`.
- `finally`: `repository?.close()`, then one stderr line:
  `Backfill finished in Xs (days=N, api_calls=M, success=…)`

How to run:
```bash
docker compose exec fetcher node src/job-backfill.js --start-date 11-10-2026 --end-date 15-10-2026
```
API cost: about 29 calls per day for the 3 cities, so about 145 calls for 5 days.

`job.js`, `AirQualityIngestion` and `OpenAQRepository` are unchanged.

### Docs: `claude/03-backfill/`
- `PLAN.md`: this plan.
- `DEVELOPMENT.md`:
  - usage and the date format;
  - how dates map to `target_date`;
  - the API quota per day;
  - the error and exit codes;
  - re-run safety.
- `VERIFICATION.md`: the commands and results of the checks below.

## Verification
1. `docker compose exec -T fetcher ls src` should show `job-backfill.js`, which confirms the mount sees it.
2. `node src/job-backfill.js --start-date 11-10-2026 --end-date 15-10-2026` should:
   - exit 0;
   - print 5 reports, with `period.to` set to `2026-10-11T00:00:00Z` through `2026-10-15T00:00:00Z`;
   - fill `air_quality` for sofia, ruse and varna on target dates 2026-10-11 to 2026-10-15. Check with `SELECT city, target_date, mean_ratio, max_ratio FROM air_quality WHERE target_date BETWEEN '2026-10-11' AND '2026-10-15' ORDER BY target_date, city` (up to 15 rows, minus any no-data city and day).
3. Run it again. The rows should keep the same `id` and `created_at`.
4. Sofia 2026-10-14 should still be pm25 11.1, matching the `job.js --date-to 2026-10-14` results from step 02.
5. Error paths, all exit 2:
   - a missing `--end-date`;
   - `--start-date 32-10-2026`;
   - `2026-10-11` (wrong format);
   - start after end;
   - an end date in the future.
6. MySQL stopped → exit 1.
7. `git status --short` should show only `fetcher/src/job-backfill.js` and `claude/03-backfill/`, with no Pushgateway push. `curl -s localhost:9091/metrics | grep cleanair_job_last_run` should be unchanged after a backfill.

## Revision: `ApiClient` handles OpenAQ's rate limit
The first 5-day run failed on day 3 with `gave up after 3 attempts`, after 61 API calls in about 32s. OpenAQ's free tier allows **60 calls per fixed 60s window** (`x-ratelimit-limit: 60`), and `x-ratelimit-reset` gives the seconds left in the window. One day for 3 cities costs about 29 calls. The old retry waited `attempt * 2` seconds (2s, then 4s), which is far shorter than the window.

The user chose to fix this in `ApiClient`, so `job.js` benefits too:
- `fetcher/src/openaq/ApiClient.js`: **429** waits `x-ratelimit-reset` seconds, or 60s if that header is missing or invalid, then retries. It still makes up to `maxAttempts` attempts.
- **5xx** keeps the `attempt * 2` second backoff.

In `job-backfill.js`, a missing option, a malformed date and start-after-end throw a local `UsageError` (exit 2), so the messages name `start-date` or `end-date`. A future end date still fails through `InvalidDateToError` from `AirQualityIngestion.run`.

## Revision: logging
The user removed `printJson(report)` from `job.js` and `job-backfill.js`, so reports are no longer printed. In both files:
- The error in `catch` changes from `printJson({ error: err.message })` on stdout to `console.error(err.message)` on stderr.
- The finished line (`Job finished …` / `Backfill finished …`) is a normal completion, so it changes from `console.error` to `console.info` (stdout). The user chose `console.info` over adding a logger with a `notice` level.
- The unused `printJson` helper is removed.
Exit codes, `job.js`'s Prometheus metrics and the `main().catch` handler are unchanged.
