const fs = require('node:fs/promises');
const path = require('node:path');

class FileUploader {
  constructor({ dir = '/tmp/archive' } = {}) {
    this.dir = dir;
  }

  async upload({ fileName, content }) {
    await fs.mkdir(this.dir, { recursive: true });
    const filePath = path.join(this.dir, fileName);
    await fs.writeFile(filePath, content);
    return filePath;
  }
}

module.exports = { FileUploader };
