// Node test: load the built dist/ exactly as the page does and run every
// example's testbenches through the WebAssembly core.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const ctx = {};
vm.createContext(ctx);
for (const f of ['wasm.js', 'examples.js', 'chipdb.js']) vm.runInContext(fs.readFileSync(path.join(dist, f), 'utf8'), ctx);
const { Veryl, fromBase64, gunzip } = createRequire(import.meta.url)(path.join(dist, 'api.cjs'));
const core = await Veryl.load(fromBase64(ctx.VERYL_WASM_B64));

let bad = 0;
const expectFail = new Set(['alu_fail']);
for (const ex of ctx.VERYL_EXAMPLES) {
  const t0 = Date.now();
  let line;
  try {
    const r = core.simulate(ex.files, undefined, { vcd: true });
    if (r.vcd.length !== r.tops.length || !r.vcd.every((v) => v.text.includes('$enddefinitions'))) throw new Error('missing VCD');
    const fails = r.tops.reduce((a, t) => a + t.fails, 0);
    const ok = expectFail.has(ex.id) ? fails > 0 : fails === 0 && r.tops.length > 0;
    if (!ok) bad++;
    line = `${ok ? 'ok  ' : 'FAIL'} ${ex.id.padEnd(9)} simulate ${r.tops.map((t) => `${t.name}:${t.fails ? t.fails + ' fail' : 'PASS'}`).join(' ')}`;
  } catch (e) {
    bad++;
    line = `FAIL ${ex.id.padEnd(9)} ${e.message}`;
  }
  console.log(`${line}  (${Date.now() - t0} ms)`);
}
// synthesis stages: every example's design module; cell counts must equal the CLI's
const cli = path.join(dist, '../../veryl-eda/target/release/veryl-eda');
const haveCli = fs.existsSync(cli);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'veryl2chip-'));
for (const ex of ctx.VERYL_EXAMPLES) {
  if (!ex.synth) continue;
  const t0 = Date.now();
  try {
    const r = core.call({ cmd: 'synth', files: ex.files, top: ex.synth });
    let note = '';
    if (haveCli) {
      const paths = ex.files.map((f) => { const p = path.join(tmp, f.name); fs.writeFileSync(p, f.src); return p; });
      const count = (args) => +/cells: (\d+)/.exec(execFileSync(cli, ['--top', ex.synth, ...args, ...paths], { encoding: 'utf8' }))[1];
      const [o, m] = [count([]), count(['--ice40'])];
      if (o !== r.opt.cells.length || m !== r.map.cells.length) { bad++; note = ` MISMATCH cli opt ${o} map ${m}`; }
      else note = ' = CLI';
    }
    console.log(`${note.includes('MISMATCH') ? 'FAIL' : 'ok  '} ${ex.id.padEnd(9)} synth ${r.top}: gates ${r.raw.cells.length} -> ${r.opt.cells.length}, iCE40 cells ${r.map.cells.length}${note}  (${Date.now() - t0} ms)`);
  } catch (e) {
    bad++;
    console.log(`FAIL ${ex.id.padEnd(9)} synth ${e.message}`);
  }
}

// FPGA place and route in wasm: the bitstream (.asc) must equal the CLI's
{
  const t0 = Date.now();
  core.loadChipdb(await gunzip(fromBase64(ctx.VERYL_CHIPDB_GZ_B64)));
  console.log(`ok   chipdb loaded (${Date.now() - t0} ms)`);
}
for (const ex of ctx.VERYL_EXAMPLES) {
  if (!ex.synth) continue;
  const t0 = Date.now();
  try {
    const r = core.call({ cmd: 'pnr', files: ex.files, top: ex.synth, pcf: ex.pcf ?? null, seed: 1 });
    let note = '';
    if (haveCli) {
      const paths = ex.files.map((f) => { const p = path.join(tmp, f.name); fs.writeFileSync(p, f.src); return p; });
      const asc = path.join(tmp, ex.id + '.asc');
      const extra = ex.pcf ? ['--pcf', path.join(tmp, ex.id + '.pcf')] : [];
      if (ex.pcf) fs.writeFileSync(extra[1], ex.pcf);
      execFileSync(cli, ['--top', ex.synth, '--ice40', '--pnr', 'veryl', ...extra, '--asc', asc, ...paths]);
      if (fs.readFileSync(asc, 'utf8') !== r.asc) { bad++; note = ' .asc DIFFERS from CLI'; } else note = ', .asc = CLI';
      try {
        execFileSync('icepack', [asc, asc + '.bin']);
        if (!fs.readFileSync(asc + '.bin').equals(Buffer.from(r.bin, 'base64'))) { bad++; note += ' .bin DIFFERS from icepack'; }
        else note += ', .bin = icepack';
      } catch { /* icepack not installed */ }
    }
    console.log(`${note.includes('DIFFERS') ? 'FAIL' : 'ok  '} ${ex.id.padEnd(9)} pnr ${r.top}: ${r.lcs.length} LCs, ${r.pips} pips, Fmax ${r.timing.fmax.toFixed(1)} MHz, route ${r.route_iters.join('>')}${note}  (${Date.now() - t0} ms)`);
  } catch (e) {
    // the bare RV32I core is too big for the UP5K (and has 160 IO bits for 39 pins)
    const expected = ex.id === 'rv32i' && /does not fit/.test(e.message);
    if (!expected) bad++;
    console.log(`${expected ? 'ok  ' : 'FAIL'} ${ex.id.padEnd(9)} pnr ${e.message}${expected ? '  (expected)' : ''}`);
  }
}

// ASIC flow in wasm: same cells, wirelength and Fmax as the CLI; legal rows; no overflow
for (const ex of ctx.VERYL_EXAMPLES) {
  if (!ex.synth) continue;
  const t0 = Date.now();
  try {
    const r = core.call({ cmd: 'asic', files: ex.files, top: ex.synth, seed: 1 });
    const problems = [];
    const occ = new Set();
    r.cells.forEach(([row, site, w], i) => {
      if (row >= r.die.rows || site + w > r.die.sites) problems.push(`cell ${i} outside`);
      for (let k = site; k < site + w; k++) { const key = row * 1e6 + k; if (occ.has(key)) problems.push(`overlap at ${row}/${k}`); occ.add(key); }
    });
    if (r.route.overflow) problems.push(`overflow ${r.route.overflow}`);
    if (!r.def.includes('END DESIGN') || !r.verilog.includes('module DFF')) problems.push('missing DEF / Verilog');
    let note = '';
    if (haveCli) {
      const paths = ex.files.map((f) => { const p = path.join(tmp, f.name); fs.writeFileSync(p, f.src); return p; });
      const out = execFileSync(cli, ['--top', ex.synth, '--asic', ...paths], { encoding: 'utf8' });
      const cells = +/cells: (\d+)/.exec(out)[1];
      const wl = +/wirelength (\d+)/.exec(out)[1];
      const fmax = /Fmax ([\d.]+)/.exec(out)[1];
      if (cells !== r.map.cells.length || wl !== Math.round(r.route.wirelength) || fmax !== r.timing.fmax.toFixed(1)) problems.push(`CLI: ${cells} cells, ${wl} µm, ${fmax} MHz`);
      else note = ' = CLI';
    }
    if (problems.length) bad++;
    console.log(`${problems.length ? 'FAIL' : 'ok  '} ${ex.id.padEnd(9)} asic ${r.top}: ${r.map.cells.length} cells, ${r.area.toFixed(0)} µm², ${(r.route.wirelength / 1000).toFixed(2)} mm, Fmax ${r.timing.fmax.toFixed(1)} MHz${note}${problems.length ? ' ' + problems.slice(0, 3).join('; ') : ''}  (${Date.now() - t0} ms)`);
  } catch (e) {
    bad++;
    console.log(`FAIL ${ex.id.padEnd(9)} asic ${e.message}`);
  }
}

// a broken source must come back as a message, not crash the core
try { core.simulate([{ name: 'x.veryl', src: 'module X ( a: input logic ) { assign b = ; }' }]); bad++; console.log('FAIL parse error not reported'); }
catch (e) { console.log(`ok   parse error reported: ${e.message}`); }
console.log(bad ? `${bad} failure(s)` : 'all passed');
process.exit(bad ? 1 : 0);
