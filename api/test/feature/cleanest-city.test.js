const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../../src/app');
const { CityRepository } = require('../../src/db/CityRepository');
const { SqliteConnection } = require('../SqliteConnection');

const record = (city, targetDate, meanRatio, maxRatio) => ({
  city,
  target_date: targetDate,
  mean_ratio: meanRatio,
  max_ratio: maxRatio,
});

const RECORDS = [
  record('sofia', '2026-10-01', 0.25, 2.0),
  record('sofia', '2026-10-02', 0.25, 2.0),
  record('ruse', '2026-10-01', 1.0, 1.0),
  record('ruse', '2026-10-02', 1.0, 1.5),
  record('varna', '2026-10-01', 0.5, 1.5),
  record('varna', '2026-10-02', 0.5, 1.0),
  record('ruse', '2026-09-30', 0.1, 0.1),
  record('sofia', '2026-10-03', 0.2, 0.2),
];

async function startApi(t, records = RECORDS) {
  const connection = new SqliteConnection();
  records.forEach((r) => connection.insert(r));
  t.mock.method(console, 'error', () => {});
  const server = createApp({ repository: new CityRepository(connection) }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => {
    server.close();
    connection.close();
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return async (path) => {
    const response = await fetch(`${base}${path}`);
    const type = response.headers.get('content-type') ?? '';
    return { status: response.status, type, body: type.includes('json') ? await response.json() : await response.text() };
  };
}

test('returns the city with the lowest period max, using the period mean as a tie-breaker', async (t) => {
  const get = await startApi(t);

  const { status, type, body } = await get('/cleanest-city?date-from=2026-10-01&date-to=2026-10-02');

  assert.equal(status, 200);
  assert.equal(type, 'application/json; charset=utf-8');
  assert.deepEqual(body, { city: 'varna', period_max_polution: 1.25, period_mean_polution: 0.5 });
});

test('includes rows on both range bounds', async (t) => {
  const get = await startApi(t);

  const first = await get('/cleanest-city?date-from=2026-09-30&date-to=2026-09-30');
  const last = await get('/cleanest-city?date-from=2026-10-03&date-to=2026-10-03');

  assert.deepEqual(first.body, { city: 'ruse', period_max_polution: 0.1, period_mean_polution: 0.1 });
  assert.deepEqual(last.body, { city: 'sofia', period_max_polution: 0.2, period_mean_polution: 0.2 });
});

test('returns 400 for missing or invalid dates', async (t) => {
  const get = await startApi(t);

  for (const query of [
    '',
    '?date-from=2026-10-01',
    '?date-from=01-10-2026&date-to=02-10-2026',
    '?date-from=2026-02-31&date-to=2026-03-01',
    '?date-from=2026-10-02&date-to=2026-10-01',
  ]) {
    const { status, body } = await get(`/cleanest-city${query}`);
    assert.equal(status, 400, query);
    assert.ok(body.error, query);
  }
});

test('returns 404 when there is no data for the range', async (t) => {
  const get = await startApi(t);

  const { status, body } = await get('/cleanest-city?date-from=2020-01-01&date-to=2020-12-31');

  assert.equal(status, 404);
  assert.equal(body.error, 'No data for the selected period');
});

test('returns 500 when the repository fails', async (t) => {
  t.mock.method(console, 'error', () => {});
  const repository = { findCleanest: async () => { throw new Error('db down'); } };
  const server = createApp({ repository }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => server.close());

  const response = await fetch(`http://127.0.0.1:${server.address().port}/cleanest-city?date-from=2026-10-01&date-to=2026-10-02`);

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: 'Internal error' });
});

test('serves the UI page', async (t) => {
  const get = await startApi(t);

  const { status, body } = await get('/');

  assert.equal(status, 200);
  assert.match(body, /flatpickr/);
  assert.match(body, /cleanest-city/);
});

test('exposes cleanest-city request count and response time metrics', async (t) => {
  const get = await startApi(t);

  await get('/cleanest-city?date-from=2026-10-01&date-to=2026-10-02');
  await get('/cleanest-city?date-from=2020-01-01&date-to=2020-12-31');
  await get('/cleanest-city');
  const { status, type, body } = await get('/metrics');

  assert.equal(status, 200);
  assert.match(type, /^text\/plain/);
  assert.match(body, /cleanair_api_cleanest_city_request_duration_seconds_count\{status="200"\} 1/);
  assert.match(body, /cleanair_api_cleanest_city_request_duration_seconds_count\{status="404"\} 1/);
  assert.match(body, /cleanair_api_cleanest_city_request_duration_seconds_count\{status="400"\} 1/);
  assert.match(body, /cleanair_api_cleanest_city_request_duration_seconds_sum\{status="200"\} \d/);
});

test('records the last failed request timestamp only for 5xx responses', async (t) => {
  t.mock.method(console, 'error', () => {});
  const repository = { findCleanest: async () => { throw new Error('db down'); } };
  const server = createApp({ repository }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const lastFailure = async () => {
    const body = await (await fetch(`${base}/metrics`)).text();
    return Number(body.match(/^cleanair_api_cleanest_city_last_failure_timestamp_seconds (\S+)$/m)[1]);
  };

  await fetch(`${base}/cleanest-city`);
  assert.equal(await lastFailure(), 0);

  const before = Date.now() / 1000;
  await fetch(`${base}/cleanest-city?date-from=2026-10-01&date-to=2026-10-02`);
  const timestamp = await lastFailure();

  assert.ok(timestamp >= Math.floor(before) && timestamp <= Date.now() / 1000, String(timestamp));
});
