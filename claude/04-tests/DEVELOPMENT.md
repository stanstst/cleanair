# Development: unit tests

## Layout
| File | Role |
|---|---|
| `fetcher/test/AirQualityIngestion.test.js` | `node:test` tests for `AirQualityIngestion.run` |
| `fetcher/test/MockApiClient.js` | Stand-in for `ApiClient`. It answers `get(path, query)` from `fixtures/openaq-api/` and never uses the network |
| `fetcher/test/fixtureName.js` | Maps a `get(path, query)` call to a fixture file name. Shared by the mock and the capture script |
| `fetcher/test/capture-openaq-api-fixtures.js` | Runs the real `ApiClient` + `AirQualityIngestion` (as `job.js` does) and saves every response |
| `fetcher/test/fixtures/openaq-api/*.json` | Real OpenAQ responses for `--city sofia --date-to 2026-10-14` |

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
`npm test` runs the same glob. It needs the image to be rebuilt first, because `package.json` is baked into the image.

## Re-capturing fixtures
This makes real API calls (11 for sofia) and overwrites the matching files in `fixtures/openaq-api/`:
```bash
docker compose run --rm --no-deps --user "$(id -u):$(id -g)" -v "$PWD/fetcher/test:/fetcher/test" \
  fetcher node test/capture-openaq-api-fixtures.js --city sofia --date-to 2026-10-14
```
The report goes to stdout. Progress lines (`saved …`, `api_calls=…`) go to stderr. If you capture a different city or date, update `expected` and the expected call list in the test from that output.

## Missing fixtures
If `AirQualityIngestion` makes a call that has no fixture, `MockApiClient.get` throws `no fixture for <path> <query> (<file>)`. The test then fails instead of quietly reaching the network.
