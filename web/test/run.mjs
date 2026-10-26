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
  const files = ['synth/overlay.ts', 'synth/compare.ts', 'synth/layouts.ts', 'wave.ts', 'client.ts', 'ide/main.ts'];
  const han = /[\u3400-\u9fff]/;
  const trad = new Set('並佈佔來個側傳價優內兩別則動問啟單圖執塊實寫專對層帶庫後從態應換擁數斷時會條標樣機檔檢歡決沒測準滿為無熱狀現產畫發碼種稱節範簡約紅級細終組結給統經綠網線編緩縮總繞續腳與藍號術補裡規視計訊記設註試該語說調請證讀變讓負資軌較載輪輸轉這連週進過達違選還邊邏錄錯鍵鏈長閉開間閘關階際隨雙離電靜頁頂項順須預題顏類顯餘驅驗體鬆黃點');
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
