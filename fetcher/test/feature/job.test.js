const { test } = require('node:test');
const assert = require('node:assert/strict');
const { main } = require('../../src/job');
const { OpenAQRepository } = require('../../src/db/OpenAQRepository');
const { MockApiClient } = require('../MockApiClient');
const { SqliteConnection } = require('../SqliteConnection');

async function runJob(args) {
  const connection = new SqliteConnection();
  const client = new MockApiClient();
  const pushes = [];

  const exitCode = await main({
    args,
    env: { OPENAQ_API_KEY: 'test-key' },
    createClient: () => client,
    connectRepository: async () => new OpenAQRepository(connection),
    pushgateway: {
      pushAdd: async (params) => {
        pushes.push(params);
      },
    },
  });

  const rows = connection.all('SELECT * FROM air_quality');
  connection.close();
  return { exitCode, rows, client, connection, pushes };
}

test('job saves the sofia air_quality record from the captured API responses', async () => {
  const { exitCode, rows, client, connection, pushes } = await runJob([
    '--city',
    'sofia',
    '--date-to',
    '2026-10-14',
  ]);

  assert.equal(exitCode, 0);
  assert.equal(rows.length, 1);

  const { created_at, ...row } = rows[0];
  assert.deepEqual(row, {
    id: 1,
    city: 'sofia',
    target_date: '2026-10-14',
    mean_ratio: 0.38,
    max_ratio: 0.74,
    pm25_average: 11.1,
    pm25_unit: 'µg/m³',
    pm25_ratio: 0.74,
    pm10_average: 12.4,
    pm10_unit: 'µg/m³',
    pm10_ratio: 0.28,
    co_average: 519.8,
    co_unit: 'µg/m³',
    co_ratio: 0.13,
  });
  assert.match(created_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);

  assert.equal(client.callCount, 11);
  assert.equal(connection.ended, true);
  assert.deepEqual(pushes, [{ jobName: 'cleanair_job' }]);
});

test('job without a city saves one air_quality record per configured city', async () => {
  const { exitCode, rows, client } = await runJob(['--date-to', '2026-10-14']);

  assert.equal(exitCode, 0);
  assert.deepEqual(
    rows.map(({ created_at, ...row }) => row),
    [
      { id: 1, city: 'sofia', target_date: '2026-10-14', mean_ratio: 0.38, max_ratio: 0.74, pm25_average: 11.1, pm25_unit: 'µg/m³', pm25_ratio: 0.74, pm10_average: 12.4, pm10_unit: 'µg/m³', pm10_ratio: 0.28, co_average: 519.8, co_unit: 'µg/m³', co_ratio: 0.13 },
      { id: 2, city: 'ruse', target_date: '2026-10-14', mean_ratio: 0.2, max_ratio: 0.39, pm25_average: 5.9, pm25_unit: 'µg/m³', pm25_ratio: 0.39, pm10_average: 6.6, pm10_unit: 'µg/m³', pm10_ratio: 0.15, co_average: 258.6, co_unit: 'µg/m³', co_ratio: 0.06 },
      { id: 3, city: 'varna', target_date: '2026-10-14', mean_ratio: 0.17, max_ratio: 0.27, pm25_average: 4, pm25_unit: 'µg/m³', pm25_ratio: 0.27, pm10_average: 6.8, pm10_unit: 'µg/m³', pm10_ratio: 0.15, co_average: 397.7, co_unit: 'µg/m³', co_ratio: 0.1 },
    ],
  );
  assert.equal(client.callCount, 29);
});

test('job exits 2 for an unknown city and saves nothing', async () => {
  const { exitCode, rows, client, pushes } = await runJob(['--city', 'atlantis']);

  assert.equal(exitCode, 2);
  assert.equal(rows.length, 0);
  assert.equal(client.callCount, 0);
  assert.deepEqual(pushes, [{ jobName: 'cleanair_job' }]);
});
