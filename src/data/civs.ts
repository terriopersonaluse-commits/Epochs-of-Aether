import type { CivId, TerrainId, UnitId } from '../core/types.ts';

export interface CivDef {
  id: CivId;
  name: string;
  description: string;
  goldMult: number;
  foodMult: number;
  ironMult: number;
  manpowerMult: number;
  /** Attack multipliers per unit type. */
  unitAttack: Partial<Record<UnitId, number>>;
  /** Recruitment cost multipliers per unit type. */
  unitCost: Partial<Record<UnitId, number>>;
  /** Extra defence multiplier when fighting in these terrains (attacking or defending). */
  terrainBonus: Partial<Record<TerrainId, number>>;
  /** Shifts applied to generated personality. */
  aggressionBias: number;
  cautionBias: number;
  /** Preferred share of each unit type when the AI recruits. */
  armyMix: Record<UnitId, number>;
  nameStyle: 'human' | 'dwarven' | 'elven' | 'orcish' | 'merchant' | 'nomad';
}

export const CIVS: Record<CivId, CivDef> = {
  human: {
    id: 'human', name: 'Human Kingdom',
    description: 'Balanced realms of knights and farmers. No glaring weakness.',
    goldMult: 1, foodMult: 1.1, ironMult: 1, manpowerMult: 1.1,
    unitAttack: {}, unitCost: {}, terrainBonus: {},
    aggressionBias: 0, cautionBias: 0,
    armyMix: { infantry: 0.5, archers: 0.25, cavalry: 0.2, siege: 0.05 },
    nameStyle: 'human',
  },
  dwarven: {
    id: 'dwarven', name: 'Dwarven Hold',
    description: 'Master smiths of the deep. Rich in iron, deadly in hills and mountains, short on food.',
    goldMult: 1, foodMult: 0.85, ironMult: 1.6, manpowerMult: 0.8,
    unitAttack: { infantry: 1.2, siege: 1.3 }, unitCost: { siege: 0.75 },
    terrainBonus: { hills: 1.2, mountains: 1.3 },
    aggressionBias: -0.1, cautionBias: 0.15,
    armyMix: { infantry: 0.6, archers: 0.15, cavalry: 0.05, siege: 0.2 },
    nameStyle: 'dwarven',
  },
  elven: {
    id: 'elven', name: 'Elven Realm',
    description: 'Ancient forest peoples. Superb archers, masters of woodland war, few in number.',
    goldMult: 1.05, foodMult: 1, ironMult: 0.9, manpowerMult: 0.75,
    unitAttack: { archers: 1.4 }, unitCost: { archers: 0.8 },
    terrainBonus: { forest: 1.35 },
    aggressionBias: -0.15, cautionBias: 0.1,
    armyMix: { infantry: 0.3, archers: 0.55, cavalry: 0.1, siege: 0.05 },
    nameStyle: 'elven',
  },
  orcish: {
    id: 'orcish', name: 'Orcish War Clans',
    description: 'Fierce raiders with endless warriors and a poor treasury.',
    goldMult: 0.8, foodMult: 1, ironMult: 1, manpowerMult: 1.5,
    unitAttack: { infantry: 1.3, cavalry: 1.1 }, unitCost: { infantry: 0.8 },
    terrainBonus: {},
    aggressionBias: 0.25, cautionBias: -0.2,
    armyMix: { infantry: 0.7, archers: 0.1, cavalry: 0.15, siege: 0.05 },
    nameStyle: 'orcish',
  },
  merchant: {
    id: 'merchant', name: 'Merchant Republic',
    description: 'Wealthy trading states that hire armies rather than breed them.',
    goldMult: 1.4, foodMult: 1, ironMult: 1, manpowerMult: 0.8,
    unitAttack: {}, unitCost: {},
    terrainBonus: {},
    aggressionBias: -0.1, cautionBias: 0.1,
    armyMix: { infantry: 0.45, archers: 0.3, cavalry: 0.15, siege: 0.1 },
    nameStyle: 'merchant',
  },
  nomad: {
    id: 'nomad', name: 'Nomad Horde',
    description: 'Horse peoples of the steppe and sands. Cheap, fast cavalry; weak at sieges.',
    goldMult: 0.9, foodMult: 1, ironMult: 1, manpowerMult: 1.1,
    unitAttack: { cavalry: 1.25 }, unitCost: { cavalry: 0.7 },
    terrainBonus: { plains: 1.15, desert: 1.25 },
    aggressionBias: 0.15, cautionBias: -0.1,
    armyMix: { infantry: 0.2, archers: 0.3, cavalry: 0.5, siege: 0 },
    nameStyle: 'nomad',
  },
};

export const CIV_ORDER: CivId[] = ['human', 'dwarven', 'elven', 'orcish', 'merchant', 'nomad'];
