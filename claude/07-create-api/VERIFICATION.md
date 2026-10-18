# API and UI: verification (2026-10-18)

1. **Build.** `docker compose build api` built `cleanair-api`. `docker compose up -d --build api` started `cleanair-api-1`, and the log shows `API listening on :8080`.
2. **Feature tests.** `api/test/test-feature.sh` gave **6 pass, 0 fail**. The tests covered:
   - two different winners (ruse for mean, sofia for max);
   - both range dates being included;
   - five 400 cases;
   - 404;
   - 500 from a failing repository;
   - the UI page.
3. **Data.** `docker compose exec dummy-dev-populator node src/job.js --date-from 01-09-2026` reported `days=48, inserted=0, skipped=144`. The data for 2026-09-01..2026-10-18 was already there.
4. **Endpoint vs SQL.** `curl 'localhost:8080/cleanest-city?date-from=2026-09-01&date-to=2026-10-18'` returned:
   ```json
   {"mean_polution":{"city":"ruse","period_mean_polution":1.49,"period_max_polution":2.22},
    "lowest_single_pollutant_max_polution":{"city":"ruse","period_mean_polution":1.49,"period_max_polution":2.22}}
   ```
   The same query run directly in MySQL gave:
   ```
   ruse   1.492708  2.219375
   sofia  1.677917  2.450833
   varna  1.541875  2.225625
   ```
   ruse has the lowest value in both columns, and the rounded values match.
5. **Single day.** `date-from=date-to=2026-10-18` returned varna (0.22 / 0.37). A one-day range works because both dates are included.
6. **Error paths.**
   - These all returned `400 {"error":"date-from and date-to are required in YYYY-MM-DD format"}`:
     - no params;
     - only `date-from`;
     - `01-10-2026`;
     - `2026-02-31`;
     - `2026-13-01`.
   - `date-from=2026-10-02&date-to=2026-10-01` returned `400 {"error":"date-from must not be after date-to"}`.
   - `2000-01-01..2000-02-01` returned `404 {"error":"No data for the selected period"}`.
   - With MySQL stopped, the API returned `500 {"error":"Internal error"}` and logged `getaddrinfo ENOTFOUND mysql`. After `docker compose start mysql`, the same request returned 200 again without restarting the API.
7. **UI.** `GET /` returns 200 and references `flatpickr@4.6.13`. The CDN script URL returns 200. The page was **not** clicked through in a browser, so the date picker and the two result rows still need a manual check at http://localhost:8080.
8. **`git status --short`.** Only `README.md`, `docker-compose.yml`, `api/` and `claude/07-create-api/` changed. `fetcher/`, `archiver/`, `dummy-dev-populator/` and the earlier `claude/0*` folders are unchanged.

## Revision: one cleanest city, ranked in SQL (2026-10-18)
1. **Build and tests.** `docker compose build api && api/test/test-feature.sh` gave **6 pass, 0 fail**. The tests covered:
   - the ranking: varna wins with `{period_max_polution: 1.25, period_mean_polution: 0.5}`, beating ruse on the mean tie-breaker and sofia, which has the lowest mean but a higher max;
   - both range dates being included;
   - the 400 cases;
   - 404;
   - 500;
   - the UI page.
2. **Endpoint vs SQL.** After `docker compose restart api`, `curl 'localhost:8080/cleanest-city?date-from=2026-09-01&date-to=2026-10-18'` returned:
   ```json
   {"city":"ruse","period_max_polution":2.219375,"period_mean_polution":1.492708}
   ```
   The values are numbers and are not rounded. Running the requirements' query in MySQL (with `BETWEEN` and no `LIMIT`) gave:
   ```
   ruse   2.219375  1.492708
   varna  2.225625  1.541875
   sofia  2.450833  1.677917
   ```
   The API returned the first row unchanged.
3. **Error paths.**
   - `2026-02-31` returned 400 with the format error.
   - `date-from` after `date-to` returned 400 with `date-from must not be after date-to`.
   - `2000-01-01..2000-02-01` returned 404.
4. **UI.** `GET /` returns 200, and the page has one `Cleanest City` row template, `… with ${body.period_max_polution} and ${body.period_mean_polution}`. The page has still **not** been clicked through in a browser.
