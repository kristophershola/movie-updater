process.env.GITHUB_TOKEN = 'test-token';

const { test } = require('node:test');
const assert = require('node:assert');

const { handler } = require('../netlify/functions/save.js');

function jsonRes(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

async function withFetch(routes, fn) {
  const orig = global.fetch;
  global.fetch = async (url, opts = {}) => {
    const key = `${opts.method || 'GET'} ${url}`;
    const route = routes[key];
    if (!route) throw new Error(`No mock for ${key}`);
    return route(url, opts);
  };
  try {
    return await fn();
  } finally {
    global.fetch = orig;
  }
}

test('returns 500 when GITHUB_TOKEN is missing', async (t) => {
  delete process.env.GITHUB_TOKEN;
  t.after(() => {
    process.env.GITHUB_TOKEN = 'test-token';
  });
  const res = await handler({ httpMethod: 'POST', body: '{}' });
  assert.strictEqual(res.statusCode, 500);
});

test('returns 400 for payload without a movies array', async () => {
  const res = await handler({ httpMethod: 'POST', body: '42' });
  assert.strictEqual(res.statusCode, 400);
  assert.match(JSON.parse(res.body).error, /movies array/);
});

test('returns 405 for non-POST', async () => {
  const res = await handler({ httpMethod: 'GET', body: '' });
  assert.strictEqual(res.statusCode, 405);
});

test('returns 400 for invalid JSON body', async () => {
  const res = await handler({ httpMethod: 'POST', body: 'not-json' });
  assert.strictEqual(res.statusCode, 400);
});

test('commits new content via GitHub Contents API', async () => {
  const payload = { generated: 'x', movies: [{ title: 'Test Movie' }] };
  const captured = {};
  const res = await withFetch({
    'GET https://api.github.com/repos/kristophershola/movie-updater/contents/movies.json?ref=main': () =>
      jsonRes(200, { sha: 'abc123' }),
    'PUT https://api.github.com/repos/kristophershola/movie-updater/contents/movies.json': async (url, opts) => {
      captured.opts = opts;
      return jsonRes(200, {});
    },
  }, () => handler({ httpMethod: 'POST', body: JSON.stringify(payload) }));

  assert.strictEqual(res.statusCode, 200);
  assert.deepStrictEqual(JSON.parse(res.body), { ok: true });
  const req = JSON.parse(captured.opts.body);
  assert.strictEqual(req.sha, 'abc123');
  assert.strictEqual(req.branch, 'main');
  assert.strictEqual(req.message, 'Update movies.json');
  assert.strictEqual(req.content, Buffer.from(JSON.stringify(payload, null, 2)).toString('base64'));
});

test('creates file when it does not exist (no sha)', async () => {
  const captured = {};
  const res = await withFetch({
    'GET https://api.github.com/repos/kristophershola/movie-updater/contents/movies.json?ref=main': () =>
      jsonRes(404, { message: 'Not Found' }),
    'PUT https://api.github.com/repos/kristophershola/movie-updater/contents/movies.json': async (url, opts) => {
      captured.opts = opts;
      return jsonRes(200, {});
    },
  }, () => handler({ httpMethod: 'POST', body: '{"movies":[]}' }));

  assert.strictEqual(res.statusCode, 200);
  const req = JSON.parse(captured.opts.body);
  assert.strictEqual(req.sha, undefined);
});

test('returns GitHub PUT error with readable message', async () => {
  const res = await withFetch({
    'GET https://api.github.com/repos/kristophershola/movie-updater/contents/movies.json?ref=main': () =>
      jsonRes(200, { sha: 'abc123' }),
    'PUT https://api.github.com/repos/kristophershola/movie-updater/contents/movies.json': () =>
      jsonRes(409, { message: 'sha doesnt match the tip of branch' }),
  }, () => handler({ httpMethod: 'POST', body: '{"movies":[]}' }));

  assert.strictEqual(res.statusCode, 409);
  assert.match(JSON.parse(res.body).error, /sha doesnt match/);
});

test('returns upstream status when reading movies.json fails', async () => {
  const res = await withFetch({
    'GET https://api.github.com/repos/kristophershola/movie-updater/contents/movies.json?ref=main': () =>
      jsonRes(403, {}),
  }, () => handler({ httpMethod: 'POST', body: '{"movies":[]}' }));

  assert.strictEqual(res.statusCode, 403);
  assert.deepStrictEqual(JSON.parse(res.body), { error: 'Failed to read movies.json (403)' });
});

test('returns 500 when GitHub fetch throws', async () => {
  const res = await withFetch({
    'GET https://api.github.com/repos/kristophershola/movie-updater/contents/movies.json?ref=main': () => {
      throw new Error('network down');
    },
  }, () => handler({ httpMethod: 'POST', body: '{"movies":[]}' }));

  assert.strictEqual(res.statusCode, 500);
  assert.match(JSON.parse(res.body).error, /network down/);
});
