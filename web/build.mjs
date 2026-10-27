// Build the front-end-only web environment into dist/:
//   wasm.js      the Rust core (veryl-wasm) as base64, so file:// works
//   examples.js  example projects (sources read from the repository)
//   app.js       TypeScript UI bundled by esbuild into one classic script
//   api.cjs      the same core API for the Node tests
//   ide.js       the IDE page (M11), same core
//   img_linux.js the emulator's Linux image for the RV64 example (OpenSBI + Linux + busybox, gzip + base64),
//                loaded by the page only when the emulator boots it
//   img_snap_linux.js  the same machine booted to its shell (snapshot.mjs: memory, gzip + base64), so the
//                board starts in seconds; remade only when the model or the image changed
// Usage: node build.mjs [--skip-wasm] [--skip-snapshot]
//   index.html (the IDE), ide.css, demo.html (the demo page), style.css, ide.html (redirects to index.html)
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
const GROUP_EN = { 教學: 'Tutorial', 實驗: 'Labs', 'C 程式': 'C programs', 基礎: 'Basics', 時序: 'Sequential', 綜合: 'Combined', 周邊: 'Peripherals', 'RISC-V': 'RISC-V', 其他: 'Other' };
const EN = {
  lab_gates: { title_en: 'Breadboard lab: logic gates', note_en: 'two switches (PMOD1B, each with a pull-down) → four LEDs for AND, OR, XOR, NOT (PMOD1A, each with a series resistor); the breadboard comes wired' },
  lab_counter: { title_en: 'Lab: one press, plus one', note_en: 'each BTN1 press adds one (synchronizer + rising edge); the 8-bit count on the LED module in PMOD1A; BTN2 clears' },
  lab_traffic: { title_en: 'Lab: traffic-light state machine', note_en: 'green 5 s → yellow 1 s → red 4 s; pressing BTN1 (pedestrian button) during green leaves it 1 more second; three LEDs on the breadboard (PMOD1A pins 1-3, each with a resistor)' },
  c_hello: { title_en: 'C: Hello (serial port, LEDs)', note_en: 'a C program on the RISC-V SoC you built in Veryl: ⚡ Virtual board compiles it into the block RAM; prints on the USB terminal, counts on the LEDs, echoes in upper case' },
  c_knight: { title_en: 'C: running light', note_en: 'the tutorial\'s Knight Rider in software; BTN1 faster, BTN2 slower (rising edges detected in C)' },
  c_guess: { title_en: 'C: guess the number', note_en: 'a game on the USB terminal: read_line, atoi, rand seeded by the time you take to press Enter' },
  c_sevenseg: { title_en: 'C: seven-segment display', note_en: '00-99 on the 7-segment module (PMOD1A), multiplexed in software; BTN1 clears' },
  c_music: { title_en: 'C: music on the buzzer', note_en: 'square waves on PMOD1A pin 1 (the buzzer module): Twinkle, Twinkle' },
  c_vga: { title_en: 'C: VGA text mode', note_en: 'RvVgaBoard: the SoC with a 40 × 30 character VGA screen (VgaText, font and characters in block RAM); uptime, buttons, and what you type on the terminal' },
  c_switches: { title_en: 'C: switches', note_en: 'the 8 switches (PMOD1B) on the 8 LEDs (PMOD1A) and on the terminal in binary / hex' },
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
  rv64_linux: { title_en: 'RV64 board: Linux + GPIO (emulator)', note_en: 'A Raspberry Pi style board: Rv64Core (RV64IMAC, M/S/U, SV39) in Rv64Soc with 256 MB RAM and 16 GPIO pins, run in the emulator (🖥): veryl-emu compiles it to WebAssembly and boots OpenSBI + Linux 6.12 + busybox; the board\'s ACT / USER LEDs (GPIO 0, 1) and button (GPIO 2), GPIO 3-15 on the header and the breadboard (the same BCM numbers as on a Pi). Type echo 1 > /sys/class/leds/user/brightness in the terminal to light an LED' },
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
  { id: 'lab_gates', group: '實驗', title: '麵包板實驗：邏輯閘', files: ['examples/src/gates.veryl'], synth: 'Gates', pcf: 'examples/gates.pcf',
    note: '兩個開關（PMOD1B，各有下拉電阻）→ AND、OR、XOR、NOT 四顆 LED（PMOD1A，各有限流電阻）；麵包板已接好', board: {"uart": false, "baud": 115200, "pmod1a": "", "pmod1b": "", "breadboard": true, "bb": [{"id": 1, "kind": "wire", "a": "gnd", "b": "r:top-:1", "color": "#3e63dd"}, {"id": 2, "kind": "wire", "a": "vcc", "b": "r:top+:30", "color": "#e5484d"}, {"id": 3, "kind": "wire", "a": "p:4", "b": "h:2:a", "color": "#f76b15"}, {"id": 4, "kind": "led", "a": "h:2:c", "b": "h:3:c", "color": "#ff3b30"}, {"id": 5, "kind": "res", "a": "h:3:e", "b": "r:top-:3"}, {"id": 6, "kind": "wire", "a": "p:2", "b": "h:6:a", "color": "#f76b15"}, {"id": 7, "kind": "led", "a": "h:6:c", "b": "h:7:c", "color": "#34c759"}, {"id": 8, "kind": "res", "a": "h:7:e", "b": "r:top-:7"}, {"id": 9, "kind": "wire", "a": "p:47", "b": "h:10:a", "color": "#f76b15"}, {"id": 10, "kind": "led", "a": "h:10:c", "b": "h:11:c", "color": "#ffcc00"}, {"id": 11, "kind": "res", "a": "h:11:e", "b": "r:top-:11"}, {"id": 12, "kind": "wire", "a": "p:45", "b": "h:14:a", "color": "#f76b15"}, {"id": 13, "kind": "led", "a": "h:14:c", "b": "h:15:c", "color": "#0a84ff"}, {"id": 14, "kind": "res", "a": "h:15:e", "b": "r:top-:15"}, {"id": 15, "kind": "sw", "a": "r:top+:22", "b": "h:22:a", "on": false}, {"id": 16, "kind": "wire", "a": "h:22:b", "b": "p:43", "color": "#8e4ec6"}, {"id": 17, "kind": "res", "a": "h:22:e", "b": "r:top-:23"}, {"id": 18, "kind": "sw", "a": "r:top+:26", "b": "h:26:a", "on": false}, {"id": 19, "kind": "wire", "a": "h:26:b", "b": "p:38", "color": "#8e4ec6"}, {"id": 20, "kind": "res", "a": "h:26:e", "b": "r:top-:27"}]} },
  { id: 'lab_counter', group: '實驗', title: '實驗：按一下加一', files: ['examples/src/button_counter.veryl'], synth: 'ButtonCounter', pcf: 'examples/button_counter.pcf',
    note: 'BTN1 每按一下加一（同步器 + 抓上升緣），8 位元計數顯示在 PMOD1A 的 LED 模組；BTN2 歸零', board: { uart: false, baud: 115200, pmod1a: 'led8', pmod1b: '' } },
  { id: 'lab_traffic', group: '實驗', title: '實驗：紅綠燈狀態機', files: ['examples/src/traffic.veryl'], synth: 'TrafficLight', pcf: 'examples/traffic.pcf',
    note: '綠 5 秒 → 黃 1 秒 → 紅 4 秒；綠燈時按 BTN1（行人按鈕）綠燈只再亮 1 秒；三顆 LED 在麵包板上（PMOD1A 腳 1–3，各串電阻）', board: {"uart": false, "baud": 115200, "pmod1a": "", "pmod1b": "", "breadboard": true, "bb": [{"id": 1, "kind": "wire", "a": "gnd", "b": "r:top-:1", "color": "#3e63dd"}, {"id": 3, "kind": "wire", "a": "p:4", "b": "h:2:a", "color": "#f76b15"}, {"id": 4, "kind": "led", "a": "h:2:c", "b": "h:3:c", "color": "#ff3b30"}, {"id": 5, "kind": "res", "a": "h:3:e", "b": "r:top-:3"}, {"id": 7, "kind": "wire", "a": "p:2", "b": "h:6:a", "color": "#f76b15"}, {"id": 8, "kind": "led", "a": "h:6:c", "b": "h:7:c", "color": "#ffcc00"}, {"id": 9, "kind": "res", "a": "h:7:e", "b": "r:top-:7"}, {"id": 11, "kind": "wire", "a": "p:47", "b": "h:10:a", "color": "#f76b15"}, {"id": 12, "kind": "led", "a": "h:10:c", "b": "h:11:c", "color": "#34c759"}, {"id": 13, "kind": "res", "a": "h:11:e", "b": "r:top-:11"}]} },
  ...[
    ['c_hello', 'hello', 'C：Hello（序列埠、LED）', '在你用 Veryl 做的 RISC-V SoC 上跑 C 程式：⚡ 虛擬板會編譯它並放進 block RAM；在 USB 終端機打招呼、LED 計數、把收到的字轉成大寫送回', { uart: true, pmod1a: 'led8', pmod1b: '' }],
    ['c_knight', 'knight', 'C：跑馬燈', '教學第 2 課的跑馬燈改用軟體做；BTN1 加快、BTN2 變慢（在 C 裡偵測上升緣）', { uart: false, pmod1a: 'led8', pmod1b: '' }],
    ['c_guess', 'guess', 'C：猜數字', '在 USB 終端機上玩的遊戲：read_line、atoi，用按 Enter 花的時間當亂數種子', { uart: true, pmod1a: 'led8', pmod1b: '' }],
    ['c_sevenseg', 'sevenseg', 'C：七段顯示器', '00–99 顯示在七段模組（PMOD1A），用軟體多工掃描；BTN1 歸零', { uart: false, pmod1a: 'seg7', pmod1b: '' }],
    ['c_music', 'music', 'C：蜂鳴器音樂', 'PMOD1A 腳 1 的方波（蜂鳴器模組）：小星星', { uart: true, pmod1a: 'buzzer', pmod1b: '' }],
    ['c_switches', 'switches', 'C：開關', 'PMOD1B 的 8 個開關顯示在 PMOD1A 的 8 顆 LED，並在終端機印出二進位 / 十六進位', { uart: true, pmod1a: 'led8', pmod1b: 'sw8' }],
    ['c_threads', 'threads', 'C：多執行緒（搶佔式核心）', '計時器中斷每 10 ms 切換執行緒（mtvec、mepc、mret）；ecall 做 yield / sleep，amoswap 做互斥鎖。LED 0、1 是兩個閃爍的執行緒，LED 7 是不讓出 CPU 的質數計算', { uart: true, pmod1a: 'led8', pmod1b: '' }],
  ].map(([id, f, title, note, b], i) => ({
    id, group: 'C 程式', title, note, synth: 'RvBoard', pcf: 'examples/rvsoc.pcf', board: { baud: 115200, mode: 'cpu', ...b },
    files: ['examples/c/' + f + '.c', 'examples/src/rvsoc.veryl', 'examples/src/rv32i.veryl', 'examples/src/sync_ram.veryl', 'examples/src/uart.veryl', 'examples/src/rvsoc_rom.veryl', 'examples/src/rv32i_rom.veryl'],
    // the C examples share one SoC: the hardware checks of npm test run on the first
    ...(i ? { same_hw: 'c_hello' } : {}),
    asic: false,
  })),
  { id: 'c_vga', group: 'C 程式', title: 'C：VGA 文字模式', note: 'RvVgaBoard：SoC 加上 40 × 30 字元的 VGA 畫面（VgaText，字型和字元都在 block RAM）；顯示開機時間、按鈕和在終端機打的字',
    synth: 'RvVgaBoard', pcf: 'examples/rvvga.pcf', asic: false, board: { uart: true, baud: 115200, pmod1a: 'vga', pmod1b: '', mode: 'cpu' },
    files: ['examples/c/vga.c', 'examples/src/rvvga.veryl', 'examples/src/vga.veryl', 'examples/src/rvsoc.veryl', 'examples/src/rv32i.veryl', 'examples/src/sync_ram.veryl', 'examples/src/uart.veryl', 'examples/src/rvsoc_rom.veryl', 'examples/src/rv32i_rom.veryl'] },
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
  { id: 'rv64_linux', group: 'RISC-V', title: 'RV64 開發板：Linux + GPIO（模擬機）', files: ['examples/rv64/src/rv64core.veryl', 'examples/rv64/src/rv64soc.veryl'], synth: 'Rv64Core', asic: false, emu: true,
    machine: { top: 'Rv64Soc', reset: { port: 'i_rst', active: 0, cycles: 2 },
      uart: { tx_valid: 'o_tx_valid', tx_data: 'o_tx_data', rx_valid: 'i_rx_valid', rx_data: 'i_rx_data', rx_ready: 'o_rx_ready' },
      finish: { valid: 'o_finish', code: 'o_finish_code', pass: 0x5555 }, ram: { array: 'mem', base: '0x80000000' }, load: [{ image: 'linux' }],
      gpio: { out: 'o_gpio', oe: 'o_gpio_oe', in: 'i_gpio', n: 16 }, board: 'pi', snapshot: 'linux', prompt: 'rv64:~$ ' },
    note: '像樹莓派的開發板：Rv64Core（RV64IMAC、M / S / U、SV39）放在有 256 MB RAM 與 16 支腳 GPIO 的 Rv64Soc 裡，用模擬機（🖥）跑：veryl-emu 把它編成 WebAssembly，開 OpenSBI + Linux 6.12 + busybox；板上 ACT / USER LED（GPIO 0、1）、按鈕（GPIO 2），排針與麵包板上是 GPIO 3–15（和樹莓派同樣的 BCM 編號）。在終端機打 echo 1 > /sys/class/leds/user/brightness 點亮 LED' },
  { id: 'rv32i', group: 'RISC-V', title: 'RV32I 單週期 CPU', files: ['examples/src/rv32i.veryl', 'examples/src/rv32i_rom.veryl'], synth: 'RiscvCore',
    note: 'TestRiscvCore 跑 examples/sw/rv32i_test.S（41 個結果，期望值經 spike 交叉比對）' },
  { id: 'soc', group: 'RISC-V', title: 'RISC-V SoC（FPGA）', files: ['examples/src/rv32i.veryl', 'examples/src/rv32i_rom.veryl', 'veryl-eda/examples/soc.veryl'],
    synth: 'RiscvSoc', pcf: 'veryl-eda/examples/icebreaker.pcf', note: 'Fibonacci(10) = 55 → LED；iCEBreaker 腳位（LED 在 PMOD1A）', board: { uart: false, baud: 115200, pmod1a: 'led8', pmod1b: '' } },
  { id: 'alu_fail', group: '其他', title: 'Alu（含一個故意失敗的斷言）', files: ['veryl-sim/examples/alu.veryl'], synth: 'Alu',
    note: '示範斷言失敗的樣子：tb_alu 有一個 "should fail on purpose" 的斷言' },
].map((e) => ({ ...e, ...EN[e.id], group_en: GROUP_EN[e.group], pcf: e.pcf ? fs.readFileSync(path.join(root, e.pcf), 'utf8') : undefined, machine: undefined,
  files: [...e.files.map(rd), ...(e.machine ? [{ name: 'machine.json', src: JSON.stringify(e.machine, null, 2) + '\n' }] : [])] }));
fs.writeFileSync(path.join(dist, 'examples.js'), `var VERYL_EXAMPLES = ${JSON.stringify(EX)};\n`);
console.log(`examples.js  ${EX.length} projects`);

// ---- the emulator's Linux image (examples/rv64/linux/build.sh) ----
{
  const img = path.join(root, 'examples/rv64/linux/build/opensbi/platform/generic/firmware/fw_payload.bin');
  if (fs.existsSync(img)) {
    const { gzipSync } = await import('node:zlib');
    const gz = gzipSync(fs.readFileSync(img), { level: 9 });
    fs.writeFileSync(path.join(dist, 'img_linux.js'), `// OpenSBI (BSD-2-Clause) + Linux 6.12 (GPL-2.0) + busybox 1.36 (GPL-2.0) + musl (MIT) for Rv64Soc, built by examples/rv64/linux/build.sh; gzip + base64\nvar VERYL_IMAGES = typeof VERYL_IMAGES === 'undefined' ? {} : VERYL_IMAGES;\nVERYL_IMAGES.linux = "${gz.toString('base64')}";\n`);
    console.log(`img_linux.js ${(gz.length / 1e6).toFixed(1)} MB gzip`);
  } else if (!fs.existsSync(path.join(dist, 'img_linux.js'))) {
    console.warn('examples/rv64/linux/build: no Linux image (run examples/rv64/linux/build.sh): the RV64 example cannot boot in the emulator');
  }
}

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
const emuWorker = await esbuild.build({ entryPoints: [path.join(here, 'src/emu_worker.ts')], bundle: true, format: 'iife', target: 'es2020', write: false, logLevel: 'warning' });
const emuWorkerSrc = emuWorker.outputFiles[0].text;
await esbuild.build({ entryPoints: [path.join(here, 'src/main.ts')], bundle: true, format: 'iife', target: 'es2020', outfile: path.join(dist, 'app.js'), logLevel: 'warning',
  define: { WORKER_SRC: JSON.stringify(workerSrc) } });
await esbuild.build({ entryPoints: [path.join(here, 'src/ide/main.ts')], bundle: true, format: 'iife', target: 'es2020', outfile: path.join(dist, 'ide.js'), logLevel: 'warning',
  define: { WORKER_SRC: JSON.stringify(workerSrc), EMU_WORKER_SRC: JSON.stringify(emuWorkerSrc) } });
// the emulator's machine for the Node tests
await esbuild.build({ entryPoints: [path.join(here, 'src/emu_machine.ts')], bundle: true, format: 'cjs', platform: 'node', target: 'node20', outfile: path.join(dist, 'emu_machine.cjs'), logLevel: 'warning' });
await esbuild.build({ entryPoints: [path.join(here, 'src/api.ts')], bundle: true, format: 'cjs', platform: 'node', target: 'node20', outfile: path.join(dist, 'api.cjs'), logLevel: 'warning' });
for (const f of ['index.html', 'ide.css', 'demo.html', 'style.css', 'ide.html']) fs.copyFileSync(path.join(here, 'static', f), path.join(dist, f));
console.log('app.js, ide.js, api.cjs, emu_machine.cjs, index.html (IDE), ide.css, demo.html, style.css, ide.html (redirect)');

// ---- the emulator's snapshots (needs dist/: after everything above) ----
if (!process.argv.includes('--skip-snapshot')) execFileSync('node', [path.join(here, 'snapshot.mjs')], { cwd: here, stdio: 'inherit' });
