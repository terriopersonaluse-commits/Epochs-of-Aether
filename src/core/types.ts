// Authoritative game-state model. Everything here must be plain JSON-serialisable data.

export const SAVE_VERSION = 1;

export type TerrainId = 'sea' | 'plains' | 'forest' | 'hills' | 'mountains' | 'desert' | 'tundra';
export type UnitId = 'infantry' | 'archers' | 'cavalry' | 'siege';
export type CivId = 'human' | 'dwarven' | 'elven' | 'orcish' | 'merchant' | 'nomad';
export type DepositId = 'iron' | 'gold' | 'fertile';

export type UnitCounts = Record<UnitId, number>;

export interface Settings {
  countryCount: number;
  /** Turns before AI nations may declare their first wars. */
  graceTurns: number;
}

export interface WorldMap {
  width: number;
  height: number;
  /** Index into TERRAIN_ORDER for every tile, row-major. */
  terrain: number[];
  /** Province id for every tile, -1 for sea. */
  province: number[];
}

export interface Province {
  id: number;
  name: string;
  terrain: TerrainId;
  deposit: DepositId | null;
  tileCount: number;
  /** Representative tile (inside the province) used to draw tokens and labels. */
  cx: number;
  cy: number;
  coastal: boolean;
  population: number;
  owner: number | null;
  fort: number;
  /** Land neighbours plus strait neighbours, sorted. */
  neighbors: number[];
  /** Subset of neighbours reached across a sea strait. */
  straits: number[];
  siege: { by: number; progress: number } | null;
}

export interface Personality {
  /** 0 = pacifist, 1 = warmonger. */
  aggression: number;
  /** 0 = reckless, 1 = very risk-averse. */
  caution: number;
}

export interface Resources {
  gold: number;
  food: number;
  iron: number;
}

export interface Country {
  id: number;
  name: string;
  color: string;
  civ: CivId;
  personality: Personality;
  capital: number;
  treasury: Resources;
  manpower: number;
  warExhaustion: number;
  alive: boolean;
  isPlayer: boolean;
  /** Last turn's net income, kept for display and AI budgeting. */
  lastIncome: Resources;
  lastExpenses: Resources;
}

export interface Army {
  id: number;
  owner: number;
  province: number;
  units: UnitCounts;
  /** 0..1 */
  morale: number;
  /** Remaining provinces to walk through, first element is the next step. */
  path: number[];
}

export interface RecruitOrder {
  country: number;
  province: number;
  unit: UnitId;
  count: number;
  completesOnTurn: number;
}

export interface War {
  a: number;
  b: number;
  startTurn: number;
  /** War score earned by a and by b. */
  scoreA: number;
  scoreB: number;
  battles: number;
}

export interface Truce {
  a: number;
  b: number;
  untilTurn: number;
}

export interface PeaceOffer {
  from: number;
  to: number;
  turn: number;
}

export type EventType =
  | 'start' | 'war' | 'peace' | 'battle' | 'capture' | 'colonize'
  | 'eliminated' | 'capital' | 'shortage' | 'victory' | 'recruit' | 'info';

export interface HistoryEvent {
  turn: number;
  type: EventType;
  text: string;
  participants: number[];
  province?: number;
  /** 'public' events are known to everyone; otherwise only to participants. */
  visibility: 'public' | 'participants';
}

export interface GameState {
  version: number;
  seed: number;
  rng: number;
  turn: number;
  settings: Settings;
  map: WorldMap;
  provinces: Province[];
  countries: Country[];
  armies: Army[];
  nextArmyId: number;
  recruitment: RecruitOrder[];
  wars: War[];
  truces: Truce[];
  peaceOffers: PeaceOffer[];
  log: HistoryEvent[];
  winner: number | null;
}
