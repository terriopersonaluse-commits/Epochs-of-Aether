// Read-only questions about the game state. Nothing here mutates state or consumes rng.
import { hash01 } from '../core/rng.ts';
import type { Army, Country, GameState, Province, Resources, UnitCounts, War } from '../core/types.ts';
import { CIVS } from '../data/civs.ts';
import { DEPOSITS, TERRAIN } from '../data/terrain.ts';
import { UNITS, UNIT_ORDER, totalRegiments } from '../data/units.ts';

export function findWar(state: GameState, a: number, b: number): War | undefined {
  return state.wars.find((w) => (w.a === a && w.b === b) || (w.a === b && w.b === a));
}

export function atWar(state: GameState, a: number, b: number): boolean {
  return a !== b && findWar(state, a, b) !== undefined;
}

export function enemiesOf(state: GameState, id: number): number[] {
  return state.wars.flatMap((w) => (w.a === id ? [w.b] : w.b === id ? [w.a] : []));
}

export function truceUntil(state: GameState, a: number, b: number): number | null {
  const t = state.truces.find((x) => ((x.a === a && x.b === b) || (x.a === b && x.b === a)) && x.untilTurn > state.turn);
  return t ? t.untilTurn : null;
}

export function ownedProvinces(state: GameState, id: number): Province[] {
  return state.provinces.filter((p) => p.owner === id);
}

export function armiesOf(state: GameState, id: number): Army[] {
  return state.armies.filter((a) => a.owner === id);
}

export function armiesIn(state: GameState, provinceId: number): Army[] {
  return state.armies.filter((a) => a.province === provinceId);
}

/** May an army of `country` stand in `province`? Own land, untamed wilds, or land of an enemy at war. */
export function canEnter(state: GameState, country: number, provinceId: number): boolean {
  const owner = state.provinces[provinceId].owner;
  return owner === null || owner === country || atWar(state, country, owner);
}

/** Shortest walkable route (excluding the start). Null when unreachable. */
export function findPath(state: GameState, country: number, from: number, to: number): number[] | null {
  if (from === to) return [];
  if (!canEnter(state, country, to)) return null;
  const prev = new Map<number, number>([[from, -1]]);
  const queue = [from];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const n of state.provinces[cur].neighbors) {
      if (prev.has(n) || !canEnter(state, country, n)) continue;
      prev.set(n, cur);
      if (n === to) {
        const path = [n];
        let p = cur;
        while (p !== from) { path.unshift(p); p = prev.get(p)!; }
        return path;
      }
      queue.push(n);
    }
  }
  return null;
}

/** Combat value of a set of regiments, independent of terrain and morale. */
export function unitsStrength(units: UnitCounts, civ: Country['civ']): number {
  let s = 0;
  for (const id of UNIT_ORDER) {
    const def = UNITS[id];
    s += units[id] * ((def.attack * (CIVS[civ].unitAttack[id] ?? 1)) + def.defense) / 2;
  }
  return s;
}

export function armyStrength(state: GameState, army: Army): number {
  return unitsStrength(army.units, state.countries[army.owner].civ) * (0.5 + 0.5 * army.morale);
}

export function trueMilitaryStrength(state: GameState, id: number): number {
  return armiesOf(state, id).reduce((s, a) => s + armyStrength(state, a), 0);
}

/** Provinces a country can currently see: its land, its armies' locations, and everything adjacent. */
export function visibleProvinces(state: GameState, id: number): Set<number> {
  const vis = new Set<number>();
  const add = (p: number) => {
    vis.add(p);
    for (const n of state.provinces[p].neighbors) vis.add(n);
  };
  for (const p of state.provinces) if (p.owner === id) add(p.id);
  for (const a of state.armies) if (a.owner === id) add(a.province);
  return vis;
}

/**
 * What `observer` believes `target`'s army strength to be. Armies in visible provinces are
 * counted exactly; the rest are misjudged by up to ±30%, stable for four turns at a time.
 */
export function estimateStrength(state: GameState, observer: number, target: number, vis?: Set<number>): number {
  if (observer === target) return trueMilitaryStrength(state, target);
  const seen = vis ?? visibleProvinces(state, observer);
  const period = Math.floor(state.turn / 4);
  let total = 0;
  for (const a of armiesOf(state, target)) {
    const s = armyStrength(state, a);
    total += seen.has(a.province) ? s : s * (0.7 + 0.6 * hash01(observer, target, period, a.id));
  }
  return total;
}

export function bordersOf(state: GameState, id: number): Set<number> {
  const out = new Set<number>();
  for (const p of state.provinces) {
    if (p.owner !== id) continue;
    for (const n of p.neighbors) {
      const o = state.provinces[n].owner;
      if (o !== null && o !== id) out.add(o);
    }
  }
  return out;
}

export function isBesiegedByEnemy(state: GameState, provinceId: number): boolean {
  const p = state.provinces[provinceId];
  return p.owner !== null && p.siege !== null && p.siege.by !== p.owner;
}

export function provinceYield(state: GameState, p: Province): Resources {
  if (p.owner === null || isBesiegedByEnemy(state, p.id)) return { gold: 0, food: 0, iron: 0 };
  const c = state.countries[p.owner];
  const civ = CIVS[c.civ];
  const t = TERRAIN[p.terrain];
  const d = p.deposit ? DEPOSITS[p.deposit] : { gold: 0, food: 0, iron: 0 };
  const capital = c.capital === p.id;
  const popFactor = 0.6 + p.population * 0.05;
  const exhaustion = 1 - c.warExhaustion / 200;
  return {
    gold: ((t.gold + d.gold) * popFactor + (capital ? 3 : 0)) * civ.goldMult * exhaustion,
    food: (t.food + d.food + (capital ? 1 : 0)) * civ.foodMult,
    iron: (t.iron + d.iron) * civ.ironMult,
  };
}

export interface Budget {
  income: Resources;
  expenses: Resources;
  manpowerGain: number;
  manpowerCap: number;
  foodCap: number;
}

export function budget(state: GameState, id: number): Budget {
  const c = state.countries[id];
  const civ = CIVS[c.civ];
  const income = { gold: 0, food: 0, iron: 0 };
  let pop = 0, provinces = 0;
  for (const p of state.provinces) {
    if (p.owner !== id) continue;
    const y = provinceYield(state, p);
    income.gold += y.gold; income.food += y.food; income.iron += y.iron;
    pop += p.population;
    provinces++;
  }
  const expenses = { gold: 0, food: 0, iron: 0 };
  for (const a of armiesOf(state, id)) {
    for (const u of UNIT_ORDER) {
      expenses.gold += a.units[u] * UNITS[u].upkeepGold;
      expenses.food += a.units[u] * UNITS[u].upkeepFood;
    }
  }
  return {
    income,
    expenses,
    manpowerGain: Math.round(pop * 12 * civ.manpowerMult),
    manpowerCap: Math.round(pop * 250 * civ.manpowerMult),
    foodCap: 40 + provinces * 8,
  };
}

export function unitCost(civ: Country['civ'], unit: keyof UnitCounts): { gold: number; iron: number; manpower: number } {
  const m = CIVS[civ].unitCost[unit] ?? 1;
  const d = UNITS[unit];
  return { gold: Math.round(d.gold * m), iron: Math.round(d.iron * m), manpower: d.manpower };
}

export function regimentsOf(state: GameState, id: number): number {
  return armiesOf(state, id).reduce((s, a) => s + totalRegiments(a.units), 0);
}

export function dateLabel(turn: number): string {
  const seasons = ['Spring', 'Summer', 'Autumn', 'Winter'];
  return `${seasons[(turn - 1) % 4]}, Year ${Math.floor((turn - 1) / 4) + 1}`;
}

/** Events a given country knows about (public events plus those it took part in). */
export function knownEvents(state: GameState, id: number | null) {
  return state.log.filter((e) => e.visibility === 'public' || (id !== null && e.participants.includes(id)));
}
