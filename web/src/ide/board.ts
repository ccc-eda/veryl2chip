// The virtual iCEBreaker: the design "flashed" onto a drawn board. The
// simulation runs in its own worker (board_load / board_run / board_reset
// of the core); this side draws the board, turns duty cycles into LED
// brightness and sends button presses.

import type { VFile } from '../api';
import type { Core } from '../client';
import { tr } from '../i18n';

interface PinInfo { pin: number; name: string; kind: string; level: boolean; input: string | null; output: string | null }
interface LoadInfo {
  top: string; pins: PinInfo[]; warnings: string[]; default_pcf: boolean; clock_hz: number;
  cells: { lut: number; carry: number; ff: number; ram: number; lc?: number };
  /** bitstream: synthesized, placed, routed, decoded; netlist: the mapped netlist; bin: an uploaded bitstream */
  mode: 'bitstream' | 'netlist' | 'bin';
  fmax?: number;
  bin?: string;
}
interface RunResult { cycle: number; duty: [number, number][]; evals: number }

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
        <select data-a="mode" title="${tr('燒錄什麼：位元流＝佈局繞線後的真實位元流（解碼回電路模擬）；網表＝映射後的網表（快，不佈局繞線）', 'What to flash: bitstream = the real placed-and-routed bitstream (decoded back into a circuit); netlist = the mapped netlist (fast, no place and route)')}">
          <option value="bitstream">${tr('位元流（真實）', 'bitstream (real)')}</option><option value="netlist">${tr('網表（快速）', 'netlist (fast)')}</option></select>
        <button class="tb-btn ghost" data-a="upload" title="${tr('載入任何 iCE40UP5K 的 .bin（例如 nextpnr + icepack 做的；也可以拖放到板子上）', 'Load any iCE40UP5K .bin (e.g. from nextpnr + icepack; or drop it on the board)')}">${tr('📂 .bin', '📂 .bin')}</button>
        <button class="tb-btn ghost hidden" data-a="download" title="${tr('下載這個位元流（iceprog 可以燒進真實的 iCEBreaker）', 'Download this bitstream (iceprog flashes it to a real iCEBreaker)')}">⬇ .bin</button>
        <input type="file" accept=".bin" class="hidden" data-a="file">
        <select data-a="pace" title="${tr('速度', 'Speed')}"><option value="rt">${tr('不超過即時', 'up to real time')}</option><option value="max">${tr('最快', 'fastest')}</option></select>
        <span class="vb-stat"></span>
      </div>
      <div class="vb-stage"><svg class="vb-svg" viewBox="0 0 920 330" xmlns="http://www.w3.org/2000/svg"></svg></div>
      <div class="vb-foot"></div>`;
    this.svg.innerHTML = this.drawing();
    this.q('[data-a=run]').onclick = () => this.setRunning(!this.running);
    this.q('[data-a=power]').onclick = () => this.power();
    this.q<HTMLSelectElement>('[data-a=pace]').onchange = e => { this.realtime = (e.target as HTMLSelectElement).value === 'rt'; };
    this.q('[data-a=upload]').onclick = () => this.q<HTMLInputElement>('[data-a=file]').click();
    this.q<HTMLInputElement>('[data-a=file]').onchange = e => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) this.loadBin(f); (e.target as HTMLInputElement).value = ''; };
    this.q('[data-a=download]').onclick = () => this.download();
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

  /** the flash button (the IDE hooks it up) */
  get flashButton(): HTMLButtonElement { return this.q('[data-a=flash]'); }
  get loaded(): LoadInfo | null { return this.info; }

  private q<T extends Element = HTMLButtonElement>(sel: string): T { return this.host.querySelector(sel) as unknown as T; }
  private get svg(): SVGSVGElement { return this.q<SVGSVGElement>('.vb-svg'); }

  /** the selected mode: the real bitstream (synthesis, place and route, decoding) or the mapped netlist */
  get mode(): string { return this.q<HTMLSelectElement>('[data-a=mode]').value; }

  /** synthesize `top` and power the board up with it */
  async flash(files: VFile[], top: string, pcf: string | undefined): Promise<LoadInfo> {
    this.setRunning(false);
    const gen = ++this.gen;
    const core = await this.core();
    let info: LoadInfo;
    if (this.mode === 'bitstream') {
      this.stat(tr('載入晶片資料庫…', 'Loading the chip database…'));
      await core.chipdb();
      this.stat(tr('合成、佈局繞線、產生位元流並燒錄…', 'Synthesis, place and route, bitstream, flashing…'));
      info = await core.call<LoadInfo>({ cmd: 'board_flash', files, top, pcf: pcf ?? null });
    } else {
      this.stat(tr('合成並燒錄網表…', 'Synthesizing and flashing the netlist…'));
      info = await core.call<LoadInfo>({ cmd: 'board_load', files, top, pcf: pcf ?? null });
    }
    if (gen !== this.gen) return info;
    this.start(info);
    return info;
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
    this.setRunning(true);
  }

  private async power(): Promise<void> {
    if (!this.info) return;
    const was = this.running;
    this.setRunning(false);
    await (await this.core()).call({ cmd: 'board_reset' });
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
    let r: RunResult;
    try {
      r = await (await this.core()).call<RunResult>({ cmd: 'board_run', cycles: n, inputs });
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

  /** LED brightness and pin levels from the duty cycles */
  private show(r: RunResult): void {
    for (const [pin, duty] of r.duty) {
      const p = this.info!.pins.find(x => x.pin === pin);
      if (!p) continue;
      const lit = p.kind === 'led' ? (p.level ? duty : 1 - duty) : duty;
      for (const el of this.svg.querySelectorAll<SVGElement>(`[data-led="${pin}"]`)) el.style.opacity = (lit < 0.004 ? 0 : 0.18 + 0.82 * Math.sqrt(lit)).toFixed(3);
      for (const el of this.svg.querySelectorAll<SVGElement>(`[data-hdr="${pin}"]`)) el.style.fill = `rgba(255, 210, 80, ${(0.15 + 0.85 * duty).toFixed(3)})`;
    }
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
    const what = i.mode === 'netlist'
      ? `${tr('網表', 'netlist')}：${i.cells.lut} LUT、${i.cells.carry} CARRY、${i.cells.ff} DFF${i.cells.ram ? `、${i.cells.ram} BRAM` : ''}（${tr('未佈局繞線', 'not placed and routed')}）`
      : `${i.mode === 'bin' ? tr('上傳的位元流', 'uploaded bitstream') : tr('位元流', 'bitstream')}：${i.cells.lc ?? i.cells.lut} LC${i.cells.ram ? `、${i.cells.ram} BRAM` : ''}`
        + (i.fmax ? `，F<sub>max</sub> ${i.fmax.toFixed(1)} MHz${i.fmax < i.clock_hz / 1e6 ? ' ⚠' : ` ≥ 12 MHz ✓`}` : '');
    this.q<HTMLElement>('.vb-foot').innerHTML = `<b>${esc(i.top)}</b>　${what}`
      + `　${i.default_pcf ? tr('（專案沒有腳位檔：使用教學的 iCEBreaker 預設腳位）', '(no pin file in the project: the tutorial\'s iCEBreaker pins)') : ''}`
      + `<br>${tr('接線', 'Wiring')}：${esc(used.join('　')) || '—'}`
      + (i.warnings.length ? `<br><span class="vb-warn">⚠ ${esc(i.warnings.join('；'))}</span>` : '')
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
