// FPGA vs ASIC side by side: the placed iCE40 device next to the placed
// standard-cell die (scaled to the same height), and a table of the two
// implementations of the same design.

import type { Scene } from '../view/canvas';
import { AsicResult, dieScene } from './asic';
import { deviceScene, PnrResult } from './device';

function bbox(s: Scene): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (x: number, y: number, w: number, h: number) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + w); y1 = Math.max(y1, y + h); };
  for (const b of s.boxes) add(b.x, b.y, b.w, b.h);
  for (const b of s.bg ?? []) add(b.x, b.y, b.w, b.h);
  return Number.isFinite(x0) ? { x0, y0, x1, y1 } : { x0: 0, y0: 0, x1: 1, y1: 1 };
}

/** `s` scaled by `k` and moved by (dx, dy); box ids offset by `id` */
function moved(s: Scene, k: number, dx: number, dy: number, id: number): Scene {
  const pts = (p: number[]) => p.map((v, i) => (i % 2 ? v * k + dy : v * k + dx));
  return {
    boxes: s.boxes.map(b => ({ ...b, id: b.id + id, x: b.x * k + dx, y: b.y * k + dy, w: b.w * k, h: b.h * k })),
    lines: s.lines.map(l => ({ ...l, pts: pts(l.pts) })),
    under: s.under?.map(l => ({ ...l, pts: pts(l.pts) })),
    texts: s.texts.map(t => ({ ...t, x: t.x * k + dx, y: t.y * k + dy, size: t.size ? t.size * k : t.size })),
    bg: s.bg?.map(b => ({ ...b, x: b.x * k + dx, y: b.y * k + dy, w: b.w * k, h: b.h * k })),
  };
}

/** both placements, FPGA left and ASIC right, with titles */
export function compareScene(p: PnrResult, a: AsicResult): Scene {
  const f = deviceScene(p), d = dieScene(a);
  const bf = bbox(f), bd = bbox(d);
  const h = bf.y1 - bf.y0;
  const k = h / Math.max(1e-9, bd.y1 - bd.y0);
  const gap = h * 0.12;
  const right = moved(d, k, bf.x1 + gap - bd.x0 * k, bf.y0 - bd.y0 * k, 1_000_000);
  const left = moved(f, 1, 0, 0, 0);
  const ty = bf.y0 - h * 0.035;
  const size = h * 0.025;
  return {
    boxes: [...left.boxes, ...right.boxes],
    lines: [],
    under: [...(left.under ?? []), ...(right.under ?? [])],
    texts: [...left.texts, ...right.texts,
      { x: bf.x0, y: ty, s: `FPGA：iCE40UP5K（${p.lcs.length} LC / 5280）`, color: '#7ec3ff', size, align: 'left' },
      { x: bf.x1 + gap, y: ty, s: `ASIC：vlib 標準元件（晶粒 ${a.die.w.toFixed(0)}×${a.die.h.toFixed(0)} µm，放大到同高）`, color: '#e0b87e', size, align: 'left' }],
    bg: [...(left.bg ?? []), ...(right.bg ?? [])],
  };
}

const f1 = (v: number) => v.toFixed(1);
const f2 = (v: number) => v.toFixed(2);

/** rows: [item, FPGA, ASIC] */
export function compareRows(p: PnrResult, a: AsicResult): string[][] {
  const fc = (t: string) => p.lcs.filter(l => t === 'ff' ? l.ff : t === 'carry' ? l.carry : true).length;
  const ffA = a.map.cells.filter(c => c.t.includes('DFF')).length;
  const srams = a.map.cells.filter(c => c.t === 'SRAM').length;
  const eF = p.timing.power.e_nets + p.timing.power.e_clock + p.timing.power.e_ram;
  const eA = a.power.e_nets + a.power.e_clock + a.power.e_internal + a.power.e_sram;
  const f = Math.min(p.timing.fmax, a.timing.fmax);
  const pF = eF * f / 1000 + p.timing.power.static, pA = eA * f / 1000 + a.power.leakage;
  return [
    ['實作', 'iCE40UP5K LUT4 FPGA（可重新燒錄）', 'vlib 標準元件（約 130 nm，需流片）'],
    ['邏輯單元', `${p.lcs.length} LC（${(100 * p.lcs.length / 5280).toFixed(1)}%），DFF ${fc('ff')}，CARRY ${fc('carry')}`, `${a.map.cells.length} 個元件，DFF ${ffA}`],
    ...(p.rams.length || srams ? [['記憶體', `${p.rams.length} 個 SB_RAM40_4K`, `${srams} 個 SRAM 巨集`]] : []),
    ['面積', '固定晶片（5280 LC、30 BRAM）', `元件 ${f1(a.area)} µm²，晶粒 ${a.die.w.toFixed(0)}×${a.die.h.toFixed(0)} µm（利用率 ${(a.die.util * 100).toFixed(0)}%）`],
    ['繞線', `${p.pips} 個 pip（可程式開關）`, `${f2(a.detail.wirelength / 1000 || a.route.wirelength / 1000)} mm 金屬線，${a.detail.vias || a.route.vias} 個 via`],
    ['關鍵路徑', `${f2(p.timing.period)} ns`, `${f2(a.timing.period)} ns`],
    ['F<sub>max</sub>', `${f1(p.timing.fmax)} MHz`, `${f1(a.timing.fmax)} MHz（×${(a.timing.fmax / p.timing.fmax).toFixed(1)}）`],
    ['每週期能量', `${f1(eF)} pJ`, `${f2(eA)} pJ（÷${(eF / Math.max(1e-9, eA)).toFixed(0)}）`],
    [`功耗 @ ${f1(f)} MHz`, `${pF.toFixed(3)} mW（靜態 ${p.timing.power.static.toFixed(3)}）`, `${pA.toFixed(4)} mW（漏電 ${a.power.leakage.toFixed(4)}）`],
  ];
}
