// Netlists as returned by the WebAssembly core, plus helpers.

export type JBit = number | '0' | '1';
export interface JPort { name: string; dir: 'in' | 'out'; bits: JBit[] }
export interface JCell { t: string; c: [string, JBit][]; p?: Record<string, string> }
export interface JNet { name: string; bits: JBit[] }
export interface JNetlist { ports: JPort[]; cells: JCell[]; nets: JNet[] }

export interface SynthResult {
  top: string;
  modules: { name: string; test: boolean }[];
  warnings: string[];
  hier: { path: string; module: string }[];
  ports: { name: string; dir: string; width: number }[];
  signals: { name: string; width: number }[];
  raw: JNetlist;
  opt: JNetlist;
  map: JNetlist;
}

const OUTS = new Set(['Y', 'Q', 'O', 'CO']);
export const isOut = (pin: string) => OUTS.has(pin) || pin.startsWith('RDATA');
/** sequential cells (flip-flops, block RAM): level 0, drawn in the DFF column */
export const isFF = (t: string) => t.includes('DFF') || t === 'SB_RAM40_4K';

export function cellOut(c: JCell): JBit | undefined {
  return c.c.find(([p]) => isOut(p))?.[1];
}

/** wire id -> "signal[bit]" for named signals (first name wins) */
export function netNames(nl: JNetlist): Map<number, string> {
  const m = new Map<number, string>();
  const add = (name: string, bits: JBit[]) => bits.forEach((b, i) => {
    if (typeof b === 'number' && !m.has(b)) m.set(b, bits.length > 1 ? `${name}[${i}]` : name);
  });
  nl.ports.forEach(p => add(p.name, p.bits));
  nl.nets.forEach(n => add(n.name, n.bits));
  return m;
}

export function bitName(names: Map<number, string>, b: JBit): string {
  if (b === '0' || b === '1') return `1'b${b}`;
  return names.get(b) ?? `n${b}`;
}

export interface Leveled {
  /** level of each cell: flip-flops 0, combinational 1 + max(driver level) */
  level: number[];
  depth: number;
  /** driver cell of each wire */
  driver: Map<number, number>;
  /** cells reading each wire */
  users: Map<number, number[]>;
}

export function levelize(nl: JNetlist): Leveled {
  const driver = new Map<number, number>();
  const users = new Map<number, number[]>();
  nl.cells.forEach((c, i) => {
    for (const [p, b] of c.c) {
      if (typeof b !== 'number') continue;
      if (isOut(p)) driver.set(b, i);
      else { const u = users.get(b); if (u) u.push(i); else users.set(b, [i]); }
    }
  });
  const level = new Array<number>(nl.cells.length).fill(-1);
  let depth = 0;
  // iterative DFS (netlists can be thousands of levels deep in theory)
  for (let s = 0; s < nl.cells.length; s++) {
    if (level[s] >= 0) continue;
    const stack: [number, boolean][] = [[s, false]];
    while (stack.length) {
      const [i, done] = stack.pop()!;
      if (level[i] >= 0) continue;
      const c = nl.cells[i];
      if (isFF(c.t)) { level[i] = 0; continue; }
      const ins: number[] = [];
      for (const [p, b] of c.c) {
        if (isOut(p) || typeof b !== 'number') continue;
        const d = driver.get(b);
        if (d !== undefined) ins.push(d);
      }
      if (done) {
        let l = 0;
        for (const d of ins) l = Math.max(l, (level[d] < 0 ? 0 : level[d]) + 1);
        level[i] = Math.max(l, 1);
        depth = Math.max(depth, level[i]);
        continue;
      }
      stack.push([i, true]);
      for (const d of ins) if (level[d] === -1) stack.push([d, false]);
    }
  }
  return { level, depth, driver, users };
}

export function countTypes(nl: JNetlist): [string, number][] {
  const m = new Map<string, number>();
  for (const c of nl.cells) m.set(c.t, (m.get(c.t) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

/** LUT_INIT (msb-first binary string) -> 16 output bits, index = I3 I2 I1 I0 */
export function lutBits(init: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < 16; i++) out.push(init[15 - i] === '1' ? 1 : 0);
  return out;
}

export function lutInputs(c: JCell): number {
  return ['I0', 'I1', 'I2', 'I3'].filter(p => { const b = c.c.find(x => x[0] === p)?.[1]; return b !== undefined && b !== '0' && b !== '1'; }).length;
}
