// Seeded, serialisable random numbers (mulberry32). The generator state lives in GameState.rng.

export interface RngHolder {
  rng: number;
}

export function nextFloat(h: RngHolder): number {
  h.rng = (h.rng + 0x6d2b79f5) | 0;
  let t = h.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function nextInt(h: RngHolder, min: number, maxInclusive: number): number {
  return min + Math.floor(nextFloat(h) * (maxInclusive - min + 1));
}

export function chance(h: RngHolder, p: number): boolean {
  return nextFloat(h) < p;
}

export function pick<T>(h: RngHolder, items: readonly T[]): T {
  return items[Math.floor(nextFloat(h) * items.length)];
}

export function shuffle<T>(h: RngHolder, items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(nextFloat(h) * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

/** Stateless hash to a float in [0,1). Used where a value must be stable without consuming rng. */
export function hash01(...parts: number[]): number {
  let h = 2166136261;
  for (const p of parts) {
    h ^= p | 0;
    h = Math.imul(h, 16777619);
    h ^= h >>> 13;
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
