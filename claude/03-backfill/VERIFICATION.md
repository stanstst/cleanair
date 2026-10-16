# Verification

Verification was run on 2026-10-16 against [PLAN.md](PLAN.md), starting from commit `46db6d3` on branch `03-backfill`. Nothing is committed.

## 1. Mount
`docker compose exec -T fetcher ls src` lists `db`, `job-backfill.js`, `job.js` and `openaq`.

## 2. Argument errors (no API calls, no database)
| Args | Output | Exit |
|---|---|---|
| `--start-date 11-10-2026` | `--end-date is required (DD-MM-YYYY)` | 2 |
| `--start-date 32-10-2026 --end-date 15-10-2026` | `invalid start-date '32-10-2026'` | 2 |
| `--start-date 2026-10-11 --end-date 15-10-2026` | `invalid start-date '2026-10-11', expected DD-MM-YYYY` | 2 |
| `--start-date 15-10-2026 --end-date 11-10-2026` | `start-date '15-10-2026' is after end-date '11-10-2026'` | 2 |
| `--start-date 31-02-2026 --end-date 15-10-2026` | `invalid start-date '31-02-2026'` | 2 |
| `… extra` | `Unexpected argument 'extra'. …` | 2 |
| `--start-date 17-10-2026 --end-date 17-10-2026` (tomorrow) | `invalid date-to '2026-10-17' is in the future` | 2 |

## 3. First backfill attempt: rate limit
```bash
docker compose exec -T fetcher node src/job-backfill.js --start-date 11-10-2026 --end-date 15-10-2026
```
The run failed with exit 1 after 2 days and 61 API calls, in about 32s:
`gave up after 3 attempts: …/sensors/1293779/hours?…2026-10-12…`

A probe showed:
- `HTTP 429`, `x-ratelimit-limit: 60`, `x-ratelimit-remaining: 0`, `x-ratelimit-reset: 18`, `{"detail":"Too many requests"}`.
- Polling every 10s showed a **fixed 60s window**: `reset` counts down 60 → 7, then `used` goes back to 1.

Fix (see the PLAN revision): on 429, `ApiClient` waits `x-ratelimit-reset` seconds. The second attempt also stopped at 61 calls. It had started in the same minute the edit was saved (file mtime 17:05, run 17:05:12–17:05:48), and it gave up in about 4s, so it never reached the new wait. A later `grep -c ratelimit` in the container returned 1.

## 4. 5-day backfill
```bash
docker compose exec -T fetcher node src/job-backfill.js --start-date 11-10-2026 --end-date 15-10-2026
```
- Exit 0. `Backfill finished in 114.306s (days=5, api_calls=145, success=true)`
- 5 reports were printed, with `period.to` = `2026-10-11T00:00:00Z`, `…12…`, `…13…`, `…14…` and `…15T00:00:00Z`. **`AirQualityIngestion.run` was called 5 times.**
- Varna is in `no_data` for 2026-10-11 and 2026-10-12, so there are 13 rows instead of 15.

| id | city | target_date | mean_ratio | max_ratio | pm25_average | pm10_average | co_average | created_at |
|---|---|---|---|---|---|---|---|---|
| 13 | ruse | 2026-10-11 | 0.75 | 1.27 | 19.0 | 39.8 | 363.3 | 2026-10-16 14:01:35 |
| 12 | sofia | 2026-10-11 | 0.37 | 0.51 | 6.3 | 22.9 | 689.8 | 2026-10-16 14:01:35 |
| 15 | ruse | 2026-10-12 | 0.56 | 1.00 | 15.0 | 27.6 | 252.6 | 2026-10-16 14:01:44 |
| 14 | sofia | 2026-10-12 | 0.42 | 0.60 | 7.2 | 27.0 | 664.6 | 2026-10-16 14:01:44 |
| 25 | ruse | 2026-10-13 | 0.30 | 0.56 | 8.4 | 12.7 | 253.3 | 2026-10-16 14:09:29 |
| 24 | sofia | 2026-10-13 | 0.28 | 0.49 | 7.3 | 10.4 | 515.1 | 2026-10-16 14:09:29 |
| 26 | varna | 2026-10-13 | 0.47 | 0.73 | 10.9 | 26.0 | 450.0 | 2026-10-16 14:09:29 |
| 27 | ruse | 2026-10-14 | 0.20 | 0.39 | 5.9 | 6.6 | 258.6 | 2026-10-16 14:09:38 |
| 6 | sofia | 2026-10-14 | 0.38 | 0.74 | 11.1 | 12.4 | 519.8 | 2026-10-16 11:13:43 |
| 28 | varna | 2026-10-14 | 0.17 | 0.27 | 4.0 | 6.8 | 397.7 | 2026-10-16 14:09:38 |
| 31 | ruse | 2026-10-15 | 0.32 | 0.65 | 9.8 | 10.5 | 312.3 | 2026-10-16 14:10:26 |
| 30 | sofia | 2026-10-15 | 0.22 | 0.32 | 3.0 | 14.4 | 558.6 | 2026-10-16 14:10:26 |
| 32 | varna | 2026-10-15 | 0.20 | 0.34 | 5.1 | 7.7 | 402.2 | 2026-10-16 14:10:26 |

- Rows 12–15 were saved by the failed first attempts and updated in place.
- **Sofia 2026-10-14 is still row 6: pm25 11.1, mean 0.38, max 0.74.** That matches step 02's `job.js --date-to 2026-10-14`.

## 5. Re-run
Running the same command again gave exit 0, `days=5, api_calls=145`, in 123.9s. The query returns the same 13 rows, with the same `id`s and `created_at` values.

## 6. MySQL down
`docker compose stop mysql`, then `--start-date 11-10-2026 --end-date 11-10-2026` gave `{"error": "getaddrinfo ENOTFOUND mysql"}`, exit 1, with 0 API calls. Then `docker compose start mysql`.

## 7. No metrics, untouched files
- `cleanair_job_last_run_timestamp_seconds` in Pushgateway is still `1.792152733189e+09` after all the backfill runs.
- `git status --short` shows `M fetcher/src/openaq/ApiClient.js`, `?? fetcher/src/job-backfill.js` and `?? claude/03-backfill/`. `job.js`, `AirQualityIngestion.js`, `OpenAQRepository.js` and the `claude/01-*`, `claude/02-*` and `claude/initial-fetcher` folders are unchanged.
