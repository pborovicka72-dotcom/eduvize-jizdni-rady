const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const start = html.indexOf('function repaginate(){');
const end = html.indexOf('async function load()', start);
assert(start >= 0 && end > start, 'departure pagination was not found');
const source = html.slice(start, end);

function paginate(automaticLimit) {
  const departures = Array.from({ length: 10 }, (_, index) => ({ index }));
  const viewport = { clientHeight: 90 };
  const rows = { children: [], replaceChildren() { this.children = []; }, append(row) { this.children.push(row); } };
  const run = new Function(
    'automaticLimit', 'allDepartures', 'document', '$', 'getComputedStyle', 'buildRow',
    `let pages = [[]], pageIndex = 0, showAll = false;
     function render() {}
     ${source}
     repaginate();
     return pages.map(page => page.map(row => row.index));`
  );
  return run(
    automaticLimit,
    departures,
    { documentElement: { dataset: {} } },
    id => id === 'viewport' ? viewport : rows,
    () => ({ marginBottom: '0' }),
    data => ({ data, getBoundingClientRect() { return { height: 30 }; } })
  );
}

test('automatic departure count fits one segment and disables further pages', () => {
  assert.deepEqual(paginate(true), [[0, 1, 2]]);
  assert.deepEqual(paginate(false), [[0, 1, 2], [3, 4, 5], [6, 7, 8], [9]]);
});
