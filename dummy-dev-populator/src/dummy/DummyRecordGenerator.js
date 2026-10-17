const CITIES = ['sofia', 'ruse', 'varna'];
const POLLUTANTS = ['pm25', 'pm10', 'co'];
const UNIT = 'µg/m³';

function round(n, decimals) {
  const f = 10 ** decimals;
  return (Math.sign(n) * Math.round(Math.abs(n) * f + Number.EPSILON)) / f;
}

class DummyRecordGenerator {
  constructor({ random = Math.random } = {}) {
    this.random = random;
  }

  between(min, max, decimals) {
    return round(min + this.random() * (max - min), decimals);
  }

  rowFor(city, targetDate) {
    const pollutants = POLLUTANTS.map(() => ({
      average: this.between(5, 15, 1),
      ratio: this.between(0.3, 3.3, 2),
    }));
    const ratios = pollutants.map((p) => p.ratio);
    const meanRatio = round(ratios.reduce((sum, r) => sum + r, 0) / ratios.length, 2);
    const maxRatio = Math.max(...ratios);

    return [city, targetDate, meanRatio, maxRatio, ...pollutants.flatMap((p) => [p.average, UNIT, p.ratio])];
  }

  rowsFor(targetDate) {
    return CITIES.map((city) => this.rowFor(city, targetDate));
  }
}

module.exports = { DummyRecordGenerator, CITIES };
