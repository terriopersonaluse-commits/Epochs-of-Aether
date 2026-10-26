import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateState } from '../src/persistence/save.ts';
import { generateWorld, graphComponents } from '../src/world/generate.ts';

for (const seed of [1, 42, 777, 2026, 99999]) {
  test(`world ${seed}: generated state passes validation`, () => {
    assert.deepEqual(validateState(generateWorld(seed)), []);
  });

  test(`world ${seed}: every land tile belongs to a province and provinces form one connected graph`, () => {
    const s = generateWorld(seed);
    s.map.terrain.forEach((t, i) => assert.equal(t === 0, s.map.province[i] === -1, `tile ${i}`));
    assert.equal(graphComponents(s.provinces).length, 1);
  });

  test(`world ${seed}: countries own their capitals and start with armies`, () => {
    const s = generateWorld(seed);
    assert.equal(s.countries.length, 10);
    for (const c of s.countries) {
      assert.equal(s.provinces[c.capital].owner, c.id);
      assert.ok(s.armies.some((a) => a.owner === c.id));
    }
    assert.ok(s.provinces.some((p) => p.owner === null), 'some wild provinces remain');
  });
}

test('world generation is deterministic for a seed', () => {
  assert.equal(JSON.stringify(generateWorld(31337)), JSON.stringify(generateWorld(31337)));
  assert.notEqual(JSON.stringify(generateWorld(31337).map), JSON.stringify(generateWorld(31338).map));
});

test('country count setting is respected', () => {
  assert.equal(generateWorld(5, { countryCount: 6, graceTurns: 4 }).countries.length, 6);
  assert.equal(generateWorld(5, { countryCount: 14, graceTurns: 4 }).countries.length, 14);
});
