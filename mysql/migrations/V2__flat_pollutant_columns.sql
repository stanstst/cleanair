DROP TABLE air_quality;

CREATE TABLE air_quality (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  city VARCHAR(64) NOT NULL,
  target_date DATE NOT NULL,
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
  UNIQUE KEY uq_city_date (city, target_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
