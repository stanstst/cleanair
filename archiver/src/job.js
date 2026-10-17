const { parseArgs } = require('node:util');
const { AirQualityRepository } = require('./db/AirQualityRepository');
const { ArchiveCreator } = require('./archive/ArchiveCreator');
const { DufsFileUploader } = require('./archive/DufsFileUploader');

class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UsageError';
  }
}

const isUsageError = (err) => err instanceof UsageError || String(err.code).startsWith('ERR_PARSE_ARGS_');

function parseMonths(value) {
  if (!/^\d+$/.test(value) || Number(value) < 1) {
    throw new UsageError(`invalid months '${value}', expected a positive integer`);
  }
  return Number(value);
}

function subtractMonths(date, months) {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() - months;
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(date.getUTCDate(), lastDay)));
}

const isoDate = (date) => date.toISOString().split('T')[0];

function groupByTargetDate(rows) {
  const groups = new Map();
  for (const row of rows) {
    if (!groups.has(row.target_date)) groups.set(row.target_date, []);
    groups.get(row.target_date).push(row);
  }
  return groups;
}

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
  createUploader = () => {
    if (!env.ARCHIVE_URL) throw new Error('ARCHIVE_URL is not set');
    return new DufsFileUploader({ baseUrl: env.ARCHIVE_URL, user: env.ARCHIVE_USER, password: env.ARCHIVE_PASSWORD });
  },
} = {}) {
  const start = process.hrtime.bigint();
  let success = true;
  let exitCode = 0;
  let cutoff;
  let files = 0;
  let records = 0;
  let repository;

  try {
    const { values } = parseArgs({
      args,
      options: { months: { type: 'string', default: '36' } },
    });

    const months = parseMonths(values.months);
    cutoff = isoDate(subtractMonths(now(), months));

    const creator = new ArchiveCreator();
    const uploader = createUploader();
    repository = await connectRepository();

    const rows = await repository.findOlderThan(cutoff);
    for (const [targetDate, dayRows] of groupByTargetDate(rows)) {
      const filePath = await uploader.upload(creator.create(targetDate, dayRows));
      console.info(`Archived ${dayRows.length} records to ${filePath}`);
      await repository.deleteByTargetDate(targetDate);
      files++;
      records += dayRows.length;
    }
  } catch (err) {
    success = false;
    exitCode = isUsageError(err) ? 2 : 1;
    console.error(err.message);
  }

  await repository?.close().catch(() => {});

  const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;
  console.info(
    `Archive finished in ${durationSeconds.toFixed(3)}s (cutoff=${cutoff ?? '-'}, files=${files}, records=${records}, success=${success})`,
  );

  return exitCode;
}

if (require.main === module) {
  main()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((err) => {
      console.error('Archive failed to execute:', err);
      process.exit(1);
    });
}

module.exports = { main };
