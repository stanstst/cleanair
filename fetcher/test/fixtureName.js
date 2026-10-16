const VARYING_PARAMS = ['coordinates', 'parameters_id', 'page'];

function fixtureName(path, query = {}) {
  const segments = path.split('/').filter(Boolean);
  const params = VARYING_PARAMS.filter((key) => query[key] !== undefined).map((key) =>
    key === 'page' ? `page${query[key]}` : String(query[key]),
  );
  return `${[...segments, ...params].join('_')}.json`;
}

module.exports = { fixtureName };
