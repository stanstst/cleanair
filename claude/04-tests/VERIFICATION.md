# Verification

Verification was run on 2026-10-16 against [PLAN.md](PLAN.md), on branch `04-tests` from commit `ee8db02`. Nothing is committed.

## 1. Capture (real API)
`docker compose run --rm --no-deps --user "$(id -u):$(id -g)" -v "$PWD/fetcher/test:/fetcher/test" fetcher node test/capture-openaq-api-fixtures.js --city sofia --date-to 2026-10-14`
- Exit 0, `api_calls=11`. Period `2026-10-13T00:00:00Z → 2026-10-14T00:00:00Z`.
- 11 files written, owned by `stan`:
  - 3 `locations_42.6977,23.3219_{1,2,4}.json`;
  - 8 `sensors_<id>_hours_page1.json`.
- `sensors_25790_hours_page1.json` has `results: []`, so pm10 uses 2 of its 3 stations.

## 2. Sanity
| pollutant | avg | ratio | stations |
|---|---|---|---|
| pm25 | 11.1 | 0.74 | 2 |
| pm10 | 12.4 | 0.28 | 2 |
| co | 519.8 | 0.13 | 3 |

pm25 11.1 matches the sofia 2026-10-14 value from steps 02 and 03.

## 3. Unit tests, network disabled
`docker run --rm --network none -v …/src:ro -v …/test:ro cleanair-fetcher node --test 'test/**/*.test.js'`
```
ok 1 - run builds the sofia report from the captured API responses
ok 2 - run rejects an unknown city without calling the API
ok 3 - run rejects an invalid or future date-to without calling the API
# tests 3  # pass 3  # fail 0
```
Exit 0.

## 4. Missing fixture
With `sensors_25834_hours_page1.json` moved away, test 1 fails (exit 1) with:
`no fixture for /sensors/25834/hours {"datetime_from":"2026-10-13T00:00:00Z",…,"page":1} (sensors_25834_hours_page1.json)`
The file was then restored.

## 5. Changes
`git status --short`: ` M fetcher/package.json`, `?? claude/04-tests/`, `?? fetcher/test/`. `fetcher/src/` is unchanged.

## Issues found while running
- `docker compose run` does not accept `--network none`, so the tests run with `docker run`.
- `node --test test/` fails in Node 22 (`Cannot find module '/fetcher/test'`). A bare `node --test` also runs the capture script, which fails because `OPENAQ_API_KEY` is not set. The glob `'test/**/*.test.js'` fixes both.

## 6. After renaming the capture script and moving the fixtures to `fixtures/openaq-api/`
- `fetcher/test/fixtures/` contains only `openaq-api/`, which holds the 11 JSON files under the same names.
- The offline test run (`docker run --network none …`) passes 3 of 3, exit 0.
- `node test/capture-openaq-api-fixtures.js` with no key prints `OPENAQ_API_KEY is not set` (exit 1). This shows the renamed script loads. It was not re-run against the API.

## 7. `OpenAQRepository` test (in-memory SQLite, no MySQL)
`docker run --rm --network none -v …/src:ro -v …/test:ro cleanair-fetcher node --test 'test/**/*.test.js'`
```
ok 1 - run builds the sofia report from the captured API responses
ok 2 - run rejects an unknown city without calling the API
ok 3 - run rejects an invalid or future date-to without calling the API
# (node:14) ExperimentalWarning: SQLite is an experimental feature and might change at any time
ok 4 - saveReport inserts one air_quality row for the report city and date
# tests 4  # pass 4  # fail 0
```
Exit 0. The run needs no MySQL container and no network.

Negative check: with the expected `mean_ratio` temporarily changed to `0.39`, test 4 fails (exit 1) with the diff `+ mean_ratio: 0.38 / - mean_ratio: 0.39`. The value was then restored.

`git status --short`: `?? fetcher/test/OpenAQRepository.test.js`, `?? fetcher/test/SqliteConnection.js`, plus the `claude/04-tests/` doc updates. `fetcher/src/` is unchanged.

## 8. Tests split into `test/unit/` and `test/feature/`
`AirQualityIngestion.test.js` moved to `test/unit/` (`git mv`). `OpenAQRepository.test.js` moved to `test/feature/`. In both files the `require` paths now point one level up (`../../src/…`, `../MockApiClient`, `../SqliteConnection`).

| glob | result |
|---|---|
| `'test/**/*.test.js'` | 4 pass, 0 fail, exit 0 |
| `'test/unit/**/*.test.js'` | 3 pass, exit 0 |
| `'test/feature/**/*.test.js'` | 1 pass, exit 0 |

All three runs used `--network none`. `fetcher/src/` is unchanged.

## 9. `test:feature` npm script
- `fetcher/package.json`: `"test"` runs `'test/unit/**/*.test.js'` (changed by the user). The new `"test:feature"` runs `'test/feature/**/*.test.js'`.
- `npm run test:feature`, run in the image with `package.json`, `src` and `test` mounted and `--network none`, gives 1 pass, exit 0.
- Follow-up: the SQLite `ExperimentalWarning` in the output looked like an error. `test:feature` now runs `node --disable-warning=ExperimentalWarning --test …`. The output no longer has the warning, and the result is still 1 pass, exit 0.

## 10. Host wrapper scripts
The user chose shell wrappers, because the host has no Node/npm and an npm script can't start `docker run` itself.
- `./fetcher/bin/test-feature.sh` runs `npm run test:feature` in the image: 1 pass, exit 0.
- `fetcher/bin/test-unit.sh`, run from `/tmp`, runs `npm test`: 3 pass, exit 0. This shows that paths resolve from the script's own location.

## 11. `test-feature.sh` moved to `fetcher/test/`, and `test:feature` calls it
- `fetcher/test/test-feature.sh` now runs `node --disable-warning=ExperimentalWarning --test 'test/feature/**/*.test.js'` in the image. It no longer runs `npm run test:feature`, which would call the script again. `fetcher/bin/test-feature.sh` is removed.
- `package.json`: `"test:feature": "test/test-feature.sh"`.
- `./fetcher/test/test-feature.sh` gives 1 pass, exit 0. The same script run from `/tmp` gives 1 pass, exit 0.
- `npm run test:feature` itself was not run, because this host has no npm.
