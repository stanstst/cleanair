# Archiver: development notes

## Components (`archiver/`)
- `src/job.js` is the entry point. It parses `--months`, computes the cutoff and archives one target date at a time.
- `src/db/AirQualityRepository.js`:
  - `findOlderThan(cutoff)` selects `target_date < cutoff`, ordered by `target_date, city`.
  - `deleteByTargetDate(date)` deletes one day's rows.
  - It connects with `dateStrings: true`, so `target_date` and `created_at` come back as strings and are not shifted by the timezone.
- `src/archive/ArchiveCreator.js` builds `{ fileName, content }`:
  - The header is the table columns, in DB order.
  - `null` becomes an empty field.
  - A field that contains `,`, `"` or a newline is quoted.
- `src/archive/FileUploader.js` writes the file to `/tmp/archive`, creating the directory if needed, and overwrites an existing file. A remote upload can replace it later behind the same `upload(file)` interface.

## Usage
```bash
docker compose up -d --build archiver
docker compose exec archiver node src/job.js              # --months 36
docker compose exec archiver node src/job.js --months 12
docker compose exec archiver ls /tmp/archive
```
The `src/` folder is mounted read-only, so code edits apply without a rebuild. A change to `package.json` needs `--build`.

## Cutoff rule
- `cutoff = today (UTC) − months`.
- The day is clamped to the end of a shorter month, so 31-05-2026 minus 3 months is 28-02-2026.
- Rows with `target_date < cutoff` are archived. Rows on the cutoff date stay.

## Order and re-run safety
For each target date the job:
1. writes the CSV;
2. logs `Archived N records to /tmp/archive/<date>-archive.csv` to stdout;
3. deletes that day's rows.

A failure stops the run, and that day's rows are not deleted. Re-running overwrites a file that was already written and continues. Once nothing is left to archive, the job reports `files=0, records=0`.

The files live only in the container's filesystem. They are lost when the container is recreated (`docker compose up --build`, `down`).

## Output and exit codes
- stdout gets one `Archived …` line per file and a final `Archive finished in Xs (cutoff=…, files=N, records=M, success=…)`.
- stderr gets the error message.
- Exit codes:
  - `0`: OK.
  - `2`: usage error, either an invalid `--months` (not a positive integer) or an unknown option.
  - `1`: any other error (DB, file system).
- No metrics are pushed to Pushgateway or Grafana.

## Tests
`archiver/test/test-feature.sh` runs `test/feature/*.test.js` in the `cleanair-archiver` image with `--network none`. The tests use:
- `test/SqliteConnection.js`, an in-memory `node:sqlite` with the `air_quality` schema, which returns results in the same shape as mysql2;
- a temp dir for `FileUploader`;
- a fixed `now`.
