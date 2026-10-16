# Development: unit tests

## Layout
| File | Role |
|---|---|
| `fetcher/test/unit/AirQualityIngestion.test.js` | `node:test` tests for `AirQualityIngestion.run` |
| `fetcher/test/MockApiClient.js` | Stand-in for `ApiClient`. It answers `get(path, query)` from `fixtures/openaq-api/` and never uses the network |
| `fetcher/test/fixtureName.js` | Maps a `get(path, query)` call to a fixture file name. Shared by the mock and the capture script |
| `fetcher/test/capture-openaq-api-fixtures.js` | Runs the real `ApiClient` + `AirQualityIngestion` (as `job.js` does) and saves every response |
| `fetcher/test/fixtures/openaq-api/*.json` | Real OpenAQ responses for `--city sofia --date-to 2026-10-14` |
| `fetcher/test/feature/OpenAQRepository.test.js` | `node:test` test for `OpenAQRepository.saveReport` against an in-memory SQLite database |
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
This makes real API calls (11 for sofia) and overwrites the matching files in `fixtures/openaq-api/`:
```bash
docker compose run --rm --no-deps --user "$(id -u):$(id -g)" -v "$PWD/fetcher/test:/fetcher/test" \
  fetcher node test/capture-openaq-api-fixtures.js --city sofia --date-to 2026-10-14
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
