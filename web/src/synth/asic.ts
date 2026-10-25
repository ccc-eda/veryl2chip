// Die views for the ASIC flow: standard-cell rows, IO pins, global routes,
// routing congestion and timing heat.

import type { Box, Line, Scene, Text } from '../view/canvas';
import type { JNetlist } from './model';

export interface AsicResult {
  top: string;
  map: JNetlist;
  lib: { name: string; ins: string[]; width: number; delay: number; load: number; setup: number; area: number; verilog: string }[];
  counts: [string, number][];
  area: number;
  die: { w: number; h: number; rows: number; sites: number; util: number; row_h: number; site_w: number };
  /** per mapped cell: row, site, width (sites), arrival (ns), on the critical path */
  cells: [number, number, number, number, number][];
  pins: { name: string; dir: 'in' | 'out'; x: number; y: number }[];
  history: { temp: number; cost: number; accept: number; pos: number[] }[];
  route: {
    gx: number; gy: number; cap: number; iters: number[]; wirelength: number; vias: number; overflow: number;
    nets: { name: string; clock: boolean; len: number; vias: number; crit: boolean; segs: number[] }[];
  };
  timing: { period: number; fmax: number; endpoints: number; path: { what: string; delay: number; at: number }[] };
  verilog: string;
  def: string;
}

/** world units per µm */
export const S = 4;

export function stdColor(t: string): string {
  if (t.startsWith('DFF')) return '#d08770';
  if (t === 'MUX2') return '#ebcb8b';
  if (t === 'BUF') return '#8fbcbb';
  if (t === 'INV') return '#a3be8c';
  if (t.startsWith('TIE')) return '#7f8c9a';
  if (t.startsWith('X')) return '#c39bd3';
  if (t.endsWith('AND2')) return '#6aa1d4';
  if (t.endsWith('OR2')) return '#7ec3ff';
  return '#b48ead'; // AOI21 / OAI21
}

/** ids: cells 0..n-1, pins n.. */
export function dieScene(r: AsicResult, pos?: number[], colorOf?: (i: number) => string): Scene {
  const d = r.die;
  const H = d.h * S;
  const bg = [{ x: -2, y: -2, w: d.w * S + 4, h: H + 4, fill: '#2a3441' }];
  for (let row = 0; row < d.rows; row++) bg.push({ x: 0, y: H - (row + 1) * d.row_h * S, w: d.w * S, h: d.row_h * S, fill: row % 2 ? '#1f2833' : '#222c38' });
  const boxes: Box[] = r.cells.map(([row, site, w], i) => {
    const [rr, ss] = pos ? [pos[2 * i], pos[2 * i + 1]] : [row, site];
    return {
      id: i, x: ss * d.site_w * S + 0.25, y: H - (rr + 1) * d.row_h * S + 0.6, w: w * d.site_w * S - 0.5, h: d.row_h * S - 1.2,
      fill: colorOf ? colorOf(i) : stdColor(r.map.cells[i].t),
    };
  });
  const texts: Text[] = [];
  const n = r.cells.length;
  r.pins.forEach((p, k) => {
    const x = p.x * S, y = H - p.y * S;
    boxes.push({ id: n + k, x: x - 2.5, y: y - 2.5, w: 5, h: 5, fill: p.dir === 'in' ? '#57c27a' : '#e06c75', stroke: '#0f1318' });
    if (r.pins.length <= 120) {
      const left = p.x <= 0, right = p.x >= d.w, bottom = p.y <= 0;
      texts.push({
        x: left ? x - 5 : right ? x + 5 : x, y: left || right ? y : bottom ? y + 9 : y - 6, s: p.name,
        color: p.dir === 'in' ? '#8fe0a8' : '#f0a0a8', size: 8, align: left ? 'right' : right ? 'left' : 'center',
      });
    }
  });
  return { bg, boxes, lines: [], texts };
}

/** gcell centre in world units (gcells are one row high and as wide) */
function gc(r: AsicResult, x: number, y: number): [number, number] {
  const g = r.die.row_h * S;
  return [(x + 0.5) * g, r.die.h * S - (y + 0.5) * g];
}

/** usage of each gcell edge: horizontal and vertical, indexed y * gx + x */
export function edgeUse(r: AsicResult): { h: Uint16Array; v: Uint16Array } {
  const { gx, gy } = r.route;
  const h = new Uint16Array(gx * gy), v = new Uint16Array(gx * gy);
  for (const n of r.route.nets) {
    const s = n.segs;
    for (let i = 0; i < s.length; i += 4) {
      const [x0, y0, x1, y1] = [s[i], s[i + 1], s[i + 2], s[i + 3]];
      if (y0 === y1) h[y0 * gx + Math.min(x0, x1)]++;
      else v[Math.min(y0, y1) * gx + x0]++;
    }
  }
  return { h, v };
}

/** gcells shaded by their busiest edge (relative to the track capacity) */
export function congestion(r: AsicResult): { x: number; y: number; w: number; h: number; fill: string }[] {
  const { gx, gy, cap } = r.route;
  const u = edgeUse(r);
  const g = r.die.row_h * S;
  const out = [];
  for (let y = 0; y < gy; y++) for (let x = 0; x < gx; x++) {
    const k = y * gx + x;
    const m = Math.max(u.h[k], u.v[k], x ? u.h[k - 1] : 0, y ? u.v[k - gx] : 0) / cap;
    if (m < 0.25) continue;
    const [cx, cy] = gc(r, x, y);
    out.push({ x: cx - g / 2, y: cy - g / 2, w: g, h: g, fill: `hsla(${120 - 120 * Math.min(m, 1)}, 70%, 45%, ${0.15 + 0.35 * Math.min(m, 1)})` });
  }
  return out;
}

export function asicRouteLines(r: AsicResult, opts: { dim?: boolean; net?: number | null }): Line[] {
  const out: Line[] = [], top: Line[] = [];
  r.route.nets.forEach((n, ni) => {
    const s = n.segs;
    const sel = opts.net === ni;
    for (let i = 0; i < s.length; i += 4) {
      const [ax, ay] = gc(r, s[i], s[i + 1]), [bx, by] = gc(r, s[i + 2], s[i + 3]);
      const pts = [ax, ay, bx, by];
      if (opts.dim && n.crit) top.push({ pts, color: '#ff5c5c', width: 2.4 });
      else if (sel) top.push({ pts, color: '#ffd479', width: 2.4 });
      else if (opts.dim) out.push({ pts, color: 'rgba(126,150,180,0.15)', width: 0.8 });
      else out.push({ pts, color: n.clock ? 'rgba(87,194,122,0.8)' : s[i + 1] === s[i + 3] ? 'rgba(94,159,214,0.55)' : 'rgba(180,142,173,0.6)', width: 0.9 });
    }
  });
  return out.concat(top);
}
