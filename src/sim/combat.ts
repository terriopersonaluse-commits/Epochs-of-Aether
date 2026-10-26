// Battle resolution. Uses the state's seeded rng so results are reproducible.
import { clamp, nextFloat } from '../core/rng.ts';
import type { Army, GameState, TerrainId, UnitId } from '../core/types.ts';
import { CIVS } from '../data/civs.ts';
import { TERRAIN } from '../data/terrain.ts';
import { UNITS, UNIT_ORDER, totalRegiments } from '../data/units.ts';
import { log } from './orders.ts';
import { atWar, canEnter, findWar } from './queries.ts';

const ROUNDS = 3;

function cavalryTerrain(unit: UnitId, terrain: TerrainId): number {
  if (unit !== 'cavalry') return 1;
  if (terrain === 'plains' || terrain === 'desert') return 1.25;
  if (terrain === 'forest' || terrain === 'mountains') return 0.65;
  return 0.9;
}

function sidePower(state: GameState, armies: Army[], round: number, terrain: TerrainId): number {
  let total = 0;
  for (const a of armies) {
    const civ = CIVS[state.countries[a.owner].civ];
    const moraleFactor = 0.4 + 0.6 * a.morale;
    const terrainFactor = civ.terrainBonus[terrain] ?? 1;
    for (const u of UNIT_ORDER) {
      if (!a.units[u]) continue;
      const d = UNITS[u];
      total += a.units[u] * d.attack * (civ.unitAttack[u] ?? 1) * (round === 0 ? d.openingVolley : 1)
        * cavalryTerrain(u, terrain) * terrainFactor * moraleFactor;
    }
  }
  return total;
}

function avgDefense(state: GameState, armies: Army[], terrain: TerrainId): number {
  let sum = 0, n = 0;
  for (const a of armies) {
    const civ = CIVS[state.countries[a.owner].civ];
    for (const u of UNIT_ORDER) {
      sum += a.units[u] * UNITS[u].defense * (civ.terrainBonus[terrain] ?? 1);
      n += a.units[u];
    }
  }
  return n ? sum / n : 1;
}

function regiments(armies: Army[]): number {
  return armies.reduce((s, a) => s + totalRegiments(a.units), 0);
}

/** Remove `casualties` regiments (fractional) from a side, preferring the less sturdy units. */
function applyCasualties(state: GameState, armies: Army[], casualties: number): number {
  let lost = 0;
  let remaining = casualties;
  const pool: { army: Army; unit: UnitId; weight: number }[] = [];
  for (const a of armies) for (const u of UNIT_ORDER) if (a.units[u] > 0) pool.push({ army: a, unit: u, weight: a.units[u] / UNITS[u].defense });
  const totalWeight = pool.reduce((s, p) => s + p.weight, 0);
  for (const p of pool) {
    if (remaining <= 0) break;
    const share = casualties * (p.weight / totalWeight);
    let whole = Math.floor(share);
    if (nextFloat(state) < share - whole) whole++;
    whole = Math.min(whole, p.army.units[p.unit], Math.ceil(remaining));
    p.army.units[p.unit] -= whole;
    lost += whole;
    remaining -= whole;
  }
  const total = regiments(armies) + lost;
  for (const a of armies) a.morale = clamp(a.morale - (lost / Math.max(1, total)) * 1.2 - 0.04, 0, 1);
  return lost;
}

export interface BattleResult {
  winner: number;
  loser: number;
  winnerLosses: number;
  loserLosses: number;
}

export function fight(state: GameState, provinceId: number, sideA: Army[], sideB: Army[]): BattleResult {
  const province = state.provinces[provinceId];
  const terrain = province.terrain;
  const ownerA = sideA[0].owner, ownerB = sideB[0].owner;
  const defMult = TERRAIN[terrain].defense;
  const aDefends = province.owner === ownerA, bDefends = province.owner === ownerB;
  let lossA = 0, lossB = 0;
  let broken: 'A' | 'B' | null = null;

  for (let round = 0; round < ROUNDS && !broken; round++) {
    const pa = sidePower(state, sideA, round, terrain) * (0.8 + nextFloat(state) * 0.4);
    const pb = sidePower(state, sideB, round, terrain) * (0.8 + nextFloat(state) * 0.4);
    const dmgToA = pb / (aDefends ? defMult : 1);
    const dmgToB = pa / (bDefends ? defMult : 1);
    const casA = dmgToA / (avgDefense(state, sideA, terrain) * 4);
    const casB = dmgToB / (avgDefense(state, sideB, terrain) * 4);
    lossA += applyCasualties(state, sideA, casA);
    lossB += applyCasualties(state, sideB, casB);
    const moraleA = sideA.reduce((s, a) => s + a.morale, 0) / sideA.length;
    const moraleB = sideB.reduce((s, a) => s + a.morale, 0) / sideB.length;
    if (regiments(sideA) === 0 || moraleA < 0.2) broken = 'A';
    else if (regiments(sideB) === 0 || moraleB < 0.2) broken = 'B';
  }

  let aWins: boolean;
  if (broken) aWins = broken === 'B';
  else {
    const restA = sidePower(state, sideA, 1, terrain) * (aDefends ? defMult : 1);
    const restB = sidePower(state, sideB, 1, terrain) * (bDefends ? defMult : 1);
    aWins = restA >= restB;
  }
  const [winners, losers] = aWins ? [sideA, sideB] : [sideB, sideA];
  const winner = aWins ? ownerA : ownerB, loser = aWins ? ownerB : ownerA;
  const winnerLosses = aWins ? lossA : lossB, loserLosses = aWins ? lossB : lossA;

  for (const a of winners) a.morale = clamp(a.morale + 0.05, 0, 1);
  for (const a of losers) retreat(state, a);

  const war = findWar(state, winner, loser);
  if (war) {
    const gain = 2 + Math.floor(loserLosses / 3);
    if (war.a === winner) war.scoreA += gain; else war.scoreB += gain;
    war.battles++;
  }
  state.countries[winner].warExhaustion = clamp(state.countries[winner].warExhaustion + winnerLosses * 0.8, 0, 100);
  state.countries[loser].warExhaustion = clamp(state.countries[loser].warExhaustion + loserLosses * 0.8 + 1, 0, 100);

  log(state, {
    type: 'battle', participants: [winner, loser], province: provinceId, visibility: 'public',
    text: winnerLosses + loserLosses === 0
      ? `Skirmish at ${province.name}: ${state.countries[winner].name} drives off ${state.countries[loser].name} without losses.`
      : `Battle of ${province.name}: ${state.countries[winner].name} defeats ${state.countries[loser].name} `
        + `(${winnerLosses} vs ${loserLosses} regiments lost).`,
  });
  return { winner, loser, winnerLosses, loserLosses };
}

/** Move a beaten army to a safe neighbouring province, or disband it if surrounded. */
export function retreat(state: GameState, army: Army): void {
  army.path = [];
  if (totalRegiments(army.units) === 0) {
    state.armies = state.armies.filter((a) => a !== army);
    return;
  }
  const here = state.provinces[army.province];
  const capital = state.provinces[state.countries[army.owner].capital];
  const options = here.neighbors
    .filter((n) => canEnter(state, army.owner, n))
    .filter((n) => !state.armies.some((o) => o.province === n && atWar(state, o.owner, army.owner)))
    .sort((x, y) => {
      const px = state.provinces[x], py = state.provinces[y];
      const ox = px.owner === army.owner ? 0 : 1, oy = py.owner === army.owner ? 0 : 1;
      if (ox !== oy) return ox - oy;
      return Math.hypot(px.cx - capital.cx, px.cy - capital.cy) - Math.hypot(py.cx - capital.cx, py.cy - capital.cy);
    });
  if (!options.length) {
    log(state, {
      type: 'battle', participants: [army.owner], province: army.province, visibility: 'public',
      text: `Surrounded at ${here.name}, an army of ${state.countries[army.owner].name} surrenders (${totalRegiments(army.units)} regiments lost).`,
    });
    state.countries[army.owner].warExhaustion = clamp(state.countries[army.owner].warExhaustion + totalRegiments(army.units) * 0.8, 0, 100);
    state.armies = state.armies.filter((a) => a !== army);
    return;
  }
  army.province = options[0];
}

/** Resolve every hostile encounter in a province until no two warring sides remain there. */
export function resolveBattlesIn(state: GameState, provinceId: number): void {
  for (let guard = 0; guard < 8; guard++) {
    const here = state.armies.filter((a) => a.province === provinceId && totalRegiments(a.units) > 0);
    const owners = [...new Set(here.map((a) => a.owner))].sort((a, b) => a - b);
    let pair: [number, number] | null = null;
    for (let i = 0; i < owners.length && !pair; i++) {
      for (let j = i + 1; j < owners.length && !pair; j++) {
        if (atWar(state, owners[i], owners[j])) pair = [owners[i], owners[j]];
      }
    }
    if (!pair) return;
    // The province owner (if involved) is listed as side A only for stable ordering; defence is by ownership.
    fight(state, provinceId, here.filter((a) => a.owner === pair![0]), here.filter((a) => a.owner === pair![1]));
  }
}
