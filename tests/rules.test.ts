import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deterministicPolicy } from '../src/ai/deterministic.ts';
import type { StrategicPolicy } from '../src/ai/policy.ts';
import { fight } from '../src/sim/combat.ts';
import { assessPeace, proposePeace } from '../src/sim/diplomacy.ts';
import { canRecruit, declareWar, makePeace, recruit, setArmyDestination } from '../src/sim/orders.ts';
import { atWar, budget, canEnter } from '../src/sim/queries.ts';
import { processTurn } from '../src/sim/turn.ts';
import { clearArmies, neighbours, placeArmy, world } from './helpers.ts';

const idle: StrategicPolicy = { name: 'idle', planTurn() {} };

test('recruiting is refused without gold and paid for when allowed', () => {
  const s = world();
  const c = s.countries[0];
  c.treasury.gold = 5;
  assert.equal(canRecruit(s, 0, c.capital, 'infantry').ok, false);
  c.treasury.gold = 100;
  const before = c.manpower;
  assert.ok(recruit(s, 0, c.capital, 'infantry', 2).ok);
  assert.equal(c.treasury.gold, 70);
  assert.equal(c.manpower, before - 2000);
  assert.equal(s.recruitment.length, 1);
});

test('cannot recruit in another nation\'s province, or iron units without iron', () => {
  const s = world();
  const { a, pb } = neighbours(s);
  s.countries[a].treasury = { gold: 999, food: 50, iron: 0 };
  assert.equal(recruit(s, a, pb, 'infantry').ok, false);
  assert.equal(recruit(s, a, s.countries[a].capital, 'cavalry').ok, false);
});

test('recruited regiments appear after the turn ends', () => {
  const s = world();
  const c = s.countries[0];
  c.treasury.gold = 500;
  const before = s.armies.filter((x) => x.owner === 0).reduce((n, x) => n + x.units.infantry, 0);
  recruit(s, 0, c.capital, 'infantry', 3);
  processTurn(s, idle);
  const after = s.armies.filter((x) => x.owner === 0).reduce((n, x) => n + x.units.infantry, 0);
  assert.equal(after, before + 3);
});

test('armies cannot enter a neutral nation, but can once at war', () => {
  const s = world();
  const { a, b, pa, pb } = neighbours(s);
  clearArmies(s);
  const army = placeArmy(s, a, pa, 5);
  assert.equal(setArmyDestination(s, a, army.id, pb).ok, false);
  assert.ok(declareWar(s, a, b).ok);
  assert.ok(setArmyDestination(s, a, army.id, pb).ok);
  assert.deepEqual(army.path, [pb]);
});

test('truce blocks a new war until it expires', () => {
  const s = world();
  const { a, b } = neighbours(s);
  declareWar(s, a, b);
  makePeace(s, a, b);
  assert.equal(atWar(s, a, b), false);
  assert.equal(declareWar(s, a, b).ok, false);
  s.turn += 13;
  assert.ok(declareWar(s, a, b).ok);
});

test('a much larger army wins and the loser retreats or is destroyed', () => {
  const s = world();
  const { a, b, pb } = neighbours(s);
  clearArmies(s);
  declareWar(s, a, b);
  const big = placeArmy(s, a, pb, 20);
  const small = placeArmy(s, b, pb, 3);
  const r = fight(s, pb, [big], [small]);
  assert.equal(r.winner, a);
  assert.ok(r.loserLosses >= 1);
  const survivor = s.armies.find((x) => x.id === small.id);
  if (survivor) assert.notEqual(survivor.province, pb);
});

test('an undefended enemy province is besieged and captured', () => {
  const s = world();
  const { a, b, pb } = neighbours(s);
  clearArmies(s);
  declareWar(s, a, b);
  placeArmy(s, a, pb, 6);
  const required = 1 + s.provinces[pb].fort * 2;
  for (let i = 0; i < required + 2 && s.provinces[pb].owner !== a; i++) processTurn(s, idle);
  assert.equal(s.provinces[pb].owner, a);
  assert.ok(s.log.some((e) => e.type === 'capture' && e.province === pb));
});

test('wild provinces are settled by an army standing there', () => {
  const s = world();
  const wild = s.provinces.find((p) => p.owner === null && p.neighbors.some((n) => s.provinces[n].owner !== null))!;
  const owner = s.provinces[wild.neighbors.find((n) => s.provinces[n].owner !== null)!].owner!;
  clearArmies(s);
  placeArmy(s, owner, wild.id, 2);
  processTurn(s, idle);
  processTurn(s, idle);
  assert.equal(s.provinces[wild.id].owner, owner);
});

test('army upkeep is charged and an unpaid army loses morale', () => {
  const s = world();
  clearArmies(s);
  const army = placeArmy(s, 0, s.countries[0].capital, 400);
  const b = budget(s, 0);
  assert.ok(b.expenses.gold > b.income.gold);
  s.countries[0].treasury.gold = 0;
  processTurn(s, idle);
  assert.equal(s.countries[0].treasury.gold, 0);
  assert.ok(army.morale < 1 || !s.armies.includes(army));
});

test('peace is refused at the start of a war and accepted by an exhausted loser', () => {
  const s = world();
  const { a, b } = neighbours(s);
  declareWar(s, a, b);
  assert.equal(proposePeace(s, a, b).ok, false);
  s.turn += 10;
  s.countries[b].warExhaustion = 90;
  const war = s.wars[0];
  if (war.a === a) war.scoreA = 40; else war.scoreB = 40;
  assert.ok(assessPeace(s, b, a).accept);
  assert.ok(proposePeace(s, a, b).ok);
  assert.equal(atWar(s, a, b), false);
});

test('AI never overspends or stands in a neutral nation over a long campaign', () => {
  const s = world(4242);
  for (let t = 0; t < 120 && s.winner === null; t++) {
    processTurn(s, deterministicPolicy);
    for (const c of s.countries) {
      assert.ok(c.treasury.gold >= 0 && c.treasury.iron >= 0 && c.treasury.food >= 0 && c.manpower >= 0, `${c.name} turn ${s.turn}`);
    }
    for (const army of s.armies) assert.ok(canEnter(s, army.owner, army.province), `army ${army.id} trespassing on turn ${s.turn}`);
  }
  assert.ok(s.log.some((e) => e.type === 'war'), 'AI nations go to war on their own');
});

test('player nation is never moved by the AI policy', () => {
  const s = world(7);
  s.countries[0].isPlayer = true;
  const mine = JSON.stringify(s.armies.filter((a) => a.owner === 0).map((a) => [a.id, a.path]));
  processTurn(s, deterministicPolicy);
  const again = JSON.stringify(s.armies.filter((a) => a.owner === 0 && a.path.length).map((a) => [a.id, a.path]));
  assert.equal(again, '[]');
  assert.ok(mine.length > 2);
  assert.equal(s.recruitment.filter((r) => r.country === 0).length, 0);
});

test('a realm that loses its last province but takes another the same turn gets a new capital', async () => {
  const { captureProvince } = await import('../src/sim/turn.ts');
  const s = world(16838);
  const { a, b, pb } = neighbours(s);
  clearArmies(s);
  declareWar(s, a, b);
  for (const p of s.provinces) if (p.owner === a && p.id !== s.countries[a].capital) p.owner = b;
  captureProvince(s, s.countries[a].capital, b);
  s.provinces[pb].owner = a; // a re-takes land in the same turn
  processTurn(s, idle);
  assert.equal(s.countries[a].alive, true);
  assert.equal(s.provinces[s.countries[a].capital].owner, a);
});
