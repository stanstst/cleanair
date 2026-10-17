const mysql = require('mysql2/promise');

const COLUMNS = [
  'city',
  'target_date',
  'mean_ratio',
  'max_ratio',
  'pm25_average',
  'pm25_unit',
  'pm25_ratio',
  'pm10_average',
  'pm10_unit',
  'pm10_ratio',
  'co_average',
  'co_unit',
  'co_ratio',
];

class AirQualityRepository {
  constructor(connection) {
    this.connection = connection;
  }

  static async connect({ host, port = 3306, user, password, database }) {
    const connection = await mysql.createConnection({
      host,
      port: Number(port),
      user,
      password,
      database,
      dateStrings: true,
      flags: ['-FOUND_ROWS'],
    });
    return new AirQualityRepository(connection);
  }

  async insertIgnoringDuplicates(rows) {
    if (rows.length === 0) return 0;
    const [result] = await this.connection.query(
      `INSERT INTO air_quality (${COLUMNS.join(', ')})
       VALUES ?
       ON DUPLICATE KEY UPDATE id = id`,
      [rows],
    );
    return result.affectedRows;
  }

  async close() {
    await this.connection.end();
  }
}

module.exports = { AirQualityRepository };
