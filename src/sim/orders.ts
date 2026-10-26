// The only entry points through which the player and the AI change the world between turns.
// Every function validates against the real game state and refuses impossible actions.
import type { GameState, HistoryEvent, UnitCounts, UnitId } from '../core/types.ts';
import { UNIT_ORDER, emptyUnits, totalRegiments } from '../data/units.ts';
import {
  atWar, canEnter, findPath, findWar, isBesiegedByEnemy, truceUntil, unitCost,
} from './queries.ts';

export type OrderResult = { ok: true } | { ok: false; reason: string };

const OK: OrderResult = { ok: true };
const fail = (reason: string): OrderResult => ({ ok: false, reason });

export const TRUCE_TURNS = 12;
export const MIN_WAR_TURNS_FOR_PEACE = 3;

export function log(state: GameState, e: Omit<HistoryEvent, 'turn'>): void {
  state.log.push({ turn: state.turn, ...e });
  if (state.log.length > 600) state.log.splice(0, state.log.length - 600);
}

export function canRecruit(state: GameState, country: number, provinceId: number, unit: UnitId, count = 1): OrderResult {
  const c = state.countries[country];
  const p = state.provinces[provinceId];
  if (!c?.alive) return fail('This nation no longer exists.');
  if (!p) return fail('Unknown province.');
  if (p.owner !== country) return fail('You can only recruit in your own provinces.');
  if (isBesiegedByEnemy(state, provinceId)) return fail('The province is under siege.');
  if (!Number.isInteger(count) || count < 1) return fail('Invalid regiment count.');
  const cost = unitCost(c.civ, unit);
  if (c.treasury.gold < cost.gold * count) return fail(`Needs ${cost.gold * count} gold.`);
  if (c.treasury.iron < cost.iron * count) return fail(`Needs ${cost.iron * count} iron.`);
  if (c.manpower < cost.manpower * count) return fail(`Needs ${cost.manpower * count} manpower.`);
  return OK;
}

export function recruit(state: GameState, country: number, provinceId: number, unit: UnitId, count = 1): OrderResult {
  const check = canRecruit(state, country, provinceId, unit, count);
  if (!check.ok) return check;
  const c = state.countries[country];
  const cost = unitCost(c.civ, unit);
  c.treasury.gold -= cost.gold * count;
  c.treasury.iron -= cost.iron * count;
  c.manpower -= cost.manpower * count;
  state.recruitment.push({ country, province: provinceId, unit, count, completesOnTurn: state.turn });
  return OK;
}

export function cancelRecruit(state: GameState, country: number, index: number): OrderResult {
  const order = state.recruitment[index];
  if (!order || order.country !== country) return fail('No such recruitment order.');
  const c = state.countries[country];
  const cost = unitCost(c.civ, order.unit);
  c.treasury.gold += cost.gold * order.count;
  c.treasury.iron += cost.iron * order.count;
  c.manpower += cost.manpower * order.count;
  state.recruitment.splice(index, 1);
  return OK;
}

export function setArmyDestination(state: GameState, country: number, armyId: number, dest: number): OrderResult {
  const army = state.armies.find((a) => a.id === armyId);
  if (!army || army.owner !== country) return fail('Not your army.');
  if (!state.provinces[dest]) return fail('Unknown province.');
  if (dest === army.province) { army.path = []; return OK; }
  const owner = state.provinces[dest].owner;
  if (!canEnter(state, country, dest)) {
    return fail(`${state.countries[owner!].name} has not granted passage. Declare war to enter its lands.`);
  }
  const path = findPath(state, country, army.province, dest);
  if (!path) return fail('No route: the way is blocked by neutral lands or the sea.');
  army.path = path;
  return OK;
}

export function mergeArmies(state: GameState, country: number, provinceId: number): OrderResult {
  const here = state.armies.filter((a) => a.owner === country && a.province === provinceId);
  if (here.length < 2) return fail('Nothing to merge.');
  const [keep, ...rest] = here.sort((a, b) => a.id - b.id);
  let moraleWeighted = keep.morale * totalRegiments(keep.units);
  for (const a of rest) {
    for (const u of UNIT_ORDER) keep.units[u] += a.units[u];
    moraleWeighted += a.morale * totalRegiments(a.units);
  }
  keep.morale = moraleWeighted / Math.max(1, totalRegiments(keep.units));
  const ids = new Set(rest.map((a) => a.id));
  state.armies = state.armies.filter((a) => !ids.has(a.id));
  return OK;
}

export function splitArmy(state: GameState, country: number, armyId: number, take: UnitCounts): OrderResult {
  const army = state.armies.find((a) => a.id === armyId);
  if (!army || army.owner !== country) return fail('Not your army.');
  const taken = totalRegiments(take);
  if (taken < 1) return fail('Choose at least one regiment.');
  for (const u of UNIT_ORDER) {
    if (!Number.isInteger(take[u]) || take[u] < 0 || take[u] > army.units[u]) return fail('Invalid split.');
  }
  if (taken >= totalRegiments(army.units)) return fail('At least one regiment must stay.');
  const units = emptyUnits();
  for (const u of UNIT_ORDER) { units[u] = take[u]; army.units[u] -= take[u]; }
  state.armies.push({ id: state.nextArmyId++, owner: country, province: army.province, units, morale: army.morale, path: [] });
  return OK;
}

export function halfOf(units: UnitCounts): UnitCounts {
  const out = emptyUnits();
  for (const u of UNIT_ORDER) out[u] = Math.floor(units[u] / 2);
  if (totalRegiments(out) === 0) {
    const first = UNIT_ORDER.find((u) => units[u] > 0 && totalRegiments(units) > 1);
    if (first) out[first] = 1;
  }
  return out;
}

export function canDeclareWar(state: GameState, attacker: number, target: number): OrderResult {
  if (attacker === target) return fail('A realm cannot war on itself.');
  const a = state.countries[attacker], t = state.countries[target];
  if (!a?.alive || !t?.alive) return fail('Both nations must exist.');
  if (atWar(state, attacker, target)) return fail('Already at war.');
  const truce = truceUntil(state, attacker, target);
  if (truce !== null) return fail(`A truce holds until turn ${truce}.`);
  return OK;
}

export function declareWar(state: GameState, attacker: number, target: number): OrderResult {
  const check = canDeclareWar(state, attacker, target);
  if (!check.ok) return check;
  state.wars.push({ a: attacker, b: target, startTurn: state.turn, scoreA: 0, scoreB: 0, battles: 0 });
  state.peaceOffers = state.peaceOffers.filter((o) => !((o.from === attacker && o.to === target) || (o.from === target && o.to === attacker)));
  log(state, {
    type: 'war', participants: [attacker, target], visibility: 'public',
    text: `${state.countries[attacker].name} declares war on ${state.countries[target].name}.`,
  });
  return OK;
}

/**
 * Armies left standing in land they may no longer occupy (after a peace, or when a third nation
 * takes the province) step to an adjacent allowed province, or march home to their capital.
 * Paths through now-forbidden land are cancelled.
 */
export function expelTrespassers(state: GameState): void {
  for (const army of state.armies) {
    if (!canEnter(state, army.owner, army.province)) {
      const step = state.provinces[army.province].neighbors.find((n) => state.provinces[n].owner === army.owner)
        ?? state.provinces[army.province].neighbors.find((n) => canEnter(state, army.owner, n)
          && !state.armies.some((o) => o.province === n && atWar(state, o.owner, army.owner)));
      army.province = step ?? state.countries[army.owner].capital;
      army.path = [];
    } else if (army.path.some((p) => !canEnter(state, army.owner, p))) {
      army.path = [];
    }
  }
}

export function makePeace(state: GameState, a: number, b: number): OrderResult {
  const war = findWar(state, a, b);
  if (!war) return fail('Not at war.');
  state.wars = state.wars.filter((w) => w !== war);
  state.truces = state.truces.filter((t) => !((t.a === a && t.b === b) || (t.a === b && t.b === a)));
  state.truces.push({ a, b, untilTurn: state.turn + TRUCE_TURNS });
  state.peaceOffers = state.peaceOffers.filter((o) => !((o.from === a && o.to === b) || (o.from === b && o.to === a)));
  for (const p of state.provinces) {
    if (p.siege && ((p.owner === a && p.siege.by === b) || (p.owner === b && p.siege.by === a))) p.siege = null;
  }
  expelTrespassers(state);
  log(state, {
    type: 'peace', participants: [a, b], visibility: 'public',
    text: `${state.countries[a].name} and ${state.countries[b].name} sign a white peace. Captured provinces stay with their captors.`,
  });
  return OK;
}
