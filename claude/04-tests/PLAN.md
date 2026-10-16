# Unit test for `AirQualityIngestion` with a fixture-backed mock client

## Context
`AirQualityIngestion` (`fetcher/src/openaq/AirQualityIngestion.js`) has no tests. The user wants a unit test that:
- calls `new AirQualityIngestion(client).run(values.city, values['date-to'])` with a **mock client** that never touches the network;
- asserts the returned report.

The mock answers from JSON fixtures that are captured once from the real OpenAQ API by reusing the job's code (`ApiClient` + `AirQualityIngestion`, same as `job.js`). Fixtures live in `fetcher/test/fixtures/` and each file is named after the API endpoint it answers.

Rules carried over from earlier steps: no git commits or branch changes (work is on `04-tests`), no code comments, nothing in `claude/01-*`, `02-*`, `03-*`, `initial-fetcher/` changes. Plan docs go in `claude/04-tests/` (`PLAN.md`, `DEVELOPMENT.md`, `VERIFICATION.md`).

## Changes

### `fetcher/test/fixtureName.js` (new)
One function shared by capture and mock, so both resolve the same file for a `client.get(path, query)` call:
- `/locations` → `locations_<coordinates>_<parameters_id>.json`, e.g. `locations_42.6977,23.3219_2.json`
- `/sensors/{id}/hours` → `sensors_<id>_hours_page<page>.json`, e.g. `sensors_1293779_hours_page1.json`

Generic rule: path segments joined with `_`, plus the query values that vary between calls (`coordinates`, `parameters_id`, `page`). `datetime_from/to`, `limit`, `radius`, `monitor` are constant for a run and left out.

### `fetcher/test/capture-fixtures.js` (new, run once against the real API)
Mirrors `job.js:50-59`:
- `parseArgs` with the same `city` / `date-to` options;
- `new ApiClient({ baseUrl: API_BASE, headers: { 'X-API-Key': OPENAQ_API_KEY } })`;
- wraps `client.get` so each response is also written to `fixtures/<fixtureName(path, query)>` (pretty-printed JSON);
- runs `new AirQualityIngestion(client).run(values.city, values['date-to'])` and prints the report to stdout, so its values can be put into the test's expected object;
- no DB, no Pushgateway.

Capture inputs: `--city sofia --date-to 2026-10-14` (fixed past date, so the test is deterministic; sofia 2026-10-14 is a known reference: pm25 11.1). About 10 API calls (3 `/locations` + sensor hours for up to 3 locations per pollutant).

### `fetcher/test/fixtures/*.json` (new, generated)
Output of the capture script, committed with the test.

### `fetcher/test/MockApiClient.js` (new)
- `get(path, query)` reads `fixtures/<fixtureName(path, query)>` and returns the parsed JSON;
- missing fixture → throws (`no fixture for <path> <query>`), so an unexpected call fails the test instead of hitting the network;
- records `calls` (`{ path, query }`) and `callCount`, same field name as `ApiClient`.

### `fetcher/test/AirQualityIngestion.test.js` (new, `node:test` + `node:assert/strict`, no new deps)
```js
const values = { city: 'sofia', 'date-to': '2026-10-14' };
const client = new MockApiClient();
const report = await new AirQualityIngestion(client).run(values.city, values['date-to']);
```
Asserts:
- `assert.deepEqual(report, expected)` where `expected` is the full report literal (period `2026-10-13T00:00:00Z → 2026-10-14T00:00:00Z`, `cities[0].city === 'sofia'`, per-pollutant `avg`, `recommended_ratio`, `within_recommended`, `stations_used`, `no_data`, `source`), taken from the capture run output;
- every call used the right window (`datetime_from/to`) and the expected number of calls.

Plus small extra cases using the same mock (no fixtures needed):
- unknown city → rejects `UnknownCityError`, `client.callCount === 0`;
- `date-to` in the future / invalid → rejects `InvalidDateToError`.

### `fetcher/package.json`
Add `"test": "node --test test/"`.

## Running (no Node on the host; use the fetcher image)
Only `./fetcher/src` is mounted into the container, so `test/` is mounted ad hoc:
```bash
# capture once (real API, writes fixtures as the host user)
docker compose run --rm --no-deps --user "$(id -u):$(id -g)" -v "$PWD/fetcher/test:/fetcher/test" \
  fetcher node test/capture-fixtures.js --city sofia --date-to 2026-10-14
# unit tests (no network)
docker compose run --rm --no-deps -v "$PWD/fetcher/test:/fetcher/test:ro" --network none \
  fetcher node --test test/
```
`--network none` proves the test makes no API requests.

### Docs: `claude/04-tests/`
- `PLAN.md`: this plan.
- `DEVELOPMENT.md`: fixture naming, how to re-capture, how to run tests, how the mock fails on unknown calls.
- `VERIFICATION.md`: commands and results of the checks below.

## Verification
1. Capture run exits 0, prints the sofia report; `ls fetcher/test/fixtures` shows `locations_*` (3) and `sensors_*_hours_page1.json` files, owned by the host user.
2. Sanity: captured sofia pm25 avg matches 11.1 from step 02/03.
3. `node --test test/` with `--network none` → all tests pass.
4. Negative check: temporarily rename one fixture → test fails with `no fixture for …` (then restore).
5. `git status --short` shows only `fetcher/test/`, `fetcher/package.json`, `claude/04-tests/`; `src/` unchanged.

## Revision: how the tests run
- `docker compose run` has no `--network none` flag, so the offline test run uses `docker run` on the built `cleanair-fetcher` image, with `src/` and `test/` mounted.
- In Node 22, `node --test test/` treats `test/` as a module path and fails. A bare `node --test` also picks up the helper files and `capture-fixtures.js`. The script is therefore `node --test 'test/**/*.test.js'`.

## Revision: rename the capture script, move fixtures to `fixtures/openaq-api/`
The user asked for two changes:
- `fetcher/test/capture-fixtures.js` becomes `fetcher/test/capture-openaq-api-fixtures.js` (`git mv` isn't possible yet because the file is untracked, so a plain `mv`).
- All 11 fixture JSON files move from `fetcher/test/fixtures/` to `fetcher/test/fixtures/openaq-api/`. The file names stay the same.

Code:
- In `capture-openaq-api-fixtures.js` and `MockApiClient.js`, `FIXTURES_DIR` changes to `path.join(__dirname, 'fixtures', 'openaq-api')`. The capture script already runs `mkdirSync(..., { recursive: true })`.
- The test file and `fixtureName.js` don't change.

Docs:
- `claude/04-tests/DEVELOPMENT.md`: update the script name, the fixtures path and the re-capture command.
- `claude/04-tests/VERIFICATION.md`: rename the script in the commands, and add a short "after the move" re-run result.
- `PLAN.md`: append this revision.

Verification:
- `ls fetcher/test/fixtures` shows only `openaq-api/`, which contains the 11 files.
- The offline test run (`docker run --network none … node --test 'test/**/*.test.js'`) passes 3/3.
- `grep -rn "capture-fixtures"` finds nothing outside the "issues found" history.
- The capture script is not re-run, because that would make real API calls. `node test/capture-openaq-api-fixtures.js` without a key prints `OPENAQ_API_KEY is not set`, which confirms that it loads.

## Revision: unit test for `OpenAQRepository` with an in-memory `node:sqlite` database

### Context
The user wants a test for `fetcher/src/db/OpenAQRepository.js`. It calls `saveReport` with a report built in the test, then asserts **exactly one** row in `air_quality`, using an in-memory database instead of the MySQL container. There is no real in-memory MySQL for Node, so the test uses `node:sqlite` (`DatabaseSync(':memory:')`). It is built into Node 22: the image runs v22.23.3, where `node:sqlite` needs no flag. No new dependencies.

### No changes to `OpenAQRepository`
- The constructor already takes the connection as a parameter: `new OpenAQRepository(connection, pollutants)`.
- The repository uses only `connection.query(sql, [rows])` and `connection.end()`.
- The test builds the repository directly and never calls `connect()`, so `mysql2` isn't used.

### `fetcher/test/SqliteConnection.js` (new)
A minimal stand-in for a mysql2 connection, backed by `DatabaseSync(':memory:')`:
- The constructor creates `air_quality` as the V2 + V3 schema in SQLite DDL:
  - `id INTEGER PRIMARY KEY AUTOINCREMENT`, `city`, `target_date`, `mean_ratio`, `max_ratio`;
  - `pm25_/pm10_/co_` `average`, `unit` and `ratio`;
  - `created_at DEFAULT CURRENT_TIMESTAMP`, `UNIQUE (city, target_date)`.
- `query(sql, [rows])` turns the repository's MySQL SQL into SQLite SQL. It binds parameters rather than formatting strings, so there are no escaping differences:
  - `VALUES ?` becomes `VALUES (?, …), (?, …)`, one group per row, and the flattened row values are bound;
  - `ON DUPLICATE KEY UPDATE` becomes `ON CONFLICT (city, target_date) DO UPDATE SET`;
  - `VALUES(col)` becomes `excluded.col`.
- `all(sql)` is a helper for the assertions (`SELECT * FROM air_quality`).
- `end()` closes the database.

### `fetcher/test/OpenAQRepository.test.js` (new)
- A setup report for one city, sofia, with `period.to = '2026-10-14T00:00:00Z'` and pm25 11.1 / 0.74, pm10 12.4 / 0.28, co 519.8 / 0.13 (the same values as the captured fixture report).
- `await repository.saveReport(report)` returns `1`.
- `SELECT * FROM air_quality` returns exactly one row. The test `deepEqual`s it, without `created_at`, against:
  - `id: 1`, `city: 'sofia'`, `target_date: '2026-10-14'`;
  - `mean_ratio: 0.38`, which is round((0.74+0.28+0.13)/3, 2);
  - `max_ratio: 0.74`;
  - `pm25_average: 11.1`, `pm25_unit: 'µg/m³'`, `pm25_ratio: 0.74`, and the same for pm10 and co.
- `created_at` matches `/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/`.
- `after`: `repository.close()`.

### Limits
This checks the repository's column list, values, `target_date`, and mean/max ratio logic. It does not check MySQL itself: DECIMAL rounding, or the exact `ON DUPLICATE KEY` behaviour. Those are still covered by the container runs in `03-backfill`.

### Docs
- `claude/04-tests/PLAN.md`: append this revision.
- `DEVELOPMENT.md`: add the repository test, the SQLite adapter, and its limits.
- `VERIFICATION.md`: add the results.

### Verification
- `docker run --rm --network none -v …/src:ro -v …/test:ro cleanair-fetcher node --test 'test/**/*.test.js'` passes 4 of 4, with no MySQL. Any `ExperimentalWarning` for sqlite is noted.
- Negative check: temporarily change one expected value, for example `mean_ratio`. The test fails with a diff, then the value is restored.
- `git status`: `fetcher/src/` is unchanged.

## Revision: split the tests into `test/unit/` and `test/feature/`
The user asked for two moves:
- `fetcher/test/AirQualityIngestion.test.js` → `fetcher/test/unit/AirQualityIngestion.test.js`
- `fetcher/test/OpenAQRepository.test.js` → `fetcher/test/feature/OpenAQRepository.test.js`

Both are moved with `git mv`. `AirQualityIngestion.test.js` is committed in `edbb151`. `OpenAQRepository.test.js` is untracked, so it gets a plain `mv`.

The helpers stay in `fetcher/test/`: `MockApiClient.js`, `fixtureName.js`, `SqliteConnection.js`, `capture-openaq-api-fixtures.js` and `fixtures/openaq-api/`.

`require` paths in the moved files go one level deeper:
- `'../src/…'` → `'../../src/…'`
- `'./MockApiClient'` → `'../MockApiClient'`
- `'./SqliteConnection'` → `'../SqliteConnection'`

`package.json` doesn't change: `'test/**/*.test.js'` already matches the subdirectories.

Docs:
- `DEVELOPMENT.md`: update the test paths in the layout table and add the single-folder run commands (`node --test 'test/unit/**/*.test.js'`, `'test/feature/**/*.test.js'`).
- `VERIFICATION.md`: add the result.
- `PLAN.md`: append this revision.

Verification:
- The full offline run (`docker run --network none … node --test 'test/**/*.test.js'`) passes 4 of 4.
- `test/unit` alone passes 3 tests and `test/feature` alone passes 1.
- `git status` shows the renames, with `fetcher/src/` unchanged.

## Revision: `test-feature.sh` moves to `fetcher/test/`, and `npm run test:feature` runs it

### Context
The user has already copied `fetcher/bin/test-feature.sh` to `fetcher/test/test-feature.sh` and cleared `"test:feature"` in `package.json`. They want `test:feature` to run the `test/feature` tests through the Docker command. The npm script becomes the host-side entry point, and it calls the shell script.

### Changes
- `fetcher/test/test-feature.sh`:
  - `FETCHER_DIR` stays `dirname/..`, which is still `fetcher/`.
  - Inside the container it no longer calls `npm run test:feature`, because that would now recurse back into the script. It runs node directly:
    `cleanair-fetcher node --disable-warning=ExperimentalWarning --test 'test/feature/**/*.test.js' "$@"`
  - The executable bit is kept.
- `fetcher/package.json`: `"test:feature": "test/test-feature.sh"`.
- Delete `fetcher/bin/test-feature.sh`, the old copy. `fetcher/bin/test-unit.sh` is left as it is, since the user didn't ask to change it.

### Notes
- `npm run test:feature` now runs on a machine with npm **and** Docker. It no longer works inside the container, which has no `docker`.
- This host has no npm, so here `./fetcher/test/test-feature.sh` is the way to run it.
- The test globs (`*.test.js`) don't match `.sh`, so the script isn't picked up as a test.

### Docs
- `DEVELOPMENT.md`: update the wrapper paths and the `test:feature` meaning.
- `VERIFICATION.md`: add the result.
- `PLAN.md`: append this revision.

### Verification
- `./fetcher/test/test-feature.sh` gives 1 pass, exit 0.
- Run from `/tmp` by its absolute path, it also passes.
- `npm run test:feature` can't be run on this host (no npm). Its effect is shown by mounting the repo's `fetcher/` into a node container with the docker socket… which is too heavy, so it is skipped. The script name and path are checked by `grep`.
- `git status`: `fetcher/bin/test-feature.sh` is gone, and `fetcher/src/` is unchanged.

## Revision: feature test for `job.js` (mock API client, real ingestion + repository, in-memory DB)

### Context
The user wants an end-to-end feature test of `fetcher/src/job.js` that uses:
- `MockApiClient`, the fixture-backed client;
- the real `AirQualityIngestion` and the real `OpenAQRepository`;
- assertions on the real record(s) in the in-memory database (`SqliteConnection`).

`job.js` can't be tested as it is today:
- `main()` runs as soon as the file is required.
- It builds `ApiClient` and `OpenAQRepository.connect()` (MySQL) itself, reads `process.argv` and `process.env`, sets `process.exitCode`, and pushes to Pushgateway.
- Nothing is exported.

### Approach: a small dependency-injection refactor of `job.js` (behaviour unchanged)
`main` takes optional dependencies, and their defaults are exactly what the job does today:
```js
async function main({
  args = process.argv.slice(2),
  env = process.env,
  createClient = (apiKey) => new ApiClient({ baseUrl: API_BASE, headers: { 'X-API-Key': apiKey } }),
  connectRepository = () => OpenAQRepository.connect({ host: env.DB_HOST, port: env.DB_PORT, user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME }),
  pushgateway = new Pushgateway(PUSHGATEWAY_URL, {}, registry),
} = {}) { … return exitCode; }
```
- `parseArgs({ args, options })`, with the `OPENAQ_API_KEY` check read from `env`.
- `main` **returns** the exit code (0, 1 or 2) instead of setting `process.exitCode`. A test that sets `process.exitCode` would make `node --test` report a failure.
- Entry point:
  ```js
  if (require.main === module) main().then((code) => { process.exitCode = code; }).catch(…existing handler…);
  module.exports = { main };
  ```
- The metrics, the log lines, `repository.close()` and the Pushgateway push all stay. Only where the dependencies come from changes.
- `node src/job.js --city … --date-to …` behaves the same: same exit codes, output and metrics.

The alternative, stubbing `require.cache` / `mysql2` / `prom-client` without touching `job.js`, is rejected as brittle.

### `fetcher/test/SqliteConnection.js` (small change)
`job.js` closes the repository before the test can query. So:
- `end()` only sets `this.ended = true`, which the test asserts to show that the job closed the repository;
- a new `close()` really closes the SQLite database;
- `feature/OpenAQRepository.test.js` changes its `after` to `connection.close()`.

### `fetcher/test/feature/job.test.js` (new)
Shared setup: `const connection = new SqliteConnection()`, `const client = new MockApiClient()`, `pushes = []`, and
```js
const exitCode = await main({
  args: ['--city', 'sofia', '--date-to', '2026-10-14'],
  env: { OPENAQ_API_KEY: 'test-key' },
  createClient: () => client,
  connectRepository: async () => new OpenAQRepository(connection),
  pushgateway: { pushAdd: async (params) => { pushes.push(params); } },
});
```
1. **The job saves the sofia record.**
   - `exitCode === 0`.
   - `connection.all('SELECT * FROM air_quality')` has exactly 1 row, and it deep-equals (without `created_at`):
     - `{ id: 1, city: 'sofia', target_date: '2026-10-14', mean_ratio: 0.38, max_ratio: 0.74 }`;
     - pm25 11.1 / 'µg/m³' / 0.74, pm10 12.4 / 0.28, co 519.8 / 0.13.

     These values come from the captured fixtures through the real `AirQualityIngestion` and the real `OpenAQRepository`.
   - `client.callCount === 11`.
   - `connection.ended === true`.
   - `pushes` deep-equals `[{ jobName: 'cleanair_job' }]`.
2. **Unknown city.**
   - `args: ['--city', 'atlantis']` gives `exitCode === 2`.
   - 0 rows, `client.callCount === 0`.
   - The push still happens, as the job does today when a run fails.

`job.js` prints `Job finished …` during the test. That is expected.

### Running
- The tests sit in `test/feature/`, so the existing `npm run test:feature` / `./fetcher/test/test-feature.sh` picks them up, offline.
- It doesn't need MySQL, Pushgateway or the API.

### Not in scope
`job-backfill.js` has the same structure. The same refactor would make it testable, but that is left for a later step.

### Docs
- `DEVELOPMENT.md`: the job test, `main`'s injectable dependencies, and `SqliteConnection.end`/`close`.
- `VERIFICATION.md`: the results.
- `PLAN.md`: append this revision.

### Verification
- `./fetcher/test/test-feature.sh`: 3 pass (repository + 2 job tests), exit 0.
- `npm test` / unit: still 3 pass.
- The real job is unchanged: in the running container, `docker compose exec fetcher node src/job.js --city sofia --date-to 2026-10-14` exits 0 and prints `Job finished … (success=true)`. This makes 11 real API calls and upserts the same MySQL row. An unknown city gives exit 2.
- Negative check: temporarily change the expected `pm25_average`. The job test fails, then the value is restored.

## Revision: same refactor and feature test for `job-backfill.js`
- `fetcher/src/job-backfill.js`:
  - `main({ args, env, createClient, createIngestion, connectRepository })`, where the defaults are the old behaviour;
  - it returns the exit code;
  - it runs only when `require.main === module`, and exports `{ main }`.
- `fetcher/test/feature/job-backfill.test.js`:
  - a 2-day sofia-only backfill gives 2 rows, 22 calls, the right date windows, and the repository closed;
  - start after end gives exit 2, no rows and no calls.
- Limits: the fixtures cover sofia only, and the fixture names don't include the date. So the test injects a sofia-only `AirQualityIngestion`, and both days have the same values.

## Revision: capture fixtures for ruse and varna, and use all 3 cities in the tests

### Context
The fixtures cover only sofia. Because of that, the `job-backfill.js` test injects a sofia-only `AirQualityIngestion` (`createIngestion`), and no test runs the default "all cities" path. The user wants ruse and varna captured too.

### Capture (real API, same date, 2026-10-14)
```bash
docker compose run --rm --no-deps --user "$(id -u):$(id -g)" -v "$PWD/fetcher/test:/fetcher/test" \
  fetcher node test/capture-openaq-api-fixtures.js --city ruse --date-to 2026-10-14
… --city varna --date-to 2026-10-14
```
- Each city is captured on its own, so the existing sofia files aren't overwritten with newer data.
- New files: `locations_43.8356,25.9657_{1,2,4}.json` and `locations_43.2141,27.9147_{1,2,4}.json`, plus `sensors_<id>_hours_page1.json` for their sensors.
- Before writing, check that no new sensor id clashes with an existing sofia sensor file. Different locations should mean different sensors.
- About 20 API calls in total, under the rate limit.
- Each run prints a report. Those values become the expected values in the tests. If a city returns no data, the expected values follow (`no_data`, no row).

### Tests
- `test/unit/AirQualityIngestion.test.js`: add `run(undefined, '2026-10-14')`. It deep-equals the full 3-city report (sofia, ruse and varna, or `no_data`) and the total call count.
- `test/feature/job.test.js`: add "no `--city`". It expects exit 0, one row per city with data, every column checked, and the total call count.
- `test/feature/job-backfill.test.js`:
  - drop the sofia-only `createIngestion` and run the real default ingestion over all 3 cities;
  - for `13-10-2026..14-10-2026`, expect 2 days × 3 cities = 6 rows (by `target_date, city`), with call count = 2 × the per-day total.
- `fetcher/src/job-backfill.js`: remove the `createIngestion` option, since only the test needed it. Its dependencies then match `job.js`: `args`, `env`, `createClient` and `connectRepository`. Behaviour is unchanged.
- Shared expected rows: each test file keeps its own literals, like the existing tests. No new helper.

### Remaining limit
Fixture names don't include the date, so in the backfill test both days still have the 2026-10-14 values.

### Docs
- `DEVELOPMENT.md`: the fixtures now cover all 3 cities, the capture commands are listed per city, and the sofia-only limit is removed.
- `VERIFICATION.md`: the capture output and the test results.
- `PLAN.md`: append this revision.

### Verification
- Both capture runs exit 0, and the new files are owned by the host user. `git status` shows only added fixture files, with the sofia files unchanged.
- `./fetcher/test/test-feature.sh` and `npm test` (unit) pass offline (`--network none`).
- `docker compose exec fetcher node src/job-backfill.js --start-date 11-10-2026` still exits 2, which confirms the entry point after removing `createIngestion`.
