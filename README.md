# Movie Updater

Single-file web app for updating the Lavish Cinemas movie list. Pulls now-playing and upcoming titles from TMDB, lets staff pin/manage movies, and exports the curated list to `movies.json`.

## Files

- `index.html` - the whole app (HTML, CSS, JS) in one file. Open it directly in a browser.
- `movies.json` - generated output data consumed by the site.

## Usage

1. Open `index.html` in a browser.
2. Movies are automatically loaded, fetched from TMDB in real time, and kept sorted from newest to oldest.
3. Add movies by title or TMDB ID — TMDB data is fetched immediately and sorted into the list in real time.
4. Save to `movies.json` when ready.
