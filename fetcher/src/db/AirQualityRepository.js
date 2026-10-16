const mysql = require('mysql2/promise');
const { POLLUTANTS } = require('../openaq/config');

const COLUMN_NAME = /^[a-z0-9_]+$/;

function round(n, decimals) {
  const f = 10 ** decimals;
  return (Math.sign(n) * Math.round(Math.abs(n) * f + Number.EPSILON)) / f;
}

class AirQualityRepository {
  constructor(connection, pollutants = POLLUTANTS) {
    const keys = Object.keys(pollutants);
    const invalid = keys.find((key) => !COLUMN_NAME.test(key));
    if (invalid) throw new Error(`invalid pollutant key '${invalid}'`);

    this.connection = connection;
    this.pollutantKeys = keys;
    this.pollutantColumns = keys.flatMap((key) => [`${key}_average`, `${key}_unit`, `${key}_ratio`]);
  }

  static async connect({ host, port = 3306, user, password, database }, pollutants = POLLUTANTS) {
    const connection = await mysql.createConnection({ host, port: Number(port), user, password, database });
    return new AirQualityRepository(connection, pollutants);
  }

  rowFor(city, targetDate) {
    const byPollutant = Object.fromEntries(city.pollutants.map((p) => [p.pollutant, p]));
    const values = this.pollutantKeys.flatMap((key) => {
      const p = byPollutant[key];
      return p ? [p.avg, p.unit, p.recommended_ratio] : [null, null, null];
    });

    const ratios = this.pollutantKeys
      .map((key) => byPollutant[key]?.recommended_ratio)
      .filter((r) => r !== null && r !== undefined);
    if (ratios.length === 0) throw new Error(`no ratios for ${city.city}`);

    const meanRatio = round(ratios.reduce((sum, r) => sum + r, 0) / ratios.length, 2);
    const maxRatio = Math.max(...ratios);

    return [city.city, targetDate, meanRatio, maxRatio, ...values];
  }

  async saveReport(report) {
    const targetDate = new Date(report.period.to).toISOString().split('T')[0];
    const rows = report.cities.map((c) => this.rowFor(c, targetDate));
    if (rows.length === 0) return 0;

    const columns = ['city', 'target_date', 'mean_ratio', 'max_ratio', ...this.pollutantColumns];
    const updates = ['mean_ratio', 'max_ratio', ...this.pollutantColumns].map((col) => `${col} = VALUES(${col})`);

    await this.connection.query(
      `INSERT INTO air_quality (${columns.join(', ')})
       VALUES ?
       ON DUPLICATE KEY UPDATE ${updates.join(', ')}`,
      [rows],
    );
    return rows.length;
  }

  async close() {
    await this.connection.end();
  }
}

module.exports = { AirQualityRepository };
