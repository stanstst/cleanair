const mysql = require('mysql2/promise');

class CityRepository {
  constructor(connection) {
    this.connection = connection;
  }

  static async connect({ host, port = 3306, user, password, database }) {
    const pool = mysql.createPool({
      host,
      port: Number(port),
      user,
      password,
      database,
      dateStrings: true,
      decimalNumbers: true,
    });
    return new CityRepository(pool);
  }

  async findCleanest(dateFrom, dateTo) {
    const [rows] = await this.connection.query(
      `SELECT city, AVG(max_ratio) AS period_max_polution, AVG(mean_ratio) AS period_mean_polution
       FROM air_quality
       WHERE target_date BETWEEN ? AND ?
       GROUP BY city
       ORDER BY AVG(max_ratio), AVG(mean_ratio)
       LIMIT 1`,
      [dateFrom, dateTo],
    );
    return rows[0];
  }

  async close() {
    await this.connection.end();
  }
}

module.exports = { CityRepository };
