const { RADIUS_M, PM25_PARAM_ID, RECOMMENDED_PM25_24H, CITIES } = require('./config');

class UnknownCityError extends Error {
  constructor(city) {
    super(`unknown city '${city}'`);
    this.name = 'UnknownCityError';
  }
}

class InvalidDateToError extends Error {
  constructor(value, reason = '') {
    super(`invalid date-to '${value}'${reason}`);
    this.name = 'InvalidDateToError';
  }
}

function round(n, decimals) {
  const f = 10 ** decimals;
  return (Math.sign(n) * Math.round(Math.abs(n) * f + Number.EPSILON)) / f;
}

function toNumber(v) {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '') return Number(v);
  return NaN;
}

const mean =(values) => values.reduce((sum, v) => sum + v, 0) / values.length;

const isoSeconds = (date) => date.toISOString().replace(/\.\d{3}Z$/, 'Z');

// OpenAQ-specific ingestion: finds PM2.5 monitors near each city, averages
// their last 24 hours, and ranks the cities against the WHO 24h guideline.
class Pm25Ingestion {
  constructor(client, { cities = CITIES, maxLocationsPerCity = 3 } = {}) {
    this.client = client;
    this.cities = cities;
    this.maxLocationsPerCity = maxLocationsPerCity;
  }

  static timeWindow(now = new Date()) {
    const to = new Date(now);
    to.setUTCMinutes(0, 0, 0);
    const from = new Date(to.getTime() - 24 * 3600 * 1000);
    return { from: isoSeconds(from), to: isoSeconds(to) };
  }

  /** Hourly PM2.5 values for one sensor (handles paging). */
  async sensorHours(sensorId, from, to) {
    const values = [];
    let page = 1;
    let batch;
    do {
      const json = await this.client.get(`/sensors/${sensorId}/hours`, {
        datetime_from: from,
        datetime_to: to,
        limit: 100,
        page: page++,
      });
      batch = json.results ?? [];

      for (const h of batch) {
        const v = toNumber(h.value);
        if (Number.isFinite(v) && v >= 0) values.push(v);
      }
    } while (batch.length === 100);

    return values;
  }

  async cityPm25(city, lat, lon, from, to) {
    const json = await this.client.get('/locations', {
      coordinates: `${lat},${lon}`,
      radius: RADIUS_M,
      monitor: 'true',
      parameters_id: PM25_PARAM_ID,
      limit: 100,
    });
    // limit api calls, to prevent exceeding the free limit
    const locations = (json.results ?? []).slice(0, this.maxLocationsPerCity);

    const stations = [];
    for (const loc of locations) {
      for (const sensor of loc.sensors ?? []) {
        if (sensor.parameter?.name !== 'pm25') continue;

        const values = await this.sensorHours(sensor.id, from, to);
        stations.push({
          location_id: loc.id,
          name: loc.name ?? null,
          sensor_id: sensor.id,
          pm25_avg: values.length ? round(mean(values), 1) : null,
          hours: values.length,
        });
      }
    }

    const withData = stations.filter((s) => s.pm25_avg !== null);
    const avg = withData.length ? round(mean(withData.map((s) => s.pm25_avg)), 1) : null;

    return {
      city,
      avg: avg,
      recommended_ratio: avg !== null ? round(avg / RECOMMENDED_PM25_24H, 2) : null,
      within_recommended: avg !== null ? avg <= RECOMMENDED_PM25_24H : null,
      stations_used: withData.length,
    };
  }

  async run(cityArg, dateTo) {
    const arg = cityArg ? cityArg.toLowerCase() : null;
    if (arg !== null && !Object.hasOwn(this.cities, arg)) throw new UnknownCityError(arg);

    const now = new Date();
    const reference = dateTo === undefined || dateTo === null ? now : new Date(dateTo);
    if (Number.isNaN(reference.getTime())) throw new InvalidDateToError(dateTo);
    if (reference > now) throw new InvalidDateToError(dateTo, ' is in the future');

    const cities = arg ? { [arg]: this.cities[arg] } : this.cities;
    const { from, to } = Pm25Ingestion.timeWindow(reference);

    const results = [];
    for (const [name, [lat, lon]] of Object.entries(cities)) {
      results.push(await this.cityPm25(name, lat, lon, from, to));
    }

    const filteredCities = results.filter((r) => r.avg !== null);
    const noData = results.filter((r) => r.avg === null);

    return {
      pollutant: 'pm25',
      unit: 'µg/m³',
      period: { from, to },
      recommended_guideline: RECOMMENDED_PM25_24H,
      cities: filteredCities,
      no_data: noData.map((r) => r.city),
      source: 'OpenAQ v3 (reference monitors)',
    };
  }
}

module.exports = { Pm25Ingestion, UnknownCityError, InvalidDateToError };
