const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const html = fs.readFileSync(path.join(__dirname, '..', 'config.html'), 'utf8');
const start = html.indexOf("function showNearby(lat,lon,label,origin='school'){");
const end = html.indexOf('async function chooseSchool(item)', start);
assert(start >= 0 && end > start, 'nearby-stop renderer was not found');
const renderer = html.slice(start, end);

function nearbyStops(radius) {
  const names = [];
  const coordinates = {};
  for (let index = 0; index < 25; index++) {
    const name = `Brno, Zastávka ${index}`;
    names.push(name);
    coordinates[name] = [[49.2 + (0.2 + index * 0.02) / 111, 16.6]];
  }
  for (const [name, km] of [
    ['Brno, Hlavní nádraží', 1.2],
    ['Brno, ÚAN Zvonařka', 1.4],
  ]) {
    names.push(name);
    coordinates[name] = [[49.2 + km / 111, 16.6]];
  }
  const nearby = {
    children: [],
    replaceChildren() { this.children = []; },
    append(child) { this.children.push(child); },
  };
  const document = {
    createElement() {
      return {
        dataset: {},
        setAttribute() {},
        classList: { toggle() {} },
      };
    },
  };
  const distanceKm = (a, b, c, d) => Math.hypot((c - a) * 111, (d - b) * 70);
  const render = new Function(
    'available', 'stopCoordinates', 'radiusKm', 'distanceKm',
    'document', 'selected', 'nearby', 'toggleStop',
    `let nearbyOrigin = null; ${renderer}; showNearby(49.2, 16.6, 'Škola');`
  );
  render(names, coordinates, () => radius, distanceKm, document, [], nearby, () => {});
  return nearby.children.map(child => child.dataset?.stop).filter(Boolean);
}

test('larger radius reveals all stops, including Brno railway and bus terminals', () => {
  const close = nearbyStops(1);
  const wider = nearbyStops(4);
  assert.equal(close.length, 25);
  assert.equal(wider.length, 27);
  assert(!close.includes('Brno, Hlavní nádraží'));
  assert(!close.includes('Brno, ÚAN Zvonařka'));
  assert(wider.includes('Brno, Hlavní nádraží'));
  assert(wider.includes('Brno, ÚAN Zvonařka'));
});
