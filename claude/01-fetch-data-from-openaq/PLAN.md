# OpenAQ PM2.5 fetch in the fetcher job (Node port of openaqtest.php)

## Context
`openaqtest.php` fetches 24h PM2.5 averages for 10 Bulgarian cities from OpenAQ v3, ranks them against the WHO guideline, and prints a JSON report. The containerized `fetcher` job (`fetcher/src/job.js`) is currently a dummy that sleeps 1-3 seconds. The goal is to replace the dummy with a Node.js version of the PHP logic, behaving the same way. The existing Prometheus metrics (duration, last run, success) stay unchanged. The output is the JSON report on stdout only; no new metrics and no database.

## Behaviour to replicate (from `openaqtest.php`)
- Constants:
  - `API_BASE = https://api.openaq.org/v3`
  - `RADIUS_M = 15000`
  - `PM25_PARAM_ID = 2`
  - `WHO_PM25_24H = 15`
  - the same 10 `CITIES` with their coordinates
- `apiGet(path, query)`:
  - Sends the `X-API-Key` and `Accept: application/json` headers, with a 30-second timeout.
  - Makes up to 3 attempts. On 429 or 5xx it waits `attempt * 2` seconds and retries.
  - On 401 or 403 it fails with "OpenAQ rejected the API key". Any other non-200 status, or invalid JSON, also fails.
  - It increments an API call counter.
- `sensorHours(sensorId, from, to)`: pages through `/sensors/{id}/hours` 100 results at a time and keeps numeric values that are 0 or higher.
- `cityPm25(city, lat, lon, from, to)`:
  - Calls `/locations` with `coordinates`, `radius`, `monitor=true`, `parameters_id` and `limit=100`.
  - **Keeps only the first 3 locations** (the free-quota limit from the PHP file).
  - For each pm25 sensor it records `{location_id, name, sensor_id, pm25_avg (1 decimal), hours}`.
  - The city average is the mean of the stations that have data. It also reports `who_ratio` (2 decimals), `within_who` and `stations_used`.
- Time window: the current UTC time truncated to the hour, minus 24h, formatted as `YYYY-MM-DDTHH:mm:ssZ`.
- Optional CLI argument for a single city (case-insensitive). An unknown city produces `{"error": "unknown city 'x'"}` and exit code 2.
- Report fields:
  - `pollutant`, `unit`, `period{from,to}`, `who_guideline`
  - `cleanest`
  - `ranking`: cities sorted by `pm25_avg` ascending, with no-data cities excluded
  - `no_data`: the city names that had no data
  - `source`
- API call count: recorded in the Prometheus gauge `cleanair_job_api_calls` (PHP prints `Number of Api calls: N` instead).

## Git branch
The work is on branch **`01-fetch-data-from-openaq`**, which was created from the initial commit on `main` (`2364956`). The docs for this branch are in `claude/01-fetch-data-from-openaq/`.

**No git commits.** From now on, Claude does not run `git commit` (or amend, reset, rebase or push). All changes stay uncommitted in the working tree, and the user reviews and commits them.

**No code comments.** Claude does not add comments to code (`//`, `/* */`, JSDoc or YAML `#`). The code and these docs carry the explanation.

## Files
All new code goes in `fetcher/src/openaq/`, using CommonJS like `job.js`. It uses Node 22's built-in `fetch`, so no new dependencies are needed.

### `fetcher/src/openaq/config.js` (new)
Data only: `API_BASE`, `RADIUS_M`, `PM25_PARAM_ID`, `WHO_PM25_24H` and `CITIES` (the 10 cities with coordinates, exactly as in the PHP file).

### `fetcher/src/openaq/ApiClient.js` (new): generic API calls, errors and retries
- `class ApiError extends Error` with `status` and `url` fields.
- `class ApiClient`:
  - `constructor({ baseUrl, headers = {}, maxAttempts = 3, timeoutMs = 30000 })`. `baseUrl` is required. `headers` are added to every request alongside `Accept: application/json`; the job passes auth this way, so the client knows nothing about OpenAQ keys.
  - `async get(path, query)`:
    - Builds the URL with `URLSearchParams` and sends `Accept` plus the injected `headers`, using `AbortSignal.timeout(timeoutMs)`.
    - Increments `this.callCount` for each logical call (as PHP's `$apiCounter` does).
    - A network error or timeout throws `request failed: …`.
    - 401 or 403 throws "API rejected the credentials (HTTP n) from <url>".
    - 429 or 5xx waits `attempt * 2` seconds and retries, up to `maxAttempts`, then throws `gave up after 3 attempts: <url>`.
    - Any other non-200 status throws `HTTP n from <url>`, and an unparsable body throws `invalid JSON from <url>`.
    - Returns the parsed JSON.
  - It contains no OpenAQ domain logic; it only handles HTTP.

### `fetcher/src/openaq/Pm25Ingestion.js` (new): OpenAQ-specific ingestion and processing
- `class Pm25Ingestion`:
  - `constructor(client, { cities = CITIES, maxLocationsPerCity = 3 } = {})`
  - `async sensorHours(sensorId, from, to)`: pages through `/sensors/{id}/hours` (limit 100) and keeps numeric values that are 0 or higher.
  - `async cityPm25(city, lat, lon, from, to)`:
    - Calls `/locations` and keeps the first `maxLocationsPerCity` locations.
    - Records the per-sensor pm25 stations, the city average, `who_ratio`, `within_who` and `stations_used`.
  - `static timeWindow(now = new Date())`: the UTC time truncated to the hour, minus 24h, as `{ from, to }` strings in `YYYY-MM-DDTHH:mm:ssZ` format.
  - `async run(cityArg)`:
    - Checks the city. An unknown city throws `UnknownCityError` (exit code 2).
    - Fetches the cities one after another (as PHP does, to stay gentle on the quota).
    - Returns the report object, with the same fields as the PHP output.
  - Rounding uses a small `round(n, d)` helper that matches PHP's `round` behaviour.

### `fetcher/src/job.js` (modify)
- Remove `dummyTask`. In `main()`, throw `OPENAQ_API_KEY is not set` if the key is empty, then build `new Pm25Ingestion(new ApiClient({ baseUrl: API_BASE, headers: { 'X-API-Key': key } }))` and `await ingestion.run(process.argv[2])` inside the existing timing and try/catch block.
- Sets the gauge `cleanair_job_api_calls` to `client.callCount` on every run, or to 0 if the client was never created (missing key or unknown city). The count is no longer logged.
- On success, print the report as pretty JSON (2-space indent) to **stdout**. On error, print `{"error": msg}` to stdout, matching PHP's `fail()`. The exit code is 2 for an unknown city and 1 otherwise.
- Status lines go to **stderr** (`console.error`), so stdout stays valid JSON that can be piped to `jq`. That covers the duration line.
- Metrics are pushed after every run, whether it succeeded or failed (as now). The job name `cleanair_job` and the Grafana dashboard stay unchanged.

### `grafana/provisioning/dashboards/cleanair-job.json` (modify)
- Adds a stat panel, **"API calls (last run)"**. The top row is now 4 stat panels, each `w: 6`.
- Adds a time series panel, **"API calls per run"**, below the duration graph.
- Both panels use the query `cleanair_job_api_calls{job="cleanair_job"}`.

### API key
- `docker-compose.yml`, `fetcher` service: add `OPENAQ_API_KEY: ${OPENAQ_API_KEY}` to `environment`.
- Create `.env` at the project root, holding the key taken from `openaqtest.php`. Docker Compose reads this file automatically. Add `.env` to `.gitignore` (alongside the existing `.idea` and `openaqtest.php` entries).
- Add a committed `.env.example` containing `OPENAQ_API_KEY=`.
- `job.js` throws "OPENAQ_API_KEY is not set" if the key is empty, and injects it as the `X-API-Key` header.
- Changing `.env` requires `docker compose up -d fetcher` (a restart doesn't re-read the environment).

### Docs: `claude/01-fetch-data-from-openaq/` (new, named after the branch, following the `claude/initial-fetcher/` pattern)
- `PLAN.md`: this plan.
- `VERIFICATION.md`: the commands and output from the checks below.
- Update the "Edit job.js" row in `claude/initial-fetcher/DEVELOPMENT.md` to mention the API key and `.env`.

## Verification
Each full run uses about 1 + 3×(sensors) calls per city. To protect the free quota, test with a single city first.
1. `docker compose up -d fetcher` (this picks up the new environment variable).
2. `docker compose exec -T fetcher node src/job.js sofia | jq .` should return valid JSON with `ranking[0].city == "sofia"`. The Pushgateway should show `cleanair_job_api_calls 3`.
3. Compare with PHP: run `php openaqtest.php sofia` (or the `php:8.3-cli` container) and check that the city averages and station list match. The PHP script also prints a call-count line before its JSON.
4. `docker compose exec -T fetcher node src/job.js nowhere` should print `{"error":"unknown city 'nowhere'"}` with exit code 2, and Pushgateway should show `cleanair_job_last_success 0`.
5. Run once with all cities. The ranking should be sorted ascending, `no_data` should list the cities without data, and the Grafana duration panel should show the real run time.
6. A missing key (temporarily `OPENAQ_API_KEY= docker compose exec -e OPENAQ_API_KEY= ...`) should produce a clear error and exit code 1.
