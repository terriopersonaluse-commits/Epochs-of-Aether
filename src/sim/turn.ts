// End-of-turn processing. The order of the phases is deliberate; see docs/TECHNICAL_PLAN.md.
//  1. economy (income, upkeep, shortages)    5. movement + battles (two sub-steps)
//  2. recruitment completes                  6. sieges and colonisation
//  3. manpower, morale recovery              7. eliminations, exhaustion, truces, victory
//  4. AI nations plan and issue orders       8. advance the calendar
import { clamp, nextFloat } from '../core/rng.ts';
import type { GameState } from '../core/types.ts';
import { CIVS } from '../data/civs.ts';
import { UNITS, UNIT_ORDER, armySpeed, emptyUnits, totalRegiments } from '../data/units.ts';
import type { StrategicPolicy } from '../ai/policy.ts';
import { resolveBattlesIn } from './combat.ts';
import { expelTrespassers, log } from './orders.ts';
import { atWar, budget, canEnter, enemiesOf, findWar } from './queries.ts';

export const VICTORY_SHARE = 0.6;

function economyPhase(state: GameState): void {
  for (const c of state.countries) {
    if (!c.alive) continue;
    const b = budget(state, c.id);
    c.lastIncome = b.income;
    c.lastExpenses = b.expenses;
    c.treasury.gold += b.income.gold - b.expenses.gold;
    c.treasury.food = Math.min(b.foodCap, c.treasury.food + b.income.food - b.expenses.food);
    c.treasury.iron += b.income.iron;

    if (c.treasury.gold < 0) {
      c.treasury.gold = 0;
      for (const a of state.armies) if (a.owner === c.id) a.morale = clamp(a.morale - 0.15, 0, 1);
      log(state, { type: 'shortage', participants: [c.id], visibility: 'participants', text: `${c.name} cannot pay its soldiers. Army morale collapses.` });
    }
    if (c.treasury.food < 0) {
      c.treasury.food = 0;
      let deserted = 0;
      for (const a of state.armies) {
        if (a.owner !== c.id) continue;
        for (const u of UNIT_ORDER) {
          for (let i = a.units[u]; i > 0; i--) if (nextFloat(state) < 0.1) { a.units[u]--; deserted++; }
        }
        a.morale = clamp(a.morale - 0.1, 0, 1);
      }
      log(state, { type: 'shortage', participants: [c.id], visibility: 'participants', text: `Food runs out in ${c.name}. ${deserted} regiments desert or starve.` });
    }
  }
}

function recruitmentPhase(state: GameState): void {
  const due = state.recruitment.filter((r) => r.completesOnTurn <= state.turn);
  state.recruitment = state.recruitment.filter((r) => r.completesOnTurn > state.turn);
  for (const r of due) {
    if (state.provinces[r.province].owner !== r.country || !state.countries[r.country].alive) continue;
    let army = state.armies.find((a) => a.owner === r.country && a.province === r.province && a.path.length === 0);
    if (!army) {
      army = { id: state.nextArmyId++, owner: r.country, province: r.province, units: emptyUnits(), morale: 0.8, path: [] };
      state.armies.push(army);
    }
    const before = totalRegiments(army.units);
    army.units[r.unit] += r.count;
    army.morale = (army.morale * before + 0.8 * r.count) / (before + r.count);
  }
}

function recoveryPhase(state: GameState): void {
  for (const c of state.countries) {
    if (!c.alive) continue;
    const b = budget(state, c.id);
    c.manpower = Math.min(b.manpowerCap, c.manpower + b.manpowerGain);
    const atWarNow = enemiesOf(state, c.id).length > 0;
    c.warExhaustion = clamp(c.warExhaustion + (atWarNow ? 0.6 : -1.5), 0, 100);
  }
  for (const a of state.armies) {
    const home = state.provinces[a.province].owner === a.owner;
    a.morale = clamp(a.morale + (home ? 0.1 : 0.04), 0, 1);
  }
}

function movementPhase(state: GameState): void {
  const maxSpeed = Math.max(1, ...UNIT_ORDER.map((u) => UNITS[u].speed));
  const halted = new Set<number>();
  for (let step = 0; step < maxSpeed; step++) {
    const touched = new Set<number>();
    for (const army of [...state.armies].sort((a, b) => a.id - b.id)) {
      if (!state.armies.includes(army) || halted.has(army.id)) continue;
      if (step >= armySpeed(army.units) || army.path.length === 0) continue;
      const next = army.path[0];
      if (!state.provinces[army.province].neighbors.includes(next) || !canEnter(state, army.owner, next)) {
        army.path = [];
        continue;
      }
      army.province = next;
      army.path.shift();
      touched.add(next);
      const p = state.provinces[next];
      const hostileHere = state.armies.some((o) => o.province === next && atWar(state, o.owner, army.owner));
      // Armies halt when they meet the enemy or reach an enemy fortress.
      if (hostileHere || (p.owner !== null && p.owner !== army.owner && p.fort > 0)) halted.add(army.id);
    }
    for (const pid of [...touched].sort((a, b) => a - b)) resolveBattlesIn(state, pid);
  }
  // Armies that stood still can still be attacked where enemies arrived; resolve everywhere once more.
  const contested = [...new Set(state.armies.map((a) => a.province))].sort((a, b) => a - b);
  for (const pid of contested) resolveBattlesIn(state, pid);
  state.armies = state.armies.filter((a) => totalRegiments(a.units) > 0);
}

function siegePhase(state: GameState): void {
  for (const p of state.provinces) {
    const here = state.armies.filter((a) => a.province === p.id);
    if (p.owner === null) {
      const owners = [...new Set(here.map((a) => a.owner))];
      if (owners.length !== 1) { p.siege = null; continue; }
      const by = owners[0];
      p.siege = p.siege?.by === by ? { by, progress: p.siege.progress + 1 } : { by, progress: 1 };
      if (p.siege.progress >= 2) {
        p.owner = by;
        p.siege = null;
        log(state, { type: 'colonize', participants: [by], province: p.id, visibility: 'public', text: `${state.countries[by].name} settles the wild province of ${p.name}.` });
      }
      continue;
    }
    const owner = p.owner;
    if (here.some((a) => a.owner === owner)) { p.siege = null; continue; }
    const besiegers = here.filter((a) => atWar(state, a.owner, owner));
    if (!besiegers.length) { p.siege = null; continue; }
    const byStrength = new Map<number, number>();
    for (const a of besiegers) byStrength.set(a.owner, (byStrength.get(a.owner) ?? 0) + totalRegiments(a.units));
    const by = [...byStrength.entries()].sort((x, y) => y[1] - x[1] || x[0] - y[0])[0][0];
    const civ = CIVS[state.countries[by].civ];
    let power = 0;
    for (const a of besiegers) {
      if (a.owner !== by) continue;
      for (const u of UNIT_ORDER) power += a.units[u] * UNITS[u].siege * (u === 'siege' ? civ.unitAttack.siege ?? 1 : 1);
    }
    power = clamp(power, 0.5, 4);
    const progress = (p.siege?.by === by ? p.siege.progress : 0) + power;
    const required = 1 + p.fort * 2;
    if (progress < required) { p.siege = { by, progress }; continue; }
    captureProvince(state, p.id, by);
  }
}

export function captureProvince(state: GameState, provinceId: number, by: number): void {
  const p = state.provinces[provinceId];
  const loser = p.owner!;
  const wasCapital = state.countries[loser].capital === provinceId;
  p.owner = by;
  p.siege = null;
  p.fort = Math.max(0, p.fort - 1);
  const war = findWar(state, by, loser);
  const gain = wasCapital ? 15 : 6;
  if (war) { if (war.a === by) war.scoreA += gain; else war.scoreB += gain; }
  const lc = state.countries[loser];
  lc.warExhaustion = clamp(lc.warExhaustion + (wasCapital ? 12 : 4), 0, 100);
  state.recruitment = state.recruitment.filter((r) => !(r.province === provinceId && r.country === loser));
  log(state, {
    type: 'capture', participants: [by, loser], province: provinceId, visibility: 'public',
    text: `${state.countries[by].name} captures ${p.name}${wasCapital ? `, the capital of ${lc.name}` : ''}.`,
  });
  if (wasCapital) {
    const rest = state.provinces.filter((x) => x.owner === loser).sort((a, b) => b.population - a.population || a.id - b.id);
    if (rest.length) {
      lc.capital = rest[0].id;
      rest[0].fort += 1;
      log(state, { type: 'capital', participants: [loser], province: rest[0].id, visibility: 'public', text: `${lc.name} moves its court to ${rest[0].name}.` });
    }
  }
}

function cleanupPhase(state: GameState): void {
  for (const c of state.countries) {
    if (!c.alive) continue;
    const owned = state.provinces.filter((p) => p.owner === c.id);
    if (owned.length && state.provinces[c.capital].owner !== c.id) {
      // The court fell while the realm held nothing else, then the realm took new land this turn.
      const seat = owned.sort((a, b) => b.population - a.population || a.id - b.id)[0];
      c.capital = seat.id;
      seat.fort += 1;
      log(state, { type: 'capital', participants: [c.id], province: seat.id, visibility: 'public', text: `${c.name} raises a new court at ${seat.name}.` });
    }
    if (owned.length) continue;
    c.alive = false;
    state.armies = state.armies.filter((a) => a.owner !== c.id);
    state.recruitment = state.recruitment.filter((r) => r.country !== c.id);
    state.wars = state.wars.filter((w) => w.a !== c.id && w.b !== c.id);
    state.peaceOffers = state.peaceOffers.filter((o) => o.from !== c.id && o.to !== c.id);
    for (const p of state.provinces) if (p.siege?.by === c.id) p.siege = null;
    log(state, { type: 'eliminated', participants: [c.id], visibility: 'public', text: `${c.name} has fallen and passes into history.` });
  }
  state.truces = state.truces.filter((t) => t.untilTurn > state.turn);
  // Offers expire after the turn they were made.
  state.peaceOffers = state.peaceOffers.filter((o) => o.turn >= state.turn);

  if (state.winner === null) {
    for (const c of state.countries) {
      if (!c.alive) continue;
      const share = state.provinces.filter((p) => p.owner === c.id).length / state.provinces.length;
      const sole = state.countries.filter((x) => x.alive).length === 1;
      if (share >= VICTORY_SHARE || sole) {
        state.winner = c.id;
        log(state, { type: 'victory', participants: [c.id], visibility: 'public', text: `${c.name} achieves hegemony over the continent.` });
        break;
      }
    }
  }
}

/** Process one full turn. The policy decides for every nation not controlled by the player. */
export function processTurn(state: GameState, policy: StrategicPolicy): void {
  economyPhase(state);
  recruitmentPhase(state);
  recoveryPhase(state);
  for (const c of state.countries) {
    if (c.alive && !c.isPlayer) policy.planTurn(state, c.id);
  }
  movementPhase(state);
  siegePhase(state);
  expelTrespassers(state);
  cleanupPhase(state);
  state.turn++;
}
