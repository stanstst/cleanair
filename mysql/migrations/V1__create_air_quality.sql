CREATE TABLE air_quality (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  city VARCHAR(64) NOT NULL,
  pollutant VARCHAR(16) NOT NULL,
  average_value DECIMAL(8,1) NOT NULL,
  unit VARCHAR(16) NOT NULL,
  target_date DATE NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  recommended_guideline DECIMAL(8,1) NOT NULL,
  recommended_ratio DECIMAL(8,2) NOT NULL,
  UNIQUE KEY uq_city_pollutant_date (city, pollutant, target_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
