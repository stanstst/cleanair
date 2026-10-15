class ApiError extends Error {
  constructor(message, { status = null, url = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.url = url;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class ApiClient {
  constructor({ baseUrl, headers = {}, maxAttempts = 3, timeoutMs = 30000 } = {}) {
    if (!baseUrl) throw new ApiError('baseUrl is required');

    this.baseUrl = baseUrl;
    this.headers = headers;
    this.maxAttempts = maxAttempts;
    this.timeoutMs = timeoutMs;
    this.callCount = 0;
  }

  async get(path, query = {}) {
    this.callCount++;

    const url = `${this.baseUrl}${path}?${new URLSearchParams(query)}`;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      let res;
      try {
        res = await fetch(url, {
          headers: { Accept: 'application/json', ...this.headers },
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (err) {
        throw new ApiError(`request failed: ${err.cause?.message || err.message}`, { url });
      }

      const { status } = res;
      if (status === 401 || status === 403) {
        throw new ApiError(`API rejected the credentials (HTTP ${status}) from ${url}`, { status, url });
      }
      if (status === 429 || status >= 500) {
        await res.body?.cancel();
        await sleep(attempt * 2000);
        continue;
      }
      if (status !== 200) throw new ApiError(`HTTP ${status} from ${url}`, { status, url });

      try {
        return await res.json();
      } catch {
        throw new ApiError(`invalid JSON from ${url}`, { status, url });
      }
    }

    throw new ApiError(`gave up after ${this.maxAttempts} attempts: ${url}`, { url });
  }
}

module.exports = { ApiClient, ApiError };
