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
