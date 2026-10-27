// The translation to WebAssembly (src/jit.rs) runs only in a WebAssembly host, so it is
// tested in Node on the wasm build: the official riscv-tests (RISCV_TESTS, default
// /Users/Shared/ccc/riscv-tests) with nearly every block translated (threshold 2), and Linux
// (examples/rv64/linux/build) booted and given commands with translation off, at threshold 2
// and at the default: the same output, and the speeds.
//   cargo build --release --lib --target wasm32-unknown-unknown && node tests/jit.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const wasmPath = path.join(here, '../target/wasm32-unknown-unknown/release/riscv_emu.wasm');
if (!fs.existsSync(wasmPath)) { console.log('no wasm build (cargo build --release --lib --target wasm32-unknown-unknown): skipped'); process.exit(0); }
const mod = new WebAssembly.Module(fs.readFileSync(wasmPath));

/** a machine; hot = translation threshold (0: off, 1: the default) */
function machine(hot) {
  const x = new WebAssembly.Instance(mod, {}).exports;
  x.rv_init(256);
  x.rv_jit(hot);
  const put = (b) => { const p = x.rv_buf(b.length); new Uint8Array(x.memory.buffer, p, b.length).set(b); };
  const translate = () => {
    const n = x.rv_jit_code();
    const bytes = new Uint8Array(x.memory.buffer, x.rv_buf(0), n).slice();
    const inst = new WebAssembly.Instance(new WebAssembly.Module(bytes), { env: { mem: x.memory, ld: x.jit_ld, st: x.jit_st, ar: x.jit_ar } });
    let slot = x.rv_jit_slot();
    if (slot < 0) slot = x.__indirect_function_table.grow(1);
    x.__indirect_function_table.set(slot, inst.exports.b);
    x.rv_jit_done(slot);
  };
  return {
    x,
    load(b) { put(b); if (x.rv_load_program(b.length)) throw new Error('load'); x.rv_reset(); },
    input(s) { const b = Buffer.from(s); put(b); x.rv_input(b.length); },
    /** run up to n instructions: [output, stop] */
    run(n) {
      let out = '', r = 0;
      const end = x.rv_instret() + n;
      while (x.rv_instret() < end) {
        r = x.rv_run(Math.min(1_000_000, end - x.rv_instret()));
        const k = x.rv_output();
        if (k) out += Buffer.from(new Uint8Array(x.memory.buffer, x.rv_buf(0), k)).toString('latin1');
        if (r === 3) translate();
        if (r === 1 || r === 2) break;
      }
      return [out, r];
    },
  };
}

let bad = 0;
const dir = path.join(process.env.RISCV_TESTS ?? '/Users/Shared/ccc/riscv-tests', 'isa');
if (fs.existsSync(dir)) {
  let pass = 0;
  const fail = [];
  for (const n of fs.readdirSync(dir).sort()) {
    if (!/^rv64.*-[pv]-/.test(n) || n.endsWith('.dump') || n.endsWith('-ma_data')) continue;
    const m = machine(2);
    m.load(fs.readFileSync(path.join(dir, n)));
    const [, r] = m.run(5_000_000);
    if (r === 1 && m.x.rv_finished() === 0x5555) pass++; else fail.push(n);
  }
  console.log(`riscv-tests, every block translated: ${pass} passed${fail.length ? `, FAILED: ${fail.join(' ')}` : ''}`);
  if (fail.length) bad++;
} else console.log('no riscv-tests: skipped');

const fw = path.join(here, '../../examples/rv64/linux/build/opensbi/platform/generic/firmware/fw_payload.bin');
if (fs.existsSync(fw)) {
  const img = fs.readFileSync(fw);
  const cmd = 'echo $((6*7)); ls /bin | wc -l; micropython -c "print(sum(i*i for i in range(100000)))"; echo D$((1+1))NE\r';
  const outs = [];
  for (const hot of [0, 2, 1]) {
    const m = machine(hot);
    m.load(img);
    let t = performance.now(), o = '';
    while (!o.endsWith('rv64:~$ ') && m.x.rv_instret() < 400e6) o += m.run(1_000_000)[0];
    const boot = performance.now() - t, bootN = m.x.rv_instret();
    m.input(cmd);
    t = performance.now();
    o = '';
    while (!o.includes('D2NE') && m.x.rv_instret() < bootN + 200e6) o += m.run(1_000_000)[0];
    const ms = performance.now() - t, n = m.x.rv_instret() - bootN;
    outs.push(o);
    console.log(`Linux, ${hot === 0 ? 'interpreted' : hot === 2 ? 'threshold 2' : 'translated'}: shell after ${(bootN / 1e6).toFixed(0)} M instructions in ${boot.toFixed(0)} ms (${(bootN / boot / 1e3).toFixed(0)} MIPS); `
      + `commands ${(n / 1e6).toFixed(0)} M instructions in ${ms.toFixed(0)} ms (${(n / ms / 1e3).toFixed(0)} MIPS); ${m.x.rv_jit_stats(0)} blocks translated`);
  }
  const same = outs.every((o) => o === outs[0]) && outs[0].includes('333328333350000');
  console.log(same ? 'Linux: the same output' : 'Linux: DIFFERENT output ' + JSON.stringify(outs));
  if (!same) bad++;
} else console.log('no Linux build: skipped');
process.exit(bad ? 1 : 0);
