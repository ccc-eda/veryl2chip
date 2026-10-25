// Scenes for the synthesis stages: instance hierarchy and levelized netlists.

import type { Box, Line, Scene, Text } from '../view/canvas';
import { stdColor } from './asic';
import { isFF, isOut, JNetlist, Leveled, lutInputs } from './model';

export const TYPE_COLOR: Record<string, string> = {
  $_AND_: '#6aa1d4', $_OR_: '#7ec3ff', $_XOR_: '#c39bd3', $_NOT_: '#a3be8c', $_MUX_: '#ebcb8b',
  SB_CARRY: '#e5c07b', SB_RAM40_4K: '#b48ead', PI: '#57c27a', PO: '#e06c75',
};
const LUT_COLOR = ['#5a6b80', '#8fbcbb', '#88c0d0', '#81a1c1', '#5e81ac'];

export function cellColor(t: string, inputs = 4): string {
  if (t.includes('DFF')) return '#d08770';
  if (t === 'SB_LUT4') return LUT_COLOR[inputs];
  if (/^[A-Z]/.test(t) && !t.startsWith('SB_') && t !== 'PI' && t !== 'PO') return stdColor(t); // vlib standard cell
  return TYPE_COLOR[t] ?? '#9fb2c8';
}

export function shortType(t: string): string {
  if (t === 'SB_LUT4') return 'LUT4';
  if (t === 'SB_CARRY') return 'CARRY';
  if (t === 'SB_RAM40_4K') return 'BRAM';
  if (t.startsWith('SB_DFF')) return t.slice(3);
  return t.replace(/^\$_/, '').replace(/_$/, '').replace(/^DFF_.*/, 'DFF').replace(/^SDFF_.*/, 'SDFF');
}

/** box index of each cell, and of each port bit (keys "P:name:i") */
export interface NetLayout {
  scene: Scene;
  cellBox: number[];
  portBox: Map<string, number>;
  /** wire -> box ids of port bits driving / reading it */
  pinPorts: Map<number, number[]>;
  outPorts: Map<number, number[]>;
}

const BW = 34, BH = 11, CG = 26, RG = 3;

export function netScene(nl: JNetlist, lev: Leveled): NetLayout {
  const boxes: Box[] = [];
  const texts: Text[] = [];
  // columns: 0 = input ports, 1 = flip-flops, 1+level = combinational, last = output ports
  const cols: number[][] = [];
  const put = (col: number, id: number) => { (cols[col] ??= []).push(id); };
  const n = nl.cells.length;
  const items: { fill: string; label: string }[] = [];
  nl.cells.forEach((c, i) => {
    items.push({ fill: cellColor(c.t, c.t === 'SB_LUT4' ? lutInputs(c) : 4), label: shortType(c.t) });
    put(isFF(c.t) ? 1 : 1 + Math.max(lev.level[i], 1), i);
  });
  const portBox = new Map<string, number>();
  const pinPorts = new Map<number, number[]>();
  const outPorts = new Map<number, number[]>();
  const last = Math.max(cols.length, 2);
  let pid = n;
  for (const p of nl.ports) {
    p.bits.forEach((b, i) => {
      const id = pid++;
      items.push({ fill: p.dir === 'in' ? TYPE_COLOR.PI : TYPE_COLOR.PO, label: p.bits.length > 1 ? `${p.name}[${i}]` : p.name });
      portBox.set(`${p.name}:${i}`, id);
      put(p.dir === 'in' ? 0 : last, id);
      if (typeof b === 'number') {
        const m = p.dir === 'in' ? pinPorts : outPorts;
        (m.get(b) ?? m.set(b, []).get(b)!).push(id);
      }
    });
  }
  // tall columns wrap into sub-columns
  const total = items.length;
  const maxRows = Math.max(40, Math.ceil(Math.sqrt(total * 3)));
  const pos: [number, number][] = new Array(items.length);
  let x = 0;
  cols.forEach((ids, ci) => {
    if (!ids || !ids.length) { x += BW * 0.5; return; }
    const sub = Math.ceil(ids.length / maxRows);
    const rows = Math.ceil(ids.length / sub);
    const w = ci === 0 || ci === last ? BW * 2.2 : BW;
    ids.forEach((id, k) => {
      const sx = Math.floor(k / rows), sy = k % rows;
      pos[id] = [x + sx * (w + 4), sy * (BH + RG)];
    });
    const label = ci === 0 ? '輸入' : ci === 1 ? 'DFF' : ci === last ? '輸出' : `L${ci - 1}`;
    texts.push({ x: x, y: -12, s: label, color: '#9fb2c8', size: 11 });
    x += sub * (w + 4) + CG;
  });
  const cellBox: number[] = [];
  items.forEach((it, id) => {
    const [bx, by] = pos[id];
    const port = id >= n;
    const w = port ? BW * 2.2 : BW;
    boxes.push({ id, x: bx, y: by, w, h: BH, fill: it.fill, label: it.label });
    if (!port) cellBox[id] = id;
  });
  return { scene: { boxes, lines: [], texts }, cellBox, portBox, pinPorts, outPorts };
}

/** wires as lines: all of them (if `all`), and the fan-in / fan-out of `sel` */
export function netLines(nl: JNetlist, lev: Leveled, lay: NetLayout, all: boolean, sel: number | null): Line[] {
  const bx = lay.scene.boxes;
  const right = (id: number) => [bx[id].x + bx[id].w, bx[id].y + bx[id].h / 2];
  const left = (id: number) => [bx[id].x, bx[id].y + bx[id].h / 2];
  const out: Line[] = [];
  const edge = (from: number, to: number, color: string, width = 1) => {
    const [x0, y0] = right(from), [x1, y1] = left(to);
    const mx = (x0 + x1) / 2;
    out.push({ pts: [x0, y0, mx, y0, mx, y1, x1, y1], color, width });
  };
  const sources = (w: number): number[] => {
    const d = lev.driver.get(w);
    if (d !== undefined) return [d];
    return lay.pinPorts.get(w) ?? [];
  };
  const each = (fn: (from: number, to: number) => void, only?: number) => {
    nl.cells.forEach((c, i) => {
      for (const [p, b] of c.c) {
        if (isOut(p) || typeof b !== 'number') continue;
        for (const s of sources(b)) if (only === undefined || only === i || only === s) fn(s, i);
      }
    });
    for (const [w, ids] of lay.outPorts) for (const id of ids) for (const s of sources(w)) if (only === undefined || only === id || only === s) fn(s, id);
  };
  if (all) each((a, b) => edge(a, b, 'rgba(126,195,255,0.18)'));
  if (sel !== null) {
    each((a, b) => edge(a, b, b === sel ? '#ff9b8a' : '#7ec3ff', 1.6), sel);
  }
  return out;
}

export function edgeCount(nl: JNetlist): number {
  let n = 0;
  for (const c of nl.cells) for (const [p, b] of c.c) if (!isOut(p) && typeof b === 'number') n++;
  return n;
}

/** instance tree: one box per instance, children indented under the parent */
export function hierScene(hier: { path: string; module: string }[], counts: Map<string, number>): Scene {
  const boxes: Box[] = [];
  const lines: Line[] = [];
  const texts: Text[] = [];
  const W = 260, H = 26, IND = 40, GAP = 10;
  const ypos = new Map<string, [number, number]>();
  hier.forEach((h, i) => {
    const depth = h.path === '' ? 0 : h.path.split('.').length;
    const x = depth * IND, y = i * (H + GAP);
    const parent = h.path.includes('.') ? h.path.slice(0, h.path.lastIndexOf('.')) : h.path === '' ? null : '';
    const name = h.path === '' ? h.module : h.path.split('.').pop()!;
    const n = counts.get(h.path) ?? 0;
    boxes.push({ id: i, x, y, w: W, h: H, fill: depth === 0 ? '#3d6ea0' : '#2c3e55', stroke: '#6aa1d4', label: `${name} : ${h.module}` });
    texts.push({ x: x + W + 10, y: y + H / 2, s: `${n} 個訊號`, color: '#9fb2c8', size: 11 });
    if (parent !== null && ypos.has(parent)) {
      const [px, py] = ypos.get(parent)!;
      lines.push({ pts: [px + 14, py + H, px + 14, y + H / 2, x, y + H / 2], color: '#6aa1d4', width: 1.5 });
    }
    ypos.set(h.path, [x, y]);
  });
  return { boxes, lines, texts };
}

