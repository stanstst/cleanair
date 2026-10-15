# Applying changes

The `fetcher` container mounts `./fetcher/src` at `/fetcher/src` (read-only). Each job run starts a new Node process, so it always loads the current source.

| Change | How to apply |
|---|---|
| Edit `fetcher/src/job.js` (or anything in `fetcher/src/`) | Save the file, then run `docker compose exec fetcher node src/job.js`. The change takes effect immediately, with no rebuild or restart (but see the Docker Desktop caveat below). |
| Change the OpenAQ API key (`.env` at the project root, which git ignores; copy it from `.env.example`) | `docker compose up -d fetcher` (a restart alone doesn't reload the environment). To run for one city: `docker compose exec fetcher node src/job.js sofia` |
| Add or change dependencies (`fetcher/package.json`) | `docker compose up -d --build fetcher` |
| Change `fetcher/Dockerfile` | `docker compose up -d --build fetcher` |
| Change `docker-compose.yml` | `docker compose up -d` (recreates only the services that changed) |
| Change `prometheus/prometheus.yml` | `docker compose restart prometheus` |
| Change the Grafana dashboard JSON | Grafana reloads it automatically within about 10 seconds, or run `docker compose restart grafana` |
| Change Grafana datasource provisioning | `docker compose restart grafana` |

## Docker Desktop: edits sometimes don't show up
On Docker Desktop (Linux), the container only sees a change to a mounted file if the file was **overwritten in place**. Some tools save by writing a new file and renaming it over the old one: vim with some settings, other "safe write" editors, and the edit tool Claude uses. After that kind of save, the container keeps reading the old file until it restarts.

If an edit doesn't seem to take effect, check it from inside the container:
```bash
docker compose exec fetcher cat src/job.js
```
If it shows the old content, run `docker compose restart fetcher`. This takes a second and doesn't need a rebuild.

## Without the mount
The image still copies `src/` at build time (`COPY src ./src`), so it runs on its own. This is useful for cron or deployment later. If you run it without the mount, apply code changes with `docker compose up -d --build fetcher`.
