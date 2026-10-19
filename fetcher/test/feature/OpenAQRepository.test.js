const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { OpenAQRepository } = require('../../src/db/OpenAQRepository');
const { SqliteConnection } = require('../SqliteConnection');

const report = {
  period: { from: '2026-10-13T00:00:00Z', to: '2026-10-14T00:00:00Z' },
  cities: [
    {
      city: 'sofia',
      pollutants: [
        { pollutant: 'pm25', unit: 'µg/m³', avg: 11.1, recommended_guideline: 15, recommended_ratio: 0.74, within_recommended: true, stations_used: 2 },
        { pollutant: 'pm10', unit: 'µg/m³', avg: 12.4, recommended_guideline: 45, recommended_ratio: 0.28, within_recommended: true, stations_used: 2 },
        { pollutant: 'co', unit: 'µg/m³', avg: 519.8, recommended_guideline: 4000, recommended_ratio: 0.13, within_recommended: true, stations_used: 3 },
      ],
    },
  ],
  no_data: [],
  source: 'OpenAQ v3 (reference monitors)',
};

const connection = new SqliteConnection();
const repository = new OpenAQRepository(connection);

after(() => connection.close());

test('saveReport inserts one air_quality row for the report city and date', async () => {
  const saved = await repository.saveReport(report);

  assert.equal(saved, 1);

  const rows = connection.all('SELECT * FROM air_quality');
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
});

test('saveReport stores a pollutant only when its unit is µg/m³ and leaves it out of the ratios', async () => {
  await repository.saveReport({
    ...report,
    cities: [
      {
        city: 'ruse',
        pollutants: [
          { pollutant: 'pm25', unit: 'µg/m³', avg: 11.1, recommended_guideline: 15, recommended_ratio: 0.74, within_recommended: true, stations_used: 1 },
          { pollutant: 'pm10', unit: 'µg/m³', avg: 12.4, recommended_guideline: 45, recommended_ratio: 0.28, within_recommended: true, stations_used: 1 },
          { pollutant: 'co', unit: 'ppm', avg: 9000, recommended_guideline: 4000, recommended_ratio: 2.25, within_recommended: false, stations_used: 1 },
        ],
      },
    ],
  });

  const [row] = connection.all("SELECT * FROM air_quality WHERE city = 'ruse'");
  assert.equal(row.co_average, null);
  assert.equal(row.co_unit, null);
  assert.equal(row.co_ratio, null);
  assert.equal(row.pm25_average, 11.1);
  assert.equal(row.pm10_average, 12.4);
  assert.equal(row.mean_ratio, 0.51);
  assert.equal(row.max_ratio, 0.74);
});
