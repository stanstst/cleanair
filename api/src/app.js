const path = require('node:path');
const express = require('express');
const { Registry, Histogram, Gauge } = require('prom-client');

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isIsoDate(value) {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function createApp({ repository }) {
  const app = express();
  const registry = new Registry();

  const cleanestCityDuration = new Histogram({
    name: 'cleanair_api_cleanest_city_request_duration_seconds',
    help: 'Response time of GET /cleanest-city requests in seconds',
    labelNames: ['status'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [registry],
  });

  const cleanestCityLastFailure = new Gauge({
    name: 'cleanair_api_cleanest_city_last_failure_timestamp_seconds',
    help: 'Unix timestamp of the last failed (5xx) GET /cleanest-city request',
    registers: [registry],
  });

  app.use(express.static(path.join(__dirname, '../public')));

  app.get('/metrics', async (req, res) => {
    res.set('Content-Type', registry.contentType);
    res.send(await registry.metrics());
  });

  app.get('/cleanest-city', async (req, res) => {
    const stopTimer = cleanestCityDuration.startTimer();
    res.on('finish', () => {
      stopTimer({ status: res.statusCode });
      if (res.statusCode >= 500) cleanestCityLastFailure.setToCurrentTime();
    });
    res.set('Content-Type', 'application/json');
    const dateFrom = req.query['date-from'];
    const dateTo = req.query['date-to'];

    if (!isIsoDate(dateFrom) || !isIsoDate(dateTo)) {
      return res.status(400).json({ error: 'date-from and date-to are required in YYYY-MM-DD format' });
    }
    if (dateFrom > dateTo) {
      return res.status(400).json({ error: 'date-from must not be after date-to' });
    }

    try {
      const record = await repository.findCleanest(dateFrom, dateTo);
      if (!record) {
        return res.status(404).json({ error: 'No data for the selected period' });
      }
      return res.json(record);
    } catch (error) {
      console.error(error.message);
      return res.status(500).json({ error: 'Internal error' });
    }
  });

  return app;
}

module.exports = { createApp };
