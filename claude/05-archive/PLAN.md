# Archive: new `archiver` job moves old `air_quality` rows to CSV

## Context
`air_quality` grows by one row per city per day, and nothing ever removes old rows. `claude/05-archive/REQUIREMENTS.md` asks for a separate job that:
- exports rows whose `target_date` is older than `--months` (default 36) to CSV;
- deletes those rows.

The requirements also set these rules:
- One file per `target_date`, named `<target_date>-archive.csv`, e.g. `2023-01-05-archive.csv`. The user chose this split.
- Files are stored inside the container in `/tmp/archive`.
- Each file name is logged to stdout.
- No Grafana or Prometheus metrics.
- Code lives in `/archiver` at the project root, with the components `job.js`, `AirQualityRepository`, `ArchiveCreator` and `FileUploader`.
- It runs as a new compose service, `archiver`. The user chose this.
- Feature tests follow the step 04 pattern. The user chose this.

Rules carried over from earlier steps:
- No commits. The work is on `05-archive`.
- No code comments.
- Earlier `claude/0*` folders stay unchanged.
- `fetcher/` stays unchanged.

## Changes

### `archiver/package.json`, `archiver/Dockerfile`, `archiver/.dockerignore` (new)
- Copied from `fetcher/`. The only dependency is `mysql2` (no `prom-client`).
- The script is `"test:feature": "test/test-feature.sh"`.
- The Dockerfile is the same as the fetcher one: `node:22-alpine`, `WORKDIR /archiver` and `CMD ["node", "src/job.js"]`.

### `docker-compose.yml`: new `archiver` service
It mirrors `fetcher`:
- `build: ./archiver` and `command: ["sleep", "infinity"]`;
- the `DB_*` env vars;
- the volume `./archiver/src:/archiver/src:ro`;
- `depends_on: migrate (service_completed_successfully)`;
- `restart: unless-stopped`.

There is no Pushgateway dependency and no volume for `/tmp/archive`, because the requirement keeps the files inside the container for now.

### `archiver/src/db/AirQualityRepository.js` (new)
- `static connect({...})` follows `OpenAQRepository.connect` (`fetcher/src/db/OpenAQRepository.js:23`) and adds `dateStrings: true`.
  - Without it, mysql2 returns `DATE` and `DATETIME` as JS `Date` objects shifted by the timezone.
  - With it, `target_date` is `'YYYY-MM-DD'`, which goes straight into the file name and the CSV.
- `findOlderThan(cutoffDate)` runs `SELECT * FROM air_quality WHERE target_date < ? ORDER BY target_date, city` and returns the rows.
- `deleteByTargetDate(targetDate)` runs `DELETE FROM air_quality WHERE target_date = ?` and returns `affectedRows`.
- `close()`.

### `archiver/src/archive/ArchiveCreator.js` (new)
`create(targetDate, rows)` returns `{ fileName: \`${targetDate}-archive.csv\`, content }`:
- The header row is the column names of `rows[0]`, in DB column order.
- `null` becomes an empty field.
- A value that contains `,`, `"` or a newline is quoted, with `"` doubled.
- Lines end with `\n`.

### `archiver/src/archive/FileUploader.js` (new)
- `constructor({ dir = '/tmp/archive' })`.
- `upload({ fileName, content })`:
  - runs `fs.promises.mkdir(dir, { recursive: true })`;
  - runs `writeFile(path.join(dir, fileName), content)`;
  - returns the full path.
- An existing file is overwritten, so a re-run after a crash between the upload and the delete is safe.
- Its interface is the place to swap in a remote upload later.

### `archiver/src/job.js` (new)
It is structured like `fetcher/src/job-backfill.js`:
- It reuses the `UsageError` / `isUsageError` pattern, which maps to exit 2.
- Dependencies are injectable through `main({ args, env, now, connectRepository, createUploader })`.

Steps:
1. `parseArgs` with `months: { type: 'string', default: '36' }`. The value must match `/^\d+$/` and be ≥ 1, otherwise it throws a `UsageError`.
2. `cutoff = subtractMonths(now(), months)`, formatted as an ISO date in UTC.
   - The day is clamped to the last day of the target month, so 31-05 minus 3 months is 28/29-02, not early March.
   - Rows with `target_date < cutoff` are archived.
3. Connect the repository and run `findOlderThan(cutoff)`. Group the rows by `target_date`, keeping their order.
4. For each date:
   - `creator.create(date, rows)` → `uploader.upload(file)` → `console.info(\`Archived ${rows.length} records to ${path}\`)`, which logs the file name to stdout;
   - then `repository.deleteByTargetDate(date)`.
   - A day's rows are deleted only after its file is written.
5. The `catch` block, `repository?.close()` and the exit codes match `job-backfill.js`.
6. It ends with this line:

   ```
   Archive finished in Xs (cutoff=YYYY-MM-DD, files=N, records=M, success=…)
   ```

   It goes to stdout through `console.info`. There are no metrics.

How to run:
```bash
docker compose up -d --build archiver
docker compose exec archiver node src/job.js              # 36 months
docker compose exec archiver node src/job.js --months 1
docker compose exec archiver ls /tmp/archive
```

### Tests: `archiver/test/` (new)
- `SqliteConnection.js`:
  - an in-memory `node:sqlite` with the same `air_quality` schema as `fetcher/test/SqliteConnection.js`;
  - a generic `query(sql, params)` that returns `[rows]` for a `SELECT` and `[{ affectedRows }]` otherwise, matching the mysql2 result shape;
  - helpers `insert(row)` and `all(sql)`.
- `feature/job.test.js` uses `node:test` and `node:assert/strict`, with a fixed `now = 2026-10-17`, a `mkdtemp` dir for `FileUploader`, and `new AirQualityRepository(connection)`. It covers:
  - Default 36 months: rows dated 2023-10-15, 2023-10-15 and 2023-10-16, plus 2023-10-17 and 2026-10-10, give:
    - two files, `2023-10-15-archive.csv` (2 rows) and `2023-10-16-archive.csv`, with exact CSV content;
    - the remaining rows are only 2023-10-17 and 2026-10-10;
    - stdout lines name both files;
    - exit 0.
  - `--months 1`: the cutoff is 2026-09-17.
  - Nothing to archive: exit 0, no files, no rows deleted.
  - `--months 0`, `--months abc` and `--unknown` each exit 2, with no files and no deletes.
  - Month-end clamping: `now = 2026-05-31` and `--months 3` give cutoff 2026-02-28.
  - Upload failure: an uploader that throws gives exit 1, and that day's rows are not deleted.
- `test-feature.sh` is copied from `fetcher/test/test-feature.sh` with the image `cleanair-archiver` and paths under `/archiver`.

### Docs
- `README.md` "Running the jobs" gets an `archiver` subsection with the run commands above.
- In `claude/05-archive/`:
  - `PLAN.md` is this plan.
  - `DEVELOPMENT.md` covers the components, the cutoff rule, the file format and naming, the delete-after-upload order, and the exit codes.
  - `VERIFICATION.md` records the results of the checks below.

## Verification
1. `docker compose up -d --build archiver`, then `docker compose exec archiver ls src` shows the mounted sources.
2. `archiver/test/test-feature.sh` passes, running with `--network none`.
3. Manual run against MySQL:
   - Insert test rows with old dates, e.g. `target_date='2022-01-01'` and `'2022-01-02'` for sofia and ruse.
   - Run `node src/job.js`. Stdout should show 2 `Archived … /tmp/archive/2022-01-0X-archive.csv` lines, and exit should be 0.
   - `cat /tmp/archive/2022-01-01-archive.csv` should show a header and 2 rows.
   - `SELECT COUNT(*) … WHERE target_date < '2023-10-17'` should be 0, and recent rows should be untouched.
4. A re-run should report `files=0, records=0` and exit 0.
5. `--months x` should exit 2. With MySQL stopped, the job should exit 1.
6. `curl -s localhost:9091/metrics` should show no archiver metrics.
7. `git status --short` should show only `archiver/`, `docker-compose.yml`, `README.md` and `claude/05-archive/`.
