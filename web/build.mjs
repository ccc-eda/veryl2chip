// Build the front-end-only web environment into dist/:
//   wasm.js      the Rust core (veryl-wasm) as base64, so file:// works
//   examples.js  example projects (sources read from the repository)
//   app.js       TypeScript UI bundled by esbuild into one classic script
//   api.cjs      the same core API for the Node tests
//   index.html, style.css
// Usage: node build.mjs [--skip-wasm]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const dist = path.join(here, 'dist');
fs.mkdirSync(dist, { recursive: true });

// ---- WebAssembly core ----
const wasmCrate = path.join(root, 'veryl-wasm');
const wasmPath = path.join(wasmCrate, 'target/wasm32-unknown-unknown/release/veryl_wasm.wasm');
if (!process.argv.includes('--skip-wasm')) {
  console.log('cargo build veryl-wasm (wasm32-unknown-unknown) …');
  execFileSync('cargo', ['build', '--release', '--target', 'wasm32-unknown-unknown'], { cwd: wasmCrate, stdio: 'inherit' });
}
const wasm = fs.readFileSync(wasmPath);
fs.writeFileSync(path.join(dist, 'wasm.js'), `var VERYL_WASM_B64 = "${wasm.toString('base64')}";\n`);
console.log(`wasm.js      ${(wasm.length / 1e6).toFixed(1)} MB wasm`);

// ---- examples ----
const rd = (p) => ({ name: path.basename(p), src: fs.readFileSync(path.join(root, p), 'utf8') });
const EX = [
  { id: 'adder', group: '基礎', title: 'Adder 加法器', files: ['examples/src/adder.veryl'], synth: 'Adder' },
  { id: 'max3', group: '基礎', title: 'Max3 function', files: ['examples/src/max3.veryl'], synth: 'Max3' },
  { id: 'alu_pkg', group: '基礎', title: 'AluUnit package + enum', files: ['examples/src/alu_pkg.veryl'], synth: 'AluUnit' },
  { id: 'gen_rev', group: '基礎', title: 'BitRev / GrayConv generate', files: ['examples/src/gen_rev.veryl'], synth: 'GrayConv' },
  { id: 'seq101', group: '時序', title: 'Seq101 狀態機', files: ['examples/src/seq101.veryl'], synth: 'Seq101' },
  { id: 'pkt_reg', group: '時序', title: 'PktReg struct 暫存器', files: ['examples/src/pkt_reg.veryl'], synth: 'PktReg' },
  { id: 'ram', group: '時序', title: 'Ram 16×8', files: ['examples/src/ram.veryl'], synth: 'Ram' },
  { id: 'sync_ram', group: '時序', title: 'SyncRam 同步讀取 RAM → block RAM', files: ['examples/src/sync_ram.veryl'], synth: 'SyncRam' },
  { id: 'counter', group: '時序', title: 'Counter（veryl-sim 範例）', files: ['veryl-sim/examples/counter.veryl'], synth: 'Counter' },
  { id: 'features', group: '綜合', title: 'features：移位/函式/範圍/計數器', files: ['veryl-eda/examples/features.veryl'], synth: 'Top' },
  { id: 'bram', group: '綜合', title: 'BramMix：4 個 block RAM + 邏輯', files: ['examples/src/sync_ram.veryl', 'veryl-eda/examples/bram_tests.veryl'], synth: 'BramMix' },
  { id: 'acc', group: '綜合', title: 'AccTest 32-bit 進位鏈', files: ['veryl-eda/examples/pnr_tests.veryl'], synth: 'AccTest' },
  { id: 'rv32i', group: 'RISC-V', title: 'RV32I 單週期 CPU', files: ['examples/src/rv32i.veryl', 'examples/src/rv32i_rom.veryl'], synth: 'RiscvCore',
    note: 'TestRiscvCore 跑 examples/sw/rv32i_test.S（41 個結果，期望值經 spike 交叉比對）' },
  { id: 'soc', group: 'RISC-V', title: 'RISC-V SoC（FPGA）', files: ['examples/src/rv32i.veryl', 'examples/src/rv32i_rom.veryl', 'veryl-eda/examples/soc.veryl'],
    synth: 'RiscvSoc', pcf: 'veryl-eda/examples/icebreaker.pcf', note: 'Fibonacci(10) = 55 → LED；iCEBreaker 腳位' },
  { id: 'alu_fail', group: '其他', title: 'Alu（含一個故意失敗的斷言）', files: ['veryl-sim/examples/alu.veryl'], synth: 'Alu',
    note: '示範斷言失敗的樣子：tb_alu 有一個 "should fail on purpose" 的斷言' },
].map((e) => ({ ...e, files: e.files.map(rd), pcf: e.pcf ? fs.readFileSync(path.join(root, e.pcf), 'utf8') : undefined }));
fs.writeFileSync(path.join(dist, 'examples.js'), `var VERYL_EXAMPLES = ${JSON.stringify(EX)};\n`);
console.log(`examples.js  ${EX.length} projects`);

// ---- IceStorm chip database for place and route (gzip, base64) ----
const chipdbCands = [process.env.VERYL_EDA_CHIPDB, '/usr/local/share/icebox/chipdb-5k.txt', '/usr/share/icebox/chipdb-5k.txt',
  '/Users/Shared/ccc/oss-cad-suite/share/icebox/chipdb-5k.txt', path.join(process.env.HOME ?? '', 'oss-cad-suite/share/icebox/chipdb-5k.txt')].filter(Boolean);
const chipdbPath = chipdbCands.find((p) => fs.existsSync(p));
if (chipdbPath) {
  const { gzipSync } = await import('node:zlib');
  const gz = gzipSync(fs.readFileSync(chipdbPath), { level: 9 });
  fs.writeFileSync(path.join(dist, 'chipdb.js'), `// IceStorm chip database (chipdb-5k.txt, ISC license, https://github.com/YosysHQ/icestorm), gzip + base64\nvar VERYL_CHIPDB_GZ_B64 = "${gz.toString('base64')}";\n`);
  console.log(`chipdb.js    ${(gz.length / 1e6).toFixed(1)} MB gzip (${chipdbPath})`);
} else if (!fs.existsSync(path.join(dist, 'chipdb.js'))) {
  console.warn('chipdb-5k.txt not found (set VERYL_EDA_CHIPDB): place & route will be unavailable');
}

// ---- TypeScript ----
const worker = await esbuild.build({ entryPoints: [path.join(here, 'src/worker.ts')], bundle: true, format: 'iife', target: 'es2020', write: false, logLevel: 'warning' });
const workerSrc = worker.outputFiles[0].text;
await esbuild.build({ entryPoints: [path.join(here, 'src/main.ts')], bundle: true, format: 'iife', target: 'es2020', outfile: path.join(dist, 'app.js'), logLevel: 'warning',
  define: { WORKER_SRC: JSON.stringify(workerSrc) } });
await esbuild.build({ entryPoints: [path.join(here, 'src/api.ts')], bundle: true, format: 'cjs', platform: 'node', target: 'node20', outfile: path.join(dist, 'api.cjs'), logLevel: 'warning' });
for (const f of ['index.html', 'style.css']) fs.copyFileSync(path.join(here, 'static', f), path.join(dist, f));
console.log('app.js, api.cjs, index.html, style.css');
