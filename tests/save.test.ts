import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deterministicPolicy } from '../src/ai/deterministic.ts';
import { parseSave, serializeSave } from '../src/persistence/save.ts';
import { processTurn } from '../src/sim/turn.ts';
import { world } from './helpers.ts';

test('save round-trips to an identical state', () => {
  const s = world(9);
  for (let i = 0; i < 15; i++) processTurn(s, deterministicPolicy);
  const r = parseSave(serializeSave(s, 'test'));
  assert.ok(r.ok);
  if (r.ok) {
    assert.deepEqual(r.state, s);
    assert.equal(r.label, 'test');
  }
});

test('loading a save and continuing reproduces the uninterrupted campaign exactly', () => {
  const continuous = world(10);
  for (let i = 0; i < 30; i++) processTurn(continuous, deterministicPolicy);

  const first = world(10);
  for (let i = 0; i < 12; i++) processTurn(first, deterministicPolicy);
  const loaded = parseSave(serializeSave(first));
  assert.ok(loaded.ok);
  if (!loaded.ok) return;
  for (let i = 0; i < 18; i++) processTurn(loaded.state, deterministicPolicy);

  assert.equal(JSON.stringify(loaded.state), JSON.stringify(continuous));
});

test('corrupted or foreign saves are rejected with reasons', () => {
  const good = serializeSave(world(11));
  assert.equal(parseSave(good.slice(0, good.length / 2)).ok, false);
  assert.equal(parseSave('{"hello":1}').ok, false);

  const tampered = JSON.parse(good);
  tampered.state.provinces[3].owner = 999;
  const r = parseSave(JSON.stringify(tampered));
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.errors.join(' '), /invalid owner/);

  const future = JSON.parse(good);
  future.version = 999;
  assert.equal(parseSave(JSON.stringify(future)).ok, false);

  const badArmy = JSON.parse(good);
  badArmy.state.armies[0].units.infantry = -4;
  assert.equal(parseSave(JSON.stringify(badArmy)).ok, false);
});
