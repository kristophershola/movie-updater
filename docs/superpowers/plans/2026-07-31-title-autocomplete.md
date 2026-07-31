# Movie Title Autocomplete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a debounced TMDB search-as-you-type dropdown to the movie title field that suggests matching movie titles with release years, and fills title + TMDB ID + genres on selection.

**Architecture:** Single-file change to `index.html`: wrap the title input in a positioned container, add a hidden dropdown element, style it with existing theme variables, and add JS that debounces input, calls TMDB `search/movie` (reusing the existing `HEADERS`), renders up to 8 results as title + year rows, and handles mouse + keyboard selection. No new dependencies.

**Tech Stack:** Vanilla JS in a single HTML file. No unit-test framework exists for the browser code; verification is per-task script syntax checks plus a final deploy-and-browser-verify task. Node v24 is available for `node --check`.

## Global Constraints

- All changes are inside the single file `index.html`. Do not create or modify other files except where a task explicitly says so.
- Use existing theme variables only: `--surface2`, `--gold`, `--gold-dim`, `--muted`, `--border`, `--white`, `--radius`.
- No new dependencies, no build step, no new fonts or assets.
- No em dashes in any new text or code comments. Use plain punctuation.
- Follow the file's existing style: 2-space indent, comment banners like `// ---- SECTION ----`, `HTMLElement` ids referenced via `getElementById`.
- Reuse the existing TMDB call pattern: `https://api.themoviedb.org/3/search/movie?query=<encoded>&include_adult=false&language=en-US&page=1` with `{ headers: HEADERS }`. `HEADERS` already exists at ~line 639.
- Do not change `fetchAll`, `sortByDate`, `bestMatch`, genre matching, pin logic, `addMovie`, or the save function.
- The dropdown year appears only in the dropdown; it is not stored on the movie entry.
- The existing "Add to List" flow is unchanged; selecting a suggestion only fills the form fields.
- `selectTitleSuggestion` may only fill `addGenres` if that field is currently empty.

---
### Task 1: Add the dropdown element and its CSS

**Files:**
- Modify: `index.html` (HTML around lines 573-580, CSS after line 187)

**Interfaces:**
- Produces: an element `titleSuggest` (class `title-suggest`) placed directly inside a `position:relative` container that wraps `addTitle`; the element has the `hidden` attribute. Rows rendered by later tasks use classes `title-suggest-row`, `title-suggest-year`, `title-suggest-none`, and `highlight`. Later tasks attach JS to `addTitle` and read/write `titleSuggest` via `getElementById`.

- [ ] **Step 1: Replace the title input markup**

Find this block in the Add Movie form (currently ~lines 573-579):

```html
      <div class="form-row">
        <input class="form-input" id="addTitle" type="text" placeholder="Movie title (as it appears on TMDB)">
        <input class="form-input" id="addGenres" type="text" placeholder="Genres (e.g. Action, Thriller)">
```

Replace it with:

```html
      <div class="form-row">
        <div style="position:relative">
          <input class="form-input" id="addTitle" type="text" placeholder="Movie title (as it appears on TMDB)" autocomplete="off">
          <div class="title-suggest" id="titleSuggest" hidden></div>
        </div>
        <input class="form-input" id="addGenres" type="text" placeholder="Genres (e.g. Action, Thriller)">
```

Leave the TMDB ID input, `autofillStatus`, `form-hint`, and the rest of the form untouched.

- [ ] **Step 2: Add the dropdown CSS**

After the `.form-hint` rule (ends ~line 187), add:

```css
/* TITLE SUGGEST */
.title-suggest {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  z-index: 50;
  background: var(--surface2);
  border: 1px solid var(--border2);
  border-radius: var(--radius);
  max-height: 240px;
  overflow-y: auto;
  box-shadow: 0 8px 24px rgba(0,0,0,0.4);
}

.title-suggest-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 12px;
  padding: 8px 12px;
  cursor: pointer;
  font-size: 12px;
  font-weight: 300;
  color: var(--white);
}

.title-suggest-row:hover,
.title-suggest-row.highlight {
  background: var(--gold-dim);
}

.title-suggest-year {
  font-family: 'DM Mono', monospace;
  font-size: 10px;
  color: var(--muted);
  white-space: nowrap;
}

.title-suggest-none {
  padding: 8px 12px;
  font-size: 11px;
  font-style: italic;
  color: var(--muted);
}
```

- [ ] **Step 3: Verify the markup and CSS**

Run:
```powershell
Select-String -Path "index.html" -Pattern "id=`"titleSuggest`"", ".title-suggest {"
```
Expected: both lines appear. Then open `index.html` in a browser (or `npx.cmd --yes serve .` from the repo root and open the printed URL): the title input should have no visible dropdown and no visual regression to the form. The `hidden` attribute keeps `titleSuggest` out of view.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: add title suggestion dropdown markup and styling"
```

---
### Task 2: Search flow, rendering, and mouse selection

**Files:**
- Modify: `index.html` (add a new `// ---- TITLE AUTOCOMPLETE ----` section before the `// ---- KEYBOARD SHORTCUTS ----` comment at ~line 1207)

**Interfaces:**
- Consumes: existing globals `HEADERS` (~line 639), `TMDB_GENRES` (~line 642), elements `addTitle`, `addGenres`, `addTmdbId`, `titleSuggest`.
- Produces (used by Task 3): `titleItems` (array of TMDB result objects, empty when dropdown hidden), `titleIndex` (number, -1 when nothing highlighted), `hideTitleSuggest()` (hides dropdown, clears rows/state), `highlightTitle(i)` (sets highlight + `titleIndex`), and `selectTitleSuggestion(i)` (fills `addTitle` with `r.title`, `addTmdbId` with `String(r.id)`, `addGenres` with comma-joined genre names from `r.genre_ids` via `TMDB_GENRES` only if the genres field is empty, then hides the dropdown and focuses `addGenres`). Rendered rows call `selectTitleSuggestion(${i})` and `highlightTitle(${i})` from inline `onclick`/`onmouseenter` attributes.

- [ ] **Step 1: Write the JS block**

Insert this block immediately before the `// ---- KEYBOARD SHORTCUTS ----` comment:

```js
// ---- TITLE AUTOCOMPLETE ----
let titleDebounce = null;
let titleIndex = -1;
let titleItems = [];

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function hideTitleSuggest() {
  const suggest = document.getElementById('titleSuggest');
  suggest.hidden = true;
  suggest.innerHTML = '';
  titleIndex = -1;
  titleItems = [];
}

function highlightTitle(i) {
  titleIndex = i;
  const rows = document.querySelectorAll('#titleSuggest .title-suggest-row');
  rows.forEach((row, idx) => row.classList.toggle('highlight', idx === i));
}

function handleTitleInput() {
  clearTimeout(titleDebounce);
  const q = document.getElementById('addTitle').value.trim();
  if (q.length < 2) {
    hideTitleSuggest();
    return;
  }
  titleDebounce = setTimeout(() => searchTitleSuggestions(q), 400);
}

async function searchTitleSuggestions(q) {
  const suggest = document.getElementById('titleSuggest');
  try {
    const res = await fetch(
      `https://api.themoviedb.org/3/search/movie?query=${encodeURIComponent(q)}&include_adult=false&language=en-US&page=1`,
      { headers: HEADERS }
    );
    const data = await res.json();
    const results = (data.results || []).slice(0, 8);
    if (!results.length) {
      suggest.innerHTML = '<div class="title-suggest-none">No matches found</div>';
      suggest.hidden = false;
      titleIndex = -1;
      titleItems = [];
      return;
    }
    titleItems = results;
    titleIndex = -1;
    suggest.innerHTML = results.map((r, i) => {
      const year = r.release_date ? r.release_date.slice(0, 4) : '';
      return `<div class="title-suggest-row" onclick="selectTitleSuggestion(${i})" onmouseenter="highlightTitle(${i})">` +
        `<span>${escapeHtml(r.title)}</span>` +
        (year ? `<span class="title-suggest-year">(${escapeHtml(year)})</span>` : '') +
        `</div>`;
    }).join('');
    suggest.hidden = false;
  } catch {
    hideTitleSuggest();
  }
}

function selectTitleSuggestion(i) {
  const r = titleItems[i];
  if (!r) return;
  const titleEl = document.getElementById('addTitle');
  const genresEl = document.getElementById('addGenres');
  const tmdbIdEl = document.getElementById('addTmdbId');
  titleEl.value = r.title || '';
  tmdbIdEl.value = String(r.id || '');
  if (!genresEl.value.trim()) {
    genresEl.value = (r.genre_ids || [])
      .map(id => TMDB_GENRES[id])
      .filter(Boolean)
      .join(', ');
  }
  hideTitleSuggest();
  genresEl.focus();
}

document.getElementById('addTitle').addEventListener('input', handleTitleInput);
```

- [ ] **Step 2: Syntax-check the full script**

Run:
```powershell
$html = Get-Content -Raw "index.html"
$m = [regex]::Match($html, '(?s)<script>(.*?)</script>')
Set-Content -Path "$env:TEMP\title-autocomplete-check.js" -Value $m.Groups[1].Value -Encoding UTF8
node --check "$env:TEMP\title-autocomplete-check.js"
```
Expected: no output and exit code 0 (syntax OK). There is exactly one `<script>` block in the file.

- [ ] **Step 3: Browser-verify the mouse flow**

Serve the repo with `npx.cmd --yes serve .` from the repo root and open the printed URL. Type "spider" in the title field. Expected: after ~400ms, a dropdown appears with TMDB matches, each showing the title and, where a release date exists, the year in parens (e.g. "Spider-Man (2002)"). Click one row. Expected: the title field fills with the full movie title, the TMDB ID field fills with its numeric ID, and the genres field fills (if it was empty) with comma-joined genre names. The dropdown disappears and the genres field gains focus. Typing fewer than 2 characters hides the dropdown; a search with no matches shows a single dimmed "No matches found" row.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: add debounced TMDB title search with mouse selection"
```

---
### Task 3: Keyboard navigation and blur handling

**Files:**
- Modify: `index.html` (replace the `addTitle` keydown listener in the `// ---- KEYBOARD SHORTCUTS ----` section at ~lines 1208-1210; add a blur listener and the `selectTitleSuggestion`... note: `selectTitleSuggestion` is already defined in Task 2. Do not redefine it.)

**Interfaces:**
- Consumes: from Task 2 - `titleItems`, `titleIndex`, `hideTitleSuggest()`, `highlightTitle(i)`, `selectTitleSuggestion(i)`, and element `titleSuggest`.
- Produces: keyboard handling for ArrowDown, ArrowUp, Enter, Escape on `addTitle`, plus a blur handler that closes the dropdown after 150ms. When the dropdown is closed, Enter keeps the pre-existing behavior (focus the genres field).

- [ ] **Step 1: Replace the addTitle keydown listener**

Find:

```js
document.getElementById('addTitle').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('addGenres').focus();
});
```

Replace it with:

```js
document.getElementById('addTitle').addEventListener('keydown', e => {
  const open = titleItems.length > 0 && !document.getElementById('titleSuggest').hidden;
  if (open) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      highlightTitle(titleIndex < 0 ? 0 : (titleIndex + 1) % titleItems.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      highlightTitle(titleIndex <= 0 ? titleItems.length - 1 : titleIndex - 1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (titleIndex >= 0) selectTitleSuggestion(titleIndex);
    } else if (e.key === 'Escape') {
      hideTitleSuggest();
    }
    return;
  }
  if (e.key === 'Enter') document.getElementById('addGenres').focus();
});

document.getElementById('addTitle').addEventListener('blur', () => {
  setTimeout(() => hideTitleSuggest(), 150);
});
```

- [ ] **Step 2: Syntax-check the full script**

Run the same extraction + `node --check` command from Task 2 Step 2. Expected: no output and exit code 0.

- [ ] **Step 3: Browser-verify keyboard and blur**

Serve the repo, type "spider" in the title field, wait for the dropdown. Verify:
- ArrowDown moves the highlight down, ArrowUp moves it up (wraps at both ends).
- Enter selects the highlighted row and fills title + TMDB ID + genres.
- Escape closes the dropdown without filling anything.
- With the dropdown closed, Enter in the title field still moves focus to the genres field.
- Clicking outside the title field closes the dropdown, but clicking a row still selects it (the 150ms blur delay lets the click register).

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: add keyboard navigation and blur close for title suggestions"
```

---
### Task 4: Deploy and verify end-to-end

**Files:** none (configuration/manual). Deployment is automatic: pushing to `main` triggers the existing Netlify GitHub sync.

- [ ] **Step 1: Push**

```bash
git push
```
Expected: Netlify build runs. Watch https://app.netlify.com/projects/movie-updater/deploys until Ready.

- [ ] **Step 2: Verify on the live site**

Open https://movie-updater.netlify.app/
1. Type a partial title (e.g. "conjuring") in the title field. Expected: dropdown with TMDB matches showing release years, e.g. "The Conjuring (2013)" and "The Conjuring: Last Rites (2026)".
2. Click "The Conjuring: Last Rites (2026)". Expected: title, TMDB ID, and genres fields all fill; genres field gains focus.
3. Click "Add to List". Expected: the movie appears in the list with a pinned TMDB ID.
4. Type gibberish, e.g. "zzzzzzzz". Expected: "No matches found" row after the debounce.
5. Confirm the movie list still auto-loads and the Save button still commits (no regressions to prior features).

- [ ] **Step 3: Confirm no unintended repo changes**

Run `git status` and `git log --oneline -5`. Expected: working tree clean; the only new commits are this feature's three (Task 1, Task 2, Task 3) plus nothing else. `movies.json` must be unchanged (the dropdown does not write to it).

---
## Self-Review Notes

- Spec coverage: dropdown element + CSS (Task 1), debounced search + render title/year + mouse selection (Task 2), keyboard + blur (Task 3), deploy + end-to-end verify (Task 4). All spec components present.
- No placeholders; all code blocks complete and runnable.
- Naming is consistent across tasks: `titleSuggest`, `titleItems`, `titleIndex`, `hideTitleSuggest`, `highlightTitle`, `selectTitleSuggestion`, `handleTitleInput`, `searchTitleSuggestions`. Task 3 consumes exactly what Task 2 produces.
- Browser code has no unit-test harness (dependency-free single file per Global Constraints); per-task verification is the script syntax check plus the browser checks, with the final live deploy as the end-to-end gate.
