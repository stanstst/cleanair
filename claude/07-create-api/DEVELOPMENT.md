# API and UI: development notes

## Components (`api/`)
- `src/server.js` is the entry point. It connects `CityRepository` from the `DB_*` env vars, listens on `PORT` (default 8080), and closes the pool on `SIGTERM`/`SIGINT`.
- `src/app.js`:
  - `createApp({ repository })` returns the Express app. The repository is injected, so tests can run against SQLite.
  - It serves `public/` as static files and `GET /cleanest-city`.
  - The endpoint validates the dates and returns the repository's record unchanged.
- `src/db/CityRepository.js`:
  - `connect()` uses `mysql.createPool` (the server runs for a long time) with `dateStrings: true` and `decimalNumbers: true`.
  - `findCleanest(dateFrom, dateTo)` runs the selection query and returns the single top row, or `undefined` when there is none.
- `public/index.html` is the UI. It uses [flatpickr](https://flatpickr.js.org) 4.6.13 from the jsdelivr CDN.

## Usage
```bash
docker compose up -d --build api
curl 'http://localhost:8080/cleanest-city?date-from=2025-10-06&date-to=2026-10-06'
```
The UI is at http://localhost:8080.

`src/` and `public/` are mounted read-only. A change to `public/` applies on the next page load. A change to `src/` needs `docker compose restart api`, because the server is a long-running process. A change to `package.json` needs `--build`.

## Endpoint: `GET /cleanest-city`
Query params:
| Param | Format | Required |
|---|---|---|
| `date-from` | `YYYY-MM-DD` | yes |
| `date-to` | `YYYY-MM-DD` | yes |

Selection (the ranking happens in SQL):
```sql
SELECT city, AVG(max_ratio) AS period_max_polution, AVG(mean_ratio) AS period_mean_polution
FROM air_quality
WHERE target_date BETWEEN ? AND ?
GROUP BY city
ORDER BY AVG(max_ratio), AVG(mean_ratio)
LIMIT 1
```
- The city with the lowest average `max_ratio` wins. If two cities have the same average max, the one with the lower average `mean_ratio` wins.
- If two cities tie on both averages, which one MySQL returns is undefined. The `ORDER BY` is kept exactly as specified.
- Both dates are inclusive. The example SQL in the requirements uses strict `>`/`<`, but inclusive ranges were chosen to match the backfill job.

Every response from this route, errors included, sends `Content-Type: application/json; charset=utf-8`. The handler sets it first, and Express adds the charset.

Response `200`, the record exactly as the query returns it:
```json
{ "city": "ruse", "period_max_polution": 2.219375, "period_mean_polution": 1.492708 }
```
- **Number format:** the values are not rounded or converted in app code. By default mysql2 returns `AVG` of a `DECIMAL` column as a string, so `decimalNumbers: true` on the pool makes it return numbers instead. MySQL returns the averages with 6 decimals.

Errors:
| Status | When | Body |
|---|---|---|
| `400` | a date is missing, not `YYYY-MM-DD`, or not a real date (e.g. `2026-02-31`) | `{"error":"date-from and date-to are required in YYYY-MM-DD format"}` |
| `400` | `date-from` is after `date-to` | `{"error":"date-from must not be after date-to"}` |
| `404` | no rows in the period | `{"error":"No data for the selected period"}` |
| `500` | database error (the message goes to stderr) | `{"error":"Internal error"}` |

## UI
- Two flatpickr inputs (`Y-m-d`) default to one year ago and today, plus a **Find** button.
- It calls `/cleanest-city` on the same origin, so no CORS setup is needed.
- It shows one row: `Cleanest City by overall pollution load is: <city> with <period_max_polution> and <period_mean_polution>`. The values are shown as the API returns them.
- An API error message is shown in red.
- flatpickr loads from the CDN, so the browser needs internet access.
- The 640px page width is set on `<main>`, not on `<body>`. flatpickr compares the input's position, measured from the window's left edge, against `document.body.offsetWidth`. With a narrow body it decides the input is at the right edge and opens the calendar near the window's right edge, off screen.

## Tests
- `api/test/test-feature.sh` runs `test/feature/**/*.test.js` in the `cleanair-api` image with `--network none`. The image must be built first (`docker compose build api`).
- `test/SqliteConnection.js` is copied from `archiver/test`, and `CityRepository` runs on top of it.
- `test/feature/cleanest-city.test.js` starts the app on port 0 and calls it with `fetch`. It covers:
  - the ranking: the city with the lowest mean (sofia) loses to a lower max, and varna beats ruse on the mean tie-breaker when both have a max of 1.25;
  - both range dates being included;
  - the 400 cases;
  - 404;
  - 500 from a failing repository;
  - `GET /` serving the page.
- The seed values are exact in floating point (e.g. 0.5, 1.25), so the tests can assert the full body without rounding.
