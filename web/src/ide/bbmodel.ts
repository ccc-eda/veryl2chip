// The breadboard's electrical model (digital, no DOM, so Node tests can use it).
//
// Points: breadboard holes ("h:col:row", rows a-e / f-j), power-rail holes
// ("r:top+:col", ...), header pins ("p:<pin>") and the header's "vcc" / "gnd".
// Strong connections join points into nets: the breadboard's strips and
// rails, jumper wires, closed buttons and switches. A net's level comes from
// its strong drivers: 3V3 (1), GND (0) or an FPGA output pin (its duty, the
// fraction of time at 1). Resistors are weak: a net without a strong driver
// takes its level through a resistor (pull-ups, pull-downs, an LED's series
// resistor). An LED (a = anode, b = cathode) lights by level(a) × (1 − level(b)).

export type PartKind = 'led' | 'res' | 'btn' | 'sw' | 'wire';
export interface Part { id: number; kind: PartKind; a: string; b: string; color?: string; on?: boolean }

/** the strip a hole belongs to (all holes of a strip are one point electrically) */
export function node(p: string): string {
  const m = /^h:(\d+):([a-j])$/.exec(p);
  if (m) return `s:${m[1]}:${'abcde'.includes(m[2]) ? 'top' : 'bot'}`;
  const r = /^r:([a-z]+[+-]):\d+$/.exec(p);
  if (r) return `rail:${r[1]}`;
  return p;
}

export interface Solved {
  /** level of each net (0..1), or null when floating */
  level: Map<string, number | null>;
  /** LED brightness by part id */
  led: Map<number, number>;
  /** levels for the FPGA's input pins on the breadboard: pin -> 0/1 */
  inputs: Map<number, number>;
  warnings: string[];
}

class Uf {
  p = new Map<string, string>();
  find(a: string): string { let r = a; while (this.p.has(r) && this.p.get(r) !== r) r = this.p.get(r)!; this.p.set(a, r); return r; }
  union(a: string, b: string): void { const x = this.find(a), y = this.find(b); if (x !== y) this.p.set(x, y); }
}

/**
 * Solve the breadboard: `outputs` = duty of the FPGA output pins (pin -> 0..1),
 * `inputs` = the FPGA's input pins that matter, `pressed` = buttons held now.
 */
export function solve(parts: Part[], outputs: Map<number, number>, inputs: Set<number>, pressed: Set<number>, tr: (h: string, e: string) => string = (h) => h): Solved {
  const uf = new Uf();
  const nodes = new Set<string>(['vcc', 'gnd']);
  for (const p of parts) { nodes.add(node(p.a)); nodes.add(node(p.b)); }
  for (const pin of [...outputs.keys(), ...inputs]) nodes.add(`p:${pin}`);
  for (const n of nodes) uf.find(n);
  for (const p of parts) {
    const closed = p.kind === 'wire' || (p.kind === 'sw' && p.on) || (p.kind === 'btn' && pressed.has(p.id));
    if (closed) uf.union(node(p.a), node(p.b));
  }
  // strong drivers per net
  const drivers = new Map<string, { what: string; v: number }[]>();
  const add = (n: string, what: string, v: number) => { const r = uf.find(n); if (!drivers.has(r)) drivers.set(r, []); drivers.get(r)!.push({ what, v }); };
  add('vcc', '3V3', 1);
  add('gnd', 'GND', 0);
  // an output pin no part touches is a net of its own, so adding it never conflicts
  for (const [pin, d] of outputs) add(`p:${pin}`, tr(`腳 ${pin}`, `pin ${pin}`), d);
  const warnings: string[] = [];
  const level = new Map<string, number | null>();
  const nets = new Set<string>([...nodes].map(n => uf.find(n)));
  for (const r of nets) {
    const ds = drivers.get(r) ?? [];
    if (ds.length > 1) {
      // two drivers on one net: a short unless they always agree (3V3 + 3V3 cannot happen)
      warnings.push(tr(`短路：${ds.map(d => d.what).join(' 和 ')} 接在一起`, `Short circuit: ${ds.map(d => d.what).join(' and ')} are connected`));
    }
    level.set(r, ds.length ? ds[0].v : null);
  }
  // weak levels through resistors, for nets with no strong driver
  const strong = new Set([...nets].filter(r => level.get(r) !== null));
  for (let changed = true, k = 0; changed && k < 50; k++) {
    changed = false;
    for (const p of parts.filter(q => q.kind === 'res')) {
      const [x, y] = [uf.find(node(p.a)), uf.find(node(p.b))];
      for (const [from, to] of [[x, y], [y, x]]) {
        if (!strong.has(to) && level.get(to) == null && level.get(from) != null) { level.set(to, level.get(from)!); changed = true; }
      }
    }
  }
  const lv = (n: string) => level.get(uf.find(n)) ?? null;
  // LEDs
  const led = new Map<number, number>();
  for (const p of parts.filter(q => q.kind === 'led')) {
    const [a, c] = [lv(node(p.a)), lv(node(p.b))];
    led.set(p.id, a === null || c === null ? 0 : Math.max(0, a * (1 - c)));
    const [ra, rc] = [uf.find(node(p.a)), uf.find(node(p.b))];
    if (strong.has(ra) && strong.has(rc) && (level.get(ra) ?? 0) > 0 && (level.get(rc) ?? 1) < 1) {
      warnings.push(tr('LED 沒有串聯限流電阻（真實電路中會燒掉 LED 或 FPGA 腳位）', 'An LED has no series resistor (on real hardware it would burn the LED or the FPGA pin)'));
    }
  }
  // FPGA inputs
  const ins = new Map<number, number>();
  for (const pin of inputs) {
    const n = `p:${pin}`;
    if (!parts.some(p => node(p.a) === n || node(p.b) === n)) continue;
    const v = lv(n);
    if (v === null) warnings.push(tr(`腳 ${pin} 浮接（沒有接到任何電位）：加一個上拉或下拉電阻`, `Pin ${pin} floats (nothing drives it): add a pull-up or pull-down resistor`));
    ins.set(pin, v !== null && v > 0.5 ? 1 : 0);
  }
  return { level, led, inputs: ins, warnings: [...new Set(warnings)] };
}
