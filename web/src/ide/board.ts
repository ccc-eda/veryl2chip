// The virtual iCEBreaker: the design "flashed" onto a drawn board. The
// simulation runs in its own worker (board_load / board_run / board_reset
// of the core); this side draws the board, turns duty cycles into LED
// brightness and sends button presses.

import type { VFile } from '../api';
import type { Core } from '../client';
import { tr } from '../i18n';
import { Part, solve } from './bbmodel';
import { Breadboard } from './breadboard';

interface PinInfo { pin: number; name: string; kind: string; level: boolean; input: string | null; output: string | null }
interface LoadInfo {
  top: string; pins: PinInfo[]; warnings: string[]; default_pcf: boolean; clock_hz: number;
  cells: { lut: number; carry: number; ff: number; ram: number; lc?: number };
  /** bitstream: synthesized, placed, routed, decoded; netlist: the mapped netlist; bin: an uploaded bitstream */
  mode: 'bitstream' | 'netlist' | 'bin' | 'cpu';
  fmax?: number;
  bin?: string;
  /** the design's port bits (not for an uploaded bitstream) */
  ports?: { name: string; dir: 'in' | 'out' }[];
  /** the design has a program memory (RvSoc); bytes of the program in it */
  program_mem?: boolean;
  program?: number | null;
}
interface RunResult {
  cycle: number; window: number; duty: [number, number][]; evals: number;
  segs: number[][][]; edges: [number, number][];
  uart: { rx: number[]; errors: number; pending: number } | null;
  vga: { n: number; w?: number; h?: number; rle?: string } | null;
}

/** what is plugged into the board: the USB terminal and a module on each PMOD */
export interface BoardSetup { uart: boolean; baud: number; pmod1a: string; pmod1b: string; breadboard?: boolean; bb?: Part[]; mode?: string }
export const DEFAULT_SETUP: BoardSetup = { uart: false, baud: 115200, pmod1a: '', pmod1b: '' };

/** PMOD pins 1-4, 7-10 */
const SLOT: Record<string, number[]> = { pmod1a: [4, 2, 47, 45, 3, 48, 46, 44], pmod1b: [43, 38, 34, 31, 42, 36, 32, 28] };
const MODULES: [string, string, string][] = [
  ['', '—', '—'], ['led8', '8 顆 LED', '8 LEDs'], ['sw8', '8 個開關', '8 switches'], ['seg7', '七段顯示器（2 位）', '7-segment (2 digits)'],
  ['vga', 'VGA 螢幕（佔 1A+1B）', 'VGA monitor (1A+1B)'], ['buzzer', '蜂鳴器（腳 1）', 'buzzer (pin 1)'],
];

/** board drawing coordinates of each pin's part */
const PMOD1A = [4, 2, 47, 45, 3, 48, 46, 44];
const PMOD1B = [43, 38, 34, 31, 42, 36, 32, 28];
const PMOD2 = [27, 25, 21, 19, 26, 23, 20, 18];
/** keyboard keys for the buttons */
const KEYS: Record<string, number> = { '0': 10, '1': 20, '2': 19, '3': 18 };

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

export class VirtualBoard {
  private info: LoadInfo | null = null;
  private running = false;
  private loop = 0;
  private pending: [number, number][] = [];
  private held = new Map<number, boolean>();
  private latched = new Set<number>();
  private cycles = 20000;
  private realtime = true;
  private lastCycle = 0;
  private speed = { t: 0, c: 0, rate: 0 };
  private gen = 0;

  constructor(private host: HTMLElement, private core: () => Promise<Core>) {
    host.innerHTML = `<div class="vb-bar">
        <button class="tb-btn" data-a="flash" title="${tr('合成目前的設計並燒錄到虛擬板', 'Synthesize the current design and flash it to the virtual board')}">${tr('⚡ 燒錄', '⚡ Flash')}</button>
        <button class="tb-btn" data-a="run" disabled>⏸</button>
        <button class="tb-btn" data-a="power" disabled title="${tr('重新上電（從頭開始）', 'Power cycle (start over)')}">⟲</button>
        <select data-a="mode" title="${tr('燒錄什麼：位元流＝佈局繞線後的真實位元流（解碼回電路模擬）；網表＝映射後的網表（快，不佈局繞線）；CPU＝RISC-V SoC 的 C 程式，CPU 用指令集模擬器跑（即時速度，周邊和腳位相同）', 'What to flash: bitstream = the real placed-and-routed bitstream (decoded back into a circuit); netlist = the mapped netlist (fast, no place and route); CPU = the RISC-V SoC\'s C program with the CPU as an instruction-set simulator (real time, same pins and peripherals)')}">
          <option value="bitstream">${tr('位元流（真實）', 'bitstream (real)')}</option><option value="netlist">${tr('網表（快速）', 'netlist (fast)')}</option><option value="cpu">${tr('CPU（C 程式，即時）', 'CPU (C program, real time)')}</option></select>
        <button class="tb-btn ghost" data-a="upload" title="${tr('載入任何 iCE40UP5K 的 .bin（例如 nextpnr + icepack 做的；也可以拖放到板子上）', 'Load any iCE40UP5K .bin (e.g. from nextpnr + icepack; or drop it on the board)')}">${tr('📂 .bin', '📂 .bin')}</button>
        <button class="tb-btn ghost" data-a="pins" disabled title="${tr('腳位指定：設計的每個埠接到板子的哪支腳（寫入 pins.pcf）', 'Pin assignment: which board pin each port uses (written to pins.pcf)')}">${tr('📌 腳位', '📌 Pins')}</button>
        <button class="tb-btn ghost hidden" data-a="download" title="${tr('下載這個位元流（iceprog 可以燒進真實的 iCEBreaker）', 'Download this bitstream (iceprog flashes it to a real iCEBreaker)')}">⬇ .bin</button>
        <input type="file" accept=".bin" class="hidden" data-a="file">
        <select data-a="pace" title="${tr('速度', 'Speed')}"><option value="rt">${tr('不超過即時', 'up to real time')}</option><option value="max">${tr('最快', 'fastest')}</option></select>
        <span class="vb-stat"></span>
      </div>
      <div class="vb-bar vb-bar2">
        <label class="vb-chk"><input type="checkbox" data-a="uart"> ${tr('🖥 USB 終端機', '🖥 USB terminal')}</label>
        <select data-a="baud" title="${tr('鮑率（每位元時脈數 = 12 MHz ÷ 鮑率）', 'Baud rate (clocks per bit = 12 MHz / baud)')}">
          ${[115200, 57600, 19200, 9600].map(b => `<option value="${b}">${b}</option>`).join('')}<option value="-8">${tr('每位元 8 拍（測試用）', '8 clocks per bit (tests)')}</option></select>
        <span class="vb-sep">│</span>
        <label class="vb-chk">PMOD1A <select data-a="pmod1a">${MODULES.map(m => `<option value="${m[0]}">${tr(m[1], m[2])}</option>`).join('')}</select></label>
        <label class="vb-chk">PMOD1B <select data-a="pmod1b">${MODULES.filter(m => m[0] !== 'vga').map(m => `<option value="${m[0]}">${tr(m[1], m[2])}</option>`).join('')}</select></label>
        <span class="vb-sep">│</span>
        <label class="vb-chk"><input type="checkbox" data-a="breadboard"> ${tr('🧪 麵包板', '🧪 Breadboard')}</label>
      </div>
      <div class="vb-main">
        <div class="vb-stage"><svg class="vb-svg" viewBox="0 0 920 330" xmlns="http://www.w3.org/2000/svg"></svg><div class="bb hidden"></div></div>
        <div class="vb-cards"></div>
      </div>
      <div class="vb-foot"></div>
      <div class="vb-pins hidden"></div>`;
    this.svg.innerHTML = this.drawing();
    this.q('[data-a=run]').onclick = () => this.setRunning(!this.running);
    this.q('[data-a=power]').onclick = () => this.power();
    this.q<HTMLSelectElement>('[data-a=pace]').onchange = e => { this.realtime = (e.target as HTMLSelectElement).value === 'rt'; };
    this.q('[data-a=upload]').onclick = () => this.q<HTMLInputElement>('[data-a=file]').click();
    this.q<HTMLInputElement>('[data-a=file]').onchange = e => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) this.loadBin(f); (e.target as HTMLInputElement).value = ''; };
    this.q('[data-a=download]').onclick = () => this.download();
    this.q('[data-a=pins]').onclick = () => this.pinTable();
    for (const k of ['uart', 'baud', 'pmod1a', 'pmod1b', 'breadboard', 'mode']) this.q(`[data-a=${k}]`).addEventListener('change', () => this.setupFromUi());
    this.bb = new Breadboard(this.q<HTMLElement>('.bb'));
    this.bb.onChange = layout => {
      if (layout) { this.setup.bb = this.bb.parts.map(p => ({ ...p })); this.onSetup(this.setup); }
      this.solveBB();
      if (!this.running) this.tick(0);
    };
    host.addEventListener('dragover', e => { e.preventDefault(); host.classList.add('drop'); });
    host.addEventListener('dragleave', () => host.classList.remove('drop'));
    host.addEventListener('drop', e => { e.preventDefault(); host.classList.remove('drop'); const f = e.dataTransfer?.files?.[0]; if (f) this.loadBin(f); });
    for (const b of this.svg.querySelectorAll<SVGGElement>('[data-btn]')) {
      const pin = +b.dataset.btn!;
      const down = (e: Event) => {
        e.preventDefault();
        if ((e as PointerEvent).shiftKey) { this.latched.has(pin) ? this.latched.delete(pin) : this.latched.add(pin); this.press(pin, this.latched.has(pin)); return; }
        this.press(pin, true);
      };
      const up = () => { if (!this.latched.has(pin)) this.press(pin, false); };
      b.addEventListener('pointerdown', down);
      b.addEventListener('pointerup', up);
      b.addEventListener('pointerleave', up);
    }
    host.tabIndex = 0;
    host.addEventListener('keydown', e => { const p = KEYS[e.key]; if (p !== undefined && !e.repeat) { this.press(p, true); e.preventDefault(); } });
    host.addEventListener('keyup', e => { const p = KEYS[e.key]; if (p !== undefined && !this.latched.has(p)) this.press(p, false); });
  }

  private setup: BoardSetup = { ...DEFAULT_SETUP };
  private bb!: Breadboard;
  private duty = new Map<number, number>();
  private bbIn = new Map<number, number>();
  private vgaSeen = 0;
  private term = '';
  private sendQ = '';
  private audio: { ctx: AudioContext; osc: OscillatorNode; gain: GainNode } | null = null;
  private switches = new Map<number, boolean>();
  /** called when the user changes what is plugged in (the IDE saves it with the project) */
  onSetup: (s: BoardSetup) => void = () => {};

  /** plug in modules and the terminal (from the project, or an example's defaults) */
  setSetup(s: BoardSetup): void {
    this.setup = { ...DEFAULT_SETUP, ...s };
    if (this.setup.pmod1a === 'vga') this.setup.pmod1b = '';
    this.q<HTMLInputElement>('[data-a=uart]').checked = this.setup.uart;
    this.q<HTMLSelectElement>('[data-a=baud]').value = String(this.setup.baud);
    this.q<HTMLSelectElement>('[data-a=pmod1a]').value = this.setup.pmod1a;
    this.q<HTMLSelectElement>('[data-a=pmod1b]').value = this.setup.pmod1b;
    this.q<HTMLSelectElement>('[data-a=pmod1b]').disabled = this.setup.pmod1a === 'vga';
    this.q<HTMLInputElement>('[data-a=breadboard]').checked = !!this.setup.breadboard;
    if (this.setup.mode) this.q<HTMLSelectElement>('[data-a=mode]').value = this.setup.mode;
    this.q<HTMLElement>('.bb').classList.toggle('hidden', !this.setup.breadboard);
    // header pins under a PMOD module cannot take wires
    this.bb.blocked = new Set([...(this.setup.pmod1a ? SLOT.pmod1a : []), ...(this.setup.pmod1b || this.setup.pmod1a === 'vga' ? SLOT.pmod1b : [])]);
    this.bb.setParts(this.setup.bb ?? []);
    this.bbIn.clear();
    this.cards();
    if (this.info) this.attach();
  }

  private setupFromUi(): void {
    const s: BoardSetup = {
      uart: this.q<HTMLInputElement>('[data-a=uart]').checked,
      baud: +this.q<HTMLSelectElement>('[data-a=baud]').value,
      pmod1a: this.q<HTMLSelectElement>('[data-a=pmod1a]').value,
      pmod1b: this.q<HTMLSelectElement>('[data-a=pmod1b]').value,
      breadboard: this.q<HTMLInputElement>('[data-a=breadboard]').checked,
      bb: this.bb.parts.map(p => ({ ...p })),
      mode: this.mode,
    };
    this.setSetup(s);
    this.onSetup(this.setup);
  }

  /** the peripheral configuration for the core */
  private periph(): object {
    const s = this.setup;
    const seg = (pins: number[]) => ({ segs: [...pins.slice(0, 7), null], sels: [[pins[7], 0], [pins[7], 1]], on: 1 });
    const segs = (['pmod1a', 'pmod1b'] as const).filter(k => s[k] === 'seg7').map(k => seg(SLOT[k]));
    const a = SLOT.pmod1a, b = SLOT.pmod1b;
    return {
      uart: s.uart ? { tx: 9, rx: 6, cpb: s.baud < 0 ? -s.baud : 12e6 / s.baud } : null,
      seg: segs,
      // PmodVGA: 1A pins 1-4 R0-R3, 7-10 B0-B3; 1B pins 1-4 G0-G3, 7 HS, 8 VS (colors msb first)
      vga: s.pmod1a === 'vga' ? { hs: b[4], vs: b[5], r: [a[3], a[2], a[1], a[0]], g: [b[3], b[2], b[1], b[0]], b: [a[7], a[6], a[5], a[4]] } : null,
    };
  }

  private async attach(): Promise<void> {
    await (await this.core()).call({ cmd: 'board_periph', ...this.periph() });
    this.vgaSeen = 0;
    // switches drive their pins as they stand
    for (const [pin, on] of this.switches) this.pending.push([pin, on ? 1 : 0]);
  }

  /** the cards of the plugged-in modules */
  private cards(): void {
    const box = this.q<HTMLElement>('.vb-cards');
    let h = '';
    const s = this.setup;
    if (s.uart) h += `<div class="vb-card vb-term"><div class="vb-card-h">${tr('USB 終端機', 'USB terminal')}　<span class="vb-dim">TX ${tr('腳', 'pin')} 9 → ${tr('電腦', 'PC')}，RX ${tr('腳', 'pin')} 6 ← ${tr('電腦', 'PC')}</span><span class="vb-err"></span><button class="icon" data-a="tclear" title="${tr('清除', 'Clear')}">⌫</button></div>`
      + `<pre class="vb-tout"></pre><input class="vb-tin" placeholder="${tr('輸入文字，Enter 送出', 'Type, Enter to send')}"></div>`;
    for (const k of ['pmod1a', 'pmod1b'] as const) {
      const m = s[k], pins = SLOT[k], name = k === 'pmod1a' ? 'PMOD1A' : 'PMOD1B';
      if (!m) continue;
      if (m === 'led8') h += `<div class="vb-card"><div class="vb-card-h">${name}：${tr('8 顆 LED', '8 LEDs')}</div><div class="vb-led8">${pins.map((p, i) => `<span class="vb-l8" data-l8="${p}" title="${tr('腳', 'pin')} ${p}">${i}</span>`).join('')}</div></div>`;
      if (m === 'sw8') h += `<div class="vb-card"><div class="vb-card-h">${name}：${tr('8 個開關（點一下切換）', '8 switches (click to flip)')}</div><div class="vb-sw8">${pins.map((p, i) => `<button class="vb-sw" data-sw="${p}" title="${tr('腳', 'pin')} ${p}">${i}</button>`).join('')}</div></div>`;
      if (m === 'seg7') h += `<div class="vb-card"><div class="vb-card-h">${name}：${tr('七段顯示器', '7-segment display')}　<span class="vb-dim">${tr('腳 1–4、7–9 = a–g，腳 10 = 選位', 'pins 1–4, 7–9 = a–g, pin 10 = digit')}</span></div><svg class="vb-seg" viewBox="0 0 150 110" data-seg="${k}">${[1, 0].map((d, i) => this.digit(8 + i * 70, 8, d)).join('')}</svg></div>`;
      if (m === 'vga') h += `<div class="vb-card"><div class="vb-card-h">${tr('VGA 螢幕', 'VGA monitor')}　<span class="vb-dim vb-vga-i"></span></div><canvas class="vb-vga" width="320" height="240"></canvas></div>`;
      if (m === 'buzzer') h += `<div class="vb-card"><div class="vb-card-h">${name}：${tr('蜂鳴器（腳 1）', 'buzzer (pin 1)')}　<label class="vb-chk"><input type="checkbox" data-a="sound"> ${tr('🔊 聲音', '🔊 sound')}</label></div><div class="vb-buzz" data-buzz="${pins[0]}">—</div></div>`;
    }
    box.innerHTML = h;
    box.classList.toggle('hidden', !h);
    const tin = box.querySelector<HTMLInputElement>('.vb-tin');
    if (tin) tin.onkeydown = e => { if (e.key === 'Enter') { this.sendQ += tin.value; this.echoLocal(tin.value); tin.value = ''; if (!this.running) this.tick(0); } };
    const tc = box.querySelector<HTMLButtonElement>('[data-a=tclear]');
    if (tc) tc.onclick = () => { this.term = ''; this.showTerm(); };
    this.showTerm();
    for (const b of box.querySelectorAll<HTMLButtonElement>('[data-sw]')) {
      const pin = +b.dataset.sw!;
      b.classList.toggle('on', !!this.switches.get(pin));
      b.onclick = () => { const on = !this.switches.get(pin); this.switches.set(pin, on); b.classList.toggle('on', on); this.pending.push([pin, on ? 1 : 0]); if (!this.running) this.tick(0); };
    }
    const snd = box.querySelector<HTMLInputElement>('[data-a=sound]');
    if (snd) { snd.checked = !!this.audio; snd.onchange = () => this.sound(snd.checked); }
  }

  /** a seven-segment digit: segments a..g + dp as paths tagged data-s */
  private digit(x: number, y: number, d: number): string {
    const H = (sx: number, sy: number) => `M${x + sx + 6} ${y + sy} h28 l5 5 l-5 5 h-28 l-5 -5 z`;
    const V = (sx: number, sy: number) => `M${x + sx} ${y + sy + 6} l5 -5 l5 5 v30 l-5 5 l-5 -5 z`;
    const segs = [H(0, 0), V(38, 4), V(38, 46), H(0, 84), V(-6, 46), V(-6, 4), H(0, 42)];
    return segs.map((p, k) => `<path d="${p}" class="vb-s" data-d="${d}" data-s="${k}"/>`).join('') + `<circle cx="${x + 50}" cy="${y + 92}" r="4" class="vb-s" data-d="${d}" data-s="7"/>`;
  }

  private echoLocal(_t: string): void { /* the terminal shows what the FPGA sends, not what is typed (no local echo) */ }

  private showTerm(): void {
    const o = this.host.querySelector<HTMLElement>('.vb-tout');
    if (!o) return;
    o.textContent = this.term;
    o.scrollTop = o.scrollHeight;
  }

  private sound(on: boolean): void {
    if (on && !this.audio) {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      gain.gain.value = 0;
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      this.audio = { ctx, osc, gain };
    } else if (!on && this.audio) {
      this.audio.ctx.close();
      this.audio = null;
    }
  }

  /** the flash button (the IDE hooks it up) */
  get flashButton(): HTMLButtonElement { return this.q('[data-a=flash]'); }
  get loaded(): LoadInfo | null { return this.info; }

  private q<T extends Element = HTMLButtonElement>(sel: string): T { return this.host.querySelector(sel) as unknown as T; }
  private get svg(): SVGSVGElement { return this.q<SVGSVGElement>('.vb-svg'); }

  /** the selected mode: the real bitstream (synthesis, place and route, decoding) or the mapped netlist */
  get mode(): string { return this.q<HTMLSelectElement>('[data-a=mode]').value; }

  /** synthesize `top` and power the board up with it (and `program`, base64, in its program memory) */
  async flash(files: VFile[], top: string, pcf: string | undefined, program?: string): Promise<LoadInfo> {
    this.setRunning(false);
    const gen = ++this.gen;
    const core = await this.core();
    let info: LoadInfo;
    if (this.mode === 'cpu') {
      if (!program) throw new Error(tr('CPU 模式跑的是 C 程式：專案裡要有一個 .c 檔（設計要用 RvSoc）', 'The CPU mode runs a C program: the project needs a .c file (and the RvSoc design)'));
      this.stat(tr('載入 C 程式（CPU 用指令集模擬器）…', 'Loading the C program (the CPU as an instruction-set simulator)…'));
      info = await core.call<LoadInfo>({ cmd: 'board_load_cpu', program, pcf: pcf ?? null, top });
    } else if (this.mode === 'bitstream') {
      this.stat(tr('載入晶片資料庫…', 'Loading the chip database…'));
      await core.chipdb();
      this.stat(tr('合成、佈局繞線、產生位元流並燒錄…', 'Synthesis, place and route, bitstream, flashing…'));
      info = await core.call<LoadInfo>({ cmd: 'board_flash', files, top, pcf: pcf ?? null, program: program ?? null });
    } else {
      this.stat(tr('合成並燒錄網表…', 'Synthesizing and flashing the netlist…'));
      info = await core.call<LoadInfo>({ cmd: 'board_load', files, top, pcf: pcf ?? null, program: program ?? null });
    }
    if (gen !== this.gen) return info;
    this.start(info);
    return info;
  }

  /** a new program (base64) for the design on the board: no synthesis, no place and route */
  async program(program: string): Promise<void> {
    if (!this.info) throw new Error('no design on the board');
    this.setRunning(false);
    ++this.gen;
    this.stat(tr('換程式…', 'Loading the program…'));
    const r = await (await this.core()).call<{ bin: string | null; bytes: number }>({ cmd: 'board_program', program });
    this.start({ ...this.info, bin: r.bin ?? this.info.bin, program: r.bytes });
  }

  /** any iCE40UP5K bitstream from a file */
  private async loadBin(f: File): Promise<void> {
    this.setRunning(false);
    const gen = ++this.gen;
    const bytes = new Uint8Array(await f.arrayBuffer());
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    try {
      const core = await this.core();
      this.stat(tr('載入晶片資料庫…', 'Loading the chip database…'));
      await core.chipdb();
      this.stat(tr('解碼位元流…', 'Decoding the bitstream…'));
      const info = await core.call<LoadInfo>({ cmd: 'board_load_bin', bin: btoa(s), name: f.name });
      if (gen !== this.gen) return;
      this.start(info);
      this.onLoaded(info);
    } catch (e) {
      this.stat('✗ ' + String((e as Error).message ?? e));
    }
  }

  /** a new pin file from the pin table (the IDE saves it as pins.pcf and flashes again) */
  onPins: (pcf: string) => void = () => {};

  /** the pin assignment table: a pin per port bit */
  private pinTable(): void {
    const i = this.info;
    const box = this.q<HTMLElement>('.vb-pins');
    if (!i?.ports) return;
    const cur = new Map<string, number>();
    for (const p of i.pins) { const port = p.input ?? p.output; if (port) cur.set(port, p.pin); }
    const kind = (k: string) => ({ clock: tr('時脈', 'clock'), button: tr('按鈕', 'button'), led: 'LED', uart_rx: 'UART RX', uart_tx: 'UART TX', pmod: 'PMOD' } as Record<string, string>)[k] ?? k;
    const opts = (port: string) => `<option value="">—</option>` + i.pins.map(p => `<option value="${p.pin}"${cur.get(port) === p.pin ? ' selected' : ''}>${p.name}（${p.pin}，${kind(p.kind)}）</option>`).join('');
    box.innerHTML = `<div class="vb-pins-box"><div class="vb-card-h">${tr('腳位指定', 'Pin assignment')}　<span class="vb-dim">${tr('套用後寫入 pins.pcf 並重新燒錄', 'Apply writes pins.pcf and flashes again')}</span></div>
      <table>${i.ports.map(p => `<tr><td>${esc(p.name)}</td><td class="vb-dim">${p.dir === 'in' ? tr('輸入', 'input') : tr('輸出', 'output')}</td><td><select data-port="${esc(p.name)}">${opts(p.name)}</select></td></tr>`).join('')}</table>
      <div class="vb-pins-act"><button class="tb-btn primary" data-a="pins-ok">${tr('套用並燒錄', 'Apply and flash')}</button><button class="tb-btn" data-a="pins-no">${tr('取消', 'Cancel')}</button></div></div>`;
    box.classList.remove('hidden');
    box.querySelector<HTMLButtonElement>('[data-a=pins-no]')!.onclick = () => box.classList.add('hidden');
    box.querySelector<HTMLButtonElement>('[data-a=pins-ok]')!.onclick = () => {
      const lines = [...box.querySelectorAll<HTMLSelectElement>('select[data-port]')].filter(sel => sel.value).map(sel => `set_io -nowarn ${sel.dataset.port} ${sel.value}`);
      box.classList.add('hidden');
      this.onPins(`# pins of ${i.top} on the iCEBreaker (written by the pin table)\n${lines.join('\n')}\n`);
    };
  }

  /** called after an uploaded bitstream is on the board (the IDE shows its warnings) */
  onLoaded: (info: LoadInfo) => void = () => {};

  private download(): void {
    if (!this.info?.bin) return;
    const raw = atob(this.info.bin);
    const u = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) u[i] = raw.charCodeAt(i);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([u], { type: 'application/octet-stream' }));
    a.download = `${this.info.top}.bin`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  private start(info: LoadInfo): void {
    this.info = info;
    this.held.clear();
    this.latched.clear();
    this.lastCycle = 0;
    this.speed = { t: performance.now(), c: 0, rate: 0 };
    this.cycles = 20000;
    this.wire();
    this.foot();
    this.q('[data-a=run]').disabled = false;
    this.q('[data-a=power]').disabled = false;
    this.q('[data-a=download]').classList.toggle('hidden', !info.bin);
    this.q('[data-a=pins]').disabled = !info.ports;
    this.term = '';
    this.bbIn.clear();
    this.cards();
    this.attach().then(() => this.setRunning(true));
  }

  private async power(): Promise<void> {
    if (!this.info) return;
    const was = this.running;
    this.setRunning(false);
    await (await this.core()).call({ cmd: 'board_reset' });
    this.vgaSeen = 0;
    for (const [pin, on] of this.switches) this.pending.push([pin, on ? 1 : 0]);
    this.lastCycle = 0;
    this.speed = { t: performance.now(), c: 0, rate: 0 };
    for (const p of this.latched) this.press(p, true);
    if (was) this.setRunning(true); else this.tick(0);
  }

  stop(): void { this.setRunning(false); }
  resume(): void { this.setRunning(true); }
  get isRunning(): boolean { return this.running; }

  private setRunning(on: boolean): void {
    this.running = on && !!this.info;
    this.q('[data-a=run]').textContent = this.running ? '⏸' : '▶';
    this.q('[data-a=run]').title = this.running ? tr('暫停', 'Pause') : tr('繼續', 'Run');
    clearTimeout(this.loop);
    if (this.running) { this.speed = { t: performance.now(), c: this.lastCycle, rate: this.speed.rate }; this.tick(this.cycles); }
  }

  private press(pin: number, down: boolean): void {
    const p = this.info?.pins.find(x => x.pin === pin);
    if (!p || p.kind !== 'button') return;
    this.held.set(pin, down);
    this.pending.push([pin, (down ? p.level : !p.level) ? 1 : 0]);
    this.svg.querySelector(`[data-btn="${pin}"]`)?.classList.toggle('down', down);
    if (!this.running) this.tick(0);
  }

  /** one call to the worker: `n` cycles, then draw and schedule the next */
  private async tick(n: number): Promise<void> {
    const gen = this.gen;
    const t0 = performance.now();
    const inputs = this.pending;
    this.pending = [];
    const uart_send = this.sendQ;
    this.sendQ = '';
    const wantFrame = this.setup.pmod1a === 'vga' && performance.now() - this.lastFrame > 150;
    let r: RunResult;
    try {
      r = await (await this.core()).call<RunResult>({ cmd: 'board_run', cycles: n, inputs, uart_send, ...(wantFrame ? { vga_seen: this.vgaSeen } : {}) });
    } catch (e) {
      this.stat('✗ ' + String((e as Error).message ?? e));
      this.setRunning(false);
      return;
    }
    if (gen !== this.gen) return;
    const dt = performance.now() - t0;
    this.lastCycle = r.cycle;
    this.show(r);
    if (!this.running) { this.stat(); return; }
    // ~25 ms of work per call; at most real time when asked
    if (n > 0) this.cycles = Math.max(1000, Math.min(4e6, Math.round(n * 25 / Math.max(1, dt))));
    const now = performance.now();
    const el = (now - this.speed.t) / 1000;
    if (el > 0.5) { this.speed.rate = (r.cycle - this.speed.c) / el; this.speed = { t: now, c: r.cycle, rate: this.speed.rate }; }
    this.stat();
    let next = this.cycles;
    let wait = 0;
    if (this.realtime) {
      const hz = this.info!.clock_hz;
      next = Math.min(next, Math.round(hz * 0.03));
      wait = Math.max(0, next / hz * 1000 - dt);
    }
    this.loop = window.setTimeout(() => this.tick(next), wait);
  }

  private lastFrame = 0;

  /** the breadboard against the outputs' duties: LED brightness, warnings, the FPGA's input levels */
  private solveBB(): void {
    if (!this.setup.breadboard || !this.info) return;
    const outs = new Map<number, number>(), ins = new Set<number>();
    for (const p of this.info.pins) {
      if (this.bb.blocked.has(p.pin)) continue;
      if (p.output) outs.set(p.pin, this.duty.get(p.pin) ?? 0);
      if (p.input) ins.add(p.pin);
    }
    const r = solve(this.bb.parts, outs, ins, this.bb.pressed, tr);
    this.bb.setLeds(r.led);
    this.bb.setWarnings(r.warnings);
    for (const [pin, v] of r.inputs) {
      if (this.bbIn.get(pin) !== v) { this.bbIn.set(pin, v); this.pending.push([pin, v]); }
    }
  }

  /** LED brightness and pin levels from the duty cycles */
  private show(r: RunResult): void {
    this.duty = new Map(r.duty);
    this.solveBB();
    this.showPeriph(r);
    for (const [pin, duty] of r.duty) {
      const p = this.info!.pins.find(x => x.pin === pin);
      if (!p) continue;
      const lit = p.kind === 'led' ? (p.level ? duty : 1 - duty) : duty;
      for (const el of this.svg.querySelectorAll<SVGElement>(`[data-led="${pin}"]`)) el.style.opacity = (lit < 0.004 ? 0 : 0.18 + 0.82 * Math.sqrt(lit)).toFixed(3);
      for (const el of this.svg.querySelectorAll<SVGElement>(`[data-hdr="${pin}"]`)) el.style.fill = `rgba(255, 210, 80, ${(0.15 + 0.85 * duty).toFixed(3)})`;
    }
  }

  private showPeriph(r: RunResult): void {
    const duty = new Map(r.duty);
    for (const el of this.host.querySelectorAll<HTMLElement>('[data-l8]')) {
      const d = duty.get(+el.dataset.l8!);
      el.style.setProperty('--lit', d === undefined ? '0' : (d < 0.004 ? 0 : 0.2 + 0.8 * Math.sqrt(d)).toFixed(3));
      el.classList.toggle('nc', d === undefined);
    }
    // seven-segment: a segment's brightness relative to one digit's share of the time
    let si = 0;
    for (const svg of this.host.querySelectorAll<SVGSVGElement>('[data-seg]')) {
      const disp = r.segs[si++];
      if (!disp) continue;
      for (const el of svg.querySelectorAll<SVGElement>('.vb-s')) {
        const v = disp[+el.dataset.d!]?.[+el.dataset.s!] ?? 0;
        el.style.opacity = (v * disp.length < 0.01 ? 0.08 : 0.25 + 0.75 * Math.min(1, Math.sqrt(v * disp.length))).toFixed(3);
      }
    }
    if (r.uart) {
      if (r.uart.rx.length) {
        for (const b of r.uart.rx) { if (b === 13) continue; this.term += b === 10 || b >= 32 ? String.fromCharCode(b) : `\\x${b.toString(16).padStart(2, '0')}`; }
        if (this.term.length > 20000) this.term = this.term.slice(-15000);
        this.showTerm();
      }
      const e = this.host.querySelector<HTMLElement>('.vb-err');
      if (e) e.textContent = r.uart.errors ? `　⚠ ${r.uart.errors} ${tr('個格式錯誤（鮑率對嗎？）', 'framing errors (right baud rate?)')}` : '';
    }
    if (r.vga?.rle && r.vga.w && r.vga.h) {
      this.vgaSeen = r.vga.n;
      this.lastFrame = performance.now();
      this.drawFrame(r.vga.w, r.vga.h, r.vga.rle);
    }
    const vi = this.host.querySelector<HTMLElement>('.vb-vga-i');
    if (vi && r.vga) vi.textContent = r.vga.n ? `${tr('畫面', 'frames')} ${r.vga.n}` : tr('等待 VSYNC…', 'waiting for VSYNC…');
    // buzzer: toggles per virtual second
    const bz = this.host.querySelector<HTMLElement>('[data-buzz]');
    if (bz && r.window > 0) {
      const edges = new Map(r.edges).get(+bz.dataset.buzz!) ?? 0;
      const hz = edges / 2 / (r.window / this.info!.clock_hz);
      bz.textContent = hz >= 1 ? `${hz < 1000 ? hz.toFixed(1) : (hz / 1000).toFixed(2) + ' k'}Hz` : tr('（安靜）', '(silent)');
      if (this.audio) {
        const on = hz >= 20 && hz <= 20000;
        this.audio.gain.gain.setTargetAtTime(on ? 0.05 : 0, this.audio.ctx.currentTime, 0.01);
        if (on) this.audio.osc.frequency.setTargetAtTime(hz, this.audio.ctx.currentTime, 0.01);
      }
    }
  }

  private drawFrame(w: number, h: number, rle: string): void {
    const c = this.host.querySelector<HTMLCanvasElement>('.vb-vga');
    if (!c) return;
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    const raw = atob(rle);
    const img = c.getContext('2d')!.createImageData(w, h);
    let p = 0;
    for (let i = 0; i + 3 < raw.length; i += 4) {
      const col = raw.charCodeAt(i) | raw.charCodeAt(i + 1) << 8;
      const n = raw.charCodeAt(i + 2) | raw.charCodeAt(i + 3) << 8;
      const [R, G, B] = [((col >> 8) & 15) * 17, ((col >> 4) & 15) * 17, (col & 15) * 17];
      for (let k = 0; k < n && p < w * h; k++, p++) { img.data[p * 4] = R; img.data[p * 4 + 1] = G; img.data[p * 4 + 2] = B; img.data[p * 4 + 3] = 255; }
    }
    c.getContext('2d')!.putImageData(img, 0, 0);
  }

  private stat(text?: string): void {
    const s = this.q<HTMLElement>('.vb-stat');
    if (text !== undefined) { s.textContent = text; return; }
    if (!this.info) { s.textContent = tr('還沒有燒錄設計', 'No design flashed yet'); return; }
    const hz = this.info.clock_hz;
    const t = this.lastCycle / hz;
    const rate = this.speed.rate;
    s.textContent = `${this.info.top} · ${tr('虛擬時間', 'virtual time')} ${t < 10 ? t.toFixed(3) : t.toFixed(1)} s · `
      + (this.running ? `${tr('速度', 'speed')} ${(rate / 1e6).toFixed(2)} MHz（${tr('真實的', 'real time ×')} ${(rate / hz).toFixed(2)}${tr(' 倍', '')}）` : tr('暫停', 'paused'));
  }

  /** which pins the design uses: tooltips and dim parts it does not drive */
  private wire(): void {
    const by = new Map(this.info!.pins.map(p => [p.pin, p]));
    for (const el of this.svg.querySelectorAll<SVGElement>('[data-pin]')) {
      const p = by.get(+el.dataset.pin!);
      if (!p) continue;
      const port = p.input ?? p.output;
      el.classList.toggle('used', !!port);
      const t = el.querySelector('title') ?? el.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'title'));
      t.textContent = `${p.name}（${tr('腳', 'pin')} ${p.pin}）` + (port ? ` ↔ ${port}` : tr('：設計沒有用到', ': not used by the design'));
    }
    for (const el of this.svg.querySelectorAll<SVGElement>('[data-led],[data-hdr]')) { el.style.opacity = el.dataset.led ? '0' : ''; el.style.fill = ''; }
  }

  private foot(): void {
    const i = this.info!;
    const used = i.pins.filter(p => p.input || p.output).map(p => `${p.name}↔${p.input ?? p.output}`);
    const what = i.mode === 'cpu'
      ? tr(`CPU 模式：C 程式 ${i.program ?? 0} 位元組，CPU 用指令集模擬器（和 RvSoc 一樣的記憶體映射與時脈數），周邊與腳位照 pins.pcf`, `CPU mode: a ${i.program ?? 0}-byte C program, the CPU as an instruction-set simulator (RvSoc's memory map and cycle counts), peripherals and pins from pins.pcf`)
      : i.mode === 'netlist'
      ? `${tr('網表', 'netlist')}：${i.cells.lut} LUT、${i.cells.carry} CARRY、${i.cells.ff} DFF${i.cells.ram ? `、${i.cells.ram} BRAM` : ''}（${tr('未佈局繞線', 'not placed and routed')}）`
      : `${i.mode === 'bin' ? tr('上傳的位元流', 'uploaded bitstream') : tr('位元流', 'bitstream')}：${i.cells.lc ?? i.cells.lut} LC${i.cells.ram ? `、${i.cells.ram} BRAM` : ''}`
        + (i.fmax ? `，F<sub>max</sub> ${i.fmax.toFixed(1)} MHz${i.fmax < i.clock_hz / 1e6 ? ' ⚠' : ` ≥ 12 MHz ✓`}` : '');
    this.q<HTMLElement>('.vb-foot').innerHTML = `<b>${esc(i.top)}</b>　${what}`
      + `　${i.default_pcf ? tr('（專案沒有腳位檔：使用教學的 iCEBreaker 預設腳位）', '(no pin file in the project: the tutorial\'s iCEBreaker pins)') : ''}`
      + `<br>${tr('接線', 'Wiring')}：${esc(used.join('　')) || '—'}`
      + (i.warnings.length ? `<br><span class="vb-warn">⚠ ${esc(i.warnings.slice(0, 3).join('；'))}${i.warnings.length > 3 ? tr(`…（共 ${i.warnings.length} 條，見「問題」面板）`, `… (${i.warnings.length} in all, see Problems)`) : ''}</span>` : '')
      + `<br><span class="vb-hint">${tr('按住按鈕（或按鍵 0 = BTN_N、1–3 = BTN1–3）；Shift+點擊可以鎖住按鈕。位元流模式模擬的是佈局繞線後真正會燒進晶片的位元流（解碼回電路、逐週期模擬），速度依設計大小而定；可以把任何 .bin 拖放到板子上。板子的圖是示意圖。', 'Hold a button (or keys 0 = BTN_N, 1–3 = BTN1–3); Shift+click latches it. In bitstream mode the board runs the placed-and-routed bitstream that would be flashed (decoded back into a circuit, simulated cycle by cycle); the speed depends on the design size. Drop any .bin on the board. The board drawing is schematic.')}</span>`;
  }

  /** the board: main section (USB, FPGA, LEDs, button, PMOD1A/1B) and the break-off section */
  private drawing(): string {
    const hdr = (x: number, y: number, pins: number[], label: string, vertical = false) => {
      let s = `<text x="${x + (vertical ? 22 : 60)}" y="${y - 8}" class="vb-silk" text-anchor="middle">${label}</text>`;
      // 2 × 6 header: signal pins 1-4 / 7-10, then GND and 3V3
      const rows = [[...pins.slice(0, 4), -1, -2], [...pins.slice(4), -1, -2]];
      rows.forEach((row, r) => row.forEach((p, k) => {
        const [px, py] = vertical ? [x + r * 22, y + k * 22] : [x + k * 22, y + r * 22];
        if (p < 0) { s += `<rect x="${px}" y="${py}" width="18" height="18" rx="2" class="vb-hdr-pwr"><title>${p === -1 ? 'GND' : '3V3'}</title></rect>`; return; }
        s += `<g data-pin="${p}"><rect x="${px}" y="${py}" width="18" height="18" rx="2" class="vb-hdr" data-hdr="${p}"/></g>`;
      }));
      return s;
    };
    const led = (x: number, y: number, pin: number, color: string, label: string) =>
      `<g data-pin="${pin}"><rect x="${x - 9}" y="${y - 6}" width="18" height="12" rx="2" class="vb-led-body"/>`
      + `<circle cx="${x}" cy="${y}" r="16" fill="${color}" filter="url(#vbGlow)" data-led="${pin}" style="opacity:0"/>`
      + `<rect x="${x - 9}" y="${y - 6}" width="18" height="12" rx="2" fill="${color}" data-led="${pin}" style="opacity:0"/>`
      + `<text x="${x}" y="${y + 22}" class="vb-silk" text-anchor="middle">${label}</text></g>`;
    const btn = (x: number, y: number, pin: number, label: string) =>
      `<g data-pin="${pin}" data-btn="${pin}" class="vb-btn"><rect x="${x - 15}" y="${y - 15}" width="30" height="30" rx="3" class="vb-btn-base"/>`
      + `<circle cx="${x}" cy="${y}" r="10" class="vb-btn-cap"/><text x="${x}" y="${y + 30}" class="vb-silk" text-anchor="middle">${label}</text></g>`;
    return `<defs><filter id="vbGlow" x="-1" y="-1" width="3" height="3"><feGaussianBlur stdDeviation="5"/></filter></defs>
      <rect x="10" y="20" width="640" height="290" rx="14" class="vb-pcb"/>
      <rect x="670" y="20" width="240" height="290" rx="14" class="vb-pcb"/>
      <line x1="660" y1="30" x2="660" y2="300" class="vb-perf"/>
      <text x="30" y="300" class="vb-silk vb-title">iCEBreaker</text>
      <rect x="0" y="135" width="42" height="56" rx="4" class="vb-usb"/><text x="48" y="128" class="vb-silk">USB</text>
      <rect x="70" y="140" width="52" height="46" rx="3" class="vb-chip"/><text x="96" y="167" class="vb-chip-t" text-anchor="middle">FTDI</text>
      <rect x="150" y="215" width="44" height="30" rx="2" class="vb-chip"/><text x="172" y="234" class="vb-chip-t" text-anchor="middle">flash</text>
      <g data-pin="35"><rect x="160" y="80" width="40" height="24" rx="5" class="vb-osc"/><text x="180" y="96" class="vb-chip-t" text-anchor="middle">12M</text><title>12 MHz</title></g>
      <rect x="245" y="95" width="140" height="140" rx="4" class="vb-chip vb-fpga"/>
      <text x="315" y="160" class="vb-chip-t vb-fpga-t" text-anchor="middle">iCE40UP5K</text>
      <text x="315" y="180" class="vb-chip-t" text-anchor="middle">SG48</text>
      ${led(430, 60, 11, '#ff3b30', 'LEDR_N')}
      ${led(480, 60, 37, '#34c759', 'LEDG_N')}
      ${btn(440, 255, 10, 'BTN_N')}
      ${hdr(500, 120, PMOD1A, 'PMOD1A', true)}
      ${hdr(575, 120, PMOD1B, 'PMOD1B', true)}
      ${hdr(682, 120, PMOD2, 'PMOD2', true)}
      ${led(810, 115, 26, '#ff3b30', 'LED1')}
      ${led(810, 65, 27, '#34c759', 'LED2')}
      ${led(860, 115, 25, '#34c759', 'LED3')}
      ${led(810, 165, 23, '#34c759', 'LED4')}
      ${led(760, 115, 21, '#34c759', 'LED5')}
      ${btn(760, 250, 20, 'BTN1')}
      ${btn(810, 250, 19, 'BTN2')}
      ${btn(860, 250, 18, 'BTN3')}`;
  }
}
