const { test } = require('node:test');
const assert = require('node:assert/strict');
const { main } = require('../../src/job-backfill');
const { OpenAQRepository } = require('../../src/db/OpenAQRepository');
const { MockApiClient } = require('../MockApiClient');
const { SqliteConnection } = require('../SqliteConnection');

async function runBackfill(args) {
  const connection = new SqliteConnection();
  const client = new MockApiClient();

  const exitCode = await main({
    args,
    env: { OPENAQ_API_KEY: 'test-key' },
    createClient: () => client,
    connectRepository: async () => new OpenAQRepository(connection),
  });

  const rows = connection.all('SELECT * FROM air_quality ORDER BY id');
  connection.close();
  return { exitCode, rows, client, connection };
}

const cityValues = [
  { city: 'sofia', mean_ratio: 0.38, max_ratio: 0.74, pm25_average: 11.1, pm25_unit: 'µg/m³', pm25_ratio: 0.74, pm10_average: 12.4, pm10_unit: 'µg/m³', pm10_ratio: 0.28, co_average: 519.8, co_unit: 'µg/m³', co_ratio: 0.13 },
  { city: 'ruse', mean_ratio: 0.2, max_ratio: 0.39, pm25_average: 5.9, pm25_unit: 'µg/m³', pm25_ratio: 0.39, pm10_average: 6.6, pm10_unit: 'µg/m³', pm10_ratio: 0.15, co_average: 258.6, co_unit: 'µg/m³', co_ratio: 0.06 },
  { city: 'varna', mean_ratio: 0.17, max_ratio: 0.27, pm25_average: 4, pm25_unit: 'µg/m³', pm25_ratio: 0.27, pm10_average: 6.8, pm10_unit: 'µg/m³', pm10_ratio: 0.15, co_average: 397.7, co_unit: 'µg/m³', co_ratio: 0.1 },
];

test('backfill saves one air_quality record per city per day in the range', async () => {
  const { exitCode, rows, client, connection } = await runBackfill([
    '--start-date',
    '13-10-2026',
    '--end-date',
    '14-10-2026',
  ]);

  assert.equal(exitCode, 0);
  assert.deepEqual(
    rows.map(({ created_at, ...row }) => row),
    ['2026-10-13', '2026-10-14'].flatMap((targetDate, day) =>
      cityValues.map(({ city, ...values }, i) => ({
        id: day * cityValues.length + i + 1,
        city,
        target_date: targetDate,
        ...values,
      })),
    ),
  );

  assert.equal(client.callCount, 58);
  const windows = [...new Set(client.calls.filter((c) => c.query.datetime_to).map((c) => c.query.datetime_to))];
  assert.deepEqual(windows, ['2026-10-13T00:00:00Z', '2026-10-14T00:00:00Z']);
  assert.equal(connection.ended, true);
});

test('backfill exits 2 when start-date is after end-date and saves nothing', async () => {
  const { exitCode, rows, client } = await runBackfill([
    '--start-date',
    '14-10-2026',
    '--end-date',
    '13-10-2026',
  ]);

  assert.equal(exitCode, 2);
  assert.equal(rows.length, 0);
  assert.equal(client.callCount, 0);
});
