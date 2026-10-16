const mysql = require('mysql2/promise');
const { POLLUTANTS } = require('../openaq/config');

const COLUMN_NAME = /^[a-z0-9_]+$/;

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

    return [city.city, targetDate, ...values];
  }

  async saveReport(report) {
    const targetDate = new Date(report.period.to).toISOString().split('T')[0];
    const rows = report.cities.map((c) => this.rowFor(c, targetDate));
    if (rows.length === 0) return 0;

    const columns = ['city', 'target_date', ...this.pollutantColumns];
    const updates = this.pollutantColumns.map((col) => `${col} = VALUES(${col})`);

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
