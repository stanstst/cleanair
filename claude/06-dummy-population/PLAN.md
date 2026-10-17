# Dummy population: new `dummy-dev-populator` service fills `air_quality` with random rows

## Context
`claude/06-dummy-population/REQUIREMENTS.md` asks for a script that fills `air_quality` with dummy data, so the rest of the system can be worked on without calling OpenAQ:
- It takes one parameter, `date_from`. `date_to` is always now, the time of execution.
- For each `target_date` from `date_from` to today, it inserts one row each for `sofia`, `ruse` and `varna` (3 rows per day).
- When a row hits the unique key `(city, target_date)`, the insert is skipped and the existing row is left as it is.
- It must not call any external API.

The user made these choices:
- **Location:** a new `/dummy-dev-populator` service with its own folder, Dockerfile and compose service, set up like `archiver` in step 05.
- **Ratios:** `mean_ratio` and `max_ratio` are calculated from the random pm25, pm10 and co ratios, not drawn separately. Both still fall within 0.3–3.3, and `max ≥ mean` always holds.
- **Tests:** none.

Rules carried over from earlier steps:
- No commits. The work is on `06-dummy-population`.
- No code comments.
- Earlier `claude/0*` folders stay unchanged.
- `fetcher/` and `archiver/` stay unchanged.

## Changes

### `dummy-dev-populator/package.json`, `dummy-dev-populator/Dockerfile`, `dummy-dev-populator/.dockerignore` (new)
- Copied from `archiver/`. The name is `cleanair-dummy-dev-populator`, the description is "Populates air_quality with dummy records", the only dependency is `mysql2`, and there is no `test:feature` script.
- Dockerfile: `node:22-alpine`, `WORKDIR /dummy-dev-populator`, `CMD ["node", "src/job.js"]`.

### `docker-compose.yml`: new `dummy-dev-populator` service
It mirrors `archiver`, without the archive env vars or the fileserver:
- `build: ./dummy-dev-populator` and `command: ["sleep", "infinity"]`;
- the `DB_*` env vars;
- the volume `./dummy-dev-populator/src:/dummy-dev-populator/src:ro`;
- `depends_on: migrate (service_completed_successfully)`;
- `restart: unless-stopped`.

### `dummy-dev-populator/src/db/AirQualityRepository.js` (new)
- `static connect({...})` is the same as `archiver/src/db/AirQualityRepository.js:8`, plus `flags: ['-FOUND_ROWS']`. mysql2 enables `CLIENT_FOUND_ROWS` by default, which makes a skipped duplicate count as 1 affected row.
- `insertIgnoringDuplicates(rows)`:
  - columns: `city, target_date, mean_ratio, max_ratio, pm25_average, pm25_unit, pm25_ratio, pm10_average, pm10_unit, pm10_ratio, co_average, co_unit, co_ratio`;
  - query: `INSERT INTO air_quality (...) VALUES ? ON DUPLICATE KEY UPDATE id = id`, using the bulk `VALUES ?` form from `fetcher/src/db/OpenAQRepository.js:56`;
  - returns `affectedRows`. Each new row counts 1 and each skipped duplicate counts 0, so this is the number of inserted rows.
  - `ON DUPLICATE KEY UPDATE id = id` is used instead of `INSERT IGNORE` because it only ignores the unique-key conflict. `INSERT IGNORE` would also turn other errors, such as truncation, into warnings.
- `close()`.

### `dummy-dev-populator/src/dummy/DummyRecordGenerator.js` (new)
- `constructor({ random = Math.random })`. The random source is injectable, which makes the output deterministic if tests are added later.
- `CITIES = ['sofia', 'ruse', 'varna']` and `POLLUTANTS = ['pm25', 'pm10', 'co']`, all with the unit `µg/m³`.
- `between(min, max, decimals)`:
  - averages use `(5, 15, 1)`, matching `DECIMAL(8,1)`;
  - ratios use `(0.3, 3.3, 2)`, matching `DECIMAL(8,2)`;
  - rounding uses the same `round` as `OpenAQRepository.js:6`.
- `rowsFor(targetDate)` returns 3 row arrays, one per city, in the column order above:
  - `mean_ratio = round(avg(ratios), 2)`;
  - `max_ratio = max(ratios)`.

### `dummy-dev-populator/src/job.js` (new)
It is structured like `fetcher/src/job-backfill.js` and `archiver/src/job.js`:
- `UsageError` / `isUsageError` map to exit 2, and other errors map to exit 1.
- Dependencies are injectable through `main({ args, env, now, connectRepository, createGenerator })`.

Steps:
1. `parseArgs` with `options: { 'date-from': { type: 'string' } }`. The value is required, in `DD-MM-YYYY` format. Parsing reuses `parseDate` from `job-backfill.js:23` (copied, because the services don't share code). This is the same format as the backfill job.
2. `today` = `now()` truncated to a UTC date. If `dateFrom > today`, it throws a `UsageError`.
3. Connect the repository. For each day `d` from `dateFrom` to `today` (inclusive, stepping one `DAY_MS`):
   - `inserted += await repository.insertIgnoringDuplicates(generator.rowsFor(isoDate(d)))`;
   - `days++`.
4. The `catch` block, `repository?.close()` and the exit codes match the archiver.
5. It ends with this line: `Populate finished in Xs (date_from=YYYY-MM-DD, date_to=YYYY-MM-DD, days=N, inserted=N, skipped=N, success=bool)`, where `skipped = days * 3 - inserted`.

### `README.md`
Add a short section, "Populating dummy data", after "Archiving old records":

```bash
docker compose up -d --build dummy-dev-populator
docker compose exec dummy-dev-populator node src/job.js --date-from 01-10-2026
```

It notes that the script makes no API calls, that existing `(city, target_date)` rows are kept, and that re-running it is safe.

### `claude/06-dummy-population/PLAN.md`
A copy of this plan, so the folder follows the earlier steps.

## Verification
1. Run `docker compose up -d --build dummy-dev-populator`.
2. Run `docker compose exec dummy-dev-populator node src/job.js --date-from <today − 4 days>`.
   - Expected: `days=5, inserted=15, skipped=0, success=true` (fewer inserted if the fetcher already filled some of those days).
3. Run the same command again.
   - Expected: `inserted=0, skipped=15`. The existing rows keep the same values and `created_at`.
4. Check the data in MySQL:
   - `SELECT city, COUNT(*), MIN(target_date), MAX(target_date) FROM air_quality GROUP BY city` shows the expected days per city.
   - Range checks return 0 rows: `SELECT COUNT(*) FROM air_quality WHERE pm25_average NOT BETWEEN 5 AND 15 OR pm25_ratio NOT BETWEEN 0.3 AND 3.3 OR max_ratio < mean_ratio OR co_unit <> 'µg/m³'`, plus the same checks for pm10 and co.
5. Check the error cases:
   - no `--date-from` → exit 2;
   - `--date-from 31-02-2026` → exit 2;
   - a future date → exit 2.
6. Confirm there are no external calls: the code has no `fetch` or HTTP import (`grep -r "fetch\|http" dummy-dev-populator/src` is empty).
