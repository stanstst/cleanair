# Populator: verification (2026-10-17)

1. **Build.** `docker compose up -d --build dummy-dev-populator` built `cleanair-dummy-dev-populator`, and `cleanair-dummy-dev-populator-1` is running.
2. **First run over days that already had data.** `--date-from 13-10-2026` printed:
   ```
   Populate finished in 0.065s (date_from=2026-10-13, date_to=2026-10-17, days=5, inserted=15, skipped=0, success=true)
   ```
   - MySQL showed that the 15 rows for 13–17 Oct already existed from the fetcher (`created_at` 2026-10-16). None were duplicated or changed, but the count was wrong.
   - **Cause:** mysql2's default `CLIENT_FOUND_ROWS` flag, which makes a no-op `id = id` update count as 1 affected row.
   - **Fix:** `flags: ['-FOUND_ROWS']` on the connection. A direct test of a duplicate insert then returned `affectedRows: 0`.
3. **After the fix.**
   ```
   --date-from 01-09-2026  →  days=47, inserted=0,  skipped=141, success=true
   --date-from 01-08-2026  →  days=78, inserted=93, skipped=141, success=true
   ```
   - The second run filled only the 31 August days that were missing (31 × 3 = 93).
4. **Row counts.** `SELECT city, COUNT(*), MIN(target_date), MAX(target_date) … WHERE target_date >= '2026-09-01' GROUP BY city` returned 47 rows per city, from 2026-09-01 to 2026-10-17.
5. **Value ranges.** The range check on 2026-09-01..2026-10-12 covered:
   - averages not in 5–15;
   - ratios not in 0.3–3.3;
   - `max_ratio < mean_ratio`;
   - `max_ratio` not equal to any of the 3 ratios;
   - a unit other than `µg/m³`.

   Only 4 rows failed, and all of them are real fetcher rows: sofia and ruse on 10-11 and 10-12, created 2026-10-16, with CO averages of 252–690. No generated row failed.
   - The first run of this check flagged 126 rows only because the `mysql` CLI used a latin1 client charset. With `--default-character-set=utf8mb4`, the stored unit is `C2B5672F6DC2B3` = `µg/m³`.
6. **Sample rows (2026-09-01).**
   ```
   sofia  mean 1.59  max 2.37  pm25 7.2/1.38   pm10 9.8/2.37   co 6.6/1.03
   ruse   mean 1.11  max 2.23  pm25 12.6/0.67  pm10 11.5/2.23  co 6.9/0.44
   varna  mean 0.99  max 2.12  pm25 12.5/0.48  pm10 14.3/0.37  co 14.2/2.12
   ```
7. **Error paths.** Each of these exited 2 and touched no data:
   - no args: `--date-from is required (DD-MM-YYYY)`;
   - `--date-from 31-02-2026`: `invalid date-from '31-02-2026'`;
   - `--date-from 01-01-2027`: `date-from '01-01-2027' is in the future`;
   - `--date-from 2026-10-01`: `invalid date-from '2026-10-01', expected DD-MM-YYYY`.
8. **No external calls.** `grep -rn "fetch\|http" dummy-dev-populator/src` is empty. `curl -s localhost:9091/metrics | grep -ci populat` returned 0.
9. **`git status --short`.** Only `README.md`, `docker-compose.yml`, `dummy-dev-populator/` and `claude/06-dummy-population/` changed. `fetcher/`, `archiver/` and the earlier `claude/0*` folders are unchanged.

**Note:** the local `air_quality` table now holds the dummy rows from these runs, for 2026-08-01..2026-10-17 (fetcher rows excluded).
