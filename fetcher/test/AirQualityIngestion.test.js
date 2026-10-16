const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  AirQualityIngestion,
  UnknownCityError,
  InvalidDateToError,
} = require('../src/openaq/AirQualityIngestion');
const { MockApiClient } = require('./MockApiClient');

const expected = {
  period: { from: '2026-10-13T00:00:00Z', to: '2026-10-14T00:00:00Z' },
  cities: [
    {
      city: 'sofia',
      pollutants: [
        {
          pollutant: 'pm25',
          unit: 'µg/m³',
          avg: 11.1,
          recommended_guideline: 15,
          recommended_ratio: 0.74,
          within_recommended: true,
          stations_used: 2,
        },
        {
          pollutant: 'pm10',
          unit: 'µg/m³',
          avg: 12.4,
          recommended_guideline: 45,
          recommended_ratio: 0.28,
          within_recommended: true,
          stations_used: 2,
        },
        {
          pollutant: 'co',
          unit: 'µg/m³',
          avg: 519.8,
          recommended_guideline: 4000,
          recommended_ratio: 0.13,
          within_recommended: true,
          stations_used: 3,
        },
      ],
    },
  ],
  no_data: [],
  source: 'OpenAQ v3 (reference monitors)',
};

test('run builds the sofia report from the captured API responses', async () => {
  const values = { city: 'sofia', 'date-to': '2026-10-14' };
  const client = new MockApiClient();

  const report = await new AirQualityIngestion(client).run(values.city, values['date-to']);

  assert.deepEqual(report, expected);
  assert.deepEqual(
    client.calls.map((c) => c.path),
    [
      '/locations',
      '/sensors/6283928/hours',
      '/sensors/1293779/hours',
      '/locations',
      '/sensors/25781/hours',
      '/sensors/25790/hours',
      '/sensors/25822/hours',
      '/locations',
      '/sensors/25784/hours',
      '/sensors/25793/hours',
      '/sensors/25834/hours',
    ],
  );
  for (const { path, query } of client.calls) {
    if (path === '/locations') {
      assert.equal(query.coordinates, '42.6977,23.3219');
    } else {
      assert.equal(query.datetime_from, '2026-10-13T00:00:00Z');
      assert.equal(query.datetime_to, '2026-10-14T00:00:00Z');
    }
  }
});

test('run rejects an unknown city without calling the API', async () => {
  const client = new MockApiClient();

  await assert.rejects(new AirQualityIngestion(client).run('atlantis', '2026-10-14'), UnknownCityError);
  assert.equal(client.callCount, 0);
});

test('run rejects an invalid or future date-to without calling the API', async () => {
  const client = new MockApiClient();
  const ingestion = new AirQualityIngestion(client);

  await assert.rejects(ingestion.run('sofia', 'not-a-date'), InvalidDateToError);
  await assert.rejects(ingestion.run('sofia', '2999-01-01'), /is in the future/);
  assert.equal(client.callCount, 0);
});
