import { hash01 } from '../core/rng.ts';

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Seeded 2D value noise in [0,1). */
export function valueNoise(seed: number, x: number, y: number): number {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = smooth(x - x0), fy = smooth(y - y0);
  const a = hash01(seed, x0, y0), b = hash01(seed, x0 + 1, y0);
  const c = hash01(seed, x0, y0 + 1), d = hash01(seed, x0 + 1, y0 + 1);
  return (a + (b - a) * fx) + ((c + (d - c) * fx) - (a + (b - a) * fx)) * fy;
}

/** Fractal value noise, roughly in [0,1). */
export function fbm(seed: number, x: number, y: number, octaves = 5): number {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += valueNoise(seed + o * 1013, x * freq, y * freq) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}
