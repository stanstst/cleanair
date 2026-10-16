const fs = require('node:fs');
const path = require('node:path');
const { fixtureName } = require('./fixtureName');

const FIXTURES_DIR = path.join(__dirname, 'fixtures', 'openaq-api');

class MockApiClient {
  constructor({ fixturesDir = FIXTURES_DIR } = {}) {
    this.fixturesDir = fixturesDir;
    this.calls = [];
    this.callCount = 0;
  }

  async get(apiPath, query = {}) {
    this.callCount++;
    this.calls.push({ path: apiPath, query });

    const file = path.join(this.fixturesDir, fixtureName(apiPath, query));
    if (!fs.existsSync(file)) {
      throw new Error(`no fixture for ${apiPath} ${JSON.stringify(query)} (${path.basename(file)})`);
    }
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  }
}

module.exports = { MockApiClient };
