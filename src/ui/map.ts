// Canvas map: a cached base layer (terrain, political colours, borders) plus per-frame overlays.
import { hash01 } from '../core/rng.ts';
import type { Army, GameState } from '../core/types.ts';
import { TERRAIN, TERRAIN_ORDER } from '../data/terrain.ts';
import { totalRegiments } from '../data/units.ts';

export const TS = 12; // base pixels per tile

export interface Overlay {
  player: number | null;
  visible: Set<number> | null; // null = see everything
  selectedProvince: number | null;
  selectedArmy: number | null;
  highlightCountry: number | null;
}

export interface Hit { kind: 'army'; army: Army; x: number; y: number; r: number }

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function shade([r, g, b]: [number, number, number], f: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * f)));
  return `rgb(${c(r)},${c(g)},${c(b)})`;
}

export class MapView {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private base: HTMLCanvasElement;
  private state: GameState | null = null;
  private seaDepth: Int8Array | null = null;
  private provinceEdges: Float32Array[] = [];
  private countryLabels: { id: number; x: number; y: number; tiles: number }[] = [];
  political = true;
  scale = 1;
  ox = 0;
  oy = 0;
  hits: Hit[] = [];
  private dpr = 1;
  private dirty = true;
  /** Once the player pans, zooms or focuses somewhere, resizes keep their view. */
  userMoved = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.base = document.createElement('canvas');
    const loop = () => {
      if (this.dirty && this.state) this.draw();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  overlay: Overlay = { player: null, visible: null, selectedProvince: null, selectedArmy: null, highlightCountry: null };

  invalidate(): void { this.dirty = true; }

  resize(): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const r = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.max(1, Math.round(r.width * this.dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * this.dpr));
    if (this.userMoved) this.clampCamera(); else this.fitToScreen();
    this.dirty = true;
  }

  /** Call when a new world is loaded. */
  setWorld(state: GameState): void {
    this.state = state;
    const { width: W, height: H, province } = state.map;
    this.base.width = W * TS;
    this.base.height = H * TS;
    // Distance from land for sea shading.
    const depth = new Int8Array(W * H).fill(-1);
    const queue: number[] = [];
    for (let i = 0; i < W * H; i++) if (province[i] >= 0) { depth[i] = 0; queue.push(i); }
    for (let q = 0; q < queue.length; q++) {
      const i = queue[q], x = i % W, y = (i / W) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        if (depth[j] === -1 && depth[i] < 8) { depth[j] = depth[i] + 1; queue.push(j); }
      }
    }
    this.seaDepth = depth;
    // Outline segments of every province, for selection highlighting.
    const segs: number[][] = state.provinces.map(() => []);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const p = province[y * W + x];
        if (p < 0) continue;
        const at = (xx: number, yy: number) => (xx < 0 || yy < 0 || xx >= W || yy >= H ? -1 : province[yy * W + xx]);
        if (at(x - 1, y) !== p) segs[p].push(x, y, x, y + 1);
        if (at(x + 1, y) !== p) segs[p].push(x + 1, y, x + 1, y + 1);
        if (at(x, y - 1) !== p) segs[p].push(x, y, x + 1, y);
        if (at(x, y + 1) !== p) segs[p].push(x, y + 1, x + 1, y + 1);
      }
    }
    this.provinceEdges = segs.map((s) => new Float32Array(s));
    this.renderBase();
    this.userMoved = false;
    this.fitToScreen();
  }

  fitToScreen(): void {
    if (!this.state) return;
    const cw = this.canvas.width, ch = this.canvas.height;
    this.scale = Math.min(cw / this.base.width, ch / this.base.height) * 1.0;
    this.ox = (cw - this.base.width * this.scale) / 2;
    this.oy = (ch - this.base.height * this.scale) / 2;
    this.dirty = true;
  }

  /** Re-draw the cached layer. Call after ownership changes (each turn). */
  renderBase(): void {
    const s = this.state;
    if (!s) return;
    const g = this.base.getContext('2d')!;
    const { width: W, height: H, province, terrain } = s.map;
    const sea = hexToRgb(TERRAIN.sea.color);
    const countryRgb = s.countries.map((c) => hexToRgb(c.color));
    const labelAcc = s.countries.map(() => ({ x: 0, y: 0, n: 0 }));

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const p = province[i];
        const jitter = 0.94 + hash01(s.seed, x, y) * 0.12;
        if (p < 0) {
          const d = this.seaDepth ? this.seaDepth[i] : 4;
          g.fillStyle = shade(sea, (d === 1 ? 1.35 : d === 2 ? 1.18 : d === -1 ? 0.8 : 1.05 - d * 0.03) * (0.98 + hash01(s.seed, x, y) * 0.04));
          g.fillRect(x * TS, y * TS, TS, TS);
          continue;
        }
        const t = TERRAIN[TERRAIN_ORDER[terrain[i]]];
        let rgb = hexToRgb(t.color);
        const owner = s.provinces[p].owner;
        if (owner !== null) {
          labelAcc[owner].x += x; labelAcc[owner].y += y; labelAcc[owner].n++;
          if (this.political) {
            const oc = countryRgb[owner];
            const a = 0.5;
            rgb = [rgb[0] * (1 - a) + oc[0] * a, rgb[1] * (1 - a) + oc[1] * a, rgb[2] * (1 - a) + oc[2] * a];
          }
        } else if (this.political) {
          rgb = [rgb[0] * 0.8 + 30, rgb[1] * 0.8 + 30, rgb[2] * 0.8 + 30];
        }
        g.fillStyle = shade(rgb, jitter);
        g.fillRect(x * TS, y * TS, TS, TS);
        this.drawGlyph(g, TERRAIN_ORDER[terrain[i]], x, y, s.seed);
      }
    }

    // Borders: thin between provinces, heavy between realms, inked coastline.
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const p = province[y * W + x];
        const edge = (q: number, x0: number, y0: number, x1: number, y1: number) => {
          if (p === q) return;
          if (p < 0 && q < 0) return;
          if (p < 0 || q < 0) { g.strokeStyle = 'rgba(14,20,28,0.75)'; g.lineWidth = 1.6; }
          else if (s.provinces[p].owner !== s.provinces[q].owner) { g.strokeStyle = 'rgba(12,14,20,0.9)'; g.lineWidth = 2.6; }
          else { g.strokeStyle = 'rgba(20,24,30,0.32)'; g.lineWidth = 1; }
          g.beginPath();
          g.moveTo(x0 * TS, y0 * TS);
          g.lineTo(x1 * TS, y1 * TS);
          g.stroke();
        };
        if (x + 1 < W) edge(province[y * W + x + 1], x + 1, y, x + 1, y + 1);
        if (y + 1 < H) edge(province[(y + 1) * W + x], x, y + 1, x + 1, y + 1);
      }
    }

    // Straits: dashed sea lanes.
    g.setLineDash([4, 4]);
    g.strokeStyle = 'rgba(225,215,190,0.55)';
    g.lineWidth = 1.5;
    for (const p of s.provinces) {
      for (const q of p.straits) {
        if (q < p.id) continue;
        const o = s.provinces[q];
        g.beginPath();
        g.moveTo((p.cx + 0.5) * TS, (p.cy + 0.5) * TS);
        g.lineTo((o.cx + 0.5) * TS, (o.cy + 0.5) * TS);
        g.stroke();
      }
    }
    g.setLineDash([]);

    this.countryLabels = labelAcc
      .map((a, id) => ({ id, x: ((a.x / Math.max(1, a.n)) + 0.5) * TS, y: ((a.y / Math.max(1, a.n)) + 0.5) * TS, tiles: a.n }))
      .filter((l) => l.tiles > 0);
    this.dirty = true;
  }

  private drawGlyph(g: CanvasRenderingContext2D, t: string, x: number, y: number, seed: number): void {
    const r = hash01(seed + 3, x, y);
    if (r > 0.55) return;
    const px = x * TS, py = y * TS;
    g.lineWidth = 1;
    if (t === 'mountains') {
      g.strokeStyle = 'rgba(40,36,34,0.55)';
      g.fillStyle = 'rgba(240,236,228,0.35)';
      g.beginPath();
      g.moveTo(px + 2, py + TS - 2);
      g.lineTo(px + TS / 2, py + 2);
      g.lineTo(px + TS - 2, py + TS - 2);
      g.fill();
      g.stroke();
    } else if (t === 'hills') {
      g.strokeStyle = 'rgba(60,50,30,0.45)';
      g.beginPath();
      g.arc(px + TS / 2, py + TS - 2, TS / 3, Math.PI * 1.1, Math.PI * 1.9);
      g.stroke();
    } else if (t === 'forest') {
      g.fillStyle = 'rgba(24,52,26,0.55)';
      g.beginPath();
      g.moveTo(px + TS / 2, py + 2);
      g.lineTo(px + TS - 3, py + TS - 3);
      g.lineTo(px + 3, py + TS - 3);
      g.fill();
    } else if (t === 'desert' && r < 0.25) {
      g.fillStyle = 'rgba(150,120,60,0.4)';
      g.fillRect(px + 3, py + 6, 5, 1);
    } else if (t === 'tundra' && r < 0.3) {
      g.fillStyle = 'rgba(255,255,255,0.5)';
      g.fillRect(px + 4, py + 4, 2, 2);
    }
  }

  // ------------------------------------------------------------- camera

  zoomAt(sx: number, sy: number, factor: number): void {
    const min = Math.min(this.canvas.width / this.base.width, this.canvas.height / this.base.height) * 0.8;
    const next = Math.max(min, Math.min(6 * this.dpr, this.scale * factor));
    const f = next / this.scale;
    this.ox = sx - (sx - this.ox) * f;
    this.oy = sy - (sy - this.oy) * f;
    this.scale = next;
    this.userMoved = true;
    this.clampCamera();
    this.dirty = true;
  }

  pan(dx: number, dy: number): void {
    this.ox += dx;
    this.oy += dy;
    this.userMoved = true;
    this.clampCamera();
    this.dirty = true;
  }

  private clampCamera(): void {
    const w = this.base.width * this.scale, h = this.base.height * this.scale;
    const cw = this.canvas.width, ch = this.canvas.height;
    const mx = cw * 0.5, my = ch * 0.5;
    this.ox = Math.min(mx, Math.max(cw - w - mx, this.ox));
    this.oy = Math.min(my, Math.max(ch - h - my, this.oy));
  }

  centerOn(provinceId: number): void {
    if (!this.state) return;
    const p = this.state.provinces[provinceId];
    if (this.scale < 1.6 * this.dpr) this.scale = 1.6 * this.dpr;
    this.userMoved = true;
    this.ox = this.canvas.width / 2 - (p.cx + 0.5) * TS * this.scale;
    this.oy = this.canvas.height * 0.35 - (p.cy + 0.5) * TS * this.scale;
    this.clampCamera();
    this.dirty = true;
  }

  /** Province under a point in CSS pixels, or null for sea. */
  provinceAt(cssX: number, cssY: number): number | null {
    if (!this.state) return null;
    const bx = (cssX * this.dpr - this.ox) / this.scale, by = (cssY * this.dpr - this.oy) / this.scale;
    const tx = Math.floor(bx / TS), ty = Math.floor(by / TS);
    const { width: W, height: H } = this.state.map;
    if (tx < 0 || ty < 0 || tx >= W || ty >= H) return null;
    const p = this.state.map.province[ty * W + tx];
    return p >= 0 ? p : null;
  }

  armyAt(cssX: number, cssY: number): Army | null {
    const x = cssX * this.dpr, y = cssY * this.dpr;
    let best: Hit | null = null;
    for (const h of this.hits) {
      const d = Math.hypot(h.x - x, h.y - y);
      if (d <= h.r + 6 * this.dpr && (!best || d < Math.hypot(best.x - x, best.y - y))) best = h;
    }
    return best?.army ?? null;
  }

  get pixelRatio() { return this.dpr; }

  // ------------------------------------------------------------- frame

  private toScreen(tx: number, ty: number): [number, number] {
    return [this.ox + (tx + 0.5) * TS * this.scale, this.oy + (ty + 0.5) * TS * this.scale];
  }

  private draw(): void {
    const s = this.state!;
    const g = this.ctx;
    const ov = this.overlay;
    this.dirty = false;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#16202b';
    g.fillRect(0, 0, this.canvas.width, this.canvas.height);
    g.imageSmoothingEnabled = this.scale < 1;
    g.drawImage(this.base, this.ox, this.oy, this.base.width * this.scale, this.base.height * this.scale);
    const k = TS * this.scale;
    const dpr = this.dpr;

    // Highlighted country (soft wash) and selected province outline.
    if (ov.highlightCountry !== null) {
      g.strokeStyle = 'rgba(255,240,200,0.6)';
      g.lineWidth = 2 * dpr;
      for (const p of s.provinces) if (p.owner === ov.highlightCountry) this.strokeEdges(p.id);
    }
    if (ov.selectedProvince !== null) {
      g.strokeStyle = '#ffe9a8';
      g.lineWidth = 3 * dpr;
      this.strokeEdges(ov.selectedProvince);
    }

    // Sieges and colonisation in progress.
    for (const p of s.provinces) {
      if (!p.siege) continue;
      if (ov.visible && !ov.visible.has(p.id)) continue;
      const [x, y] = this.toScreen(p.cx, p.cy);
      const required = p.owner === null ? 2 : 1 + p.fort * 2;
      const frac = Math.min(1, p.siege.progress / required);
      const r = Math.max(10 * dpr, k * 1.1);
      g.lineWidth = 3 * dpr;
      g.strokeStyle = 'rgba(0,0,0,0.45)';
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.stroke();
      g.strokeStyle = p.owner === null ? '#9fd0a6' : '#e8735f';
      g.beginPath(); g.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2); g.stroke();
    }

    // Capitals.
    for (const c of s.countries) {
      if (!c.alive) continue;
      const p = s.provinces[c.capital];
      const [x, y] = this.toScreen(p.cx, p.cy - 1.1);
      this.star(x, y, Math.max(4 * dpr, k * 0.45));
    }

    // Labels.
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const fell = '"IM Fell English SC", Georgia, serif';
    if (this.scale / dpr < 2.4) {
      for (const l of this.countryLabels) {
        const c = s.countries[l.id];
        const size = Math.max(10 * dpr, Math.min(26 * dpr, Math.sqrt(l.tiles) * 1.2 * this.scale));
        g.font = `${size}px ${fell}`;
        const name = c.name.replace(/^.* of /, '');
        g.lineWidth = 3 * dpr;
        g.strokeStyle = 'rgba(10,12,16,0.75)';
        g.strokeText(name, this.ox + l.x * this.scale, this.oy + l.y * this.scale);
        g.fillStyle = '#f3ead2';
        g.fillText(name, this.ox + l.x * this.scale, this.oy + l.y * this.scale);
      }
    } else {
      g.font = `${Math.min(15 * dpr, k * 0.75)}px ${fell}`;
      for (const p of s.provinces) {
        const [x, y] = this.toScreen(p.cx, p.cy + 1.3);
        g.lineWidth = 3 * dpr;
        g.strokeStyle = 'rgba(10,12,16,0.7)';
        g.strokeText(p.name, x, y);
        g.fillStyle = '#f3ead2';
        g.fillText(p.name, x, y);
      }
    }

    // Selected army's planned march.
    const sel = ov.selectedArmy !== null ? s.armies.find((a) => a.id === ov.selectedArmy) : undefined;
    if (sel && sel.path.length) {
      g.strokeStyle = '#ffe9a8';
      g.lineWidth = 2.5 * dpr;
      g.setLineDash([6 * dpr, 5 * dpr]);
      g.beginPath();
      const start = s.provinces[sel.province];
      g.moveTo(...this.toScreen(start.cx, start.cy));
      for (const step of sel.path) g.lineTo(...this.toScreen(s.provinces[step].cx, s.provinces[step].cy));
      g.stroke();
      g.setLineDash([]);
      const end = s.provinces[sel.path[sel.path.length - 1]];
      const [ex, ey] = this.toScreen(end.cx, end.cy);
      g.fillStyle = '#ffe9a8';
      g.beginPath(); g.arc(ex, ey, 4 * dpr, 0, Math.PI * 2); g.fill();
    }

    // Army banners.
    this.hits = [];
    const byProvince = new Map<number, Army[]>();
    for (const a of s.armies) {
      if (ov.visible && a.owner !== ov.player && !ov.visible.has(a.province)) continue;
      const list = byProvince.get(a.province) ?? [];
      list.push(a);
      byProvince.set(a.province, list);
    }
    const r = Math.max(9 * dpr, Math.min(16 * dpr, k * 0.7));
    g.font = `600 ${Math.round(r * 0.95)}px "Alegreya Sans", system-ui, sans-serif`;
    for (const [pid, list] of byProvince) {
      const p = s.provinces[pid];
      const [cx, cy] = this.toScreen(p.cx, p.cy);
      list.forEach((a, i) => {
        const x = cx + (i - (list.length - 1) / 2) * r * 2.3;
        const y = cy;
        const c = s.countries[a.owner];
        const selected = a.id === ov.selectedArmy;
        g.fillStyle = 'rgba(0,0,0,0.4)';
        g.beginPath(); g.arc(x + dpr, y + 1.5 * dpr, r, 0, Math.PI * 2); g.fill();
        g.fillStyle = c.color;
        g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
        g.lineWidth = (selected ? 3 : 1.5) * dpr;
        g.strokeStyle = selected ? '#ffe9a8' : a.owner === ov.player ? '#f3ead2' : 'rgba(10,12,16,0.85)';
        g.stroke();
        g.fillStyle = '#fff';
        g.fillText(String(totalRegiments(a.units)), x, y + dpr);
        // morale pip
        g.fillStyle = a.morale > 0.66 ? '#8fd19e' : a.morale > 0.33 ? '#e7c35a' : '#e8735f';
        g.beginPath(); g.arc(x + r * 0.75, y - r * 0.75, r * 0.28, 0, Math.PI * 2); g.fill();
        this.hits.push({ kind: 'army', army: a, x, y, r });
      });
    }
  }

  private strokeEdges(pid: number): void {
    const e = this.provinceEdges[pid];
    if (!e) return;
    const g = this.ctx;
    const k = TS * this.scale;
    g.beginPath();
    for (let i = 0; i < e.length; i += 4) {
      g.moveTo(this.ox + e[i] * k, this.oy + e[i + 1] * k);
      g.lineTo(this.ox + e[i + 2] * k, this.oy + e[i + 3] * k);
    }
    g.stroke();
  }

  private star(x: number, y: number, r: number): void {
    const g = this.ctx;
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const rr = i % 2 ? r * 0.45 : r;
      g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    g.closePath();
    g.fillStyle = '#f5d77a';
    g.fill();
    g.lineWidth = Math.max(1, r * 0.18);
    g.strokeStyle = 'rgba(30,22,8,0.9)';
    g.stroke();
  }
}
