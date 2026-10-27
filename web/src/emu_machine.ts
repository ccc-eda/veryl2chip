// The emulator's machine: a design compiled by veryl-emu (core command `emu_compile`)
// with what a project's machine.json says about its ports — the reset, a UART
// (bytes in / out), a finisher (end of the run), a RAM array that programs are
// loaded into. No DOM: the emulator's worker and the Node tests use it.

export interface MachineCfg {
  /** the module to compile */
  top: string;
  /** reset port, its active level, cycles held at start */
  reset?: { port: string; active: number; cycles?: number };
  /** UART as handshake ports (one byte a cycle) */
  uart?: { tx_valid: string; tx_data: string; rx_valid?: string; rx_data?: string; rx_ready?: string };
  /** a write to the finisher ends the run; `pass` = the code that means success */
  finish?: { valid: string; code?: string; pass?: number };
  /** the RAM array programs are loaded into, and its address */
  ram?: { array: string; base: string };
  /** programs loaded at start: a bundled image (`image`) at `addr` (default: the RAM base; ELF files by their segments) */
  load?: { image: string; addr?: string }[];
  /** GPIO pins: output values, output enables, inputs (one bit per pin) */
  gpio?: { out: string; oe: string; in: string; n?: number };
  /** the board the IDE draws for it ('pi': the RV64 development board) */
  board?: string;
}

interface Meta { finish: number; mute: Record<string, number>; signals: Record<string, { off: number; w: number; limbs: number; arr: number }> }
interface Exports { mem: WebAssembly.Memory; settle(): void; posedge(): void; run(n: number): number }

export interface StepResult {
  cycles: number; out: number[]; finished: null | { code: number; pass: boolean };
  /** GPIO: fraction of the step each pin was driven high, and which pins were driven (output enable) */
  duty?: number[]; oe?: number;
}

/** stop signals the design is compiled with: the UART output and the finisher */
export function machineStops(cfg: MachineCfg): string[] {
  return [cfg.uart?.tx_valid, cfg.finish?.valid].filter((s): s is string => !!s);
}

type Sig = { get(): bigint; set(v: bigint | number): void };

export class Machine {
  private u8: Uint8Array;
  private u64: BigUint64Array;
  private rx: number[] = [];
  /** cycles run since the reset */
  cycle = 0;
  finished: StepResult['finished'] = null;

  private constructor(private x: Exports, private meta: Meta, readonly cfg: MachineCfg) {
    this.u8 = new Uint8Array(x.mem.buffer);
    this.u64 = new BigUint64Array(x.mem.buffer);
  }

  static async create(wasm: Uint8Array | WebAssembly.Module, meta: Meta, cfg: MachineCfg): Promise<Machine> {
    const inst = wasm instanceof WebAssembly.Module ? await WebAssembly.instantiate(wasm, {}) : (await WebAssembly.instantiate(wasm as BufferSource, {})).instance;
    return new Machine(inst.exports as unknown as Exports, meta, cfg);
  }

  sig(name: string): Sig {
    const s = this.meta.signals[name];
    if (!s) throw new Error(`machine.json: no signal '${name}' in ${this.cfg.top}`);
    const i = s.off / 8, n = s.limbs, u64 = this.u64;
    const mask = (1n << BigInt(s.w)) - 1n;
    return {
      get: () => { let v = 0n; for (let k = n - 1; k >= 0; k--) v = (v << 64n) | u64[i + k]; return v; },
      set: (v) => { let x = BigInt(v) & mask; for (let k = 0; k < n; k++) { u64[i + k] = x & 0xffffffffffffffffn; x >>= 64n; } },
    };
  }

  /** a program: an ELF file by its segments, anything else at `addr` (default: the RAM base) */
  load(bytes: Uint8Array, addr?: bigint): void {
    const ram = this.cfg.ram;
    if (!ram) throw new Error('machine.json: no "ram" to load a program into');
    const info = this.meta.signals[ram.array];
    if (!info) throw new Error(`machine.json: no array '${ram.array}'`);
    const base = BigInt(ram.base);
    const size = BigInt(info.arr * info.limbs * 8);
    const put = (a: bigint, b: Uint8Array) => {
      if (a < base || a - base + BigInt(b.length) > size) throw new Error(`program at 0x${a.toString(16)} (${b.length} bytes) is outside the RAM`);
      this.u8.set(b, info.off + Number(a - base));
    };
    for (const [a, b] of elfSegments(bytes) ?? [[addr ?? base, bytes] as [bigint, Uint8Array]]) put(a, b);
  }

  /** hold the reset for its cycles, then release it */
  reset(): void {
    const r = this.cfg.reset;
    this.rx = [];
    this.finished = null;
    this.cycle = 0;
    if (this.cfg.uart?.rx_valid) this.sig(this.cfg.uart.rx_valid).set(0);
    if (r) {
      const p = this.sig(r.port);
      p.set(r.active);
      this.x.settle();
      for (let i = 0; i < (r.cycles ?? 2); i++) this.x.posedge();
      p.set(r.active ? 0 : 1);
    }
    this.x.settle();
  }

  /** clear every signal and memory (power off) */
  clear(): void { this.u8.fill(0); }

  /** bytes typed into the UART */
  input(bytes: number[]): void { this.rx.push(...bytes); }

  /** GPIO inputs (a bit per pin) */
  setGpio(bits: number): void {
    const g = this.cfg.gpio;
    if (!g) return;
    this.sig(g.in).set(bits);
    this.x.settle();
  }

  /** run up to `max` cycles; stops at the finisher */
  step(max: number): StepResult {
    const out: number[] = [];
    const u = this.cfg.uart, f = this.cfg.finish;
    const txv = u ? this.sig(u.tx_valid) : null, txd = u ? this.sig(u.tx_data) : null;
    const rxv = u?.rx_valid ? this.sig(u.rx_valid) : null, rxd = u?.rx_data ? this.sig(u.rx_data) : null, rxr = u?.rx_ready ? this.sig(u.rx_ready) : null;
    const fv = f ? this.sig(f.valid) : null, fc = f?.code ? this.sig(f.code) : null;
    // GPIO outputs are sampled every SAMPLE cycles (duty = time high / time)
    const g = this.cfg.gpio, n = g?.n ?? 16;
    const go = g ? this.sig(g.out) : null, ge = g ? this.sig(g.oe) : null;
    const high = new Array<number>(n).fill(0);
    let oeSeen = 0;
    const SAMPLE = 1024;
    const sample = (cycles: number) => {
      if (!go) return;
      const v = Number(go.get()), e = Number(ge!.get());
      oeSeen |= e;
      for (let k = 0; k < n; k++) if ((v & e) >> k & 1) high[k] += cycles;
    };
    let done = 0;
    while (done < max && !this.finished) {
      let single = false;
      if (this.rx.length && rxv && rxd && (!rxr || rxr.get())) {
        rxv.set(1); rxd.set(this.rx.shift()!); this.x.settle();
        single = true;
      }
      const want = single ? 1 : go ? Math.min(SAMPLE, max - done) : max - done;
      const ran = single ? 0 : this.x.run(want);
      done += ran;
      sample(ran);
      if (ran < want) {
        // a stop signal (or the cycle with a received byte): this cycle's outputs, then its edge
        if (txv && txv.get()) out.push(Number(txd!.get() & 0xffn));
        if (fv && fv.get()) {
          const code = fc ? Number(fc.get() & 0xffffffffn) : 0;
          this.finished = { code, pass: (code & 0xffff) === (f!.pass ?? 0x5555) };
        }
        this.x.posedge();
        done++;
        sample(1);
        if (single) { rxv!.set(0); this.x.settle(); }
      }
    }
    this.cycle += done;
    const r: StepResult = { cycles: done, out, finished: this.finished };
    if (go) { r.duty = high.map((h) => (done ? h / done : 0)); r.oe = oeSeen; }
    return r;
  }
}

/** PT_LOAD segments of an ELF64 file (null: not an ELF64 file) */
export function elfSegments(f: Uint8Array): [bigint, Uint8Array][] | null {
  if (f.length < 64 || f[0] !== 0x7f || f[1] !== 0x45 || f[2] !== 0x4c || f[3] !== 0x46 || f[4] !== 2) return null;
  const d = new DataView(f.buffer, f.byteOffset, f.byteLength);
  const phoff = Number(d.getBigUint64(32, true)), phentsize = d.getUint16(54, true), phnum = d.getUint16(56, true);
  const segs: [bigint, Uint8Array][] = [];
  for (let i = 0; i < phnum; i++) {
    const p = phoff + i * phentsize;
    if (d.getUint32(p, true) !== 1) continue;
    const off = Number(d.getBigUint64(p + 8, true)), paddr = d.getBigUint64(p + 24, true);
    const filesz = Number(d.getBigUint64(p + 32, true)), memsz = Number(d.getBigUint64(p + 40, true));
    if (memsz === 0) continue;
    const seg = new Uint8Array(memsz);
    seg.set(f.subarray(off, off + filesz));
    segs.push([paddr, seg]);
  }
  return segs;
}
