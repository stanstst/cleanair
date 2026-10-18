# Step 07: `api` service with `GET /cleanest-city` and a date-picker UI

## Context
`claude/07-create-api/REQUIREMENTS.md` asks for an HTTP API and a simple web page that answer "which city was cleanest over a period", using the `mean_ratio` / `max_ratio` columns already stored in `air_quality`.

The user made these choices:
- **No `method` param.** The endpoint always returns both winners (lowest period mean and lowest period max), since the UI shows both.
- **Inclusive dates:** `target_date BETWEEN date-from AND date-to` (the example SQL's strict `>`/`<` is not used).
- **Express** for the HTTP server, which also serves the UI page.
- **Feature tests** against in-memory SQLite, like `archiver/test`.

Fixes to obvious typos in the requirements (flag to the user):
- The payload key `lowest_single_poputent_max_polution` becomes `lowest_single_pollutant_max_polution`; the existing `polution` spelling is kept everywhere else, as specified.
- The second UI row shows the **max** winner and its `period_max_polution` (the requirements repeat `period_mean_polution`).

Rules carried over from earlier steps: no commits, no code comments, earlier `claude/0*` folders and other services unchanged.

## Changes

### `api/package.json`, `api/Dockerfile`, `api/.dockerignore` (new)
- Copied from `archiver/`. Name `cleanair-api`, description "HTTP API and UI for the cleanest city", deps `express` (^4.21) and `mysql2`, script `test:feature`.
- Dockerfile: `node:22-alpine`, `WORKDIR /api`, copies `src` and `public`, `EXPOSE 8080`, `CMD ["node", "src/server.js"]`.

### `docker-compose.yml`: new `api` service
- `build: ./api`, runs the server directly (no `sleep infinity`).
- `DB_*` env vars as in `archiver`, plus `PORT: 8080`; `ports: "8080:8080"`.
- Volumes `./api/src:/api/src:ro` and `./api/public:/api/public:ro`.
- `depends_on: migrate (service_completed_successfully)`, `restart: unless-stopped`.

### `api/src/db/CityRepository.js` (new)
- `static connect({...})` like `archiver/src/db/AirQualityRepository.js:8`, but with `mysql.createPool` (long-running server) and `dateStrings: true`.
- `findPeriodPollution(dateFrom, dateTo)`:
  ```sql
  SELECT city, AVG(mean_ratio) AS period_mean_polution, AVG(max_ratio) AS period_max_polution
  FROM air_quality WHERE target_date BETWEEN ? AND ? GROUP BY city ORDER BY city
  ```
  Maps both averages to `Number(x).toFixed(2)` → number (mysql2 returns DECIMAL averages as strings).
- `close()`.

### `api/src/app.js` (new)
`createApp({ repository })` returns the Express app, so tests can inject the repository:
- `express.static(path.join(__dirname, '../public'))`.
- `GET /cleanest-city?date-from=YYYY-MM-DD&date-to=YYYY-MM-DD`:
  - Validates both params: required, `YYYY-MM-DD`, a real calendar date (round-trip through `Date`), and `date-from <= date-to`. Otherwise `400 { error }`.
  - `records = await repository.findPeriodPollution(...)`; empty → `404 { error: 'No data for the selected period' }`.
  - Picks, in the endpoint code, the record with the lowest `period_mean_polution` and the record with the lowest `period_max_polution` (first wins on ties; records are ordered by city).
  - `200 { mean_polution: {city, period_mean_polution, period_max_polution}, lowest_single_pollutant_max_polution: {…} }`.
  - Repository errors → `500 { error: 'Internal error' }` and `console.error`.

### `api/src/server.js` (new)
Connects `CityRepository` from `DB_*` env, `createApp(...).listen(PORT ?? 8080)`, logs `API listening on :8080`, closes the pool on `SIGTERM`/`SIGINT`.

### `api/public/index.html` (new)
- [flatpickr](https://flatpickr.js.org) 4.6.13 from jsdelivr CDN (CSS + JS); two inputs, `date-from` and `date-to`, `dateFormat: 'Y-m-d'`, defaulting to the last 365 days, plus a "Find" button.
- `fetch('/cleanest-city?...')` (same origin, no CORS) and renders two rows:
  - `Cleanest City by overall pollution load is: <mean_polution.city> with <mean_polution.period_mean_polution>`
  - `Cleanest City by max single pollutant is: <lowest_….city> with <lowest_….period_max_polution>`
- Shows the `error` message on 400/404/500. Minimal inline CSS.

### Tests (new)
- `api/test/SqliteConnection.js`: copied from `archiver/test/SqliteConnection.js`.
- `api/test/feature/cleanest-city.test.js`: seeds rows, starts `createApp` on port 0, calls it with global `fetch`. Cases:
  - both winners are correct, and can be different cities;
  - date bounds are inclusive; rows outside the range are ignored;
  - 400 for missing param, bad format, `31-02`-style invalid date, `date-from > date-to`;
  - 404 for a range with no rows;
  - `GET /` serves the HTML page.
- `api/test/test-feature.sh`: same as the archiver's, image `cleanair-api`, mounts `package.json`, `src`, `public`, `test`.

### `README.md`
Section "API and UI" after "Populating dummy data": `docker compose up -d --build api`, a `curl` example, and the UI at http://localhost:8080.

### `claude/07-create-api/PLAN.md`
A copy of this plan.

## Verification
1. `docker compose build api && api/test/test-feature.sh` → all tests pass.
2. `docker compose up -d --build api`, then fill data: `docker compose exec dummy-dev-populator node src/job.js --date-from 01-09-2026`.
3. `curl 'localhost:8080/cleanest-city?date-from=2026-09-01&date-to=2026-10-18'` returns both winners; cross-check against the SQL run in MySQL directly.
4. `curl` with bad/missing dates → 400; a range before any data → 404.
5. Open http://localhost:8080, pick dates in the calendar, click Find; both rows show and match the curl output.

---

## Revision (2026-10-18): one cleanest city, ranked in SQL

### Context
`claude/07-create-api/REQUIREMENTS.md` changed. The `api` service already exists from the first version of step 07, so this revision only adjusts it:
- **Ranking in SQL:** the query now orders by `avg(max_ratio)`, then `avg(mean_ratio)`, and uses `LIMIT 1`. The endpoint returns that single record.
- **No changes to the record:** the app code must not change the data, so the endpoint no longer picks two winners and the 2-decimal rounding is removed.
- **Flat payload:** the response is just the record, `{city, period_max_polution, period_mean_polution}`.
- **One UI row:** `Cleanest City by overall pollution load is: <city> with <period_max_polution> and <period_mean_polution>`.

Decisions:
- **Number format (user choice):** mysql2's `decimalNumbers: true` pool option returns the averages as JSON numbers without any conversion in app code.
- **Dates still inclusive:** `BETWEEN`, the earlier choice. The example SQL still uses strict `>`/`<`.
- **Ties:** the `ORDER BY` is kept exactly as in the requirements. If two cities tie on both averages, which one MySQL returns is undefined; that is practically impossible with real data.
- **Unchanged:** validation, the 400/404/500 responses, the Docker and compose setup, and `server.js`.
- **Carried-over rules:** no commits, no code comments.

### Changes

#### `api/src/db/CityRepository.js`
- Add `decimalNumbers: true` to `createPool`, and remove the `round` helper and the row mapping.
- Rename `findPeriodPollution` to `findCleanest(dateFrom, dateTo)`. It returns `rows[0]` (or `undefined`):
  ```sql
  SELECT city, AVG(max_ratio) AS period_max_polution, AVG(mean_ratio) AS period_mean_polution
  FROM air_quality
  WHERE target_date BETWEEN ? AND ?
  GROUP BY city
  ORDER BY AVG(max_ratio), AVG(mean_ratio)
  LIMIT 1
  ```

#### `api/src/app.js`
- Remove `lowestBy`.
- `const record = await repository.findCleanest(...)`:
  - no record: 404, as before;
  - otherwise: `res.json(record)`.

#### `api/public/index.html`
- Show one row: `Cleanest City by overall pollution load is: ${body.city} with ${body.period_max_polution} and ${body.period_mean_polution}`.
- The values are shown exactly as the API returns them.

#### `api/test/feature/cleanest-city.test.js`
- Rework the seed data so it checks the ordering:
  - city A has the lowest mean but not the lowest max, so the lowest max wins;
  - two cities share the same average max, so the lower mean breaks the tie.
- Assert the full flat body, using values that are exact in floating point (e.g. 0.5, 1.25), because nothing is rounded any more.
- Keep the tests for inclusive date bounds, 400, 404, 500 and the UI page. The 500 test's fake repository uses `findCleanest`.

#### Docs
- `README.md`, section "API and UI": the new ranking rule and a flat JSON example.
- `claude/07-create-api/PLAN.md`: add a "Revision" section with this plan.
- `claude/07-create-api/DEVELOPMENT.md`: update the components, the selection SQL and ordering, the response, the number format and the UI row.
- `claude/07-create-api/VERIFICATION.md`: add a "Revision (2026-10-18)" section with the new run results.

### Verification
1. Run `docker compose build api && api/test/test-feature.sh`. All tests pass.
2. Run `docker compose restart api`, then `curl 'localhost:8080/cleanest-city?date-from=2026-09-01&date-to=2026-10-18'`.
   - It returns one flat record with numeric, unrounded values.
   - The record matches the requirements' query run directly in MySQL with `BETWEEN` and the same dates.
3. Check the error responses again: bad dates give 400, an empty range gives 404.
4. `GET /` returns 200. The page still needs a manual check in a browser: one row with the city and both values.
