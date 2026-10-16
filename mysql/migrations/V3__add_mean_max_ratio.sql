DELETE FROM air_quality;

ALTER TABLE air_quality
  ADD COLUMN mean_ratio DECIMAL(8,2) NOT NULL AFTER target_date,
  ADD COLUMN max_ratio DECIMAL(8,2) NOT NULL AFTER mean_ratio;
