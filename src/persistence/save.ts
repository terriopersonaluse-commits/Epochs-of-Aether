// Versioned, validated save files. Pure functions: no browser APIs here.
import { SAVE_VERSION, type GameState } from '../core/types.ts';
import { CIVS } from '../data/civs.ts';
import { TERRAIN, TERRAIN_ORDER } from '../data/terrain.ts';
import { UNIT_ORDER } from '../data/units.ts';

export const SAVE_FORMAT = 'epochs-of-aether-save';

export interface SaveFile {
  format: typeof SAVE_FORMAT;
  version: number;
  savedAt: string;
  label: string;
  state: GameState;
}

export function serializeSave(state: GameState, label = ''): string {
  const file: SaveFile = { format: SAVE_FORMAT, version: SAVE_VERSION, savedAt: new Date().toISOString(), label, state };
  return JSON.stringify(file);
}

/** Upgrade older save versions in place. Add a step here whenever SAVE_VERSION increases. */
const MIGRATIONS: Record<number, (s: any) => void> = {};

export type LoadResult = { ok: true; state: GameState; label: string; savedAt: string } | { ok: false; errors: string[] };

export function parseSave(text: string): LoadResult {
  let raw: any;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, errors: ['The save is not valid JSON (it may be truncated or corrupted).'] };
  }
  if (!raw || raw.format !== SAVE_FORMAT) return { ok: false, errors: ['This is not an Epochs of Aether save file.'] };
  if (typeof raw.version !== 'number' || raw.version > SAVE_VERSION) {
    return { ok: false, errors: [`Save version ${raw.version} is newer than this game (${SAVE_VERSION}). Update the game.`] };
  }
  for (let v = raw.version; v < SAVE_VERSION; v++) {
    const step = MIGRATIONS[v];
    if (!step) return { ok: false, errors: [`No migration from save version ${v}.`] };
    step(raw.state);
    raw.state.version = v + 1;
  }
  const errors = validateState(raw.state);
  if (errors.length) return { ok: false, errors };
  return { ok: true, state: raw.state as GameState, label: String(raw.label ?? ''), savedAt: String(raw.savedAt ?? '') };
}

const isInt = (v: unknown) => Number.isInteger(v);
const isNum = (v: unknown) => typeof v === 'number' && Number.isFinite(v);

/** Structural and referential checks. Returns a list of problems (empty when valid). */
export function validateState(s: any): string[] {
  const errors: string[] = [];
  const err = (m: string) => { if (errors.length < 25) errors.push(m); };
  if (!s || typeof s !== 'object') return ['Missing game state.'];
  if (s.version !== SAVE_VERSION) err('State version mismatch.');
  if (!isInt(s.seed) || !isInt(s.rng) || !isInt(s.turn) || s.turn < 1) err('Invalid seed, rng or turn.');
  const m = s.map;
  if (!m || !isInt(m.width) || !isInt(m.height)) return [...errors, 'Invalid map dimensions.'];
  const n = m.width * m.height;
  if (!Array.isArray(m.terrain) || m.terrain.length !== n) err('Terrain layer has the wrong size.');
  if (!Array.isArray(m.province) || m.province.length !== n) err('Province layer has the wrong size.');
  if (!Array.isArray(s.provinces) || !Array.isArray(s.countries) || !Array.isArray(s.armies)) {
    return [...errors, 'Missing provinces, countries or armies.'];
  }
  const P = s.provinces.length, C = s.countries.length;
  if (Array.isArray(m.terrain)) {
    m.terrain.forEach((t: unknown, i: number) => { if (!isInt(t) || (t as number) < 0 || (t as number) >= TERRAIN_ORDER.length) err(`Bad terrain at tile ${i}.`); });
  }
  if (Array.isArray(m.province)) {
    m.province.forEach((p: unknown, i: number) => { if (!isInt(p) || (p as number) < -1 || (p as number) >= P) err(`Bad province at tile ${i}.`); });
  }
  s.provinces.forEach((p: any, i: number) => {
    if (p?.id !== i) err(`Province ${i} has a mismatched id.`);
    if (!(p?.terrain in TERRAIN) || p.terrain === 'sea') err(`Province ${i} has invalid terrain.`);
    if (p.owner !== null && (!isInt(p.owner) || p.owner < 0 || p.owner >= C)) err(`Province ${i} has an invalid owner.`);
    if (!Array.isArray(p.neighbors) || p.neighbors.some((x: unknown) => !isInt(x) || (x as number) < 0 || (x as number) >= P || x === i)) err(`Province ${i} has invalid neighbours.`);
    else if (p.neighbors.some((x: number) => !s.provinces[x]?.neighbors?.includes(i))) err(`Province ${i} has a one-way neighbour link.`);
    if (!isInt(p.fort) || p.fort < 0) err(`Province ${i} has an invalid fort level.`);
    if (p.siege !== null && (!isInt(p.siege?.by) || !isNum(p.siege?.progress))) err(`Province ${i} has an invalid siege.`);
  });
  s.countries.forEach((c: any, i: number) => {
    if (c?.id !== i) err(`Country ${i} has a mismatched id.`);
    if (!(c?.civ in CIVS)) err(`Country ${i} has an unknown civilisation.`);
    if (!isInt(c.capital) || c.capital < 0 || c.capital >= P) err(`Country ${i} has an invalid capital.`);
    else if (c.alive && s.provinces[c.capital]?.owner !== i) err(`Country ${i} does not own its capital.`);
    for (const k of ['gold', 'food', 'iron']) if (!isNum(c.treasury?.[k]) || c.treasury[k] < 0) err(`Country ${i} has an invalid ${k} treasury.`);
    if (!isNum(c.manpower) || c.manpower < 0) err(`Country ${i} has invalid manpower.`);
  });
  if (s.countries.filter((c: any) => c.isPlayer).length > 1) err('More than one player nation.');
  const armyIds = new Set<number>();
  s.armies.forEach((a: any) => {
    if (!isInt(a?.id) || armyIds.has(a.id)) err('Duplicate or invalid army id.');
    armyIds.add(a?.id);
    if (!isInt(a.owner) || a.owner < 0 || a.owner >= C || !s.countries[a.owner]?.alive) err(`Army ${a.id} has an invalid owner.`);
    if (!isInt(a.province) || a.province < 0 || a.province >= P) err(`Army ${a.id} is in an invalid province.`);
    if (!UNIT_ORDER.every((u) => isInt(a.units?.[u]) && a.units[u] >= 0)) err(`Army ${a.id} has invalid units.`);
    if (!isNum(a.morale) || a.morale < 0 || a.morale > 1) err(`Army ${a.id} has invalid morale.`);
    if (!Array.isArray(a.path) || a.path.some((x: unknown) => !isInt(x) || (x as number) < 0 || (x as number) >= P)) err(`Army ${a.id} has an invalid path.`);
  });
  if (!isInt(s.nextArmyId) || [...armyIds].some((id) => id >= s.nextArmyId)) err('nextArmyId is behind existing armies.');
  for (const key of ['recruitment', 'wars', 'truces', 'peaceOffers', 'log']) if (!Array.isArray(s[key])) err(`Missing ${key}.`);
  (s.wars ?? []).forEach((w: any) => { if (!isInt(w?.a) || !isInt(w?.b) || w.a === w.b || w.a >= C || w.b >= C) err('Invalid war record.'); });
  return errors;
}
