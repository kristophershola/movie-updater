const test = require('node:test');
const assert = require('node:assert');

function compareNewestToOldest(a, b) {
  const da = a.release_date || '';
  const db = b.release_date || '';
  if (!da && !db) return (a.title || '').localeCompare(b.title || '');
  if (!da) return 1;
  if (!db) return -1;
  const cmp = db.localeCompare(da);
  if (cmp !== 0) return cmp;
  return (a.title || '').localeCompare(b.title || '');
}

test('sorts newest to oldest by release_date', () => {
  const list = [
    { title: 'Older', release_date: '2025-01-01' },
    { title: 'Newer', release_date: '2026-07-29' },
    { title: 'Middle', release_date: '2025-12-15' },
  ];
  list.sort(compareNewestToOldest);
  assert.deepStrictEqual(list.map(m => m.title), ['Newer', 'Middle', 'Older']);
});

test('handles same release_date by sorting alphabetically by title', () => {
  const list = [
    { title: 'Movie Z', release_date: '2026-07-24' },
    { title: 'Movie A', release_date: '2026-07-24' },
  ];
  list.sort(compareNewestToOldest);
  assert.deepStrictEqual(list.map(m => m.title), ['Movie A', 'Movie Z']);
});

test('places undated movies at the end sorted alphabetically', () => {
  const list = [
    { title: 'No Date B', release_date: '' },
    { title: 'Dated', release_date: '2025-05-01' },
    { title: 'No Date A' },
  ];
  list.sort(compareNewestToOldest);
  assert.deepStrictEqual(list.map(m => m.title), ['Dated', 'No Date A', 'No Date B']);
});
