// Node test: load the built dist/ exactly as the page does and run every
// example's testbenches through the WebAssembly core.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { execFileSync, spawnSync } from 'node:child_process';
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
// the Veryl files of an example (the C examples also have a .c program); examples on
// the same hardware as another one (same_hw) are checked as programs, below
const vfiles = (ex) => ex.files.filter((f) => f.name.endsWith('.veryl'));
const HW = ctx.VERYL_EXAMPLES.filter((ex) => !ex.same_hw).map((ex) => ({ ...ex, files: vfiles(ex) }));
for (const ex of HW) {
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
// post-synthesis simulation: the same testbenches with the design module
// replaced by its generic / iCE40 / standard-cell netlist give the RTL result
for (const ex of HW) {
  if (!ex.synth) continue;
  const rtl = core.simulate(ex.files).tops.map((t) => `${t.name}:${t.fails}`).join(' ');
  for (const gate of ['opt', 'ice40', 'asic']) {
    const t0 = Date.now();
    try {
      const r = core.call({ cmd: 'simulate', files: ex.files, top: null, max_time: 1_000_000, vcd: false, gate, synth: ex.synth });
      const got = r.tops.map((t) => `${t.name}:${t.fails}`).join(' ');
      const ok = got === rtl;
      if (!ok) bad++;
      console.log(`${ok ? 'ok  ' : 'FAIL'} ${ex.id.padEnd(9)} gate-level ${gate.padEnd(5)} ${r.gate.cells} cells: ${got}${ok ? ' = RTL' : ` (RTL ${rtl})`}  (${Date.now() - t0} ms)`);
    } catch (e) {
      bad++;
      console.log(`FAIL ${ex.id.padEnd(9)} gate-level ${gate} ${e.message}`);
    }
  }
}

// synthesis stages: every example's design module; cell counts must equal the CLI's
const cli = path.join(dist, '../../veryl-eda/target/release/veryl-eda');
const haveCli = fs.existsSync(cli);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'veryl2chip-'));
for (const ex of HW) {
  if (!ex.synth) continue;
  const t0 = Date.now();
  try {
    const r = core.call({ cmd: 'synth', files: ex.files, top: ex.synth });
    let note = '';
    if (haveCli) {
      const paths = ex.files.map((f) => { const p = path.join(tmp, f.name); fs.writeFileSync(p, f.src); return p; });
      const count = (args) => +/cells: (\d+)/.exec(execFileSync(cli, ['--top', ex.synth, ...args, ...paths], { encoding: 'utf8' }))[1];
      const [o, m] = [count([]), count(['--ice40'])];
      if (o !== (r.opt.n ?? r.opt.cells.length) || m !== r.map.cells.length) { bad++; note = ` MISMATCH cli opt ${o} map ${m}`; }
      else note = ' = CLI';
    }
    console.log(`${note.includes('MISMATCH') ? 'FAIL' : 'ok  '} ${ex.id.padEnd(9)} synth ${r.top}: gates ${r.raw.n ?? r.raw.cells.length} -> ${r.opt.n ?? r.opt.cells.length}${r.opt.n ? ' (not sent: too big to draw)' : ''}, iCE40 cells ${r.map.cells.length}${note}  (${Date.now() - t0} ms)`);
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
for (const ex of HW) {
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
// (not for the SoC with 8 KB of SRAM macros: detailed routing around big macros is still slow)
for (const ex of HW) {
  if (!ex.synth || ex.asic === false) continue;
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

// the ASIC flow on SkyWater SKY130 (pdk: 'sky130'): library cell names, a clean DRC, the GDS
// (asic_gds) with its header and the same counts as the CLI's --gds
for (const id of ['tut_blinky', 'seq101', 'lab_traffic']) {
  const ex = ctx.VERYL_EXAMPLES.find((e) => e.id === id);
  const t0 = Date.now();
  try {
    const r = core.call({ cmd: 'asic', files: ex.files, top: ex.synth, seed: 1, pdk: 'sky130' });
    const problems = [];
    const d = r.drc;
    if (r.pdk !== 'sky130_fd_sc_hd' || r.layers[0] !== 'met1') problems.push(`pdk ${r.pdk} ${r.layers}`);
    if (!d || d.shorts + d.spacing + d.area + d.opens) problems.push(`DRC ${JSON.stringify(d)}`);
    if (!r.verilog.includes('sky130_fd_sc_hd__dfrtp_1') && !r.verilog.includes('sky130_fd_sc_hd__dfxtp_1')) problems.push('no SKY130 flip-flop in the Verilog');
    if (!r.def.includes('unithd') || !r.def.includes('L1M1_PR')) problems.push('DEF without unithd / L1M1_PR');
    const g = core.call({ cmd: 'asic_gds' });
    const bytes = Buffer.from(g.gds, 'base64');
    if (bytes.length !== d.gds_bytes || bytes.readUInt16BE(2) !== 0x0002) problems.push(`GDS ${bytes.length} bytes`);
    let note = '';
    if (haveCli) {
      const paths = ex.files.map((f) => { const p = path.join(tmp, f.name); fs.writeFileSync(p, f.src); return p; });
      const gp = path.join(tmp, 'x.gds');
      const out = execFileSync(cli, ['--top', ex.synth, '--asic', '--pdk', 'sky130', '--gds', gp, ...paths], { encoding: 'utf8' });
      const m = /wrote .*\((\d+) bytes: (\d+) cell instances/.exec(out);
      if (!m || +m[1] !== bytes.length || +m[2] !== d.instances || !fs.readFileSync(gp).equals(bytes)) problems.push(`CLI: ${m && m[0]}`);
      else note = ' = CLI';
    }
    if (problems.length) bad++;
    console.log(`${problems.length ? 'FAIL' : 'ok  '} ${id.padEnd(9)} sky130 ${r.top}: ${r.map.cells.length} cells, DRC ${d ? d.shorts + d.spacing + d.area + d.opens : '?'}, GDS ${bytes.length} bytes${note}${problems.length ? ' ' + problems.slice(0, 3).join('; ') : ''}  (${Date.now() - t0} ms)`);
  } catch (e) {
    bad++;
    console.log(`FAIL ${id.padEnd(9)} sky130 ${e.message}`);
  }
}

// virtual board (board_load / board_run / board_reset): the tutorial designs
// on the iCEBreaker's pins and the RISC-V SoC's LEDs on PMOD1A
{
  const t0 = Date.now();
  const problems = [];
  const ex = (id) => ctx.VERYL_EXAMPLES.find((e) => e.id === id);
  const duty = (r) => Object.fromEntries(r.duty);
  // lesson 1: over whole turns of the 24-bit counter the top bit (LED5, pin 21) is high half the time
  let b = ex('tut_blinky');
  let info = core.call({ cmd: 'board_load', files: b.files, top: 'Blinky', pcf: b.pcf });
  if (info.warnings.length) problems.push('Blinky warnings ' + info.warnings.join('; '));
  let r = core.call({ cmd: 'board_run', cycles: 1 << 24, inputs: [] });
  let d = duty(r);
  if (Math.abs(d[21] - 0.5) > 1e-6 || Math.abs(d[11] - 0.5) > 1e-6) problems.push(`Blinky duty LED5 ${d[21]}, LEDR_N ${d[11]}`);
  // holding BTN_N (pin 10, pressed = 0) keeps the counter at 0: LEDs dark, LEDR_N high (dark), LEDG_N low (lit)
  r = core.call({ cmd: 'board_run', cycles: 1000, inputs: [[10, 0]] });
  d = duty(r);
  if (d[26] !== 0 || d[21] !== 0 || d[11] !== 1 || d[37] !== 0) problems.push('Blinky reset ' + JSON.stringify(d));
  core.call({ cmd: 'board_run', cycles: 0, inputs: [[10, 1]] });
  // lesson 2: one light, frozen while BTN1 (pin 20) is held
  b = ex('tut_knight');
  core.call({ cmd: 'board_load', files: b.files, top: 'KnightRider', pcf: b.pcf });
  const pos = () => [26, 27, 25, 23, 21].map((p) => duty(core.call({ cmd: 'board_run', cycles: 0, inputs: [] }))[p]);
  core.call({ cmd: 'board_run', cycles: 3_000_000, inputs: [] });
  const moving = pos();
  if (moving.filter((x) => x === 1).length !== 1) problems.push('KnightRider lights ' + moving);
  core.call({ cmd: 'board_run', cycles: 100, inputs: [[20, 1]] });
  const held = pos().join();
  core.call({ cmd: 'board_run', cycles: 6_000_000, inputs: [] });
  if (pos().join() !== held) problems.push('KnightRider moved while BTN1 was held');
  core.call({ cmd: 'board_run', cycles: 1_600_000, inputs: [[20, 0]] });
  if (pos().join() === held) problems.push('KnightRider did not move after BTN1');
  // the SoC: Fibonacci(10) = 55 on o_led (PMOD1A), and again after a power cycle
  b = ex('soc');
  core.call({ cmd: 'board_load', files: b.files, top: 'RiscvSoc', pcf: b.pcf });
  const led = () => { const x = duty(core.call({ cmd: 'board_run', cycles: 0, inputs: [] })); return [4, 2, 47, 45, 3, 48, 46, 44].reduce((a, p, i) => a | (x[p] << i), 0); };
  core.call({ cmd: 'board_run', cycles: 200, inputs: [] });
  const first = led();
  core.call({ cmd: 'board_reset' });
  const after = led();
  core.call({ cmd: 'board_run', cycles: 200, inputs: [] });
  if (first !== 55 || after !== 0 || led() !== 55) problems.push(`SoC LEDs ${first}, after power cycle ${after} -> ${led()}`);
  // M13: the real bitstream (synthesis, own place and route, .bin, decoded) and the same .bin uploaded
  b = ex('tut_blinky');
  const fl = core.call({ cmd: 'board_flash', files: b.files, top: 'Blinky', pcf: b.pcf });
  if (fl.mode !== 'bitstream' || !(fl.fmax > 12) || !fl.bin || fl.warnings.length) problems.push(`Blinky flash: ${fl.mode}, Fmax ${fl.fmax}, ${fl.warnings.join('; ')}`);
  d = duty(core.call({ cmd: 'board_run', cycles: 1 << 24, inputs: [] }));
  if (Math.abs(d[21] - 0.5) > 1e-6 || Math.abs(d[11] - 0.5) > 1e-6) problems.push(`Blinky bitstream duty LED5 ${d[21]}, LEDR_N ${d[11]}`);
  const up = core.call({ cmd: 'board_load_bin', bin: fl.bin, name: 'Blinky.bin' });
  if (up.mode !== 'bin' || up.cells.lc !== fl.cells.lc) problems.push(`uploaded .bin: ${up.cells.lc} LCs vs ${fl.cells.lc}`);
  d = duty(core.call({ cmd: 'board_run', cycles: 1 << 24, inputs: [] }));
  if (Math.abs(d[21] - 0.5) > 1e-6) problems.push(`uploaded Blinky duty ${d[21]}`);
  b = ex('tut_knight');
  core.call({ cmd: 'board_flash', files: b.files, top: 'KnightRider', pcf: b.pcf });
  core.call({ cmd: 'board_run', cycles: 3_000_000, inputs: [] });
  core.call({ cmd: 'board_run', cycles: 100, inputs: [[20, 1]] });
  const held2 = pos().join();
  core.call({ cmd: 'board_run', cycles: 6_000_000, inputs: [] });
  if (pos().join() !== held2 || pos().filter((x) => x === 1).length !== 1) problems.push('KnightRider bitstream: BTN1 does not hold the light');
  // M14 peripherals: the USB terminal (lesson 3), the seven-segment module, the VGA monitor
  b = ex('tut_uart');
  core.call({ cmd: 'board_load', files: b.files, top: 'UartEcho', pcf: b.pcf });
  core.call({ cmd: 'board_periph', uart: { tx: 9, rx: 6, cpb: 12e6 / 115200 } });
  let txt = '';
  const term = (r) => { txt += String.fromCharCode(...r.uart.rx); return r; };
  term(core.call({ cmd: 'board_run', cycles: 10000, inputs: [] }));
  term(core.call({ cmd: 'board_run', cycles: 20000, inputs: [], uart_send: 'Veryl!' }));
  if (txt !== 'Hi!\r\nvERYL!') problems.push('UART terminal: ' + JSON.stringify(txt));
  b = ex('sevenseg');
  core.call({ cmd: 'board_load', files: b.files, top: 'SevenSeg', pcf: b.pcf });
  core.call({ cmd: 'board_periph', seg: [{ segs: [4, 2, 47, 45, 3, 48, 46, null], sels: [[44, 0], [44, 1]], on: 1 }] });
  core.call({ cmd: 'board_run', cycles: 3_000_000 * 12 + 1000, inputs: [] }); // 12 ticks of 0.25 s
  const sg = core.call({ cmd: 'board_run', cycles: 100_000, inputs: [] }).segs[0];
  const digits = sg.map((d) => d.slice(0, 7).map((x) => (x > 0.2 ? 1 : 0)).reverse().join(''));
  if (digits.join() !== '1011011,0000110') problems.push('7-segment shows ' + digits.join());
  b = ex('vga');
  core.call({ cmd: 'board_load', files: b.files, top: 'VgaDemo', pcf: b.pcf });
  core.call({ cmd: 'board_periph', vga: { hs: 42, vs: 36, r: [45, 47, 2, 4], g: [31, 34, 38, 43], b: [44, 46, 48, 3] } });
  const vr = core.call({ cmd: 'board_run', cycles: 800 * 525 * 2 + 100, inputs: [], vga_seen: 0 }).vga;
  if (!vr.rle || vr.w !== 800 || vr.h !== 525) problems.push(`VGA frame ${vr.w}x${vr.h}`);
  else {
    const raw = Buffer.from(vr.rle, 'base64');
    const px = [];
    for (let i = 0; i + 3 < raw.length; i += 4) for (let k = 0; k < raw.readUInt16LE(i + 2); k++) px.push(raw.readUInt16LE(i));
    for (const x of [10, 100, 300, 600]) {
      const rgb = ((x >> 7) ^ ((x >> 6) & 1)) & 7;
      const want = (rgb & 4 ? 0xf00 : 0) | (rgb & 2 ? 0x0f0 : 0) | (rgb & 1 ? 0x00f : 0);
      const got = px[((240 + 35) % 525) * 800 + ((x + 144) % 800)];
      if (got !== want) problems.push(`VGA pixel x ${x}: ${got} != ${want}`);
    }
  }
  // M16 labs: one press adds one (BTN1 = 20, BTN2 = 19 clears); the traffic light's pedestrian button
  b = ex('lab_counter');
  core.call({ cmd: 'board_load', files: b.files, top: 'ButtonCounter', pcf: b.pcf });
  for (let i = 0; i < 3; i++) { core.call({ cmd: 'board_run', cycles: 1000, inputs: [[20, 1]] }); core.call({ cmd: 'board_run', cycles: 1000, inputs: [[20, 0]] }); }
  const presses = led();
  core.call({ cmd: 'board_run', cycles: 100, inputs: [[19, 1]] });
  core.call({ cmd: 'board_run', cycles: 100, inputs: [[19, 0]] });
  if (presses !== 3 || led() !== 0) problems.push(`button counter ${presses}, cleared ${led()}`);
  b = ex('lab_traffic');
  core.call({ cmd: 'board_load', files: b.files, top: 'TrafficLight', pcf: b.pcf });
  const rgy = () => { const x = duty(core.call({ cmd: 'board_run', cycles: 0, inputs: [] })); return [4, 2, 47].map((p) => x[p]).join(''); };
  const green = rgy();
  core.call({ cmd: 'board_run', cycles: 1000, inputs: [[20, 1]] });
  core.call({ cmd: 'board_run', cycles: 12_000_000, inputs: [[20, 0]] });
  if (green !== '001' || rgy() !== '010') problems.push(`traffic light ${green} -> ${rgy()} (want 001 -> 010)`);
  if (problems.length) bad++;
  console.log(`${problems.length ? 'FAIL' : 'ok  '} board    terminal (Hi!, echo), 7-segment 12, VGA color bars, labs (button counter, traffic light); bitstream: Blinky (Fmax ${fl.fmax?.toFixed(1)} MHz) and its uploaded .bin, KnightRider + BTN1; netlist: Blinky duty, KnightRider + BTN1, RiscvSoc LED = 55 (and after a power cycle)${problems.length ? ': ' + problems.join(' | ') : ''}  (${Date.now() - t0} ms)`);
}

// project export: the .zip (stored, CRC-32) must unpack, and with the
// official veryl CLI the unpacked project must check and pass its tests
{
  const esbuild = await import('esbuild');
  const js = esbuild.buildSync({ entryPoints: [path.join(dist, '../src/templates.ts')], bundle: true, format: 'cjs', platform: 'node', write: false }).outputFiles[0].text;
  const tpl = path.join(tmp, 'templates.cjs');
  fs.writeFileSync(tpl, js);
  const { projectZip, newModule } = createRequire(import.meta.url)(tpl);
  const ex = ctx.VERYL_EXAMPLES.find((e) => e.id === 'uart');
  const files = [...ex.files, { name: 'blinky.veryl', src: newModule('Blinky') }];
  const zipPath = path.join(tmp, 'uart project.zip');
  fs.writeFileSync(zipPath, projectZip('uart project', files));
  const t0 = Date.now();
  try {
    const out = path.join(tmp, 'unzipped');
    execFileSync('unzip', ['-q', '-o', zipPath, '-d', out]);
    const dir = path.join(out, 'uart_project');
    const got = fs.readdirSync(path.join(dir, 'src')).sort().join(' ');
    if (got !== 'blinky.veryl uart.veryl') throw new Error(`zip contents: ${got}`);
    let note = 'unzip ok';
    let veryl = null;
    try { veryl = execFileSync('which', ['veryl'], { encoding: 'utf8' }).trim(); } catch { /* not installed */ }
    if (veryl) {
      execFileSync(veryl, ['check'], { cwd: dir, stdio: 'pipe' });
      // veryl logs to stderr
      const t = spawnSync(veryl, ['test'], { cwd: dir, encoding: 'utf8' });
      const ok = ((t.stdout + t.stderr).match(/Succeeded test/g) ?? []).length;
      if (ok !== 2) throw new Error(`veryl test: ${ok} of 2 tests succeeded`);
      note += ', veryl check + veryl test (2 tests) ok';
    }
    console.log(`ok   export   .zip of uart + a new-file template: ${note}  (${Date.now() - t0} ms)`);
  } catch (e) {
    bad++;
    console.log(`FAIL export   ${e.message}`);
  }
}

// C programs (src/rv): every C example compiles and runs on the instruction-set simulator; on
// the virtual board RvBoard runs them from its block RAM: c_hello greets and echoes, then the
// switches program replaces it without synthesis (board_program), as a netlist and in the bitstream
{
  const t0 = Date.now();
  const problems = [];
  const ex = (id) => ctx.VERYL_EXAMPLES.find((e) => e.id === id);
  const cOf = (e) => e.files.find((f) => f.name.endsWith('.c'));
  const sizes = [];
  for (const e of ctx.VERYL_EXAMPLES.filter((x) => cOf(x))) {
    const c = cOf(e);
    const r = core.call({ cmd: 'cc', src: c.src, name: c.name, run: 300000 });
    if (!r.compiled) { problems.push(`${e.id}: ${r.errors.map((x) => x.line + ': ' + x.msg).join('; ')}`); continue; }
    sizes.push(`${c.name} ${r.size}`);
    if (r.run.error) problems.push(`${e.id}: ${r.run.error}`);
  }
  const prog = (id) => { const c = cOf(ex(id)); return core.call({ cmd: 'cc', src: c.src, name: c.name, run: 200000 }); };
  const hello = prog('c_hello');
  const sw = prog('c_switches');
  if (!hello.run.tx.startsWith('Hello from C')) problems.push('hello on the ISS: ' + JSON.stringify(hello.run.tx.slice(0, 40)));
  const badc = core.call({ cmd: 'cc', src: 'int main(void) {\n  x = 1;\n}\n', name: 'bad.c' });
  if (badc.compiled || badc.errors[0]?.line !== 2) problems.push('compile error ' + JSON.stringify(badc.errors));
  const b = ex('c_hello');
  const vf = b.files.filter((f) => f.name.endsWith('.veryl'));
  const SW = [43, 38, 34, 31, 42, 36, 32, 28];
  const onBoard = (what, info) => {
    if (!info.program_mem || info.program !== hello.size) problems.push(`${what}: program_mem ${info.program_mem}, program ${info.program}`);
    core.call({ cmd: 'board_periph', uart: { tx: 9, rx: 6, cpb: 104 } });
    let txt = '';
    const run = (cycles, extra = {}) => { const r = core.call({ cmd: 'board_run', cycles, inputs: [], ...extra }); txt += String.fromCharCode(...r.uart.rx); return r; };
    run(150000);
    run(60000, { uart_send: 'ab' });
    if (!txt.startsWith('Hello from C') || !txt.includes('AB')) problems.push(`${what} hello: ${JSON.stringify(txt.slice(0, 30))}...${JSON.stringify(txt.slice(-20))}`);
    const p = core.call({ cmd: 'board_program', program: sw.bin });
    if (p.bytes !== sw.size || (what === 'bitstream') !== !!p.bin) problems.push(`${what} board_program ${p.bytes} bytes, bin ${!!p.bin}`);
    core.call({ cmd: 'board_periph', uart: { tx: 9, rx: 6, cpb: 104 } });
    txt = '';
    run(100000, { inputs: SW.map((pin, i) => [pin, i === 0 || i === 7 ? 1 : 0]) });
    const d = Object.fromEntries(run(1000).duty);
    if (!txt.includes('switches 10000001 = 0x81 = 129') || d[4] !== 1 || d[44] !== 1 || d[2] !== 0) problems.push(`${what} switches: ${JSON.stringify(txt)} LED ${d[4]} ${d[44]} ${d[2]}`);
  };
  onBoard('netlist', core.call({ cmd: 'board_load', files: vf, top: 'RvBoard', pcf: b.pcf, program: hello.bin }));
  const tb = Date.now();
  const fl = core.call({ cmd: 'board_flash', files: vf, top: 'RvBoard', pcf: b.pcf, program: hello.bin });
  if (fl.mode !== 'bitstream' || fl.cells.ram !== 20) problems.push(`flash ${fl.mode}, ${fl.cells.ram} RAMs`);
  onBoard('bitstream', fl);
  onBoard('cpu', core.call({ cmd: 'board_load_cpu', program: hello.bin, pcf: b.pcf, top: 'RvBoard' }));
  // VGA text mode in the CPU mode: the title in yellow on dark blue
  const v = ex('c_vga');
  core.call({ cmd: 'board_load_cpu', program: prog('c_vga').bin, pcf: v.pcf, top: 'RvVgaBoard' });
  core.call({ cmd: 'board_periph', uart: { tx: 9, rx: 6, cpb: 104 }, vga: { hs: 42, vs: 36, r: [45, 47, 2, 4], g: [31, 34, 38, 43], b: [44, 46, 48, 3] } });
  const vf2 = core.call({ cmd: 'board_run', cycles: 1_400_000, inputs: [], vga_seen: 0 }).vga;
  let yellow = 0;
  if (vf2?.rle) { const raw = Buffer.from(vf2.rle, 'base64'); for (let i = 0; i + 3 < raw.length; i += 4) if (raw.readUInt16LE(i) === 0xff0) yellow += raw.readUInt16LE(i + 2); }
  if (vf2?.w !== 800 || vf2?.h !== 525 || yellow < 2000) problems.push(`VGA text: ${vf2?.w}x${vf2?.h}, ${yellow} yellow pixels`);
  // the CPU board's speed (the instruction-set simulator): virtual seconds per second
  core.call({ cmd: 'board_load_cpu', program: prog('c_knight').bin, pcf: b.pcf, top: 'RvBoard' });
  const tc = Date.now();
  core.call({ cmd: 'board_run', cycles: 6_000_000, inputs: [] });
  const cpuSpeed = 0.5 / ((Date.now() - tc) / 1000);
  if (problems.length) bad++;
  console.log(`${problems.length ? 'FAIL' : 'ok  '} c        ${sizes.join(', ')} bytes; ISS; RvBoard netlist + bitstream (Fmax ${fl.fmax?.toFixed(1)} MHz, ${((Date.now() - tb) / 1000).toFixed(0)} s) + CPU mode (${cpuSpeed.toFixed(1)}x real time): hello + echo, program swapped to switches; VGA text mode${problems.length ? ': ' + problems.join(' | ') : ''}  (${Date.now() - t0} ms)`);
}

// breadboard model (src/ide/bbmodel.ts): LEDs, resistors, pull-downs, floating inputs, shorts, buttons
{
  const esbuild = await import('esbuild');
  const js = esbuild.buildSync({ entryPoints: [path.join(dist, '../src/ide/bbmodel.ts')], bundle: true, format: 'cjs', platform: 'node', write: false }).outputFiles[0].text;
  const bp = path.join(tmp, 'bbmodel.cjs');
  fs.writeFileSync(bp, js);
  const { solve } = createRequire(import.meta.url)(bp);
  const problems = [];
  const P = (id, kind, a, b, extra = {}) => ({ id, kind, a, b, ...extra });
  // pin 4 (duty 0.5) -> LED -> resistor -> GND rail -> GND
  let parts = [P(1, 'wire', 'p:4', 'h:2:a'), P(2, 'led', 'h:2:c', 'h:3:c'), P(3, 'res', 'h:3:e', 'r:top-:3'), P(4, 'wire', 'gnd', 'r:top-:1')];
  let r = solve(parts, new Map([[4, 0.5]]), new Set(), new Set());
  if (Math.abs(r.led.get(2) - 0.5) > 1e-9 || r.warnings.length) problems.push(`LED with resistor: ${r.led.get(2)} ${r.warnings}`);
  // the same LED straight to GND: lit, but no current limit
  r = solve([P(1, 'wire', 'p:4', 'h:2:a'), P(2, 'led', 'h:2:c', 'h:3:c'), P(3, 'wire', 'h:3:e', 'gnd')], new Map([[4, 1]]), new Set(), new Set());
  if (r.led.get(2) !== 1 || !r.warnings.some((w) => w.includes('LED'))) problems.push('LED without resistor: ' + r.warnings);
  // switch from 3V3 to input pin 43 with a pull-down
  const sw = (on, pulldown) => [P(1, 'wire', 'vcc', 'r:top+:30'), P(2, 'sw', 'r:top+:20', 'h:20:a', { on }), P(3, 'wire', 'h:20:b', 'p:43'),
    ...(pulldown ? [P(4, 'res', 'h:20:e', 'r:top-:21'), P(5, 'wire', 'gnd', 'r:top-:1')] : [])];
  for (const [on, want] of [[false, 0], [true, 1]]) {
    r = solve(sw(on, true), new Map(), new Set([43]), new Set());
    if (r.inputs.get(43) !== want || r.warnings.length) problems.push(`switch ${on}: ${r.inputs.get(43)} ${r.warnings}`);
  }
  r = solve(sw(false, false), new Map(), new Set([43]), new Set());
  if (!r.warnings.some((w) => w.includes('43'))) problems.push('floating input not reported');
  // a short: output pin 4 wired to GND
  r = solve([P(1, 'wire', 'p:4', 'h:5:a'), P(2, 'wire', 'h:5:b', 'gnd')], new Map([[4, 1]]), new Set(), new Set());
  if (!r.warnings.some((w) => /短路|Short/.test(w))) problems.push('short not reported');
  // a button pulls input 38 up only while it is held
  const btn = [P(1, 'wire', 'vcc', 'h:8:a'), P(2, 'btn', 'h:8:b', 'h:10:b'), P(3, 'wire', 'h:10:a', 'p:38'), P(4, 'res', 'h:10:e', 'gnd')];
  if (solve(btn, new Map(), new Set([38]), new Set()).inputs.get(38) !== 0 || solve(btn, new Map(), new Set([38]), new Set([2])).inputs.get(38) !== 1) problems.push('button');
  // the lab examples come wired without warnings; the traffic light's yellow LED follows pin 2
  for (const id of ['lab_gates', 'lab_traffic']) {
    const e = ctx.VERYL_EXAMPLES.find((x) => x.id === id);
    r = solve(e.board.bb, new Map([[4, 0], [2, 1], [47, 0], [45, 0]]), new Set([43, 38]), new Set());
    if (r.warnings.length) problems.push(`${id}: ${r.warnings}`);
    if (id === 'lab_traffic' && [4, 8, 12].map((k) => r.led.get(k)).join() !== '0,1,0') problems.push('traffic LEDs ' + [...r.led]);
  }
  if (problems.length) bad++;
  console.log(`${problems.length ? 'FAIL' : 'ok  '} bb       LED + resistor, missing resistor, pull-down switch, floating input, short, button, lab wiring${problems.length ? ': ' + problems.join(' | ') : ''}`);
}

// IDE highlighter: lossless (tags removed = source) on every example, and
// keywords / numbers / comments tagged
{
  const esbuild = await import('esbuild');
  const js = esbuild.buildSync({ entryPoints: [path.join(dist, '../src/ide/highlight.ts')], bundle: true, format: 'cjs', platform: 'node', write: false }).outputFiles[0].text;
  const hp = path.join(tmp, 'highlight.cjs');
  fs.writeFileSync(hp, js);
  const { highlight, langOf } = createRequire(import.meta.url)(hp);
  const unesc = (h) => h.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  let n = 0, lossy = '';
  for (const ex of ctx.VERYL_EXAMPLES) for (const f of ex.files) {
    n++;
    if (unesc(highlight(f.src, langOf(f.name)).join('\n')) !== f.src) lossy ||= `${ex.id}/${f.name}`;
  }
  // C and assembly
  const hc = highlight('#define LED 1\nint main(void) { /* c */ return 0x1F; } // x', 'c').join('\n');
  const ha = highlight('loop:\n    addi a0, a0, -1   # count\n    .word 5', 'asm').join('\n');
  const taggedC = ['t-attr">#define', 't-type">int', 't-kw">return', 't-num">0x1F', 't-com">// x', 't-name">LED'].every((t) => hc.includes(t))
    && ['t-name">loop:', 't-kw">addi', 't-type">a0', 't-num">-1', 't-com"># count', 't-attr">.word'].every((t) => ha.includes(t));
  const h = highlight("module M { // c\n  var a: logic<8> = 8'hFF; /* x\n y */ $assert(a); }").join('\n');
  const tagged = ['t-kw">module', 't-type">logic', "t-num\">8'hFF", 't-com">// c', 't-com"> y */', 't-sys">$assert', 't-name">M'].every((t) => h.includes(t));
  if (lossy || !tagged || !taggedC) bad++;
  console.log(`${lossy || !tagged || !taggedC ? 'FAIL' : 'ok  '} ide       highlighter on ${n} files (Veryl, C, assembly)${lossy ? ': changes ' + lossy : ''}${tagged && taggedC ? '' : ': tokens not tagged'}`);
}

// interface languages: every tr('繁體', 'English') pair in the sources has
// Chinese-free English, and its Simplified form keeps no Traditional-only character
{
  const esbuild = await import('esbuild');
  const js = esbuild.buildSync({ entryPoints: [path.join(dist, '../src/i18n.ts')], bundle: true, format: 'cjs', platform: 'node', write: false }).outputFiles[0].text;
  const ip = path.join(tmp, 'i18n.cjs');
  fs.writeFileSync(ip, js);
  const { hans } = createRequire(import.meta.url)(ip);
  const srcDir = path.join(dist, '../src');
  const files = ['synth/overlay.ts', 'synth/compare.ts', 'synth/layouts.ts', 'wave.ts', 'client.ts', 'ide/main.ts', 'ide/board.ts', 'ide/breadboard.ts', 'ide/bbmodel.ts'];
  const han = /[\u3400-\u9fff]/;
  const trad = new Set('極製複貼麵學擊繼虛鈕鎖並佈佔來個側傳價優內兩別則動問啟單圖執塊實寫專對層帶庫後從態應換擁數斷時會條標樣機檔檢歡決沒測準滿為無熱狀現產畫發碼種稱節範簡約紅級細終組結給統經綠網線編緩縮總繞續腳與藍號術補裡規視計訊記設註試該語說調請證讀變讓負資軌較載輪輸轉這連週進過達違選還邊邏錄錯鍵鏈長閉開間閘關階際隨雙離電靜頁頂項順須預題顏類顯餘驅驗體鬆黃點');
  let pairs = 0, badEn = [], badHans = [];
  for (const f of files) {
    const src = fs.readFileSync(path.join(srcDir, f), 'utf8');
    for (const m of src.matchAll(/tr\((['`])((?:(?!\1)[^\\]|\\.)*)\1,\s*(['`])((?:(?!\3)[^\\]|\\.)*)\3\)/g)) {
      pairs++;
      if (han.test(m[4])) badEn.push(m[4].slice(0, 40));
      const h = hans(m[2]);
      if ([...h].some((c) => trad.has(c))) badHans.push(h.slice(0, 40));
    }
  }
  const ok = pairs > 150 && !badEn.length && !badHans.length;
  if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} i18n     ${pairs} tr() pairs${badEn.length ? '; Chinese in English: ' + badEn.slice(0, 3).join(' | ') : ''}${badHans.length ? '; not simplified: ' + badHans.slice(0, 3).join(' | ') : ''}; ${hans('檔案總管：模擬退火後繞線')}`);
}

// a broken source must come back as a message, not crash the core
try { core.simulate([{ name: 'x.veryl', src: 'module X ( a: input logic ) { assign b = ; }' }]); bad++; console.log('FAIL parse error not reported'); }
catch (e) { console.log(`ok   parse error reported: ${e.message}`); }
console.log(bad ? `${bad} failure(s)` : 'all passed');
process.exit(bad ? 1 : 0);
