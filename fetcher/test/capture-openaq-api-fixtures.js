const fs = require('node:fs');
const path = require('node:path');
const { parseArgs } = require('node:util');
const { ApiClient } = require('../src/openaq/ApiClient');
const { API_BASE } = require('../src/openaq/config');
const { AirQualityIngestion } = require('../src/openaq/AirQualityIngestion');
const { fixtureName } = require('./fixtureName');

const FIXTURES_DIR = path.join(__dirname, 'fixtures', 'openaq-api');

async function main() {
  const { values } = parseArgs({
    options: { city: { type: 'string' }, 'date-to': { type: 'string' } },
  });

  const apiKey = process.env.OPENAQ_API_KEY;
  if (!apiKey) throw new Error('OPENAQ_API_KEY is not set');

  const client = new ApiClient({ baseUrl: API_BASE, headers: { 'X-API-Key': apiKey } });
  const get = client.get.bind(client);
  client.get = async (apiPath, query) => {
    const json = await get(apiPath, query);
    const file = path.join(FIXTURES_DIR, fixtureName(apiPath, query));
    fs.writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
    console.error(`saved ${path.relative(process.cwd(), file)}`);
    return json;
  };

  fs.mkdirSync(FIXTURES_DIR, { recursive: true });
  const report = await new AirQualityIngestion(client).run(values.city, values['date-to']);

  console.log(JSON.stringify(report, null, 2));
  console.error(`api_calls=${client.callCount}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
