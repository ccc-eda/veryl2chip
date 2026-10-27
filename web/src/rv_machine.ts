// The riscv-emu machine (riscv-emu/src/wasm.rs): the RV64 board (Rv64Soc) as an
// instruction-set emulator, with the interface of Machine (emu_machine.ts) so the
// emulator's worker and the Node tests drive either. The devices are Rv64Soc's own, so
// only what machine.json says about the board is used (files, fb, gpio); the Veryl
// source is not. No DOM.
//
// Time: with `realtime`, mtime follows the clock (10 MHz, as the device tree says) and
// `step` reports `idle` when the hart waits (wfi) for time or input; without it mtime
// counts instructions (reproducible, for tests).
//
// With `jit`, hot blocks are translated to WebAssembly (riscv-emu/src/jit.rs): the core
// asks for one (rv_run = 3), this compiles the module, instantiates it on the core's memory
// and helpers, and puts its function into the core's table.

import { elfSegments, MachineCfg, StepResult } from './emu_machine';

interface RvExports {
  memory: WebAssembly.Memory;
  rv_init(mb: number): void; rv_buf(n: number): number; rv_ram(): number; rv_ram_len(): number; rv_ram_base(): number;
  rv_reset(): void; rv_clear(): void; rv_load(addr: number, n: number): number; rv_input(n: number): void;
  rv_set_gpio(bits: number): void; rv_gpio(): number; rv_run(n: number): number; rv_output(): number; rv_finished(): number;
  rv_instret(): number; rv_set_realtime(on: number): void; rv_time(): number; rv_set_time(t: number): void;
  rv_save(): number; rv_restore(n: number): number; rv_load_program(n: number): number;
  rv_jit(on: number): void; rv_jit_code(): number; rv_jit_slot(): number; rv_jit_done(slot: number): void; rv_jit_stats(which: number): number;
  jit_ld: Function; jit_st: Function; jit_ar: Function; __indirect_function_table: WebAssembly.Table;
}

export class RvMachine {
  /** instructions run since the reset */
  cycle = 0;
  finished: StepResult['finished'] = null;
  private t0 = 0;
  private realtime = false;

  private constructor(private x: RvExports, readonly cfg: MachineCfg) {}

  static async create(wasm: Uint8Array | WebAssembly.Module, cfg: MachineCfg, opts: { realtime?: boolean; jit?: boolean | number } = {}): Promise<RvMachine> {
    const inst = wasm instanceof WebAssembly.Module ? await WebAssembly.instantiate(wasm, {}) : (await WebAssembly.instantiate(wasm as BufferSource, {})).instance;
    const x = inst.exports as unknown as RvExports;
    x.rv_init(256);
    const m = new RvMachine(x, cfg);
    m.realtime = !!opts.realtime;
    x.rv_set_realtime(m.realtime ? 1 : 0);
    if (opts.jit) x.rv_jit(typeof opts.jit === "number" ? opts.jit : 1);
    m.t0 = performance.now();
    return m;
  }

  /** blocks translated, blocks run translated */
  jitStats(): { translated: number; run: number } { return { translated: this.x.rv_jit_stats(0), run: this.x.rv_jit_stats(1) }; }

  /** compile the block the core asked for and put it into its function table */
  private translate(): void {
    const x = this.x;
    const n = x.rv_jit_code();
    const bytes = new Uint8Array(x.memory.buffer, x.rv_buf(0), n).slice();
    const inst = new WebAssembly.Instance(new WebAssembly.Module(bytes), { env: { mem: x.memory, ld: x.jit_ld, st: x.jit_st, ar: x.jit_ar } });
    const t = x.__indirect_function_table;
    let slot = x.rv_jit_slot();
    if (slot < 0) slot = t.grow(1);
    t.set(slot, inst.exports.b as Function);
    x.rv_jit_done(slot);
  }

  private put(b: Uint8Array): void { const p = this.x.rv_buf(b.length); new Uint8Array(this.x.memory.buffer, p, b.length).set(b); }
  private ram(addr: bigint, n: number): Uint8Array {
    const off = Number(addr - BigInt(this.x.rv_ram_base()));
    return new Uint8Array(this.x.memory.buffer, this.x.rv_ram() + off, n);
  }

  /** a program: an ELF file by its segments (riscv-tests: and its tohost), anything else at `addr` (default: the RAM base) */
  load(bytes: Uint8Array, addr?: bigint): void {
    if (elfSegments(bytes)) {
      this.put(bytes);
      if (this.x.rv_load_program(bytes.length)) throw new Error('the ELF file does not fit the RAM');
      return;
    }
    for (const [a, b] of [[addr ?? BigInt(this.x.rv_ram_base()), bytes] as [bigint, Uint8Array]]) {
      this.put(b);
      if (this.x.rv_load(Number(a), b.length)) throw new Error(`program at 0x${a.toString(16)} (${b.length} bytes) is outside the RAM`);
    }
  }

  reset(): void { this.x.rv_reset(); this.x.rv_set_realtime(this.realtime ? 1 : 0); this.cycle = 0; this.finished = null; this.t0 = performance.now(); }
  clear(): void { this.x.rv_clear(); }

  writeArea(bytes: Uint8Array): void {
    if (!this.cfg.files) return;
    if (bytes.length > this.cfg.files.size) throw new Error(`the project's files (${bytes.length} bytes) do not fit the exchange area`);
    this.load(bytes, BigInt(this.cfg.files.addr));
  }
  readArea(): Uint8Array | null { const f = this.cfg.files; return f ? this.ram(BigInt(f.addr), f.size).slice() : null; }
  screen(): Uint8Array | null { const f = this.cfg.fb; return f ? this.ram(BigInt(f.addr), f.width * f.height * 2) : null; }

  input(bytes: number[]): void { if (!bytes.length) return; this.put(Uint8Array.from(bytes)); this.x.rv_input(bytes.length); }
  setGpio(bits: number): void { this.x.rv_set_gpio(bits); }

  /** the whole state (hart, devices, the RAM's non-zero pages) */
  snapshot(): Uint8Array { const n = this.x.rv_save(); return new Uint8Array(this.x.memory.buffer, this.x.rv_buf(0), n).slice(); }
  restore(data: Uint8Array, cycle = 0): void {
    this.put(data);
    if (this.x.rv_restore(data.length)) throw new Error('not a riscv-emu state');
    this.x.rv_set_realtime(this.realtime ? 1 : 0);
    // the clock goes on from the saved mtime
    this.t0 = performance.now() - this.x.rv_time() / 1e4;
    this.cycle = cycle;
    this.finished = null;
  }

  /** run up to `max` instructions; stops at the finisher, or (real time) when the hart waits */
  step(max: number): StepResult & { idle?: boolean } {
    const out: number[] = [];
    const n = this.cfg.gpio?.n ?? 16;
    const high = new Array<number>(n).fill(0);
    let oeSeen = 0, done = 0, weight = 0, idle = false;
    const SAMPLE = 4096;
    while (done < max && !this.finished) {
      if (this.realtime) this.x.rv_set_time((performance.now() - this.t0) * 1e4);
      const before = this.x.rv_instret();
      const r = this.x.rv_run(Math.min(SAMPLE, max - done));
      const ran = this.x.rv_instret() - before;
      done += ran;
      // GPIO outputs, weighted by the instructions run while they were so
      const g = this.x.rv_gpio(), v = g & 0xffff, e = g >>> 16, w = Math.max(ran, 1);
      oeSeen |= e;
      weight += w;
      for (let k = 0; k < n; k++) if ((v & e) >> k & 1) high[k] += w;
      const no = this.x.rv_output();
      if (no) { const b = new Uint8Array(this.x.memory.buffer, this.x.rv_buf(0), no); for (let i = 0; i < no; i++) out.push(b[i]); }
      if (r === 3) this.translate();
      if (r === 1) { const code = this.x.rv_finished(); this.finished = { code, pass: (code & 0xffff) === 0x5555 }; }
      if (r === 2) { idle = true; break; }
    }
    this.cycle += done;
    return { cycles: done, out, finished: this.finished, duty: high.map((h) => (weight ? h / weight : 0)), oe: oeSeen, idle };
  }
}
