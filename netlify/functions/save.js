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

  if (!payload || !Array.isArray(payload.movies)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid payload: expected a document with a movies array' }) };
  }

  try {
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
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
