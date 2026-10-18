const path = require('node:path');
const express = require('express');

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isIsoDate(value) {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function createApp({ repository }) {
  const app = express();

  app.use(express.static(path.join(__dirname, '../public')));

  app.get('/cleanest-city', async (req, res) => {
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
