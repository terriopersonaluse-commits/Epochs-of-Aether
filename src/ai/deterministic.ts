// Rule-based national AI. Uses only what the nation can see or estimate (see queries.ts).
import { clamp, nextFloat } from '../core/rng.ts';
import type { Army, GameState, UnitId } from '../core/types.ts';
import { CIVS } from '../data/civs.ts';
import { UNITS, UNIT_ORDER, totalRegiments } from '../data/units.ts';
import { assessPeace } from '../sim/diplomacy.ts';
import { declareWar, halfOf, log, makePeace, mergeArmies, recruit, setArmyDestination, splitArmy } from '../sim/orders.ts';
import {
  armiesOf, armyStrength, bordersOf, budget, enemiesOf, estimateStrength, findPath,
  isBesiegedByEnemy, truceUntil, trueMilitaryStrength, visibleProvinces,
} from '../sim/queries.ts';
import type { StrategicPolicy } from './policy.ts';

interface Ctx {
  id: number;
  vis: Set<number>;
  enemies: number[];
  neighbors: number[];
  myStrength: number;
}

function context(state: GameState, id: number): Ctx {
  return {
    id,
    vis: visibleProvinces(state, id),
    enemies: enemiesOf(state, id),
    neighbors: [...bordersOf(state, id)].sort((a, b) => a - b),
    myStrength: trueMilitaryStrength(state, id),
  };
}

// ------------------------------------------------------------------ diplomacy

function diplomacy(state: GameState, ctx: Ctx): void {
  const me = state.countries[ctx.id];
  for (const enemy of ctx.enemies) {
    const mine = assessPeace(state, ctx.id, enemy);
    if (!mine.accept) continue;
    const other = state.countries[enemy];
    if (other.isPlayer) {
      if (!state.peaceOffers.some((o) => o.from === ctx.id && o.to === enemy)) {
        state.peaceOffers.push({ from: ctx.id, to: enemy, turn: state.turn });
        log(state, {
          type: 'info', participants: [ctx.id, enemy], visibility: 'participants',
          text: `${me.name} offers white peace to ${other.name}. ${mine.reasons.join(' ')}`,
        });
      }
    } else if (assessPeace(state, enemy, ctx.id).accept) {
      makePeace(state, ctx.id, enemy);
    }
  }

  ctx.enemies = enemiesOf(state, ctx.id);
  if (state.turn <= state.settings.graceTurns || ctx.enemies.length > 0) return;
  if (me.warExhaustion > 25 || me.treasury.gold < 15) return;

  let best: { target: number; score: number } | null = null;
  for (const n of ctx.neighbors) {
    if (!state.countries[n].alive || truceUntil(state, ctx.id, n) !== null) continue;
    const ratio = ctx.myStrength / Math.max(1, estimateStrength(state, ctx.id, n, ctx.vis));
    const distracted = enemiesOf(state, n).length > 0 ? 0.35 : 0;
    const score = me.personality.aggression * 1.2 + clamp(ratio - 1.3, -1.5, 2) * 0.9
      - me.personality.caution * 0.8 + distracted;
    if (!best || score > best.score) best = { target: n, score };
  }
  if (best && best.score > 0.45 && nextFloat(state) < 0.2 + me.personality.aggression * 0.2) {
    declareWar(state, ctx.id, best.target);
    ctx.enemies = enemiesOf(state, ctx.id);
  }
}

// ------------------------------------------------------------------ recruitment

function recruitment(state: GameState, ctx: Ctx): void {
  const me = state.countries[ctx.id];
  const owned = state.provinces.filter((p) => p.owner === ctx.id);
  const b = budget(state, ctx.id);
  const atWarNow = ctx.enemies.length > 0;
  let desired = Math.round(owned.length * 1.5 * (0.7 + me.personality.aggression * 0.6) * (atWarNow ? 1.35 : 1));
  const biggestThreat = Math.max(0, ...ctx.neighbors.map((n) => estimateStrength(state, ctx.id, n, ctx.vis)));
  if (ctx.myStrength < biggestThreat * (0.6 + me.personality.caution * 0.5)) desired += 3;
  // Idle gold is wasted gold until construction exists (Phase 2): grow the army with the surplus.
  if (me.treasury.gold > 250) desired += Math.min(8, Math.floor(me.treasury.gold / 250) * 2);

  const composition: Record<UnitId, number> = { infantry: 0, archers: 0, cavalry: 0, siege: 0 };
  for (const a of armiesOf(state, ctx.id)) for (const u of UNIT_ORDER) composition[u] += a.units[u];
  for (const r of state.recruitment) if (r.country === ctx.id) composition[r.unit] += r.count;
  let current = UNIT_ORDER.reduce((s, u) => s + composition[u], 0);

  let netGold = b.income.gold - b.expenses.gold;
  let netFood = b.income.food - b.expenses.food;
  const where = recruitProvince(state, ctx);
  if (where === null) return;
  const mix = CIVS[me.civ].armyMix;

  for (let i = 0; i < 3 && current < desired; i++) {
    const options = UNIT_ORDER
      .filter((u) => mix[u] > 0 && (u !== 'siege' || atWarNow))
      .sort((x, y) => (composition[x] / Math.max(1, current) - mix[x]) - (composition[y] / Math.max(1, current) - mix[y]));
    let done = false;
    for (const unit of options) {
      const up = UNITS[unit];
      const affordable = (netGold - up.upkeepGold >= 0 || me.treasury.gold > 120)
        && (netFood - up.upkeepFood >= 0 || me.treasury.food > 25);
      if (!affordable) continue;
      if (recruit(state, ctx.id, where, unit).ok) {
        composition[unit]++;
        current++;
        netGold -= up.upkeepGold;
        netFood -= up.upkeepFood;
        done = true;
        break;
      }
    }
    if (!done) break;
  }
}

function recruitProvince(state: GameState, ctx: Ctx): number | null {
  const me = state.countries[ctx.id];
  const candidates = state.provinces.filter((p) => p.owner === ctx.id && !isBesiegedByEnemy(state, p.id));
  if (!candidates.length) return null;
  if (ctx.enemies.length) {
    const front = candidates
      .filter((p) => p.neighbors.some((n) => ctx.enemies.includes(state.provinces[n].owner ?? -1)))
      .sort((a, b) => b.fort - a.fort || a.id - b.id);
    if (front.length && front[0].fort >= 1) return front[0].id;
  }
  return candidates.some((p) => p.id === me.capital) ? me.capital : candidates[0].id;
}

// ------------------------------------------------------------------ armies

function enemyStrengthAt(state: GameState, ctx: Ctx, provinceId: number): number {
  if (!ctx.vis.has(provinceId)) return 0;
  return state.armies
    .filter((a) => a.province === provinceId && ctx.enemies.includes(a.owner))
    .reduce((s, a) => s + armyStrength(state, a), 0);
}

function warMoves(state: GameState, ctx: Ctx, army: Army): void {
  const me = state.countries[ctx.id];
  const myS = armyStrength(state, army);
  const here = state.provinces[army.province];

  // Outmatched next to a superior force: fall back to the capital unless we hold a strong fort.
  const nearby = Math.max(0, ...here.neighbors.map((n) => enemyStrengthAt(state, ctx, n)));
  if (myS < nearby * 0.6 && !(here.owner === ctx.id && here.fort >= 2)) {
    setArmyDestination(state, ctx.id, army.id, me.capital);
    return;
  }

  // Relieve our own besieged or invaded provinces first.
  const threatened = state.provinces
    .filter((p) => p.owner === ctx.id && (isBesiegedByEnemy(state, p.id) || enemyStrengthAt(state, ctx, p.id) > 0))
    .map((p) => ({ p, path: findPath(state, ctx.id, army.province, p.id), enemy: enemyStrengthAt(state, ctx, p.id) }))
    .filter((t) => t.path !== null && t.path.length <= 4 && t.enemy < myS * 1.1)
    .sort((a, b) => a.path!.length - b.path!.length);
  if (threatened.length) {
    setArmyDestination(state, ctx.id, army.id, threatened[0].p.id);
    return;
  }

  let best: { target: number; score: number } | null = null;
  for (const p of state.provinces) {
    if (p.owner === null || !ctx.enemies.includes(p.owner)) continue;
    const path = findPath(state, ctx.id, army.province, p.id);
    if (path === null || path.length > 9) continue;
    const enemy = enemyStrengthAt(state, ctx, p.id);
    let score = -path.length * 1.2 - p.fort * 1.0 + p.population * 0.05;
    if (state.countries[p.owner].capital === p.id) score += 3;
    if (enemy > 0) score += myS > enemy * 1.3 ? 2 : -20;
    if (army.province === p.id) score += 4; // keep sieging what we started
    if (!best || score > best.score) best = { target: p.id, score };
  }
  if (best && best.score > -15) setArmyDestination(state, ctx.id, army.id, best.target);
  else if (army.province !== me.capital) setArmyDestination(state, ctx.id, army.id, me.capital);
}

function peaceMoves(state: GameState, ctx: Ctx, armies: Army[]): void {
  const me = state.countries[ctx.id];
  const wilds = state.provinces.filter((p) => p.owner === null);
  const colonizing = armies.some((a) => a.path.length > 0 && state.provinces[a.path[a.path.length - 1]].owner === null);
  const sittingOnWild = armies.some((a) => state.provinces[a.province].owner === null);

  if (wilds.length && !colonizing && !sittingOnWild) {
    let best: { army: Army; target: number; len: number } | null = null;
    for (const a of armies) {
      for (const w of wilds) {
        const path = findPath(state, ctx.id, a.province, w.id);
        if (path && path.length <= 6 && (!best || path.length < best.len)) best = { army: a, target: w.id, len: path.length };
      }
    }
    if (best) {
      let colonist = best.army;
      if (totalRegiments(colonist.units) >= 4 && splitArmy(state, ctx.id, colonist.id, halfOf(colonist.units)).ok) {
        colonist = state.armies[state.armies.length - 1];
      }
      setArmyDestination(state, ctx.id, colonist.id, best.target);
    }
  }

  // Station the main army where the strongest neighbour borders us; the rest rest at the capital.
  const threat = ctx.neighbors
    .map((n) => ({ n, s: estimateStrength(state, ctx.id, n, ctx.vis) }))
    .sort((a, b) => b.s - a.s || a.n - b.n)[0];
  let staging = me.capital;
  if (threat) {
    const front = state.provinces
      .filter((p) => p.owner === ctx.id && p.neighbors.some((n) => state.provinces[n].owner === threat.n))
      .sort((a, b) => b.fort - a.fort || a.id - b.id)[0];
    if (front) staging = front.id;
  }
  const idle = armiesOf(state, ctx.id)
    .filter((a) => a.path.length === 0 && state.provinces[a.province].owner === ctx.id)
    .sort((a, b) => armyStrength(state, b) - armyStrength(state, a));
  idle.forEach((a, i) => {
    const dest = i === 0 ? staging : me.capital;
    if (a.province !== dest) setArmyDestination(state, ctx.id, a.id, dest);
  });
}

function military(state: GameState, ctx: Ctx): void {
  for (const pid of [...new Set(armiesOf(state, ctx.id).filter((a) => a.path.length === 0).map((a) => a.province))]) {
    const idleHere = state.armies.filter((a) => a.owner === ctx.id && a.province === pid && a.path.length === 0);
    if (idleHere.length > 1) mergeArmies(state, ctx.id, pid);
  }
  const armies = armiesOf(state, ctx.id).sort((a, b) => armyStrength(state, b) - armyStrength(state, a));
  if (ctx.enemies.length) {
    for (const a of armies) warMoves(state, ctx, a);
  } else {
    peaceMoves(state, ctx, armies);
  }
}

// ------------------------------------------------------------------ entry

export const deterministicPolicy: StrategicPolicy = {
  name: 'deterministic',
  planTurn(state, id) {
    const ctx = context(state, id);
    diplomacy(state, ctx);
    recruitment(state, ctx);
    military(state, ctx);
  },
};
