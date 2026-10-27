// Rv64Soc on veryl-emu (the design compiled to WebAssembly): the same harness as
// sim/main.cpp (Verilator), in JavaScript.
//
//   node emu/rv64emu.mjs [-t] [-m CYCLES] [-l ADDR:FILE]... [-s SCRIPT] PROG.elf
//
// The program goes straight into the RAM array (ELF segments, or a whole non-ELF file
// at 0x8000_0000); then the clock runs:
//   - UART output goes to stdout, stdin to the UART (raw terminal)
//   - a write of 1 to the ELF's `tohost`: pass (riscv-tests); other values: fail
//   - the finisher (0x0010_0000): 0x5555 = pass, else fail (Linux poweroff)
//   - -s SCRIPT: a line per "$ " prompt; the next prompt after the last line ends the run;
//     a line "!gpio N=V" sets GPIO input N to V instead of being typed
//   - GPIO: a change of the outputs (pins with output enable) prints "[gpio] out=…" on stderr
//   - -t: a line per retired instruction, as `spike -l --log-commits` prints it
//   - -m CYCLES: at most this many cycles (default 100 M; 0 = no limit)
// Exit code: 0 pass, 1 fail, 2 out of cycles.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadFiles } from '../../../veryl-emu/js/emu.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RAM_BASE = 0x80000000n;

const args = process.argv.slice(2);
let maxCycles = 100_000_000, prog = null, script = null, trace = false;
const extra = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '-m') maxCycles = Number(args[++i]);
  else if (a === '-l') { const [ad, f] = args[++i].split(/:(.*)/s); extra.push([BigInt(ad), f]); }
  else if (a === '-s') script = fs.readFileSync(args[++i], 'utf8').split('\n').filter((l, k, all) => k < all.length - 1 || l !== '');
  else if (a === '-t') trace = true;
  else prog = a;
}
if (!prog) { console.error('usage: rv64emu [-m CYCLES] [-l ADDR:FILE]... [-s SCRIPT] PROG.elf'); process.exit(2); }
if (maxCycles === 0) maxCycles = Infinity;

// ---- ELF64 (only what is needed) ----
function loadElf(file) {
  const f = fs.readFileSync(file);
  const parts = [];
  let tohost = 0n;
  if (f.length < 4 || f.readUInt32BE(0) !== 0x7f454c46) { parts.push([RAM_BASE, f]); return { parts, tohost }; }
  const phoff = Number(f.readBigUInt64LE(32)), shoff = Number(f.readBigUInt64LE(40));
  const phentsize = f.readUInt16LE(54), phnum = f.readUInt16LE(56), shentsize = f.readUInt16LE(58), shnum = f.readUInt16LE(60);
  for (let i = 0; i < phnum; i++) {
    const p = phoff + i * phentsize;
    if (f.readUInt32LE(p) !== 1) continue;
    const off = Number(f.readBigUInt64LE(p + 8)), paddr = f.readBigUInt64LE(p + 24);
    const filesz = Number(f.readBigUInt64LE(p + 32)), memsz = Number(f.readBigUInt64LE(p + 40));
    if (memsz === 0) continue;
    const seg = Buffer.alloc(memsz);
    f.copy(seg, 0, off, off + filesz);
    parts.push([paddr, seg]);
  }
  for (let i = 0; i < shnum; i++) {
    const s = shoff + i * shentsize;
    if (f.readUInt32LE(s + 4) !== 2) continue; // SHT_SYMTAB
    const link = f.readUInt32LE(s + 40);
    const stroff = Number(f.readBigUInt64LE(shoff + link * shentsize + 24));
    const off = Number(f.readBigUInt64LE(s + 24)), size = Number(f.readBigUInt64LE(s + 32));
    for (let k = 0; k < size / 24; k++) {
      const e = off + k * 24;
      const name = f.readUInt32LE(e);
      let end = stroff + name;
      while (f[end] !== 0) end++;
      if (f.toString('latin1', stroff + name, end) === 'tohost') tohost = f.readBigUInt64LE(e + 8);
    }
  }
  return { parts, tohost };
}

const emu = await loadFiles(path.join(HERE, '..', 'build', 'emu', 'rv64soc.wasm'));
const P = (n) => emu.sig(n);
const rst = P('i_rst'), rxValid = P('i_rx_valid'), rxData = P('i_rx_data'), rxReady = P('o_rx_ready');
const txValid = P('o_tx_valid'), txData = P('o_tx_data'), fin = P('o_finish'), finCode = P('o_finish_code');
const ret = P('o_ret'), retPc = P('o_ret_pc'), retInsn = P('o_ret_insn'), retWe = P('o_ret_we'), retRd = P('o_ret_rd'), retData = P('o_ret_wdata'), retPrv = P('o_ret_prv');
emu.mute('o_ret', !trace);
const hex = (v, n) => v.toString(16).padStart(n, '0');
const gpioOut = P('o_gpio'), gpioOe = P('o_gpio_oe'), gpioIn = P('i_gpio');
let gpioSeen = 0, gpioIns = 0;
const ramInfo = emu.info('mem');
const ramBytes = BigInt(ramInfo.arr * ramInfo.limbs * 8);

const img = loadElf(prog);
for (const [a, f] of extra) img.parts.push([a, fs.readFileSync(f)]);
for (const [a, bytes] of img.parts) {
  if (a < RAM_BASE || a - RAM_BASE + BigInt(bytes.length) > ramBytes) { console.error(`segment at 0x${a.toString(16)} is outside RAM`); process.exit(2); }
  emu.u8.set(bytes, ramInfo.off + Number(a - RAM_BASE));
}
const tohostAt = img.tohost ? ramInfo.off + Number(img.tohost - RAM_BASE) : -1;

// reset: two cycles with i_rst low (active), then release
rst.set(0); rxValid.set(0);
emu.settle(); emu.posedge(); emu.posedge();
rst.set(1); emu.settle();

// terminal
const rx = [];
let nextLine = 0, last = '';
const scripted = script !== null;
if (!scripted && process.stdin.isTTY) {
  process.stdin.setRawMode(true);
  process.stdin.on('data', (d) => { for (const b of d) { if (b === 3) { process.stdin.setRawMode(false); process.exit(130); } rx.push(b === 10 ? 13 : b); } });
} else if (!scripted) {
  process.stdin.on('data', (d) => { for (const b of d) rx.push(b === 10 ? 13 : b); });
}
const out = [];
const flush = () => { if (out.length) { process.stdout.write(Buffer.from(out)); out.length = 0; } };

const t0 = performance.now();
let cyc = 0, code = 2, done = false;
// riscv-tests are checked through memory (tohost): small chunks keep the cycle count close
const CHUNK = tohostAt >= 0 ? 1024 : 200_000;
while (cyc < maxCycles && !done) {
  if (rx.length && rxReady.get()) {
    // one cycle with a received byte
    rxValid.set(1); rxData.set(rx.shift()); emu.settle();
  }
  const want = rxValid.get() ? 1 : Math.min(CHUNK, maxCycles - cyc);
  const n = want === 1 ? 0 : emu.run(want);
  cyc += n;
  if (n < want) {
    // stopped before an edge (or one cycle at a time): look at this cycle's outputs
    if (trace && ret.get()) {
      const insn = retInsn.get();
      let line = `core   0: ${retPrv.get()} 0x${hex(retPc.get(), 16)} (0x${(insn & 3) !== 3 ? hex(insn, 4) : hex(insn, 8)})`;
      if (retWe.get()) line += ` x${String(retRd.get()).padEnd(2)} 0x${hex(retData.get(), 16)}`;
      process.stdout.write(line + '\n');
    }
    if (txValid.get()) {
      const c = txData.get();
      out.push(c);
      const ch = String.fromCharCode(c);
      if (scripted && last === '$' && ch === ' ') {
        while (nextLine < script.length && script[nextLine].startsWith('!gpio ')) {
          const [n, v] = script[nextLine++].slice(6).split('=').map(Number);
          gpioIns = v ? gpioIns | (1 << n) : gpioIns & ~(1 << n);
          gpioIn.set(gpioIns); emu.settle();
          flush(); process.stderr.write(`[gpio] in=0x${gpioIns.toString(16).padStart(4, '0')}\n`);
        }
        if (nextLine < script.length) { for (const k of script[nextLine++]) rx.push(k.charCodeAt(0)); rx.push(13); }
        else { code = 0; done = true; }
      }
      last = ch;
    }
    if (fin.get()) {
      const v = finCode.get();
      code = (v & 0xffff) === 0x5555 ? 0 : 1;
      if (code) { flush(); console.error(`finisher: 0x${v.toString(16)}`); }
      done = true;
    }
    emu.posedge(); cyc++;
    if (rxValid.get()) { rxValid.set(0); emu.settle(); }
  }
  // GPIO outputs (looked at between run slices)
  { const g = gpioOut.get() & gpioOe.get(); if (g !== gpioSeen) { gpioSeen = g; flush(); process.stderr.write(`[gpio] out=0x${g.toString(16).padStart(4, '0')}\n`); } }
  if (tohostAt >= 0) {
    const v = emu.u64[tohostAt / 8];
    if (v !== 0n) {
      if (v === 1n) code = 0;
      else { code = 1; flush(); console.error(`FAIL: test ${v >> 1n} (tohost = 0x${v.toString(16)})`); }
      done = true;
    }
  }
  if (out.length > 4096 || (out.length && !scripted)) flush();
  // let the terminal input in (interactive)
  if (!scripted && process.stdin.isTTY) await new Promise((r) => setImmediate(r));
}
flush();
if (!scripted && process.stdin.isTTY) process.stdin.setRawMode(false);
const sec = (performance.now() - t0) / 1000;
const speed = `${sec.toFixed(1)} s, ${(cyc / sec / 1e6).toFixed(2)} MHz`;
if (code === 2) console.error(`\nTIMEOUT after ${cyc} cycles (${speed})`);
else console.error(`\n${code === 0 ? 'PASS' : 'FAIL'} after ${cyc} cycles (${speed})`);
process.exit(code);
