# Clean Air Finder

A web service with a minimal UI that answers one question: **which Bulgarian city had the cleanest air over a chosen period?**

The answer is based on real public measurements of three pollutants: **PM2.5, PM10 and NO₂**.

---

## How "cleanest air" is determined

The three pollutants can't be compared directly. For example, 20 µg/m³ of PM2.5 is far more harmful than 20 µg/m³ of NO₂. So the ranking works in three steps: aggregate, normalize, combine.

### 1. Aggregate measurements for the selected period

For each city, the measurements for each pollutant are reduced to one value over the selected period: the **mean of daily means**.

**Multiple stations:** if a city has more than one station, the station values are averaged for each pollutant.

### 2. Normalize each pollutant to a ratio

Each aggregated value is divided by its reference limit:

```
ratio = measured_value / reference_limit
```

| Ratio | Meaning |
|---|---|
| `< 1` | Below the limit (good) |
| `= 1` | At the limit |
| `> 1` | Exceeds the limit |

**Reference limits** (WHO Air Quality Guidelines 2021, 24-hour values, µg/m³):

| Pollutant | Limit |
|---|---|
| PM2.5 | 15 |
| PM10 | 45 |
| NO₂ | 25 |

The limits are configurable in `config` (see below), so EU limits or another standard can be used instead.

### 3. Combine the ratios into a city score

Each city gets two scores:

- **Max ratio (primary):** the ratio of the worst pollutant.
  ```
  max_ratio = max(ratio_PM25, ratio_PM10, ratio_NO2)
  ```
- **Mean ratio (tie-breaker):** the average of the ratios of the available pollutants.
  ```
  mean_ratio = sum(available ratios) / number of available pollutants
  ```

**Ranking rule:**

1. Cities are sorted by `max_ratio`, lowest first.
2. If two cities have the same `max_ratio`, the one with the lower `mean_ratio` ranks higher.
3. The first city in the list has the cleanest air.

**Why max first?** It follows the logic of official air quality indices such as the US AQI and the European AQI: air is only as clean as its worst pollutant. A city with one pollutant at three times the limit is not "clean" just because its other pollutants are low. The mean only breaks ties, so it can never override the max.

---

## Data quality rules

| Rule | Behaviour |
|---|---|
| **Missing pollutant** | Not counted. It is **never treated as 0**, because that would make the city look cleaner than it is. Scores are calculated from the available pollutants only. |
| **Minimum required data** | A city is ranked only if it has data for **PM10 or PM2.5**. Cities without either are excluded from the ranking. |
| **Partial coverage** | A city that is missing some pollutants is still ranked, but it is flagged in the response and the UI (for example, "based on 2 of 3 pollutants"). |
| **Data coverage threshold** | A day counts only if at least **75%** of its hourly values are valid. A pollutant counts for the period only if at least **75%** of its days are valid. |
| **Invalid values** | Negative values and missing values are discarded before aggregation. |

---

## Example

Selected period: 1–31 January

| City | PM2.5 | PM10 | NO₂ | Max ratio | Mean ratio |
|---|---|---|---|---|---|
| Varna | 1.2 | 0.9 | 0.8 | **1.2** | 0.97 |
| Burgas | 1.2 | 1.1 | 0.4 | **1.2** | 0.90 |
| Sofia | 2.1 | 1.6 | 1.4 | 2.1 | 1.70 |
| Smolyan | — | 0.7 | — | 0.7 | 0.70 ⚠️ |

**Result:**

1. **Smolyan:** max ratio 0.7. ⚠️ Based on 1 of 3 pollutants.
2. **Burgas:** max ratio 1.2. Wins the tie with Varna because its mean ratio is lower (0.90 vs 0.97).
3. **Varna:** max ratio 1.2.
4. **Sofia:** max ratio 2.1.

**Smolyan is the city with the cleanest air**, but the result is flagged because it is based on PM10 only.

---

## Configuration

```yaml
reference_limits:      # µg/m³
  pm25: 15
  pm10: 45
  no2: 25

coverage_threshold: 0.75
required_pollutants_any_of: [pm25, pm10]
```

---

## Known limitations

- **Station placement affects results.** A city with a single traffic-side station will look worse than one with a single park-side station.
- **Short periods are noisy.** A ranking over one or two days can be dominated by a single weather event.
