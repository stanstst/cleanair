module.exports = {
  API_BASE: 'https://api.openaq.org/v3',
  RADIUS_M: 15000,

  POLLUTANTS: {
    pm25: { parameterId: 2, unit: 'µg/m³', recommendedGuideline: 15 },
    pm10: { parameterId: 1, unit: 'µg/m³', recommendedGuideline: 45 },
    co: { parameterId: 4, unit: 'µg/m³', recommendedGuideline: 4000 },
  },

  CITIES: {
    sofia: [42.6977, 23.3219],
    ruse: [43.8356, 25.9657],
    varna: [43.2141, 27.9147],
    // burgas: [42.5048, 27.4626],
    // plovdiv: [42.1354, 24.7453],
    // 'stara-zagora': [42.4258, 25.6345],
    // pleven: [43.417, 24.6067],
    // vidin: [43.9962, 22.8679],
    // shumen: [43.2712, 26.9361],
    // pernik: [42.6052, 23.0378],
  },
};
