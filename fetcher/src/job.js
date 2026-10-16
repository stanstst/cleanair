const { parseArgs } = require('node:util');
const { Registry, Gauge, Pushgateway } = require('prom-client');
const { ApiClient } = require('./openaq/ApiClient');
const { API_BASE } = require('./openaq/config');
const { AirQualityIngestion, UnknownCityError, InvalidDateToError } = require('./openaq/AirQualityIngestion');
const { OpenAQRepository } = require('./db/OpenAQRepository');

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

const isUsageError = (err) =>
  err instanceof UnknownCityError ||
  err instanceof InvalidDateToError ||
  String(err.code).startsWith('ERR_PARSE_ARGS_');

async function main({
  args = process.argv.slice(2),
  env = process.env,
  createClient = (apiKey) => new ApiClient({ baseUrl: API_BASE, headers: { 'X-API-Key': apiKey } }),
  connectRepository = () =>
    OpenAQRepository.connect({
      host: env.DB_HOST,
      port: env.DB_PORT,
      user: env.DB_USER,
      password: env.DB_PASSWORD,
      database: env.DB_NAME,
    }),
  pushgateway = new Pushgateway(PUSHGATEWAY_URL, {}, registry),
} = {}) {
  const start = process.hrtime.bigint();
  let success = true;
  let exitCode = 0;
  let client;
  let repository;

  try {
    const { values } = parseArgs({
      args,
      options: { city: { type: 'string' }, 'date-to': { type: 'string' } },
    });

    const apiKey = env.OPENAQ_API_KEY;
    if (!apiKey) throw new Error('OPENAQ_API_KEY is not set');

    client = createClient(apiKey);
    const report = await new AirQualityIngestion(client).run(values.city, values['date-to']);

    repository = await connectRepository();
    await repository.saveReport(report);

  } catch (err) {
    success = false;
    exitCode = isUsageError(err) ? 2 : 1;
    console.error(err.message);
  }

  await repository?.close().catch(() => {});

  apiCallsGauge.set(client ? client.callCount : 0);

  const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;
  durationGauge.set(durationSeconds);
  lastRunGauge.set(Date.now() / 1000);
  lastSuccessGauge.set(success ? 1 : 0);

  console.info(`Job finished in ${durationSeconds.toFixed(3)}s (success=${success})`);

  await pushgateway.pushAdd({ jobName: JOB_NAME });

  return exitCode;
}

if (require.main === module) {
  main()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((err) => {
      console.error('Fetcher failed to execute:', err);
      process.exit(1);
    });
}

module.exports = { main };
