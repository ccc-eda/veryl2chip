"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/emu_machine.ts
var emu_machine_exports = {};
__export(emu_machine_exports, {
  Machine: () => Machine,
  elfSegments: () => elfSegments,
  machineStops: () => machineStops
});
module.exports = __toCommonJS(emu_machine_exports);
function machineStops(cfg) {
  return [cfg.uart?.tx_valid, cfg.finish?.valid].filter((s) => !!s);
}
var Machine = class _Machine {
  constructor(x, meta, cfg) {
    this.x = x;
    this.meta = meta;
    this.cfg = cfg;
    this.u8 = new Uint8Array(x.mem.buffer);
    this.u64 = new BigUint64Array(x.mem.buffer);
  }
  x;
  meta;
  cfg;
  u8;
  u64;
  rx = [];
  /** cycles run since the reset */
  cycle = 0;
  finished = null;
  static async create(wasm, meta, cfg) {
    const inst = wasm instanceof WebAssembly.Module ? await WebAssembly.instantiate(wasm, {}) : (await WebAssembly.instantiate(wasm, {})).instance;
    return new _Machine(inst.exports, meta, cfg);
  }
  sig(name) {
    const s = this.meta.signals[name];
    if (!s) throw new Error(`machine.json: no signal '${name}' in ${this.cfg.top}`);
    const i = s.off / 8, n = s.limbs, u64 = this.u64;
    const mask = (1n << BigInt(s.w)) - 1n;
    return {
      get: () => {
        let v = 0n;
        for (let k = n - 1; k >= 0; k--) v = v << 64n | u64[i + k];
        return v;
      },
      set: (v) => {
        let x = BigInt(v) & mask;
        for (let k = 0; k < n; k++) {
          u64[i + k] = x & 0xffffffffffffffffn;
          x >>= 64n;
        }
      }
    };
  }
  /** a program: an ELF file by its segments, anything else at `addr` (default: the RAM base) */
  load(bytes, addr) {
    const ram = this.cfg.ram;
    if (!ram) throw new Error('machine.json: no "ram" to load a program into');
    const info = this.meta.signals[ram.array];
    if (!info) throw new Error(`machine.json: no array '${ram.array}'`);
    const base = BigInt(ram.base);
    const size = BigInt(info.arr * info.limbs * 8);
    const put = (a, b) => {
      if (a < base || a - base + BigInt(b.length) > size) throw new Error(`program at 0x${a.toString(16)} (${b.length} bytes) is outside the RAM`);
      this.u8.set(b, info.off + Number(a - base));
    };
    for (const [a, b] of elfSegments(bytes) ?? [[addr ?? base, bytes]]) put(a, b);
  }
  /** hold the reset for its cycles, then release it */
  reset() {
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
  clear() {
    this.u8.fill(0);
  }
  /** bytes typed into the UART */
  input(bytes) {
    this.rx.push(...bytes);
  }
  /** GPIO inputs (a bit per pin) */
  setGpio(bits) {
    const g = this.cfg.gpio;
    if (!g) return;
    this.sig(g.in).set(bits);
    this.x.settle();
  }
  /** run up to `max` cycles; stops at the finisher */
  step(max) {
    const out = [];
    const u = this.cfg.uart, f = this.cfg.finish;
    const txv = u ? this.sig(u.tx_valid) : null, txd = u ? this.sig(u.tx_data) : null;
    const rxv = u?.rx_valid ? this.sig(u.rx_valid) : null, rxd = u?.rx_data ? this.sig(u.rx_data) : null, rxr = u?.rx_ready ? this.sig(u.rx_ready) : null;
    const fv = f ? this.sig(f.valid) : null, fc = f?.code ? this.sig(f.code) : null;
    const g = this.cfg.gpio, n = g?.n ?? 16;
    const go = g ? this.sig(g.out) : null, ge = g ? this.sig(g.oe) : null;
    const high = new Array(n).fill(0);
    let oeSeen = 0;
    const SAMPLE = 1024;
    const sample = (cycles) => {
      if (!go) return;
      const v = Number(go.get()), e = Number(ge.get());
      oeSeen |= e;
      for (let k = 0; k < n; k++) if ((v & e) >> k & 1) high[k] += cycles;
    };
    let done = 0;
    while (done < max && !this.finished) {
      let single = false;
      if (this.rx.length && rxv && rxd && (!rxr || rxr.get())) {
        rxv.set(1);
        rxd.set(this.rx.shift());
        this.x.settle();
        single = true;
      }
      const want = single ? 1 : go ? Math.min(SAMPLE, max - done) : max - done;
      const ran = single ? 0 : this.x.run(want);
      done += ran;
      sample(ran);
      if (ran < want) {
        if (txv && txv.get()) out.push(Number(txd.get() & 0xffn));
        if (fv && fv.get()) {
          const code = fc ? Number(fc.get() & 0xffffffffn) : 0;
          this.finished = { code, pass: (code & 65535) === (f.pass ?? 21845) };
        }
        this.x.posedge();
        done++;
        sample(1);
        if (single) {
          rxv.set(0);
          this.x.settle();
        }
      }
    }
    this.cycle += done;
    const r = { cycles: done, out, finished: this.finished };
    if (go) {
      r.duty = high.map((h) => done ? h / done : 0);
      r.oe = oeSeen;
    }
    return r;
  }
};
function elfSegments(f) {
  if (f.length < 64 || f[0] !== 127 || f[1] !== 69 || f[2] !== 76 || f[3] !== 70 || f[4] !== 2) return null;
  const d = new DataView(f.buffer, f.byteOffset, f.byteLength);
  const phoff = Number(d.getBigUint64(32, true)), phentsize = d.getUint16(54, true), phnum = d.getUint16(56, true);
  const segs = [];
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
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  Machine,
  elfSegments,
  machineStops
});
