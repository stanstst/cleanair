class DufsFileUploader {
  constructor({ baseUrl, user, password }) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.authorization = `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
  }

  async upload({ fileName, content }) {
    const url = `${this.baseUrl}/${encodeURIComponent(fileName)}`;
    const response = await fetch(url, {
      method: 'PUT',
      headers: { Authorization: this.authorization, 'Content-Type': 'text/csv; charset=utf-8' },
      body: content,
    });
    if (!response.ok) {
      throw new Error(`upload of ${fileName} failed: ${response.status} ${response.statusText}`);
    }
    return fileName;
  }
}

module.exports = { DufsFileUploader };
