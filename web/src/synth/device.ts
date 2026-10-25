// Chip views for place and route: tiles, logic cells, IO pins, routes.

import type { Box, Line, Scene, Text } from '../view/canvas';

export interface PnrLc {
  x: number; y: number; z: number;
  init: string; carry: boolean; in3c: boolean;
  ff: { neg: boolean; sr: boolean; set: boolean; async: boolean } | null;
  out: string; ins: string[]; arr: number;
}
export interface PnrResult {
  top: string;
  device: { name: string; w: number; h: number; tiles: [number, number, string][] };
  lcs: PnrLc[];
  chains: number[][];
  ios: { name: string; dir: string; x: number; y: number; z: number; pin: string }[];
  /** block RAMs at their ramb tile (x, y); the ramt tile is (x, y + 1) */
  rams: { x: number; y: number; read: string; write: string; ins: [string, string][]; outs: [string, string][] }[];
  history: { temp: number; cost: number; accept: number; pos: number[]; ram: number[] }[];
  nets: { name: string; global: boolean; sinks: number; pips: number; segs: [number, number, number, number, string, boolean][] }[];
  route_iters: number[];
  globals: { net: string; glb: number }[];
  timing: { period: number; fmax: number; endpoints: number; path: { what: string; delay: number; at: number }[]; crit_lcs: number[] };
  pips: number;
  /** bitstream (base64), byte-identical to icepack's */
  bin: string;
  asc: string;
  pcf: string;
}

export const T = 12;
const TILE_FILL: Record<string, string> = {
  logic: '#222c38', io: '#25352b', ramb: '#33283f', ramt: '#33283f', dsp0: '#3a3026', dsp1: '#3a3026', dsp2: '#3a3026', dsp3: '#3a3026', ipcon: '#263340',
};
export const KIND_COLOR: Record<string, string> = {
  sp4: 'rgba(94,159,214,0.75)', sp12: 'rgba(180,142,173,0.85)', local: 'rgba(160,170,185,0.6)', in: 'rgba(160,170,185,0.6)',
  glb: '#57c27a', g2l: '#57c27a', ctrl: '#57c27a', io: '#e5c07b', carry: '#e5c07b', fabout: '#57c27a', out: '#9fb2c8', other: '#9fb2c8',
};

export function lcColor(lc: PnrLc): string {
  if (lc.carry) return '#e5c07b';
  if (lc.ff && lc.init === 'aaaa' && lc.ins.filter(x => x).length <= 1) return '#d08770'; // flip-flop with a pass-through LUT
  if (lc.ff) return '#c27ba0';
  if (!lc.ins.some(x => x)) return '#7f8c9a'; // constant
  return '#5e9fd6';
}

export function tileXY(dev: PnrResult['device'], x: number, y: number): [number, number] {
  return [x * T, (dev.h - 1 - y) * T];
}

export function lcRect(dev: PnrResult['device'], x: number, y: number, z: number): [number, number, number, number] {
  const [tx, ty] = tileXY(dev, x, y);
  const w = (T - 3) / 2, h = (T - 3) / 4;
  // LC 0 at the bottom, like the carry chain direction
  return [tx + 1 + (z % 2) * (w + 0.5), ty + 1 + (3 - Math.floor(z / 2)) * (h + 0.3), w, h];
}

export const RAM_COLOR = '#b48ead';

/** ids: LCs 0..n-1, IO pins n.., block RAMs after the IO pins */
export function deviceScene(r: PnrResult, pos?: number[], colorOf?: (i: number) => string, ramPos?: number[]): Scene {
  const dev = r.device;
  const bg = dev.tiles.map(([x, y, t]) => { const [tx, ty] = tileXY(dev, x, y); return { x: tx, y: ty, w: T - 1, h: T - 1, fill: TILE_FILL[t] ?? '#1d232e' }; });
  const boxes: Box[] = r.lcs.map((lc, i) => {
    const [x, y, z] = pos ? [pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]] : [lc.x, lc.y, lc.z];
    const [bx, by, w, h] = lcRect(dev, x, y, z);
    return { id: i, x: bx, y: by, w, h, fill: colorOf ? colorOf(i) : lcColor(lc) };
  });
  const texts: Text[] = [];
  r.ios.forEach((io, k) => {
    const [tx, ty] = tileXY(dev, io.x, io.y);
    boxes.push({ id: r.lcs.length + k, x: tx + 1 + io.z * 5.5, y: ty + 3, w: 4.5, h: 5, fill: io.dir === 'in' ? '#57c27a' : '#e06c75', stroke: '#0f1318' });
    texts.push({ x: tx + 3 + io.z * 5.5, y: io.y === 0 ? ty + T + 3 : ty - 3, s: io.name, color: io.dir === 'in' ? '#8fe0a8' : '#f0a0a8', size: 9, align: 'center' });
  });
  r.rams.forEach((ram, k) => {
    const [x, y] = ramPos ? [ramPos[2 * k], ramPos[2 * k + 1]] : [ram.x, ram.y];
    const [tx, ty] = tileXY(dev, x, y + 1);
    boxes.push({ id: r.lcs.length + r.ios.length + k, x: tx + 1, y: ty + 1, w: T - 3, h: 2 * T - 3, fill: RAM_COLOR, stroke: '#0f1318', label: 'RAM' });
  });
  // empty LC slots of logic tiles, as background
  for (const [x, y, t] of dev.tiles) {
    if (t !== 'logic') continue;
    for (let z = 0; z < 8; z++) { const [bx, by, w, h] = lcRect(dev, x, y, z); bg.push({ x: bx, y: by, w, h, fill: '#2a3441' }); }
  }
  return { bg, boxes, lines: [], texts };
}

export function routeLines(r: PnrResult, opts: { dim?: boolean; critOnly?: boolean; net?: number | null }): Line[] {
  const dev = r.device;
  const c = (x: number, y: number) => { const [tx, ty] = tileXY(dev, x, y); return [tx + (T - 1) / 2, ty + (T - 1) / 2]; };
  const out: Line[] = [];
  const crit: Line[] = [];
  r.nets.forEach((n, ni) => {
    const sel = opts.net === ni;
    for (const [x0, y0, x1, y1, kind, isCrit] of n.segs) {
      if (x0 === x1 && y0 === y1) continue;
      const [ax, ay] = c(x0, y0), [bx, by] = c(x1, y1);
      if (isCrit) crit.push({ pts: [ax, ay, bx, by], color: '#ff5c5c', width: 2.2 });
      else if (sel) out.push({ pts: [ax, ay, bx, by], color: '#ffd479', width: 2 });
      else if (!opts.critOnly) out.push({ pts: [ax, ay, bx, by], color: opts.dim ? 'rgba(126,150,180,0.18)' : KIND_COLOR[kind] ?? '#9fb2c8', width: 0.8 });
    }
  });
  return out.concat(crit);
}

/** green (early) -> yellow -> red (late) */
export function heat(t: number): string {
  const h = 120 - 120 * Math.min(Math.max(t, 0), 1);
  return `hsl(${h}, 70%, 52%)`;
}
