import type { DepositId, TerrainId } from '../core/types.ts';

export interface TerrainDef {
  id: TerrainId;
  name: string;
  color: string;
  food: number;
  gold: number;
  iron: number;
  /** Multiplier applied to the defender in battle. */
  defense: number;
  /** Base population of a province with this dominant terrain. */
  population: number;
  /** Extra fort levels a province of this terrain starts with. */
  naturalFort: number;
}

export const TERRAIN_ORDER: TerrainId[] = ['sea', 'plains', 'forest', 'hills', 'mountains', 'desert', 'tundra'];

export const TERRAIN: Record<TerrainId, TerrainDef> = {
  sea: { id: 'sea', name: 'Sea', color: '#24435e', food: 0, gold: 0, iron: 0, defense: 1, population: 0, naturalFort: 0 },
  plains: { id: 'plains', name: 'Plains', color: '#8fae5b', food: 3, gold: 2, iron: 0, defense: 1.0, population: 10, naturalFort: 0 },
  forest: { id: 'forest', name: 'Forest', color: '#4f7a3e', food: 1.5, gold: 1.5, iron: 0, defense: 1.25, population: 7, naturalFort: 0 },
  hills: { id: 'hills', name: 'Hills', color: '#a39563', food: 1.5, gold: 1.5, iron: 1.5, defense: 1.35, population: 7, naturalFort: 1 },
  mountains: { id: 'mountains', name: 'Mountains', color: '#8a8580', food: 0.5, gold: 1, iron: 2.5, defense: 1.7, population: 4, naturalFort: 1 },
  desert: { id: 'desert', name: 'Desert', color: '#d8c38a', food: 0.5, gold: 1.5, iron: 0.5, defense: 1.1, population: 4, naturalFort: 0 },
  tundra: { id: 'tundra', name: 'Tundra', color: '#c9d3d6', food: 1, gold: 1, iron: 0.5, defense: 1.15, population: 4, naturalFort: 0 },
};

export const DEPOSITS: Record<DepositId, { name: string; food: number; gold: number; iron: number }> = {
  iron: { name: 'Iron deposits', food: 0, gold: 0, iron: 3 },
  gold: { name: 'Gold veins', food: 0, gold: 3, iron: 0 },
  fertile: { name: 'Fertile soil', food: 3, gold: 0.5, iron: 0 },
};
