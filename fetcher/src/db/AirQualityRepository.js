const mysql = require('mysql2/promise');

class AirQualityRepository {
  constructor(connection) {
    this.connection = connection;
  }

  static async connect({ host, port = 3306, user, password, database }) {
    const connection = await mysql.createConnection({ host, port: Number(port), user, password, database });
    return new AirQualityRepository(connection);
  }

  async saveReport(report) {
    const targetDate = report.period.to.slice(0, 10);
    const rows = report.cities.map((c) => [
      c.city,
      report.pollutant,
      c.avg,
      report.unit,
      targetDate,
      report.recommended_guideline,
      c.recommended_ratio,
    ]);
    if (rows.length === 0) return 0;

    await this.connection.query(
      `INSERT INTO air_quality
         (city, pollutant, average_value, unit, target_date, recommended_guideline, recommended_ratio)
       VALUES ?
       ON DUPLICATE KEY UPDATE
         average_value = VALUES(average_value),
         unit = VALUES(unit),
         recommended_guideline = VALUES(recommended_guideline),
         recommended_ratio = VALUES(recommended_ratio)`,
      [rows],
    );
    return rows.length;
  }

  async close() {
    await this.connection.end();
  }
}

module.exports = { AirQualityRepository };
