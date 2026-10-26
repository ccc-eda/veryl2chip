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
// post-synthesis simulation: the same testbenches with the design module
// replaced by its generic / iCE40 / standard-cell netlist give the RTL result
for (const ex of ctx.VERYL_EXAMPLES) {
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
  if (problems.length) bad++;
  console.log(`${problems.length ? 'FAIL' : 'ok  '} board    bitstream: Blinky (Fmax ${fl.fmax?.toFixed(1)} MHz) and its uploaded .bin, KnightRider + BTN1; netlist: Blinky duty, KnightRider + BTN1, RiscvSoc LED = 55 (and after a power cycle)${problems.length ? ': ' + problems.join(' | ') : ''}  (${Date.now() - t0} ms)`);
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

// IDE highlighter: lossless (tags removed = source) on every example, and
// keywords / numbers / comments tagged
{
  const esbuild = await import('esbuild');
  const js = esbuild.buildSync({ entryPoints: [path.join(dist, '../src/ide/highlight.ts')], bundle: true, format: 'cjs', platform: 'node', write: false }).outputFiles[0].text;
  const hp = path.join(tmp, 'highlight.cjs');
  fs.writeFileSync(hp, js);
  const { highlight } = createRequire(import.meta.url)(hp);
  const unesc = (h) => h.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  let n = 0, lossy = '';
  for (const ex of ctx.VERYL_EXAMPLES) for (const f of ex.files) {
    n++;
    if (unesc(highlight(f.src).join('\n')) !== f.src) lossy ||= `${ex.id}/${f.name}`;
  }
  const h = highlight("module M { // c\n  var a: logic<8> = 8'hFF; /* x\n y */ $assert(a); }").join('\n');
  const tagged = ['t-kw">module', 't-type">logic', "t-num\">8'hFF", 't-com">// c', 't-com"> y */', 't-sys">$assert', 't-name">M'].every((t) => h.includes(t));
  if (lossy || !tagged) bad++;
  console.log(`${lossy || !tagged ? 'FAIL' : 'ok  '} ide       highlighter on ${n} files${lossy ? ': changes ' + lossy : ''}${tagged ? '' : ': tokens not tagged'}`);
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
  const files = ['synth/overlay.ts', 'synth/compare.ts', 'synth/layouts.ts', 'wave.ts', 'client.ts', 'ide/main.ts', 'ide/board.ts'];
  const han = /[\u3400-\u9fff]/;
  const trad = new Set('學擊繼虛鈕鎖並佈佔來個側傳價優內兩別則動問啟單圖執塊實寫專對層帶庫後從態應換擁數斷時會條標樣機檔檢歡決沒測準滿為無熱狀現產畫發碼種稱節範簡約紅級細終組結給統經綠網線編緩縮總繞續腳與藍號術補裡規視計訊記設註試該語說調請證讀變讓負資軌較載輪輸轉這連週進過達違選還邊邏錄錯鍵鏈長閉開間閘關階際隨雙離電靜頁頂項順須預題顏類顯餘驅驗體鬆黃點');
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
