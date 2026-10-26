import type { UnitCounts, UnitId } from '../core/types.ts';

export interface UnitDef {
  id: UnitId;
  name: string;
  /** Recruitment cost. */
  gold: number;
  iron: number;
  manpower: number;
  /** Per-turn upkeep. */
  upkeepGold: number;
  upkeepFood: number;
  attack: number;
  defense: number;
  /** Provinces per turn. An army moves at the speed of its slowest unit. */
  speed: number;
  /** Contribution to siege progress per turn. */
  siege: number;
  /** Bonus to attack in the first battle round (ranged volley). */
  openingVolley: number;
  description: string;
}

export const UNIT_ORDER: UnitId[] = ['infantry', 'archers', 'cavalry', 'siege'];

export const UNITS: Record<UnitId, UnitDef> = {
  infantry: {
    id: 'infantry', name: 'Infantry', gold: 15, iron: 0, manpower: 1000,
    upkeepGold: 0.5, upkeepFood: 0.5, attack: 3, defense: 4, speed: 1, siege: 0.25, openingVolley: 1,
    description: 'Cheap, sturdy line troops. The backbone of every army.',
  },
  archers: {
    id: 'archers', name: 'Archers', gold: 20, iron: 0, manpower: 1000,
    upkeepGold: 0.6, upkeepFood: 0.5, attack: 3.5, defense: 2.5, speed: 1, siege: 0.15, openingVolley: 1.8,
    description: 'Deadly opening volley, fragile in melee.',
  },
  cavalry: {
    id: 'cavalry', name: 'Cavalry', gold: 35, iron: 6, manpower: 1000,
    upkeepGold: 1.1, upkeepFood: 1, attack: 6, defense: 3, speed: 2, siege: 0.1, openingVolley: 1,
    description: 'Fast shock troops. Strong in open terrain, weak in forests and mountains. Needs iron.',
  },
  siege: {
    id: 'siege', name: 'Siege Engines', gold: 40, iron: 10, manpower: 500,
    upkeepGold: 0.9, upkeepFood: 0.25, attack: 1, defense: 1, speed: 1, siege: 1.5, openingVolley: 1,
    description: 'Breaks fortifications quickly. Nearly useless in open battle. Needs iron.',
  },
};

export function emptyUnits(): UnitCounts {
  return { infantry: 0, archers: 0, cavalry: 0, siege: 0 };
}

export function totalRegiments(u: UnitCounts): number {
  return u.infantry + u.archers + u.cavalry + u.siege;
}

export function armySpeed(u: UnitCounts): number {
  let speed = Infinity;
  for (const id of UNIT_ORDER) if (u[id] > 0) speed = Math.min(speed, UNITS[id].speed);
  return speed === Infinity ? 1 : speed;
}
