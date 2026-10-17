const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { main } = require('../../src/job');
const { AirQualityRepository } = require('../../src/db/AirQualityRepository');
const { FileUploader } = require('../../src/archive/FileUploader');
const { SqliteConnection } = require('../SqliteConnection');

const record = (city, targetDate) => ({
  city,
  target_date: targetDate,
  mean_ratio: 0.38,
  max_ratio: 0.74,
  pm25_average: 11.1,
  pm25_unit: 'µg/m³',
  pm25_ratio: 0.74,
  pm10_average: 12.4,
  pm10_unit: 'µg/m³',
  pm10_ratio: 0.28,
  co_average: null,
  co_unit: null,
  co_ratio: null,
  created_at: '2026-10-17 06:00:00',
});

const HEADER =
  'id,city,target_date,mean_ratio,max_ratio,pm25_average,pm25_unit,pm25_ratio,pm10_average,pm10_unit,pm10_ratio,co_average,co_unit,co_ratio,created_at\n';
const line = (id, city, targetDate) =>
  `${id},${city},${targetDate},0.38,0.74,11.1,µg/m³,0.74,12.4,µg/m³,0.28,,,,2026-10-17 06:00:00\n`;

async function runArchive(t, args, { records = [], now = '2026-10-17T08:00:00Z', uploader } = {}) {
  const connection = new SqliteConnection();
  records.forEach((r) => connection.insert(r));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const info = t.mock.method(console, 'info', () => {});
  const error = t.mock.method(console, 'error', () => {});

  const exitCode = await main({
    args,
    env: {},
    now: () => new Date(now),
    connectRepository: async () => new AirQualityRepository(connection),
    createUploader: () => uploader ?? new FileUploader({ dir }),
  });

  const rows = connection.all('SELECT city, target_date FROM air_quality ORDER BY id');
  const files = Object.fromEntries(
    fs.readdirSync(dir).sort().map((name) => [name, fs.readFileSync(path.join(dir, name), 'utf8')]),
  );
  connection.close();

  const stdout = info.mock.calls.map((c) => c.arguments.join(' '));
  const stderr = error.mock.calls.map((c) => c.arguments.join(' '));
  return { exitCode, rows, files, dir, stdout, stderr, connection };
}

const sampleRecords = [
  record('sofia', '2023-10-15'),
  record('ruse', '2023-10-15'),
  record('varna', '2023-10-16'),
  record('sofia', '2023-10-17'),
  record('sofia', '2026-10-10'),
];

test('archives records older than 36 months by default, one csv per target_date, and deletes them', async (t) => {
  const { exitCode, rows, files, dir, stdout, connection } = await runArchive(t, [], { records: sampleRecords });

  assert.equal(exitCode, 0);
  assert.deepEqual(files, {
    '2023-10-15-archive.csv': HEADER + line(2, 'ruse', '2023-10-15') + line(1, 'sofia', '2023-10-15'),
    '2023-10-16-archive.csv': HEADER + line(3, 'varna', '2023-10-16'),
  });
  assert.deepEqual(rows, [
    { city: 'sofia', target_date: '2023-10-17' },
    { city: 'sofia', target_date: '2026-10-10' },
  ]);
  assert.deepEqual(stdout.slice(0, 2), [
    `Archived 2 records to ${path.join(dir, '2023-10-15-archive.csv')}`,
    `Archived 1 records to ${path.join(dir, '2023-10-16-archive.csv')}`,
  ]);
  assert.match(stdout[2], /^Archive finished in .*\(cutoff=2023-10-17, files=2, records=3, success=true\)$/);
  assert.equal(connection.ended, true);
});

test('--months sets the cutoff', async (t) => {
  const { exitCode, rows, files, stdout } = await runArchive(t, ['--months', '1'], {
    records: [record('sofia', '2026-09-16'), record('sofia', '2026-09-17')],
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(Object.keys(files), ['2026-09-16-archive.csv']);
  assert.deepEqual(rows, [{ city: 'sofia', target_date: '2026-09-17' }]);
  assert.match(stdout.at(-1), /cutoff=2026-09-17, files=1, records=1, success=true/);
});

test('cutoff day is clamped to the end of a shorter month', async (t) => {
  const { exitCode, rows, files, stdout } = await runArchive(t, ['--months', '3'], {
    now: '2026-05-31T12:00:00Z',
    records: [record('sofia', '2026-02-27'), record('sofia', '2026-02-28')],
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(Object.keys(files), ['2026-02-27-archive.csv']);
  assert.deepEqual(rows, [{ city: 'sofia', target_date: '2026-02-28' }]);
  assert.match(stdout.at(-1), /cutoff=2026-02-28/);
});

test('nothing to archive exits 0 without files', async (t) => {
  const { exitCode, rows, files, stdout } = await runArchive(t, [], { records: [record('sofia', '2026-10-10')] });

  assert.equal(exitCode, 0);
  assert.deepEqual(files, {});
  assert.equal(rows.length, 1);
  assert.match(stdout.at(-1), /files=0, records=0, success=true/);
});

for (const args of [['--months', '0'], ['--months', 'abc'], ['--unknown']]) {
  test(`${args.join(' ')} exits 2 without archiving`, async (t) => {
    const { exitCode, rows, files, stderr } = await runArchive(t, args, { records: sampleRecords });

    assert.equal(exitCode, 2);
    assert.deepEqual(files, {});
    assert.equal(rows.length, sampleRecords.length);
    assert.equal(stderr.length, 1);
  });
}

test('upload failure exits 1 and keeps the records of that day', async (t) => {
  const uploader = {
    upload: async () => {
      throw new Error('disk full');
    },
  };
  const { exitCode, rows, stderr, stdout } = await runArchive(t, [], { records: sampleRecords, uploader });

  assert.equal(exitCode, 1);
  assert.equal(rows.length, sampleRecords.length);
  assert.deepEqual(stderr, ['disk full']);
  assert.match(stdout.at(-1), /files=0, records=0, success=false/);
});
