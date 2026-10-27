// veryl-emu's harness side: load a compiled model (OUT.wasm + OUT.json from
// `veryl-emu -o OUT.wasm`) and reach its signals by name. Works in Node and in a
// browser (pass the bytes and the parsed JSON to `instantiate`).
//
//   const emu = await loadFiles('model.wasm');     // Node
//   const s = emu.sig('o_tx_valid');                // a handle: s.get(), s.set(v)
//   emu.settle(); emu.posedge(); emu.run(n);
//
// Values are BigInt for signals wider than 32 bits, Number otherwise.

export async function instantiate(bytes, meta) {
  const { instance } = await WebAssembly.instantiate(bytes, {});
  return new Emu(instance.exports, meta);
}

export async function loadFiles(wasmPath) {
  const fs = await import('node:fs');
  const bytes = fs.readFileSync(wasmPath);
  const meta = JSON.parse(fs.readFileSync(wasmPath.replace(/\.wasm$/, '.json'), 'utf8'));
  return instantiate(bytes, meta);
}

export class Emu {
  constructor(ex, meta) {
    this.ex = ex;
    this.meta = meta;
    this.buf = ex.mem.buffer;
    this.u64 = new BigUint64Array(this.buf);
    this.u32 = new Uint32Array(this.buf);
    this.u8 = new Uint8Array(this.buf);
    this.settle = ex.settle;
    this.posedge = ex.posedge;
    this.run = ex.run;
  }
  info(name) {
    const s = this.meta.signals[name];
    if (!s) throw new Error(`no signal ${name}`);
    return s;
  }
  /** a handle on a scalar signal (fast get / set) */
  sig(name) {
    const s = this.info(name);
    const i = s.off / 8, n = s.limbs, u64 = this.u64, u32 = this.u32;
    const mask = (1n << BigInt(s.w)) - 1n;
    if (s.w <= 32) {
      const j = s.off / 4, m = s.w === 32 ? 0xffffffff : (1 << s.w) - 1;
      return { get: () => u32[j], set: (v) => { u32[j] = Number(v) & m; u32[j + 1] = 0; } };
    }
    return {
      get: () => { let v = 0n; for (let k = n - 1; k >= 0; k--) v = (v << 64n) | u64[i + k]; return v; },
      set: (v) => { v = BigInt(v) & mask; for (let k = 0; k < n; k++) { u64[i + k] = v & 0xffffffffffffffffn; v >>= 64n; } },
    };
  }
  /** byte offset of element `idx` of an array (its limbs are little-endian 64-bit words) */
  elemAddr(name, idx) {
    const s = this.info(name);
    return s.off + idx * s.limbs * 8;
  }
  finished() { return this.u32[this.meta.finish / 4] !== 0; }
  /** stop signal `name` (from `veryl-emu --stop`) does (false) or does not (true) end run(n) */
  mute(name, on) { this.u32[this.meta.mute[name] / 4] = on ? 1 : 0; }
}
