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
