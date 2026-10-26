import type { GameState } from '../src/core/types.ts';
import { emptyUnits } from '../src/data/units.ts';
import { generateWorld } from '../src/world/generate.ts';

export function world(seed = 12345): GameState {
  return generateWorld(seed);
}

/** Two countries that share a land border, plus a shared border province pair. */
export function neighbours(state: GameState): { a: number; b: number; pa: number; pb: number } {
  for (const p of state.provinces) {
    if (p.owner === null) continue;
    for (const n of p.neighbors) {
      const q = state.provinces[n];
      if (q.owner !== null && q.owner !== p.owner && !p.straits.includes(n)) {
        return { a: p.owner, b: q.owner, pa: p.id, pb: q.id };
      }
    }
  }
  throw new Error('no neighbouring countries');
}

export function placeArmy(state: GameState, owner: number, province: number, infantry: number) {
  const units = emptyUnits();
  units.infantry = infantry;
  const army = { id: state.nextArmyId++, owner, province, units, morale: 1, path: [] as number[] };
  state.armies.push(army);
  return army;
}

export function clearArmies(state: GameState) {
  state.armies = [];
}
