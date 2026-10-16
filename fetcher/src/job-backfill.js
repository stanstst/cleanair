const { parseArgs } = require('node:util');
const { ApiClient } = require('./openaq/ApiClient');
const { API_BASE } = require('./openaq/config');
const { AirQualityIngestion, UnknownCityError, InvalidDateToError } = require('./openaq/AirQualityIngestion');
const { OpenAQRepository } = require('./db/OpenAQRepository');

const DAY_MS = 24 * 3600 * 1000;

class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UsageError';
  }
}

const isUsageError = (err) =>
  err instanceof UsageError ||
  err instanceof UnknownCityError ||
  err instanceof InvalidDateToError ||
  String(err.code).startsWith('ERR_PARSE_ARGS_');

function parseDate(name, value) {
  if (value === undefined) throw new UsageError(`--${name} is required (DD-MM-YYYY)`);

  const match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(value);
  if (!match) throw new UsageError(`invalid ${name} '${value}', expected DD-MM-YYYY`);

  const [, d, m, y] = match.map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    throw new UsageError(`invalid ${name} '${value}'`);
  }
  return date;
}

const isoDate = (date) => date.toISOString().split('T')[0];

async function main() {
  const start = process.hrtime.bigint();
  let success = true;
  let days = 0;
  let client;
  let repository;

  try {
    const { values } = parseArgs({
      options: { 'start-date': { type: 'string' }, 'end-date': { type: 'string' } },
    });

    const startDate = parseDate('start-date', values['start-date']);
    const endDate = parseDate('end-date', values['end-date']);
    if (startDate > endDate) {
      throw new UsageError(`start-date '${values['start-date']}' is after end-date '${values['end-date']}'`);
    }

    const apiKey = process.env.OPENAQ_API_KEY;
    if (!apiKey) throw new Error('OPENAQ_API_KEY is not set');

    client = new ApiClient({ baseUrl: API_BASE, headers: { 'X-API-Key': apiKey } });
    const ingestion = new AirQualityIngestion(client);

    repository = await OpenAQRepository.connect({
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
    });

    for (let d = startDate; d <= endDate; d = new Date(d.getTime() + DAY_MS)) {
      const report = await ingestion.run(undefined, isoDate(d));
      await repository.saveReport(report);
      days++;
    }
  } catch (err) {
    success = false;
    process.exitCode = isUsageError(err) ? 2 : 1;
    console.error(err.message);
  }

  await repository?.close().catch(() => {});

  const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;
  console.info(
    `Backfill finished in ${durationSeconds.toFixed(3)}s (days=${days}, api_calls=${client ? client.callCount : 0}, success=${success})`,
  );
}

main().catch((err) => {
  console.error('Backfill failed to execute:', err);
  process.exit(1);
});
