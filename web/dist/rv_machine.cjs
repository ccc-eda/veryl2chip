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

// src/rv_machine.ts
var rv_machine_exports = {};
__export(rv_machine_exports, {
  RvMachine: () => RvMachine
});
module.exports = __toCommonJS(rv_machine_exports);

// src/emu_machine.ts
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

// src/rv_machine.ts
var RvMachine = class _RvMachine {
  constructor(x, cfg) {
    this.x = x;
    this.cfg = cfg;
  }
  x;
  cfg;
  /** instructions run since the reset */
  cycle = 0;
  finished = null;
  t0 = 0;
  realtime = false;
  static async create(wasm, cfg, opts = {}) {
    const inst = wasm instanceof WebAssembly.Module ? await WebAssembly.instantiate(wasm, {}) : (await WebAssembly.instantiate(wasm, {})).instance;
    const x = inst.exports;
    x.rv_init(256);
    const m = new _RvMachine(x, cfg);
    m.realtime = !!opts.realtime;
    x.rv_set_realtime(m.realtime ? 1 : 0);
    if (opts.jit) x.rv_jit(typeof opts.jit === "number" ? opts.jit : 1);
    m.t0 = performance.now();
    return m;
  }
  /** blocks translated, blocks run translated */
  jitStats() {
    return { translated: this.x.rv_jit_stats(0), run: this.x.rv_jit_stats(1) };
  }
  /** compile the block the core asked for and put it into its function table */
  translate() {
    const x = this.x;
    const n = x.rv_jit_code();
    const bytes = new Uint8Array(x.memory.buffer, x.rv_buf(0), n).slice();
    const inst = new WebAssembly.Instance(new WebAssembly.Module(bytes), { env: { mem: x.memory, ld: x.jit_ld, st: x.jit_st, ar: x.jit_ar } });
    const t = x.__indirect_function_table;
    let slot = x.rv_jit_slot();
    if (slot < 0) slot = t.grow(1);
    t.set(slot, inst.exports.b);
    x.rv_jit_done(slot);
  }
  put(b) {
    const p = this.x.rv_buf(b.length);
    new Uint8Array(this.x.memory.buffer, p, b.length).set(b);
  }
  ram(addr, n) {
    const off = Number(addr - BigInt(this.x.rv_ram_base()));
    return new Uint8Array(this.x.memory.buffer, this.x.rv_ram() + off, n);
  }
  /** a program: an ELF file by its segments (riscv-tests: and its tohost), anything else at `addr` (default: the RAM base) */
  load(bytes, addr) {
    if (elfSegments(bytes)) {
      this.put(bytes);
      if (this.x.rv_load_program(bytes.length)) throw new Error("the ELF file does not fit the RAM");
      return;
    }
    for (const [a, b] of [[addr ?? BigInt(this.x.rv_ram_base()), bytes]]) {
      this.put(b);
      if (this.x.rv_load(Number(a), b.length)) throw new Error(`program at 0x${a.toString(16)} (${b.length} bytes) is outside the RAM`);
    }
  }
  reset() {
    this.x.rv_reset();
    this.x.rv_set_realtime(this.realtime ? 1 : 0);
    this.cycle = 0;
    this.finished = null;
    this.t0 = performance.now();
  }
  clear() {
    this.x.rv_clear();
  }
  writeArea(bytes) {
    if (!this.cfg.files) return;
    if (bytes.length > this.cfg.files.size) throw new Error(`the project's files (${bytes.length} bytes) do not fit the exchange area`);
    this.load(bytes, BigInt(this.cfg.files.addr));
  }
  readArea() {
    const f = this.cfg.files;
    return f ? this.ram(BigInt(f.addr), f.size).slice() : null;
  }
  screen() {
    const f = this.cfg.fb;
    return f ? this.ram(BigInt(f.addr), f.width * f.height * 2) : null;
  }
  input(bytes) {
    if (!bytes.length) return;
    this.put(Uint8Array.from(bytes));
    this.x.rv_input(bytes.length);
  }
  setGpio(bits) {
    this.x.rv_set_gpio(bits);
  }
  /** the whole state (hart, devices, the RAM's non-zero pages) */
  snapshot() {
    const n = this.x.rv_save();
    return new Uint8Array(this.x.memory.buffer, this.x.rv_buf(0), n).slice();
  }
  restore(data, cycle = 0) {
    this.put(data);
    if (this.x.rv_restore(data.length)) throw new Error("not a riscv-emu state");
    this.x.rv_set_realtime(this.realtime ? 1 : 0);
    this.t0 = performance.now() - this.x.rv_time() / 1e4;
    this.cycle = cycle;
    this.finished = null;
  }
  /** run up to `max` instructions; stops at the finisher, or (real time) when the hart waits */
  step(max) {
    const out = [];
    const n = this.cfg.gpio?.n ?? 16;
    const high = new Array(n).fill(0);
    let oeSeen = 0, done = 0, weight = 0, idle = false;
    const SAMPLE = 4096;
    while (done < max && !this.finished) {
      if (this.realtime) this.x.rv_set_time((performance.now() - this.t0) * 1e4);
      const before = this.x.rv_instret();
      const r = this.x.rv_run(Math.min(SAMPLE, max - done));
      const ran = this.x.rv_instret() - before;
      done += ran;
      const g = this.x.rv_gpio(), v = g & 65535, e = g >>> 16, w = Math.max(ran, 1);
      oeSeen |= e;
      weight += w;
      for (let k = 0; k < n; k++) if ((v & e) >> k & 1) high[k] += w;
      const no = this.x.rv_output();
      if (no) {
        const b = new Uint8Array(this.x.memory.buffer, this.x.rv_buf(0), no);
        for (let i = 0; i < no; i++) out.push(b[i]);
      }
      if (r === 3) this.translate();
      if (r === 1) {
        const code = this.x.rv_finished();
        this.finished = { code, pass: (code & 65535) === 21845 };
      }
      if (r === 2) {
        idle = true;
        break;
      }
    }
    this.cycle += done;
    return { cycles: done, out, finished: this.finished, duty: high.map((h) => weight ? h / weight : 0), oe: oeSeen, idle };
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  RvMachine
});
