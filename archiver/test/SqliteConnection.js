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
    this.ended = false;
    this.db.exec(SCHEMA);
  }

  async query(sql, params = []) {
    const statement = this.db.prepare(sql);
    if (/^\s*SELECT/i.test(sql)) {
      return [statement.all(...params).map((row) => ({ ...row }))];
    }
    const { changes } = statement.run(...params);
    return [{ affectedRows: changes }];
  }

  insert(row) {
    const columns = Object.keys(row);
    this.db
      .prepare(`INSERT INTO air_quality (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`)
      .run(...Object.values(row));
  }

  all(sql) {
    return this.db.prepare(sql).all().map((row) => ({ ...row }));
  }

  async end() {
    this.ended = true;
  }

  close() {
    this.db.close();
  }
}

module.exports = { SqliteConnection };
