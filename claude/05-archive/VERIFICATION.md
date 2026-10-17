# Archiver: verification (2026-10-17)

1. **Build and mount.** `docker compose up -d --build archiver` built `cleanair-archiver`, and `cleanair-archiver-1` is running.
2. **Feature tests.** `archiver/test/test-feature.sh` gave **8 pass, 0 fail**. The tests covered:
   - the default 36 months, with 2 files, exact CSV content, deleted rows and stdout lines;
   - `--months 1`;
   - month-end clamping;
   - nothing to archive;
   - `--months 0`, `--months abc` and `--unknown`, each exiting 2;
   - an upload failure, which exits 1 and keeps the rows.
3. **Manual run against MySQL.** I inserted 4 rows: sofia and ruse on 2022-01-01 and 2022-01-02.
   ```
   Archived 2 records to /tmp/archive/2022-01-01-archive.csv
   Archived 2 records to /tmp/archive/2022-01-02-archive.csv
   Archive finished in 0.058s (cutoff=2023-10-17, files=2, records=4, success=true)
   exit=0
   ```
   - `/tmp/archive/2022-01-01-archive.csv` has the header and 2 rows. Dates are plain strings, e.g. `2022-01-01` and `2026-10-17 09:47:13`.
   - `COUNT(*) WHERE target_date < '2023-10-17'` returns 0, and the 16 existing rows are untouched.
   - The unit shows as `Âµg/mÂ³` in this CSV only because of how the test rows were inserted through the `mysql` CLI (latin1 client charset). Rows written by the fetcher read back as `µg/m³` through `AirQualityRepository`.
4. **Re-run.** It reported `files=0, records=0, success=true` and exited 0.
5. **Error paths.**
   - `--months x` printed `invalid months 'x', expected a positive integer` and exited 2.
   - With MySQL stopped, it printed `getaddrinfo ENOTFOUND mysql` and exited 1. MySQL was restarted afterwards.
6. **Metrics.** `curl -s localhost:9091/metrics | grep -ci archiv` returned 0.
7. **`git status --short`.** Only `docker-compose.yml`, `README.md`, `archiver/` and `claude/05-archive/` changed. `fetcher/` is unchanged.

## Revision: dufs file server (2026-10-17)
1. `docker compose up -d fileserver archiver` started both services. `test-feature.sh` gave **8 pass, 0 fail**, with the tests unchanged.
2. I inserted 3 rows: sofia and ruse on 2022-01-01, and sofia on 2022-01-02.
   ```
   Archived 2 records to http://fileserver:5000/2022-01-01-archive.csv
   Archived 1 records to http://fileserver:5000/2022-01-02-archive.csv
   Archive finished in 0.111s (cutoff=2023-10-17, files=2, records=3, success=true)
   exit=0
   ```
   - `ls .tmp/archive-files/` shows both CSVs, owned by the host user.
   - `curl localhost:5000/2022-01-01-archive.csv` returns the header and 2 rows, with `µg/m³` intact.
   - 0 old rows are left in MySQL.
3. Anonymous access: `GET /` returns 200, and `PUT /x.csv` returns 401.
4. Re-inserting the same rows and re-running overwrote both files and exited 0.
5. With `fileserver` stopped, the job printed `fetch failed`, exited 1, and kept all 3 rows. After `fileserver` was started again, the next run archived them.
