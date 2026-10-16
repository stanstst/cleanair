# Development: unit tests

## Layout
| File | Role |
|---|---|
| `fetcher/test/unit/AirQualityIngestion.test.js` | `node:test` tests for `AirQualityIngestion.run` |
| `fetcher/test/MockApiClient.js` | Stand-in for `ApiClient`. It answers `get(path, query)` from `fixtures/openaq-api/` and never uses the network |
| `fetcher/test/fixtureName.js` | Maps a `get(path, query)` call to a fixture file name. Shared by the mock and the capture script |
| `fetcher/test/capture-openaq-api-fixtures.js` | Runs the real `ApiClient` + `AirQualityIngestion` (as `job.js` does) and saves every response |
| `fetcher/test/fixtures/openaq-api/*.json` | Real OpenAQ responses for sofia, ruse and varna, `--date-to 2026-10-14` (29 files, one per API call) |
| `fetcher/test/feature/OpenAQRepository.test.js` | `node:test` test for `OpenAQRepository.saveReport` against an in-memory SQLite database |
| `fetcher/test/feature/job.test.js` | Feature test of `job.js`: `MockApiClient` + real `AirQualityIngestion` + real `OpenAQRepository` on `SqliteConnection` |
| `fetcher/test/feature/job-backfill.test.js` | Feature test of `job-backfill.js`: same stack, all 3 cities, 2-day range |
| `fetcher/test/SqliteConnection.js` | Stand-in for a mysql2 connection, backed by `node:sqlite` (`:memory:`) with the `air_quality` table |
| `fetcher/test/test-feature.sh` | Host script behind `npm run test:feature`. Runs the `test/feature` tests in the image, offline |
| `fetcher/bin/test-unit.sh` | Host wrapper: runs `npm test` in the image, offline |

No new dependencies: the tests use the built-in `node:test` and `node:assert/strict`.

## Fixture naming
The name is the path segments joined with `_`, then the query values that change between calls (`coordinates`, `parameters_id`, `page`):
- `/locations?coordinates=42.6977,23.3219&parameters_id=2…` → `locations_42.6977,23.3219_2.json`
- `/sensors/1293779/hours?…&page=1` → `sensors_1293779_hours_page1.json`

`datetime_from` / `datetime_to`, `limit`, `radius` and `monitor` are not part of the name. The test checks the date window on the recorded calls instead.

## Running the tests
There is no Node on the host, and only `fetcher/src` is mounted into the fetcher container. Run the tests in the image, with networking disabled to show that no API request is made:
```bash
docker run --rm --network none \
  -v "$PWD/fetcher/src:/fetcher/src:ro" -v "$PWD/fetcher/test:/fetcher/test:ro" \
  cleanair-fetcher node --test 'test/**/*.test.js'
```
One folder only:
```bash
… cleanair-fetcher node --test 'test/unit/**/*.test.js'
… cleanair-fetcher node --test 'test/feature/**/*.test.js'
```
- `test/unit/`: `AirQualityIngestion` with `MockApiClient`.
- `test/feature/`: `OpenAQRepository` with the in-memory SQLite `SqliteConnection`.
- The shared helpers and `fixtures/` stay in `test/`.

npm scripts in `fetcher/package.json`:
- `npm test` runs `test/unit/**/*.test.js`, inside the image.
- `npm run test:feature` runs `test/test-feature.sh` on the host. That script starts the `cleanair-fetcher` image and runs `node --disable-warning=ExperimentalWarning --test 'test/feature/**/*.test.js'` in it. This needs npm and Docker on the host. It doesn't work inside the container, which has no `docker`.

Without npm on the host, call the scripts directly. Both mount `package.json`, `src` and `test` read-only and use `--network none`:
```bash
./fetcher/test/test-feature.sh   # test/feature tests
./fetcher/bin/test-unit.sh       # npm test (test/unit) in the image
```
- Paths are resolved from the script's own location, so the scripts work from any directory.
- Extra arguments are passed through to `node --test`.
- The mounted `package.json` means the image only needs a rebuild when dependencies change.

## Re-capturing fixtures
This makes real API calls (sofia 11, ruse 10, varna 8) and overwrites the matching files in `fixtures/openaq-api/`. Capture one city at a time, so you only refresh the files you mean to:
```bash
docker compose run --rm --no-deps --user "$(id -u):$(id -g)" -v "$PWD/fetcher/test:/fetcher/test" \
  fetcher node test/capture-openaq-api-fixtures.js --city sofia --date-to 2026-10-14
# same for --city ruse and --city varna
```
The report goes to stdout. Progress lines (`saved …`, `api_calls=…`) go to stderr. If you capture a different city or date, update `expected` and the expected call list in the test from that output.

## Missing fixtures
If `AirQualityIngestion` makes a call that has no fixture, `MockApiClient.get` throws `no fixture for <path> <query> (<file>)`. The test then fails instead of quietly reaching the network.

## `OpenAQRepository` test (in-memory SQLite)
- `OpenAQRepository` needs no changes. Its constructor takes the connection, and it only calls `connection.query(sql, [rows])` and `connection.end()`. The test passes in a `SqliteConnection` and never calls `connect()`.
- `SqliteConnection` creates `air_quality` from migrations V2 + V3, written as SQLite DDL. In `query` it rewrites the repository's MySQL SQL:
  - `VALUES ?` → one `(?, …)` group per row, with the flattened values bound as parameters;
  - `ON DUPLICATE KEY UPDATE` → `ON CONFLICT (city, target_date) DO UPDATE SET`;
  - `VALUES(col)` → `excluded.col`.
- The test saves a one-city (sofia, 2026-10-14) report. It checks that `saveReport` returns 1 and that exactly one row is in `air_quality`, and it compares every column except `created_at`. `created_at` is matched against `YYYY-MM-DD HH:MM:SS`.
- `node:sqlite` is built into Node 22, which the image uses. Loading it prints `ExperimentalWarning: SQLite is an experimental feature`. The warning is harmless, but it looks like an error, so `test/test-feature.sh` hides it with `node --disable-warning=ExperimentalWarning`.
- Limits: the test covers the repository's columns, values, `target_date` and mean/max ratio. It does not cover MySQL itself (DECIMAL rounding, or the exact `ON DUPLICATE KEY` behaviour).
- If the schema changes in a new migration, update `SCHEMA` in `SqliteConnection.js` to match.

## `job.js` feature test
`fetcher/src/job.js` now exports `main(deps)`. It runs only when started as a script (`require.main === module`). Every dependency is optional, and the defaults are what the job used before:

| option | default |
|---|---|
| `args` | `process.argv.slice(2)` |
| `env` | `process.env` |
| `createClient(apiKey)` | `new ApiClient({ baseUrl: API_BASE, headers: { 'X-API-Key': apiKey } })` |
| `connectRepository()` | `OpenAQRepository.connect({ host: env.DB_HOST, … })` |
| `pushgateway` | `new Pushgateway(PUSHGATEWAY_URL, {}, registry)` |

`main` returns the exit code (0 / 1 / 2), and the entry point sets `process.exitCode` from it. Exit codes, log lines and metrics are unchanged.

`test/feature/job.test.js` calls `main` with:
- `args: ['--city', 'sofia', '--date-to', '2026-10-14']`;
- `createClient: () => new MockApiClient()`;
- `connectRepository: async () => new OpenAQRepository(new SqliteConnection())`;
- a Pushgateway stand-in that records `pushAdd` calls.

It asserts:
- exit 0;
- exactly one `air_quality` row (sofia, 2026-10-14, mean 0.38, max 0.74, pm25 11.1, pm10 12.4, co 519.8);
- 11 API calls;
- the repository was closed;
- one push with `{ jobName: 'cleanair_job' }`.

A second test checks that `--city atlantis` gives exit 2, no rows and no API calls, and still pushes.

`SqliteConnection.end()` only sets `ended = true`, so the test can still query after the job closes the repository. `close()` really closes the database.

`job-backfill.js` gets the same treatment, described in the next section.

## `job-backfill.js` feature test
`job-backfill.js` gets the same refactor as `job.js`:
- It exports `main(deps)` and runs only when started as a script.
- `main` returns the exit code.
- It takes the options `args`, `env`, `createClient(apiKey)` and `connectRepository()`. There is no Pushgateway, because the backfill doesn't push.

`test/feature/job-backfill.test.js`:
- `--start-date 13-10-2026 --end-date 14-10-2026` runs the real `AirQualityIngestion` over all 3 cities. It gives exit 0 and exactly 6 rows, sofia, ruse and varna on each day, with every column checked.
- It makes 58 API calls (29 per day), and the request windows end at `2026-10-13T00:00:00Z` and `2026-10-14T00:00:00Z`.
- The repository is closed at the end.
- Start after end gives exit 2, no rows and no API calls.

Limit: fixture names don't include the date, so both days get the 2026-10-14 responses, and each city has the same values on both days. The test checks the day and city loops, the date windows, `target_date` and saving, not data that differs by day.

## Expected values (2026-10-14)
| city | pm25 | pm10 | co | mean_ratio | max_ratio | API calls |
|---|---|---|---|---|---|---|
| sofia | 11.1 / 0.74 | 12.4 / 0.28 | 519.8 / 0.13 | 0.38 | 0.74 | 11 |
| ruse | 5.9 / 0.39 | 6.6 / 0.15 | 258.6 / 0.06 | 0.2 | 0.39 | 10 |
| varna | 4 / 0.27 | 6.8 / 0.15 | 397.7 / 0.1 | 0.17 | 0.27 | 8 |
