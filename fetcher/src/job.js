const { parseArgs } = require('node:util');
const { Registry, Gauge, Pushgateway } = require('prom-client');
const { ApiClient } = require('./openaq/ApiClient');
const { API_BASE } = require('./openaq/config');
const { Pm25Ingestion, UnknownCityError, InvalidDateToError } = require('./openaq/Pm25Ingestion');
const { AirQualityRepository } = require('./db/AirQualityRepository');

const PUSHGATEWAY_URL = process.env.PUSHGATEWAY_URL || 'http://pushgateway:9091';
const JOB_NAME = 'cleanair_job';

const registry = new Registry();

const durationGauge = new Gauge({
  name: 'cleanair_job_duration_seconds',
  help: 'Duration of the last job run in seconds',
  registers: [registry],
});

const lastRunGauge = new Gauge({
  name: 'cleanair_job_last_run_timestamp_seconds',
  help: 'Unix timestamp of the last job run completion',
  registers: [registry],
});

const lastSuccessGauge = new Gauge({
  name: 'cleanair_job_last_success',
  help: 'Whether the last job run succeeded (1) or failed (0)',
  registers: [registry],
});

const apiCallsGauge = new Gauge({
  name: 'cleanair_job_api_calls',
  help: 'Number of API calls made by the last job run',
  registers: [registry],
});

const printJson = (data) => console.log(JSON.stringify(data, null, 2));

const isUsageError = (err) =>
  err instanceof UnknownCityError ||
  err instanceof InvalidDateToError ||
  String(err.code).startsWith('ERR_PARSE_ARGS_');

async function main() {
  const start = process.hrtime.bigint();
  let success = true;
  let client;
  let repository;

  try {
    const { values } = parseArgs({
      options: { city: { type: 'string' }, 'date-to': { type: 'string' } },
    });

    const apiKey = process.env.OPENAQ_API_KEY;
    if (!apiKey) throw new Error('OPENAQ_API_KEY is not set');

    client = new ApiClient({ baseUrl: API_BASE, headers: { 'X-API-Key': apiKey } });
    const report = await new Pm25Ingestion(client).run(values.city, values['date-to']);

    repository = await AirQualityRepository.connect({
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
    });
    await repository.saveReport(report);

    printJson(report);
  } catch (err) {
    success = false;
    process.exitCode = isUsageError(err) ? 2 : 1;
    printJson({ error: err.message });
  }

  await repository?.close().catch(() => {});

  apiCallsGauge.set(client ? client.callCount : 0);

  const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;
  durationGauge.set(durationSeconds);
  lastRunGauge.set(Date.now() / 1000);
  lastSuccessGauge.set(success ? 1 : 0);

  console.error(`Job finished in ${durationSeconds.toFixed(3)}s (success=${success})`);

  const gateway = new Pushgateway(PUSHGATEWAY_URL, {}, registry);
  await gateway.pushAdd({ jobName: JOB_NAME });
}

main().catch((err) => {
  console.error('Fetcher failed to execute:', err);
  process.exit(1);
});
