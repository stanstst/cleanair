const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
  CREATE TABLE air_quality (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    city VARCHAR(64) NOT NULL,
    target_date DATE NOT NULL,
    mean_ratio DECIMAL(8,2) NOT NULL,
    max_ratio DECIMAL(8,2) NOT NULL,
    pm25_average DECIMAL(8,1) NULL,
    pm25_unit VARCHAR(16) NULL,
    pm25_ratio DECIMAL(8,2) NULL,
    pm10_average DECIMAL(8,1) NULL,
    pm10_unit VARCHAR(16) NULL,
    pm10_ratio DECIMAL(8,2) NULL,
    co_average DECIMAL(8,1) NULL,
    co_unit VARCHAR(16) NULL,
    co_ratio DECIMAL(8,2) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (city, target_date)
  )
`;

class SqliteConnection {
  constructor() {
    this.db = new DatabaseSync(':memory:');
    this.db.exec(SCHEMA);
  }

  async query(sql, [rows]) {
    const groups = rows.map((row) => `(${row.map(() => '?').join(', ')})`).join(', ');
    const sqliteSql = sql
      .replace('VALUES ?', `VALUES ${groups}`)
      .replace('ON DUPLICATE KEY UPDATE', 'ON CONFLICT (city, target_date) DO UPDATE SET')
      .replace(/VALUES\((\w+)\)/g, 'excluded.$1');
    return this.db.prepare(sqliteSql).run(...rows.flat());
  }

  all(sql) {
    return this.db.prepare(sql).all().map((row) => ({ ...row }));
  }

  async end() {
    this.db.close();
  }
}

module.exports = { SqliteConnection };
