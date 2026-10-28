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
  die: { w: number; h: number; rows: number; sites: number; util: number; row_h: number; site_w: number; max_density: number; target_density: number };
  /** per mapped cell: row, site, width (sites), arrival (ns), on the critical path, height (rows; SRAM macros > 1) */
  cells: [number, number, number, number, number, number][];
  pins: { name: string; dir: 'in' | 'out'; x: number; y: number }[];
  history: { temp: number; cost: number; accept: number; pos: number[] }[];
  route: {
    gx: number; gy: number; cap: number; iters: number[]; wirelength: number; vias: number; overflow: number;
    nets: { name: string; clock: boolean; len: number; vias: number; crit: boolean; segs: number[] }[];
  };
  detail: {
    nx: number; ny: number; tracks: number; wirelength: number; vias: number; conflicts: number; opens: number;
    iters: number[]; per_layer: number[]; segments: number;
    /** per net: segs flat (layer, x0, y0, x1, y1) and vias flat (lower layer, x, y), in track units; empty when too large */
    nets: { name: string; len: number; segs: number[]; vias: number[] }[];
  };
  /** power grid: rail count (row boundaries), straps (track x, VDD?), fillers flat (row, site, width) */
  pdn: { rails: number; strap_w: number; vias: number; straps: [number, boolean][]; fillers: number[] };
  power: {
    freq: number; e_nets: number; e_clock: number; e_internal: number; e_sram: number; dynamic: number; leakage: number; total: number;
    ir_worst: number; cycles: number;
    /** per cell: average power (µW) and IR drop (mV) */
    cell: number[]; ir: number[];
  };
  cts: { buffers: number; hold_bufs: number; trees: { net: string; sinks: number; buffers: number; levels: number }[] };
  timing: { period: number; fmax: number; fmax_wl: number; fmax_ideal: number; insertion: number; skew: number; hold_slack: number; endpoints: number; path: { what: string; delay: number; at: number }[];
    /** against the timing constraints (.sdc / the target clock), when there are any */
    slack?: { wns: number; tns: number; failing: number; checked: number; worst: string; clocks: { name: string; period: number; endpoints: number }[] } | null };
  /** the timing repair (with constraints): cells made stronger, buffers added, the worst slack before */
  repair?: { upsized: number; buffers: number; before: number | null };
  /** the parasitics the final timing used (a library technology): nets, wire capacitance (pF), the longest wire delay (ns) */
  extraction?: { nets: number; cap: number; worst: number } | null;
  verilog: string;
  def: string;
  /** the technology ("vlib", "sky130_fd_sc_hd"), its four routing layers, and (a PDK) the design rule check */
  pdk?: string;
  layers?: string[];
  drc?: { shapes: number; shorts: number; spacing: number; area: number; opens: number; taps: number; tap_viol: number; gds_bytes: number; instances: number; details: string[] } | null;
}

/** world units per µm */
export const S = 4;

export function stdColor(t: string): string {
  if (t === 'SRAM') return '#7d6b9e';
  if (t === 'CLKBUF') return '#57c27a';
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
  const boxes: Box[] = r.cells.map(([row, site, w, , , hh], i) => {
    const [rr, ss] = pos ? [pos[2 * i], pos[2 * i + 1]] : [row, site];
    const macro = r.map.cells[i].t === 'SRAM';
    return {
      id: i, x: ss * d.site_w * S + 0.25, y: H - (rr + hh) * d.row_h * S + 0.6, w: w * d.site_w * S - 0.5, h: hh * d.row_h * S - 1.2,
      fill: colorOf && !macro ? colorOf(i) : stdColor(r.map.cells[i].t), label: macro ? 'SRAM' : undefined, stroke: macro ? '#c3b2e0' : undefined,
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

export const LAYER_COLOR = ['rgba(94,159,214,0.75)', 'rgba(224,108,117,0.7)', 'rgba(87,194,122,0.7)', 'rgba(229,192,123,0.75)'];

/** detailed wires: one line per straight piece, coloured by layer (M2 M3 M4 M5) */
export function detailLines(r: AsicResult, sel: number | null, layers: boolean[]): Line[] {
  const d = r.detail;
  const t = r.die.row_h / d.tracks; // µm per track
  const H = r.die.h * S;
  const out: Line[] = [], top: Line[] = [];
  d.nets.forEach((n, ni) => {
    const s = n.segs;
    for (let i = 0; i < s.length; i += 5) {
      const l = s[i];
      if (!layers[l]) continue;
      const pts = [s[i + 1] * t * S, H - s[i + 2] * t * S, s[i + 3] * t * S, H - s[i + 4] * t * S];
      if (ni === sel) top.push({ pts, color: '#ffd479', width: 1.6 });
      else out.push({ pts, color: LAYER_COLOR[l], width: 0.5 });
    }
  });
  return out.concat(top);
}

/** filler cells (background boxes) and the power grid: M1 rails, M5 straps */
export function powerScene(r: AsicResult): { bg: { x: number; y: number; w: number; h: number; fill: string }[]; lines: Line[] } {
  const d = r.die, H = d.h * S, f = r.pdn.fillers;
  const bg = [];
  for (let i = 0; i < f.length; i += 3) {
    bg.push({ x: f[i + 1] * d.site_w * S + 0.25, y: H - (f[i] + 1) * d.row_h * S + 0.6, w: f[i + 2] * d.site_w * S - 0.5, h: d.row_h * S - 1.2, fill: '#323a46' });
  }
  const lines: Line[] = [];
  for (let k = 0; k < r.pdn.rails; k++) {
    const y = H - k * d.row_h * S;
    lines.push({ pts: [0, y, d.w * S, y], color: k % 2 ? 'rgba(224,108,117,0.55)' : 'rgba(126,195,255,0.55)', width: 0.8 });
  }
  const t = d.row_h / r.detail.tracks;
  for (const [x, vdd] of r.pdn.straps) {
    const cx = (x + r.pdn.strap_w / 2) * t * S;
    lines.push({ pts: [cx, 0, cx, H], color: vdd ? 'rgba(224,108,117,0.8)' : 'rgba(126,195,255,0.8)', width: r.pdn.strap_w * t * S });
  }
  return { bg, lines };
}
