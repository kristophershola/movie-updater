# Design: Movie title autocomplete with TMDB suggestions

Date: 2026-07-31

## Context

The Movie Updater (`index.html`) has an Add Movie form with a title field
(`addTitle`), a genres field (`addGenres`), and a TMDB ID field (`addTmdbId`).
The ID field already autofills title and genres from TMDB
(`handleTmdbIdInput`/`autofillFromId`). The app already calls TMDB's
`search/movie` endpoint in `sortByDate` and `fetchAll` using a shared `HEADERS`
object with a Bearer token.

Shola wants the title field to suggest movie names while typing: as the user
types a partial title, the app searches TMDB and shows a dropdown of matching
movies, each labeled with its release year to disambiguate same-name titles
(e.g. "Spider-Man (2002)" vs "Spider-Man: No Way Home (2021)"). Selecting a
suggestion fills the title, the TMDB ID, and the genres fields.

Decisions from brainstorming:
- Approach A: debounced TMDB search-as-you-type (not local-only, not hybrid).
- Selecting a suggestion fills title + TMDB ID + genres (genres only if empty).
- The year appears in the dropdown only; it is not stored on the entry.

## Architecture

Single-file change to `index.html`: one new dropdown element, its CSS, and one
new JS function group. No new dependencies, no build step. The search reuses
the exact TMDB call pattern already in the file.

## Components

### 1. HTML: wrap the title input and add a dropdown

- Wrap `addTitle` in a `position:relative` container (the same pattern as the
  TMDB ID field at ~line 576).
- Add a dropdown element `titleSuggest` below the input inside that container:
  hidden by default, absolutely positioned under the input, max height with
  overflow scroll.
- Add a `data-` attribute or matching styling hook so rows share the existing
  theme.

### 2. CSS: dropdown styling

- Use existing theme variables: `--surface2`, `--gold`, `--gold-dim`, `--muted`,
  `--border`.
- Rows: title text in the white foreground, year dimmed in `--muted` next to the
  title (e.g. "Spider-Man (2002)"). No year present -> no parens.
- Hover/highlight: `--gold-dim` background tint.
- "No matches found" row: single dimmed row.
- Dropdown: absolute position below the input, `z-index` above page content,
  max-height with vertical scroll.

### 3. JS: search flow

- `input` event listener on `addTitle`, debounced ~400ms.
- If query length < 2, hide the dropdown and return.
- Call `search/movie?query=<encoded>&include_adult=false&language=en-US&page=1`
  with the existing `HEADERS`.
- Render up to 8 results into `titleSuggest`. Each row shows the title and the
  release year (from `release_date` first 4 chars), if present.
- On any error, clear the dropdown silently (no toast while typing).
- On empty result set, show a single "No matches found" row.

### 4. JS: selection and keyboard

- Clicking a row fills `addTitle` = title, `addTmdbId` = TMDB ID, and
  `addGenres` = comma-joined genre names only if the genres field is empty.
  Then hides the dropdown and focuses the genres field.
- ArrowDown/ArrowUp move the highlight when the dropdown is open.
- Enter selects the highlighted suggestion when the dropdown is open
  (superseding the current "Enter focuses genres" behavior for that field while
  the dropdown is open). When the dropdown is closed, Enter keeps the current
  behavior (focus genres).
- Escape closes the dropdown.
- Blur closes the dropdown after a short delay so a click on a row still
  registers before the close.

## Data flow

- User types in title field -> debounce -> TMDB search -> dropdown renders
  title + year -> user clicks or arrow+Enter -> fields filled and pinned by TMDB
  ID -> user clicks "Add to List" or presses Enter (now on genres) -> movie
  added with `tmdb_id` set, so the later fetch uses the exact ID.

## Error handling

- Network/API error: dropdown hides silently, typing is not interrupted.
- No matches: single dimmed "No matches found" row so the search visibly ran.
- Short query (< 2 chars): dropdown hidden.

## Non-goals

- No local-only or hybrid matching (Approaches B/C rejected).
- Year is not stored on the movie entry; it appears only in the dropdown.
- No poster thumbnails in the dropdown.
- No changes to `fetchAll`, `sortByDate`, genre matching, or pin logic.
