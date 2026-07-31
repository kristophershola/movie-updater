# GitHub-Hosted Auto-Load and Save Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Movie Updater auto-load `movies.json` from the hosted site on page load, and save changes back to the GitHub repo through a Netlify Function so the site self-updates.

**Architecture:** The static page fetches `movies.json` (cache-busted) on init and loads it into the app. On save, the page POSTs the JSON to a Netlify Function which uses a server-side `GITHUB_TOKEN` to commit the file to the repo via the GitHub Contents API; Netlify's existing GitHub sync redeploys the site. The token never appears in the page.

**Tech Stack:** Vanilla JS single-file app (`index.html`), Netlify Functions (Node runtime), GitHub Contents REST API. Tests use Node's built-in `node:test` runner (no dependencies).

## Global Constraints

- Keep hosting on Netlify (GitHub sync). Do NOT move to GitHub Pages.
- The GitHub token must live only in the Netlify Function server-side env var `GITHUB_TOKEN`. Never embed it in the page or commit it.
- Keep the existing explicit "Save movies.json" button. No auto-save on every change.
- No changes to TMDB fetch, sort, genre-matching, or pin logic.
- Repo is `kristophershola/movie-updater`, branch `main`.
- All HTML/JS changes are inside the single file `index.html`. Follow its existing style (no em dashes, double-quoted strings, 2-space indent, comment banners like `// ---- SECTION ----`).

---
### Task 1: Create the Netlify Function with unit tests

**Files:**
- Create: `netlify.toml`
- Create: `netlify/functions/save.js`
- Create: `test/save.test.js`

**Interfaces:**
- Produces: `exports.handler(event)` at `netlify/functions/save.js`. Consumes a POST with a JSON body equal to the `movies.json` document. Returns `{ statusCode, body }` where body is JSON. Uses env vars `GITHUB_TOKEN` (required), `GITHUB_REPO` (default `kristophershola/movie-updater`), `GITHUB_BRANCH` (default `main`). Later tasks POST to `/.netlify/functions/save` and expect `200 {"ok":true}` on success or a non-2xx `{"error":"..."}` on failure.

- [ ] **Step 1: Write the failing test**

Create `test/save.test.js`:

```js
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

test('returns 500 when GITHUB_TOKEN is missing', async () => {
  delete process.env.GITHUB_TOKEN;
  const res = await handler({ httpMethod: 'POST', body: '{}' });
  assert.strictEqual(res.statusCode, 500);
  process.env.GITHUB_TOKEN = 'test-token';
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/save.test.js`
Expected: FAIL with `Cannot find module '../netlify/functions/save.js'`

- [ ] **Step 3: Write `netlify/functions/save.js`**

```js
const GH_API = 'https://api.github.com';

exports.handler = async (event) => {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    return { statusCode: 500, body: JSON.stringify({ error: 'GITHUB_TOKEN not configured' }) };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  const repo = process.env.GITHUB_REPO || 'kristophershola/movie-updater';
  const branch = process.env.GITHUB_BRANCH || 'main';
  const path = 'movies.json';

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
  };

  // 1. Read current file to get its SHA
  let sha = null;
  const getRes = await fetch(`${GH_API}/repos/${repo}/contents/${path}?ref=${branch}`, { headers });
  if (getRes.status === 200) {
    const meta = await getRes.json();
    sha = meta.sha;
  } else if (getRes.status !== 404) {
    return { statusCode: getRes.status, body: JSON.stringify({ error: `Failed to read movies.json (${getRes.status})` }) };
  }

  // 2. Write the new file content
  const body = {
    message: 'Update movies.json',
    content: Buffer.from(JSON.stringify(payload, null, 2)).toString('base64'),
    branch,
  };
  if (sha) body.sha = sha;

  const putRes = await fetch(`${GH_API}/repos/${repo}/contents/${path}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(body),
  });

  if (!putRes.ok) {
    const errText = await putRes.text();
    return {
      statusCode: putRes.status,
      body: JSON.stringify({ error: `GitHub commit failed (${putRes.status}): ${errText.slice(0, 300)}` }),
    };
  }

  return { statusCode: 200, body: JSON.stringify({ ok: true }) };
};
```

- [ ] **Step 4: Create `netlify.toml`**

```toml
[build]
  functions = "netlify/functions"
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test test/save.test.js`
Expected: PASS, all 6 tests. If the module is cached from an earlier run, restart the shell first.

- [ ] **Step 6: Commit**

```bash
git add netlify.toml netlify/functions/save.js test/save.test.js
git commit -m "feat: add Netlify function to commit movies.json to GitHub"
```

---
### Task 2: Auto-load movies.json on page load

**Files:**
- Modify: `index.html` (replace the final `// ---- INIT ----` block at lines ~1206-1207)

**Interfaces:**
- Consumes: existing globals `movies`, `fetchedData`, `renderList()`, `showToast()`, and the element `downloadBtn`.
- Produces: `async function loadMoviesFromHost()` that fetches `movies.json` relative to the page with a cache-buster, populates `movies` and `fetchedData`, and calls `renderList()`.

- [ ] **Step 1: Write the change**

Replace the block at the end of the script:

```js
// ---- INIT ----
renderList();
```

with:

```js
// ---- AUTO-LOAD MOVIES.JSON ----
async function loadMoviesFromHost() {
  try {
    const res = await fetch(`movies.json?t=${Date.now()}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.movies && Array.isArray(data.movies)) {
      movies = data.movies.map(m => {
        const entry = { title: m.title, genres: m.genres };
        if (m.tmdb_id) entry.tmdb_id = m.tmdb_id;
        return entry;
      });
      fetchedData = data;
      document.getElementById('downloadBtn').style.display = '';
      renderList();
      showToast(`Loaded ${movies.length} movies from server`, 'green');
    }
  } catch (e) {
    showToast('Could not load movies.json - starting with default list', 'gold');
  }
}

// ---- INIT ----
renderList();
loadMoviesFromHost();
```

- [ ] **Step 2: Verify syntax**

Run: `node --check index.html 2>&1; echo "note: node --check only works on .js files, so instead use a browser or extract the script"`
Alternative verification: open `index.html` in a browser while it is served over HTTP (a plain `file://` open fails because `fetch` needs HTTP). The Netlify deploy in Task 5 verifies this end-to-end. For a quick local check, run from the repo root:

```bash
npx.cmd --yes serve . 
```

then open the printed URL. Expected: the movie list fills in from `movies.json` and a green toast appears.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat: auto-load movies.json on page load"
```

---
### Task 3: Save via the Netlify Function

**Files:**
- Modify: `index.html` (the `downloadJSON` function, ~lines 1081-1117)

**Interfaces:**
- Consumes: `fetchedData` (the JSON to save), element `downloadBtn`, `showToast()`.
- Produces: `downloadJSON()` now POSTs to `/.netlify/functions/save` and falls back to a plain download on failure. Behavior change: the app no longer uses the File System Access API `fileHandle` write path.

- [ ] **Step 1: Write the change**

Replace the entire `downloadJSON` function (from `async function downloadJSON() {` through its closing `}` before the `// ---- INIT ----` comment) with:

```js
async function downloadJSON() {
  if (!fetchedData) { showToast('Fetch from TMDB first.'); return; }

  const json = JSON.stringify(fetchedData, null, 2);
  const btn = document.getElementById('downloadBtn');
  btn.disabled = true;
  btn.textContent = 'Saving...';

  try {
    const res = await fetch('/.netlify/functions/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: json,
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || !data.ok) {
      throw new Error((data && data.error) || `HTTP ${res.status}`);
    }
    showToast('movies.json saved to GitHub', 'green');
  } catch (e) {
    // Fallback: download the file manually
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'movies.json'; a.click();
    URL.revokeObjectURL(url);
    showToast(`Save failed (${e.message}) - downloaded instead`, 'gold');
  }

  btn.disabled = false;
  btn.textContent = 'Save movies.json';
}
```

Note: the `fileHandle`/`openFile` code (the `openFile()` function and `fileHandle` variable above `downloadJSON`) can stay; it is now unused for saving but harmless. Do not delete it unless the user asks.

- [ ] **Step 2: Verify in browser against a live function**

Serve the repo with `npx.cmd --yes serve .`, load the page, confirm the list loads, then click "Save movies.json". Expected: an error toast appears (because no function is running locally) and a `movies.json` file downloads as the fallback. This confirms the fallback path works.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat: save movies.json via Netlify function with download fallback"
```

---
### Task 4: Keep fetchedData in sync on addMovie

**Files:**
- Modify: `index.html` (the `addMovie` function, ~lines 827-829)

**Interfaces:**
- Consumes: existing globals `movies`, `fetchedData`, element `downloadBtn`.
- Produces: `addMovie()` appends the new entry to `fetchedData.movies` when `fetchedData` exists, so the new movie is not silently dropped on save.

- [ ] **Step 1: Write the change**

In `addMovie`, replace:

```js
  const entry = { title, genres };
  if (tmdbId) entry.tmdb_id = tmdbId;
  movies.push(entry);
  fetchedData = null;
  document.getElementById('downloadBtn').style.display = 'none';
```

with:

```js
  const entry = { title, genres };
  if (tmdbId) entry.tmdb_id = tmdbId;
  movies.push(entry);
  if (fetchedData && Array.isArray(fetchedData.movies)) {
    fetchedData.movies.push({
      title: entry.title,
      genres: entry.genres,
      poster: null,
      overview: '',
      rating: null,
      year: '',
      release_date: '',
      tmdb_id: entry.tmdb_id || null,
    });
    fetchedData.total = fetchedData.movies.length;
    fetchedData.found = fetchedData.movies.filter(m => m.tmdb_id).length;
    fetchedData.missing = fetchedData.movies.length - fetchedData.found;
  }
  document.getElementById('downloadBtn').style.display = fetchedData ? '' : 'none';
```

- [ ] **Step 2: Verify in browser**

Serve the repo, load the page, wait for auto-load, add a movie, click Save, confirm the repo's `movies.json` now contains the added movie (Task 5 covers the deploy that makes this fully testable; locally verify the list and button state).

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "fix: keep fetchedData in sync when adding a movie"
```

---
### Task 5: Deploy and verify end-to-end

**Files:** none (configuration/manual)

**Prerequisite (manual, one-time):** Create a fine-grained GitHub token scoped to only this repo and store it in Netlify.
1. Open https://github.com/settings/personal-access-tokens/new
2. Resource owner: `kristophershola`. Repository access: Only select repositories -> `movie-updater`.
3. Permissions -> Contents: Read and write.
4. Create the token, copy it.
5. Set it as a Netlify env var: in the Netlify dashboard, open the `movie-updater` site -> Site configuration -> Environment variables -> Add a variable named `GITHUB_TOKEN` with the token value. (Or run `netlify.cmd env:set GITHUB_TOKEN <token>` from this repo after linking the site.)

- [ ] **Step 1: Push changes to trigger Netlify deploy**

```bash
git push
```

Expected: Netlify build runs (deploys static files + the new function). Watch the deploy at https://app.netlify.com/projects/movie-updater/deploys until it is Ready.

- [ ] **Step 2: Verify auto-load**

Open https://movie-updater.netlify.app/
Expected: the movie list populates from `movies.json` automatically and a green toast shows the count. No manual file open needed.

- [ ] **Step 3: Verify save-to-repo**

Make a small change (e.g. remove one movie), click "Save movies.json".
Expected: green toast "movies.json saved to GitHub". Then check the GitHub repo `movies.json` content on `main` reflects the change, and the commit message is `Update movies.json`.

- [ ] **Step 4: Verify auto-redeploy**

Wait 30-60s, then open https://movie-updater.netlify.app/ again (or use the GitHub-synced deploy log).
Expected: the same saved state is shown on the live site without any manual step.

- [ ] **Step 5: Verify no token leak**

In the browser, view the page source (View Source). Search for `GITHUB_TOKEN` and `netlify/functions`.
Expected: `GITHUB_TOKEN` appears nowhere in the page; the only reference to the function is the string `/.netlify/functions/save`.

---
## Self-Review Notes

- Spec coverage: auto-load (Task 2), save-to-repo via function (Task 3), addMovie sync (Task 4), env/token setup + deploy verification (Task 5), netlify.toml (Task 1). All spec components present.
- The old `openFile`/File System Access path is intentionally left in place (spec's non-goals); only the save path changes.
- No placeholders; all code blocks complete.
- Types/names consistent across tasks: `downloadJSON`, `loadMoviesFromHost`, `fetchedData`, `downloadBtn`, `/.netlify/functions/save`.
