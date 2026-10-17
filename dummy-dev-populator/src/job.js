const { parseArgs } = require('node:util');
const { AirQualityRepository } = require('./db/AirQualityRepository');
const { DummyRecordGenerator, CITIES } = require('./dummy/DummyRecordGenerator');

const DAY_MS = 24 * 3600 * 1000;

class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UsageError';
  }
}

const isUsageError = (err) => err instanceof UsageError || String(err.code).startsWith('ERR_PARSE_ARGS_');

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

const startOfUtcDay = (date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

async function main({
  args = process.argv.slice(2),
  env = process.env,
  now = () => new Date(),
  connectRepository = () =>
    AirQualityRepository.connect({
      host: env.DB_HOST,
      port: env.DB_PORT,
      user: env.DB_USER,
      password: env.DB_PASSWORD,
      database: env.DB_NAME,
    }),
  createGenerator = () => new DummyRecordGenerator(),
} = {}) {
  const start = process.hrtime.bigint();
  let success = true;
  let exitCode = 0;
  let dateFrom;
  let dateTo;
  let days = 0;
  let inserted = 0;
  let repository;

  try {
    const { values } = parseArgs({
      args,
      options: { 'date-from': { type: 'string' } },
    });

    dateFrom = parseDate('date-from', values['date-from']);
    dateTo = startOfUtcDay(now());
    if (dateFrom > dateTo) {
      throw new UsageError(`date-from '${values['date-from']}' is in the future`);
    }

    const generator = createGenerator();
    repository = await connectRepository();

    for (let d = dateFrom; d <= dateTo; d = new Date(d.getTime() + DAY_MS)) {
      inserted += await repository.insertIgnoringDuplicates(generator.rowsFor(isoDate(d)));
      days++;
    }
  } catch (err) {
    success = false;
    exitCode = isUsageError(err) ? 2 : 1;
    console.error(err.message);
  }

  await repository?.close().catch(() => {});

  const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;
  console.info(
    `Populate finished in ${durationSeconds.toFixed(3)}s (date_from=${dateFrom ? isoDate(dateFrom) : '-'}, date_to=${dateTo ? isoDate(dateTo) : '-'}, days=${days}, inserted=${inserted}, skipped=${days * CITIES.length - inserted}, success=${success})`,
  );

  return exitCode;
}

if (require.main === module) {
  main()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((err) => {
      console.error('Populate failed to execute:', err);
      process.exit(1);
    });
}

module.exports = { main };
