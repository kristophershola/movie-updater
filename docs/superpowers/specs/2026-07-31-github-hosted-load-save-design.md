# Design: GitHub-hosted auto-load and save for Movie Updater

Date: 2026-07-31

## Context

The Movie Updater is a single-file web app (`index.html`) that maintains the
Lavish Cinemas movie list and exports it as `movies.json`. It is deployed on
Netlify from the GitHub repo `kristophershola/movie-updater` (private). Netlify
auto-deploys from the repo on every push.

Today the app does not integrate with the hosted file:

- On load, the list starts empty. The user must manually pick a local
  `movies.json` via the File System Access API.
- On save, the app writes back to the local file (or downloads it). The user
  must then manually upload the file back to GitHub for the site to update.

Goal: on load, the app reads the current `movies.json` automatically; on save,
the app commits the new `movies.json` straight to the GitHub repo, and Netlify's
GitHub sync redeploys the site.

Constraints from Shola:
- Keep hosting on Netlify (GitHub sync already works there).
- Writing back to GitHub goes through a Netlify Function that holds the GitHub
  token server-side; the token must never be embedded in the page.
- Keep the existing explicit "Save movies.json" button. No auto-save on every
  change.

## Architecture

Three pieces:

```
Browser (index.html)
   |
   |-- [on load]  fetch('movies.json?t=<timestamp>')  reads deployed file
   |
   |-- [on Save]  POST /.netlify/functions/save   Netlify Function
                          |  holds GITHUB_TOKEN in env (never in page)
                          |  GitHub Contents API: commit movies.json to repo
                          |  Netlify GitHub sync auto-redeploys site
```

## Components

### 1. Netlify Function: `netlify/functions/save.js` (new)

- Receives the full JSON document in the request body.
- Reads `GITHUB_TOKEN` and the repo owner/name from environment variables.
- Gets the current `movies.json` SHA from the GitHub Contents API
  (`GET /repos/{owner}/{repo}/contents/movies.json`).
- PUTs the new content to the same endpoint with `base64` encoded body and the
  current SHA, with commit message `Update movies.json`.
- Returns a JSON success/error payload to the page. On any failure returns a
  non-2xx status with a readable message.

Environment variables used (set in Netlify, not committed):
- `GITHUB_TOKEN`: fine-grained PAT scoped to only this repo, Contents
  read/write.
- `GITHUB_REPO`: `kristophershola/movie-updater` (optional override; defaults
  to this value).
- `GITHUB_BRANCH`: `main` (optional override).

### 2. `index.html` (edit)

- On init, fetch `movies.json` relative to the page with a cache-buster query
  (`?t=Date.now()`), parse it, and load it into the app exactly like the
  existing "Open movies.json" flow does (populate `movies` working list and set
  `fetchedData`).
- If the fetch fails, show a warning toast and continue with an empty list; the
  app remains usable.
- The Save button now POSTs the current `fetchedData` JSON to
  `/.netlify/functions/save` instead of using the local file handle or the
  download fallback.
- If the function call fails, show an error toast with the reason; existing
  data is untouched and the user can retry by clicking Save again.
- Keep a manual "download movies.json" option as a fallback for offline use.
- Fix `addMovie`: when `fetchedData` is present, also append the new movie to
  `fetchedData.movies` so an added movie is not silently dropped on save (the
  existing `removeMovie` already does the equivalent).

### 3. `netlify.toml` (new)

- Points Netlify at the functions directory:
  - `[build]` with `functions = "netlify/functions"`.
- No build command; the repo is static.

## Data flow on save

- Existing behavior preserved: save writes `fetchedData`, the full enriched
  structure (`generated`, `total`, `found`, `missing`, `movies`).
- Auto-load populates `fetchedData` from the current file, so Save works right
  after loading without a TMDB fetch.
- Each save = one commit on `main` = one Netlify redeploy (~30-60s). The new
  data appears on the site shortly after.

## Error handling

- Load failure: warning toast, empty list, app still usable.
- Save failure: error toast with reason (bad token, SHA conflict, network).
  Existing data untouched; retry by clicking Save again.
- Function handles GitHub API errors and returns a readable message.

## Non-goals

- No auto-save on change.
- No move to GitHub Pages.
- No change to the TMDB fetch, sort, or genre-matching logic.
