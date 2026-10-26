// Build the front-end-only web environment into dist/:
//   wasm.js      the Rust core (veryl-wasm) as base64, so file:// works
//   examples.js  example projects (sources read from the repository)
//   app.js       TypeScript UI bundled by esbuild into one classic script
//   api.cjs      the same core API for the Node tests
//   ide.js       the IDE page (M11), same core
//   index.html, style.css, ide.html, ide.css
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
// English titles / notes / groups (the IDE's language menu; Simplified Chinese is derived)
const GROUP_EN = { 教學: 'Tutorial', 基礎: 'Basics', 時序: 'Sequential', 綜合: 'Combined', 周邊: 'Peripherals', 'RISC-V': 'RISC-V', 其他: 'Other' };
const EN = {
  tut_blinky: { title_en: 'Lesson 1: Blinky', note_en: 'tutorial/README.tw.md lesson 1: a counter blinks the LEDs; iCEBreaker pins (onboard + break-off LEDs)' },
  tut_uart: { title_en: 'Lesson 3: UART echo', note_en: 'tutorial lesson 3: talk to the computer over the USB serial port (pins 9 / 6, 115200 baud): greets with Hi!, echoes with the case swapped' },
  sevenseg: { title_en: 'Seven-segment counter 00-99', note_en: 'two multiplexed digits on PMOD1A (the virtual 7-segment module); BTN1 clears' },
  tut_knight: { title_en: 'Lesson 2: Knight Rider', note_en: 'tutorial lesson 2: tick divider, button synchronizer; hold BTN1 to pause' },
  adder: { title_en: 'Adder' },
  max3: { title_en: 'Max3 function' },
  alu_pkg: { title_en: 'AluUnit package + enum' },
  gen_rev: { title_en: 'BitRev / GrayConv generate' },
  seq101: { title_en: 'Seq101 state machine' },
  pkt_reg: { title_en: 'PktReg struct register' },
  ram: { title_en: 'Ram 16×8' },
  sync_ram: { title_en: 'SyncRam synchronous-read RAM → block RAM' },
  fifo: { title_en: 'FIFO 256×8 (block RAM)', note_en: 'Synchronous-read memory → one SB_RAM40_4K / one SRAM macro' },
  counter: { title_en: 'Counter (veryl-sim example)' },
  features: { title_en: 'features: shifts / functions / ranges / counters' },
  bram: { title_en: 'BramMix: 4 block RAMs + logic' },
  lang: { title_en: 'lang: division, interface, 200 bits, two clocks' },
  acc: { title_en: 'AccTest 32-bit carry chain' },
  uart: { title_en: 'UART transmitter / receiver (loopback test)', note_en: 'UartTx → UartRx loopback, 8N1, 8 clocks per bit' },
  vga: { title_en: 'VGA 640×480 timing + color bars', note_en: 'The test uses a small 24×12 frame; synthesis uses the default 800×525; on the virtual board a VGA monitor on PMOD1A+1B' },
  rv32i: { title_en: 'RV32I single-cycle CPU', note_en: 'TestRiscvCore runs examples/sw/rv32i_test.S (41 results, expected values cross-checked with spike)' },
  soc: { title_en: 'RISC-V SoC (FPGA)', note_en: 'Fibonacci(10) = 55 → LEDs; iCEBreaker pins (LEDs on PMOD1A)' },
  alu_fail: { title_en: 'Alu (with an assertion that fails on purpose)', note_en: 'What a failing assertion looks like: tb_alu has a "should fail on purpose" assertion' },
};
const EX = [
  { id: 'tut_blinky', group: '教學', title: '第 1 課 Blinky 閃爍 LED', files: ['tutorial/src/blinky.veryl'], synth: 'Blinky', pcf: 'tutorial/icebreaker.pcf',
    note: 'tutorial/README.tw.md 第 1 課：計數器讓 LED 閃爍；iCEBreaker 腳位（板上與擴充板 LED）' },
  { id: 'tut_knight', group: '教學', title: '第 2 課 跑馬燈', files: ['tutorial/src/knight.veryl'], synth: 'KnightRider', pcf: 'tutorial/icebreaker.pcf',
    note: '教學第 2 課：除頻 tick、按鈕同步器；按住 BTN1 暫停' },
  { id: 'tut_uart', group: '教學', title: '第 3 課 UART 回聲', files: ['tutorial/src/uart.veryl'], synth: 'UartEcho', pcf: 'tutorial/icebreaker.pcf',
    note: '教學第 3 課：用 USB 序列埠和電腦說話（腳 9 / 6，115200 鮑）：先說 Hi!，收到字元就大小寫互換送回', board: { uart: true, baud: 115200, pmod1a: '', pmod1b: '' } },
  { id: 'adder', group: '基礎', title: 'Adder 加法器', files: ['examples/src/adder.veryl'], synth: 'Adder' },
  { id: 'max3', group: '基礎', title: 'Max3 function', files: ['examples/src/max3.veryl'], synth: 'Max3' },
  { id: 'alu_pkg', group: '基礎', title: 'AluUnit package + enum', files: ['examples/src/alu_pkg.veryl'], synth: 'AluUnit' },
  { id: 'gen_rev', group: '基礎', title: 'BitRev / GrayConv generate', files: ['examples/src/gen_rev.veryl'], synth: 'GrayConv' },
  { id: 'seq101', group: '時序', title: 'Seq101 狀態機', files: ['examples/src/seq101.veryl'], synth: 'Seq101' },
  { id: 'pkt_reg', group: '時序', title: 'PktReg struct 暫存器', files: ['examples/src/pkt_reg.veryl'], synth: 'PktReg' },
  { id: 'ram', group: '時序', title: 'Ram 16×8', files: ['examples/src/ram.veryl'], synth: 'Ram' },
  { id: 'sync_ram', group: '時序', title: 'SyncRam 同步讀取 RAM → block RAM', files: ['examples/src/sync_ram.veryl'], synth: 'SyncRam' },
  { id: 'fifo', group: '時序', title: 'FIFO 256×8（block RAM）', files: ['examples/src/fifo.veryl'], synth: 'Fifo', note: '同步讀取的記憶體 → 一塊 SB_RAM40_4K / 一個 SRAM 巨集' },
  { id: 'sevenseg', group: '時序', title: '七段顯示器計數 00–99', files: ['examples/src/sevenseg.veryl'], synth: 'SevenSeg', pcf: 'examples/sevenseg.pcf',
    note: '兩位數多工掃描，接在 PMOD1A 的虛擬七段模組；BTN1 歸零', board: { uart: false, baud: 115200, pmod1a: 'seg7', pmod1b: '' } },
  { id: 'counter', group: '時序', title: 'Counter（veryl-sim 範例）', files: ['veryl-sim/examples/counter.veryl'], synth: 'Counter' },
  { id: 'features', group: '綜合', title: 'features：移位/函式/範圍/計數器', files: ['veryl-eda/examples/features.veryl'], synth: 'Top' },
  { id: 'bram', group: '綜合', title: 'BramMix：4 個 block RAM + 邏輯', files: ['examples/src/sync_ram.veryl', 'veryl-eda/examples/bram_tests.veryl'], synth: 'BramMix' },
  { id: 'lang', group: '綜合', title: 'lang：除法、interface、200 位元、雙時脈', files: ['veryl-eda/examples/lang.veryl'], synth: 'HsTop' },
  { id: 'acc', group: '綜合', title: 'AccTest 32-bit 進位鏈', files: ['veryl-eda/examples/pnr_tests.veryl'], synth: 'AccTest' },
  { id: 'uart', group: '周邊', title: 'UART 收發器（迴路測試）', files: ['examples/src/uart.veryl'], synth: 'UartLoop', note: 'UartTx → UartRx 迴路，8N1，每位元 8 個時脈' },
  { id: 'vga', group: '周邊', title: 'VGA 640×480 時序 + 色條', files: ['examples/src/vga.veryl'], synth: 'VgaDemo', pcf: 'examples/vga.pcf',
    note: '測試用縮小的 24×12 畫面；合成用預設的 800×525；虛擬板上接 PMOD1A+1B 的 VGA 螢幕', board: { uart: false, baud: 115200, pmod1a: 'vga', pmod1b: '' } },
  { id: 'rv32i', group: 'RISC-V', title: 'RV32I 單週期 CPU', files: ['examples/src/rv32i.veryl', 'examples/src/rv32i_rom.veryl'], synth: 'RiscvCore',
    note: 'TestRiscvCore 跑 examples/sw/rv32i_test.S（41 個結果，期望值經 spike 交叉比對）' },
  { id: 'soc', group: 'RISC-V', title: 'RISC-V SoC（FPGA）', files: ['examples/src/rv32i.veryl', 'examples/src/rv32i_rom.veryl', 'veryl-eda/examples/soc.veryl'],
    synth: 'RiscvSoc', pcf: 'veryl-eda/examples/icebreaker.pcf', note: 'Fibonacci(10) = 55 → LED；iCEBreaker 腳位（LED 在 PMOD1A）', board: { uart: false, baud: 115200, pmod1a: 'led8', pmod1b: '' } },
  { id: 'alu_fail', group: '其他', title: 'Alu（含一個故意失敗的斷言）', files: ['veryl-sim/examples/alu.veryl'], synth: 'Alu',
    note: '示範斷言失敗的樣子：tb_alu 有一個 "should fail on purpose" 的斷言' },
].map((e) => ({ ...e, ...EN[e.id], group_en: GROUP_EN[e.group], files: e.files.map(rd), pcf: e.pcf ? fs.readFileSync(path.join(root, e.pcf), 'utf8') : undefined }));
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
await esbuild.build({ entryPoints: [path.join(here, 'src/ide/main.ts')], bundle: true, format: 'iife', target: 'es2020', outfile: path.join(dist, 'ide.js'), logLevel: 'warning',
  define: { WORKER_SRC: JSON.stringify(workerSrc) } });
await esbuild.build({ entryPoints: [path.join(here, 'src/api.ts')], bundle: true, format: 'cjs', platform: 'node', target: 'node20', outfile: path.join(dist, 'api.cjs'), logLevel: 'warning' });
for (const f of ['index.html', 'style.css', 'ide.html', 'ide.css']) fs.copyFileSync(path.join(here, 'static', f), path.join(dist, f));
console.log('app.js, ide.js, api.cjs, index.html, style.css, ide.html, ide.css');
