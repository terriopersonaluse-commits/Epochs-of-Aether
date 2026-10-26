// Procedural world generation: terrain, provinces, countries and starting armies.
import { clamp, nextFloat, pick, shuffle, type RngHolder } from '../core/rng.ts';
import type { CivId, Country, GameState, Province, Settings, TerrainId, UnitCounts } from '../core/types.ts';
import { SAVE_VERSION } from '../core/types.ts';
import { CIVS } from '../data/civs.ts';
import { COUNTRY_COLORS, makeName, makeStateName } from '../data/names.ts';
import { TERRAIN, TERRAIN_ORDER } from '../data/terrain.ts';
import { UNIT_ORDER, emptyUnits } from '../data/units.ts';
import { fbm } from './noise.ts';

export const MAP_W = 80;
export const MAP_H = 52;

export const DEFAULT_SETTINGS: Settings = { countryCount: 10, graceTurns: 4 };

const T = (id: TerrainId) => TERRAIN_ORDER.indexOf(id);
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

// ---------------------------------------------------------------- terrain

function generateTerrain(seed: number, W: number, H: number): number[] {
  const elev = new Array<number>(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = (x / W - 0.5) * 2, dy = (y / H - 0.5) * 2;
      const d = Math.sqrt(dx * dx * 0.85 + dy * dy);
      let e = fbm(seed, x / 13, y / 13) - d * d * 0.5 + (fbm(seed + 7, x / 5, y / 5) - 0.5) * 0.12;
      if (x < 2 || y < 2 || x >= W - 2 || y >= H - 2) e = -1;
      elev[y * W + x] = e;
    }
  }
  const sorted = [...elev].sort((a, b) => a - b);
  const seaLevel = sorted[Math.floor(sorted.length * 0.5)];
  const land = elev.map((e) => e > seaLevel);

  // Remove tiny islands, fill tiny inland lakes.
  floodComponents(W, H, (i) => land[i]).forEach((comp) => {
    if (comp.length < 14) for (const i of comp) land[i] = false;
  });
  floodComponents(W, H, (i) => !land[i]).forEach((comp) => {
    const touchesEdge = comp.some((i) => {
      const x = i % W, y = (i / W) | 0;
      return x === 0 || y === 0 || x === W - 1 || y === H - 1;
    });
    if (!touchesEdge && comp.length < 10) for (const i of comp) land[i] = true;
  });

  const landIdx: number[] = [];
  for (let i = 0; i < W * H; i++) if (land[i]) landIdx.push(i);
  const landElev = landIdx.map((i) => elev[i]).sort((a, b) => a - b);
  const q = (p: number) => landElev[Math.min(landElev.length - 1, Math.floor(landElev.length * p))];
  const mountainLvl = q(0.9), hillLvl = q(0.75);
  const moist = landIdx.map((i) => fbm(seed + 99, (i % W) / 10, ((i / W) | 0) / 10));
  const moistSorted = [...moist].sort((a, b) => a - b);
  const mq = (p: number) => moistSorted[Math.floor(moistSorted.length * p)];
  const dryLvl = mq(0.3), wetLvl = mq(0.62);

  const terrain = new Array<number>(W * H).fill(T('sea'));
  landIdx.forEach((i, k) => {
    const x = i % W, y = (i / W) | 0;
    const temp = y / H + (fbm(seed + 55, x / 8, y / 8) - 0.5) * 0.3;
    const e = elev[i], m = moist[k];
    let t: TerrainId;
    if (e >= mountainLvl) t = 'mountains';
    else if (e >= hillLvl) t = 'hills';
    else if (temp < 0.17) t = 'tundra';
    else if (temp > 0.58 && m < dryLvl) t = 'desert';
    else if (m > wetLvl) t = 'forest';
    else t = 'plains';
    terrain[i] = T(t);
  });
  return terrain;
}

function floodComponents(W: number, H: number, inSet: (i: number) => boolean): number[][] {
  const seen = new Uint8Array(W * H);
  const comps: number[][] = [];
  for (let s = 0; s < W * H; s++) {
    if (seen[s] || !inSet(s)) continue;
    const comp: number[] = [];
    const stack = [s];
    seen[s] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      comp.push(i);
      const x = i % W, y = (i / W) | 0;
      for (const [dx, dy] of DIRS) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        if (!seen[j] && inSet(j)) {
          seen[j] = 1;
          stack.push(j);
        }
      }
    }
    comps.push(comp);
  }
  return comps;
}

// ---------------------------------------------------------------- provinces

const GROW_COST: Record<TerrainId, number> = { sea: 99, plains: 1, forest: 1.5, hills: 2, mountains: 3.2, desert: 1.4, tundra: 1.4 };

function assignProvinces(h: RngHolder, W: number, H: number, terrain: number[]): number[] {
  const isLand = (i: number) => terrain[i] !== T('sea');
  const comps = floodComponents(W, H, isLand);
  const landCount = comps.reduce((s, c) => s + c.length, 0);
  const target = clamp(Math.round(landCount / 36), 40, 80);
  const minDist = Math.sqrt(landCount / target) * 0.85;

  const seeds: number[] = [];
  const all = comps.flat();
  for (let attempt = 0; attempt < target * 60 && seeds.length < target; attempt++) {
    const i = pick(h, all);
    const x = i % W, y = (i / W) | 0;
    if (seeds.every((s) => Math.hypot((s % W) - x, ((s / W) | 0) - y) >= minDist)) seeds.push(i);
  }
  for (const comp of comps) {
    const set = new Set(comp);
    if (!seeds.some((s) => set.has(s))) seeds.push(comp[Math.floor(comp.length / 2)]);
  }

  // Multi-source Dijkstra so borders bend around mountains.
  const owner = new Array<number>(W * H).fill(-1);
  const dist = new Float64Array(W * H).fill(Infinity);
  const heap = new MinHeap();
  seeds.forEach((s, id) => {
    dist[s] = 0;
    owner[s] = id;
    heap.push(0, s);
  });
  while (heap.size) {
    const [d, i] = heap.pop();
    if (d > dist[i]) continue;
    const x = i % W, y = (i / W) | 0;
    for (const [dx, dy] of DIRS) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = ny * W + nx;
      if (!isLand(j)) continue;
      const nd = d + GROW_COST[TERRAIN_ORDER[terrain[j]]] + nextFloat(h) * 0.3;
      if (nd < dist[j]) {
        dist[j] = nd;
        owner[j] = owner[i];
        heap.push(nd, j);
      }
    }
  }

  // Merge slivers into a neighbour, then renumber compactly.
  for (let pass = 0; pass < 6; pass++) {
    const sizes = new Map<number, number>();
    for (const o of owner) if (o >= 0) sizes.set(o, (sizes.get(o) ?? 0) + 1);
    let changed = false;
    for (const [pid, size] of sizes) {
      if (size >= 8) continue;
      let into = -1;
      for (let i = 0; i < owner.length && into < 0; i++) {
        if (owner[i] !== pid) continue;
        const x = i % W, y = (i / W) | 0;
        for (const [dx, dy] of DIRS) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const o = owner[ny * W + nx];
          if (o >= 0 && o !== pid) { into = o; break; }
        }
      }
      if (into >= 0) {
        for (let i = 0; i < owner.length; i++) if (owner[i] === pid) owner[i] = into;
        changed = true;
      }
    }
    if (!changed) break;
  }
  const remap = new Map<number, number>();
  return owner.map((o) => {
    if (o < 0) return -1;
    if (!remap.has(o)) remap.set(o, remap.size);
    return remap.get(o)!;
  });
}

function buildProvinces(h: RngHolder, W: number, H: number, terrain: number[], pmap: number[]): Province[] {
  const count = Math.max(...pmap) + 1;
  const tiles: number[][] = Array.from({ length: count }, () => []);
  pmap.forEach((p, i) => { if (p >= 0) tiles[p].push(i); });
  const neigh: Set<number>[] = Array.from({ length: count }, () => new Set());
  const coastal = new Array<boolean>(count).fill(false);
  for (let i = 0; i < pmap.length; i++) {
    const p = pmap[i];
    if (p < 0) continue;
    const x = i % W, y = (i / W) | 0;
    for (const [dx, dy] of DIRS) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const q = pmap[ny * W + nx];
      if (q < 0) coastal[p] = true;
      else if (q !== p) neigh[p].add(q);
    }
  }

  const provinces: Province[] = tiles.map((ts, id) => {
    const counts = new Map<number, number>();
    let sx = 0, sy = 0;
    for (const i of ts) {
      counts.set(terrain[i], (counts.get(terrain[i]) ?? 0) + 1);
      sx += i % W;
      sy += (i / W) | 0;
    }
    const mx = sx / ts.length, my = sy / ts.length;
    let best = ts[0], bestD = Infinity;
    for (const i of ts) {
      const d = Math.hypot((i % W) - mx, ((i / W) | 0) - my);
      if (d < bestD) { bestD = d; best = i; }
    }
    const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const t = TERRAIN_ORDER[dominant];
    return {
      id, name: '', terrain: t, deposit: null, tileCount: ts.length,
      cx: best % W, cy: (best / W) | 0, coastal: coastal[id],
      population: 0, owner: null, fort: TERRAIN[t].naturalFort,
      neighbors: [...neigh[id]], straits: [], siege: null,
    };
  });

  // Connect separate land masses with straits so every province is reachable.
  for (let guard = 0; guard < 50; guard++) {
    const comp = graphComponents(provinces);
    if (comp.length <= 1) break;
    comp.sort((a, b) => b.length - a.length);
    const main = new Set(comp[0]);
    let best: [number, number, number] | null = null;
    for (const p of comp[1]) {
      for (const q of main) {
        if (!provinces[p].coastal || !provinces[q].coastal) continue;
        const d = Math.hypot(provinces[p].cx - provinces[q].cx, provinces[p].cy - provinces[q].cy);
        if (!best || d < best[2]) best = [p, q, d];
      }
    }
    if (!best) break;
    const [a, b] = best;
    provinces[a].neighbors.push(b);
    provinces[b].neighbors.push(a);
    provinces[a].straits.push(b);
    provinces[b].straits.push(a);
  }

  for (const p of provinces) {
    p.neighbors.sort((a, b) => a - b);
    p.straits.sort((a, b) => a - b);
    const roll = nextFloat(h);
    if ((p.terrain === 'hills' || p.terrain === 'mountains') && roll < 0.45) p.deposit = 'iron';
    else if ((p.terrain === 'desert' || p.terrain === 'hills') && roll < 0.65) p.deposit = 'gold';
    else if ((p.terrain === 'plains' || p.terrain === 'forest') && roll < 0.22) p.deposit = 'fertile';
    else if (roll > 0.94) p.deposit = 'gold';
    p.population = Math.max(2, Math.round(TERRAIN[p.terrain].population * (0.7 + nextFloat(h) * 0.6) * Math.sqrt(p.tileCount / 30)));
  }
  return provinces;
}

export function graphComponents(provinces: Province[]): number[][] {
  const seen = new Set<number>();
  const comps: number[][] = [];
  for (const p of provinces) {
    if (seen.has(p.id)) continue;
    const comp: number[] = [];
    const stack = [p.id];
    seen.add(p.id);
    while (stack.length) {
      const c = stack.pop()!;
      comp.push(c);
      for (const n of provinces[c].neighbors) if (!seen.has(n)) { seen.add(n); stack.push(n); }
    }
    comps.push(comp);
  }
  return comps;
}

// ---------------------------------------------------------------- countries

function chooseCiv(h: RngHolder, provinces: Province[], owned: number[], capital: number, used: Map<CivId, number>): CivId {
  const share = (t: TerrainId[]) => owned.filter((p) => t.includes(provinces[p].terrain)).length / owned.length;
  const options: [CivId, number][] = [
    ['human', 1],
    ['dwarven', 0.2 + share(['hills', 'mountains']) * 4],
    ['elven', 0.2 + share(['forest']) * 4],
    ['nomad', 0.15 + share(['plains', 'desert']) * 1.5 * (provinces[capital].coastal ? 0.5 : 1)],
    ['merchant', provinces[capital].coastal ? 1.3 : 0.2],
    ['orcish', 0.6 + share(['tundra', 'desert']) * 1.5],
  ];
  const weighted = options.map(([c, w]) => [c, w / (1 + (used.get(c) ?? 0) * 1.5)] as [CivId, number]);
  const total = weighted.reduce((s, [, w]) => s + w, 0);
  let r = nextFloat(h) * total;
  for (const [c, w] of weighted) {
    r -= w;
    if (r <= 0) return c;
  }
  return 'human';
}

function assignCountries(h: RngHolder, provinces: Province[], n: number): Country[] {
  const dist = (a: number, b: number) => Math.hypot(provinces[a].cx - provinces[b].cx, provinces[a].cy - provinces[b].cy);
  const good = provinces.filter((p) => p.terrain !== 'mountains' && p.terrain !== 'tundra').map((p) => p.id);
  const capitals: number[] = [pick(h, good.length ? good : provinces.map((p) => p.id))];
  while (capitals.length < n) {
    let best = -1, bestScore = -1;
    for (const p of good) {
      if (capitals.includes(p)) continue;
      const score = Math.min(...capitals.map((c) => dist(c, p))) * (0.85 + nextFloat(h) * 0.3);
      if (score > bestScore) { bestScore = score; best = p; }
    }
    if (best < 0) break;
    capitals.push(best);
  }

  const majors = Math.max(1, Math.round(capitals.length * 0.3));
  const weights = capitals.map((_, i) => (i < majors ? 2.6 : 1) * (0.8 + nextFloat(h) * 0.4));
  const totalTarget = Math.round(provinces.length * 0.8);
  const wsum = weights.reduce((a, b) => a + b, 0);
  const targets = weights.map((w) => Math.max(2, Math.round((w / wsum) * totalTarget)));
  shuffle(h, capitals); // so "major" isn't always the first-picked (map-corner) capital

  const ownerOf = new Array<number>(provinces.length).fill(-1);
  const owned: number[][] = capitals.map((c, i) => { ownerOf[c] = i; return [c]; });
  let progress = true;
  while (progress) {
    progress = false;
    for (let i = 0; i < capitals.length; i++) {
      if (owned[i].length >= targets[i]) continue;
      const frontier: number[] = [];
      for (const p of owned[i]) {
        for (const nb of provinces[p].neighbors) {
          if (ownerOf[nb] === -1 && !provinces[p].straits.includes(nb) && !frontier.includes(nb)) frontier.push(nb);
        }
      }
      if (!frontier.length) continue;
      frontier.sort((a, b) => dist(capitals[i], a) - dist(capitals[i], b));
      const choice = frontier[Math.min(frontier.length - 1, Math.floor(nextFloat(h) * Math.min(3, frontier.length)))];
      ownerOf[choice] = i;
      owned[i].push(choice);
      progress = true;
    }
  }

  const used = new Set<string>();
  const civCount = new Map<CivId, number>();
  return capitals.map((cap, id) => {
    const civ = chooseCiv(h, provinces, owned[id], cap, civCount);
    civCount.set(civ, (civCount.get(civ) ?? 0) + 1);
    const def = CIVS[civ];
    for (const p of owned[id]) provinces[p].owner = id;
    provinces[cap].fort += 2;
    provinces[cap].population += 4;
    const size = owned[id].length;
    return {
      id,
      name: makeStateName(h, def.nameStyle, used),
      color: COUNTRY_COLORS[id % COUNTRY_COLORS.length],
      civ,
      personality: {
        aggression: clamp(0.15 + nextFloat(h) * 0.7 + def.aggressionBias, 0.05, 0.95),
        caution: clamp(0.15 + nextFloat(h) * 0.7 + def.cautionBias, 0.05, 0.95),
      },
      capital: cap,
      treasury: { gold: 60 + size * 8, food: 30 + size * 4, iron: 10 + size * 2 },
      manpower: Math.round(size * 1500 * def.manpowerMult),
      warExhaustion: 0,
      alive: true,
      isPlayer: false,
      lastIncome: { gold: 0, food: 0, iron: 0 },
      lastExpenses: { gold: 0, food: 0, iron: 0 },
    };
  });
}

function startingUnits(h: RngHolder, civ: CivId, regiments: number): UnitCounts {
  const u = emptyUnits();
  const mix = CIVS[civ].armyMix;
  for (let r = 0; r < regiments; r++) {
    let roll = nextFloat(h);
    for (const id of UNIT_ORDER) {
      roll -= mix[id];
      if (roll <= 0) { u[id]++; break; }
    }
    if (roll > 0) u.infantry++;
  }
  if (u.infantry === 0) u.infantry = 1;
  return u;
}

// ---------------------------------------------------------------- entry point

export function generateWorld(seed: number, settings: Settings = DEFAULT_SETTINGS): GameState {
  const h: RngHolder = { rng: seed | 0 };
  const W = MAP_W, H = MAP_H;
  const terrain = generateTerrain(seed, W, H);
  const pmap = assignProvinces(h, W, H, terrain);
  const provinces = buildProvinces(h, W, H, terrain, pmap);
  const countries = assignCountries(h, provinces, clamp(settings.countryCount, 4, 14));

  const usedNames = new Set<string>(countries.map((c) => c.name));
  const styles = Object.values(CIVS).map((c) => c.nameStyle);
  for (const p of provinces) {
    const style = p.owner !== null ? CIVS[countries[p.owner].civ].nameStyle : pick(h, styles);
    p.name = makeName(h, style, usedNames);
  }

  const state: GameState = {
    version: SAVE_VERSION,
    seed,
    rng: h.rng,
    turn: 1,
    settings: { ...settings },
    map: { width: W, height: H, terrain, province: pmap },
    provinces,
    countries,
    armies: [],
    nextArmyId: 1,
    recruitment: [],
    wars: [],
    truces: [],
    peaceOffers: [],
    log: [],
    winner: null,
  };

  for (const c of countries) {
    const owned = provinces.filter((p) => p.owner === c.id);
    const regiments = 3 + Math.round(owned.length * 1.1);
    const first = Math.ceil(regiments * (owned.length >= 5 ? 0.6 : 1));
    state.armies.push({ id: state.nextArmyId++, owner: c.id, province: c.capital, units: startingUnits(h, c.civ, first), morale: 1, path: [] });
    if (regiments - first > 0) {
      const border = owned.find((p) => p.id !== c.capital && p.neighbors.some((n) => provinces[n].owner !== c.id)) ?? owned[owned.length - 1];
      state.armies.push({ id: state.nextArmyId++, owner: c.id, province: border.id, units: startingUnits(h, c.civ, regiments - first), morale: 1, path: [] });
    }
  }
  state.rng = h.rng;

  const wild = provinces.filter((p) => p.owner === null).length;
  state.log.push({
    turn: 1, type: 'start', participants: [], visibility: 'public',
    text: `The Age of Aether begins. ${countries.length} realms divide the continent; ${wild} provinces remain untamed wilds.`,
  });
  return state;
}

export function setPlayer(state: GameState, countryId: number | null): void {
  for (const c of state.countries) c.isPlayer = c.id === countryId;
}

// ---------------------------------------------------------------- utilities

class MinHeap {
  private keys: number[] = [];
  private vals: number[] = [];
  get size() { return this.keys.length; }
  push(k: number, v: number) {
    this.keys.push(k); this.vals.push(v);
    let i = this.keys.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p] <= this.keys[i]) break;
      this.swap(i, p);
      i = p;
    }
  }
  pop(): [number, number] {
    const top: [number, number] = [this.keys[0], this.vals[0]];
    const lk = this.keys.pop()!, lv = this.vals.pop()!;
    if (this.keys.length) {
      this.keys[0] = lk; this.vals[0] = lv;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < this.keys.length && this.keys[l] < this.keys[m]) m = l;
        if (r < this.keys.length && this.keys[r] < this.keys[m]) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }
  private swap(a: number, b: number) {
    [this.keys[a], this.keys[b]] = [this.keys[b], this.keys[a]];
    [this.vals[a], this.vals[b]] = [this.vals[b], this.vals[a]];
  }
}
