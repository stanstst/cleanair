const mysql = require('mysql2/promise');

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
    });
    return new AirQualityRepository(connection);
  }

  async findOlderThan(cutoffDate) {
    const [rows] = await this.connection.query(
      'SELECT * FROM air_quality WHERE target_date < ? ORDER BY target_date, city',
      [cutoffDate],
    );
    return rows;
  }

  async deleteByTargetDate(targetDate) {
    const [result] = await this.connection.query('DELETE FROM air_quality WHERE target_date = ?', [targetDate]);
    return result.affectedRows;
  }

  async close() {
    await this.connection.end();
  }
}

module.exports = { AirQualityRepository };
