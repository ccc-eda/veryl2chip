// The RV64 development board (machine.json "board": "pi"): a Raspberry Pi style
// board drawn next to the emulator's terminal. The SoC's GPIO 0 and 1 are the
// board's ACT and USER LEDs, GPIO 2 its button; GPIO 3-15 are on the 40-pin
// header where the Pi has the same BCM numbers, and on a breadboard below
// (the FPGA board's breadboard and electrical model). A machine with a screen
// (machine.json "fb") gets an LCD between the board and the breadboard.

import { tr } from '../i18n';
import { node, Part, solve } from './bbmodel';
import { Breadboard, Header } from './breadboard';

/** header pins 1..40: what each one is (GPIO n = the SoC's pin n, as BCM n on a Raspberry Pi) */
export const PI_HEADER: string[] = [
  '3V3', '5V', '—', '5V', 'GPIO3', 'GND', 'GPIO4', 'GPIO14', 'GND', 'GPIO15',
  '—', '—', '—', 'GND', '—', '—', '3V3', '—', 'GPIO10', 'GND',
  'GPIO9', '—', 'GPIO11', 'GPIO8', 'GND', 'GPIO7', '—', '—', 'GPIO5', 'GND',
  'GPIO6', 'GPIO12', 'GPIO13', 'GND', '—', '—', '—', '—', 'GND', '—',
];
/** GPIO pins on the header (and the breadboard) */
export const HEADER_GPIOS = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
const physical = (g: number) => PI_HEADER.indexOf(`GPIO${g}`) + 1;
const BB_HEADER: Header = { groups: [{ label: 'GPIO', pins: HEADER_GPIOS, names: HEADER_GPIOS.map(String), title: (i) => tr(`GPIO ${HEADER_GPIOS[i]}（排針第 ${physical(HEADER_GPIOS[i])} 腳）`, `GPIO ${HEADER_GPIOS[i]} (header pin ${physical(HEADER_GPIOS[i])})`) }] };

/** the example's breadboard: red, yellow and green LEDs on GPIO 5, 12, 13 (each with its resistor), a button on GPIO 6 (with a pull-down) */
export const PI_DEFAULT_BB: Part[] = [
  { id: 1, kind: 'wire', a: 'gnd', b: 'r:top-:1', color: '#3e63dd' },
  { id: 2, kind: 'wire', a: 'vcc', b: 'r:top+:30', color: '#e5484d' },
  { id: 3, kind: 'wire', a: 'p:5', b: 'h:3:a', color: '#f76b15' },
  { id: 4, kind: 'led', a: 'h:3:c', b: 'h:4:c', color: '#ff3b30' },
  { id: 5, kind: 'res', a: 'h:4:e', b: 'r:top-:4' },
  { id: 6, kind: 'btn', a: 'r:top+:12', b: 'h:12:b' },
  { id: 7, kind: 'wire', a: 'h:12:a', b: 'p:6', color: '#8e4ec6' },
  { id: 8, kind: 'res', a: 'h:12:e', b: 'r:top-:13' },
  { id: 9, kind: 'wire', a: 'p:12', b: 'h:6:a', color: '#f76b15' },
  { id: 10, kind: 'led', a: 'h:6:c', b: 'h:7:c', color: '#ffcc00' },
  { id: 11, kind: 'res', a: 'h:7:e', b: 'r:top-:7' },
  { id: 12, kind: 'wire', a: 'p:13', b: 'h:9:a', color: '#f76b15' },
  { id: 13, kind: 'led', a: 'h:9:c', b: 'h:10:c', color: '#34c759' },
  { id: 14, kind: 'res', a: 'h:10:e', b: 'r:top-:10' },
];

/** the shortest press from the keyboard (programs read the buttons every few tens of ms) */
const HOLD_MS = 120;

export class PiBoard {
  private svg: SVGSVGElement;
  private bb: Breadboard;
  private duty: number[] = [];
  private oe = 0;
  private button = false;
  private bbInputs = 0;
  private powered = false;
  /** GPIO inputs changed (a bit per pin) */
  onInputs: (bits: number) => void = () => {};
  /** the breadboard's layout changed (save it with the project) */
  onLayout: (parts: Part[]) => void = () => {};

  constructor(host: HTMLElement) {
    host.innerHTML = `<svg class="pi-svg" viewBox="0 0 560 250" xmlns="http://www.w3.org/2000/svg"></svg><div class="pi-keys"></div>`
      + `<div class="pi-lcd hidden"><canvas width="320" height="240"></canvas><div class="pi-t2">${tr('螢幕 320 × 240（/dev/fb0）', 'Screen 320 × 240 (/dev/fb0)')}</div></div><div class="pi-bb"></div>`;
    this.svg = host.querySelector('.pi-svg')!;
    this.lcd = host.querySelector('.pi-lcd canvas')!;
    this.bb = new Breadboard(host.querySelector('.pi-bb')!, BB_HEADER);
    this.bb.onChange = (layout) => { if (layout) { this.onLayout(this.bb.parts); this.keyHint(); } this.solve(); };
    this.draw();
    this.svg.addEventListener('mousedown', (e) => { host.focus(); if ((e.target as Element).closest('[data-a="btn"]')) { e.preventDefault(); this.press(true); } });
    this.svg.addEventListener('touchstart', (e) => { if ((e.target as Element).closest('[data-a="btn"]')) { e.preventDefault(); this.press(true); } });
    window.addEventListener('mouseup', () => this.press(false));
    window.addEventListener('touchend', () => this.press(false));
    // the keyboard holds the buttons while the board has the focus (a click on it); the terminal keeps its keys
    host.tabIndex = 0;
    this.lcd.addEventListener('mousedown', () => host.focus());
    host.addEventListener('keydown', (e) => this.key(e, true));
    host.addEventListener('keyup', (e) => this.key(e, false));
    host.addEventListener('blur', () => { for (const id of [...this.held]) this.bb.hold(id, false); this.held.clear(); this.press(false); }, true);
  }

  private press(on: boolean): void { if (this.button !== on) { this.button = on; this.draw(); this.send(); } }

  /** breadboard buttons held from the keyboard */
  private held = new Set<number>();

  /** the keys: ← / Space the first breadboard button (left to right), → the second, ↑ ↓ the third and fourth, 1-9 by number; B the board's button */
  private keys(): { keys: string[]; id: number | null; gpio: number | null }[] {
    const col = (p: Part) => Math.min(...[p.a, p.b].map((x) => +(/:(\d+)(:|$)/.exec(x)?.[1] ?? 99)));
    const btns = this.bb.parts.filter((p) => p.kind === 'btn').sort((x, y) => col(x) - col(y));
    // the GPIO pin a button is wired to (a wire from its strip to the header)
    const gpioOf = (b: Part) => {
      const ends = new Set([node(b.a), node(b.b)]);
      for (const w of this.bb.parts.filter((p) => p.kind === 'wire')) {
        if (w.a.startsWith('p:') && ends.has(node(w.b))) return +w.a.slice(2);
        if (w.b.startsWith('p:') && ends.has(node(w.a))) return +w.b.slice(2);
      }
      return null;
    };
    const extra = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
    return [
      ...btns.slice(0, 9).map((b, k) => ({ keys: [...(k < 4 ? [extra[k]] : []), ...(k === 0 ? [' '] : []), String(k + 1)], id: b.id, gpio: gpioOf(b) })),
      { keys: ['b', 'B'], id: null, gpio: 2 },
    ];
  }

  /** when each key-held button went down: a tap is held at least HOLD_MS, or a program that polls would miss it */
  private since = new Map<number | null, number>();

  private key(e: KeyboardEvent, down: boolean): void {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = this.keys().find((x) => x.keys.includes(e.key));
    if (!k) return;
    e.preventDefault();
    if (e.repeat) return;
    const set = (on: boolean) => {
      if (k.id === null) { this.press(on); return; }
      if (on) this.held.add(k.id); else this.held.delete(k.id);
      this.bb.hold(k.id, on);
    };
    if (down) { this.since.set(k.id, performance.now()); set(true); return; }
    const t = this.since.get(k.id) ?? 0;
    setTimeout(() => { if (this.since.get(k.id) === t) set(false); }, Math.max(0, HOLD_MS - (performance.now() - t)));
  }

  /** the line under the board: which key presses which button */
  private keyHint(): void {
    const name = (k: string) => ({ ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', ' ': tr('空白鍵', 'Space') } as Record<string, string>)[k] ?? k;
    const list = this.keys().map((k) => `${k.keys.filter((x) => x !== 'B').map(name).join(' / ')}：${k.id === null ? tr('板上的 BTN（GPIO 2）', 'the board\'s BTN (GPIO 2)') : k.gpio !== null ? `GPIO ${k.gpio}` : tr('按鈕', 'button')}`);
    (this.svg.parentElement!.querySelector('.pi-keys') as HTMLElement).innerHTML = `<b>⌨</b> ${tr('點一下板子或螢幕，用鍵盤按按鈕', 'Click the board or the screen, then press the buttons with the keyboard')}　${list.join('　')}`;
  }

  private lcd: HTMLCanvasElement;
  private img: ImageData | null = null;

  /** show the screen (its size in pixels), or hide it (null) */
  setScreenSize(size: { width: number; height: number } | null): void {
    (this.lcd.parentElement as HTMLElement).classList.toggle('hidden', !size);
    if (!size) return;
    this.lcd.width = size.width;
    this.lcd.height = size.height;
    this.img = this.lcd.getContext('2d')!.createImageData(size.width, size.height);
    this.img.data.fill(255);
    for (let i = 0; i < size.width * size.height; i++) { this.img.data[i * 4] = this.img.data[i * 4 + 1] = this.img.data[i * 4 + 2] = 0; }
    this.lcd.getContext('2d')!.putImageData(this.img, 0, 0);
  }

  /** the screen's pixels (RGB565, little-endian) */
  setScreen(px: Uint8Array): void {
    const img = this.img;
    if (!img) return;
    const d = img.data, n = Math.min(px.length >> 1, d.length >> 2);
    for (let i = 0; i < n; i++) {
      const v = px[2 * i] | px[2 * i + 1] << 8;
      const r = v >> 11, g = v >> 5 & 63, b = v & 31;
      d[4 * i] = r << 3 | r >> 2;
      d[4 * i + 1] = g << 2 | g >> 4;
      d[4 * i + 2] = b << 3 | b >> 2;
    }
    this.lcd.getContext('2d')!.putImageData(img, 0, 0);
  }

  setParts(parts: Part[]): void { this.bb.parts = parts.map((p) => ({ ...p })); this.bb.render(); this.solve(); this.keyHint(); }
  get parts(): Part[] { return this.bb.parts; }

  /** the machine is running (PWR LED) */
  setPower(on: boolean): void { if (on !== this.powered) { this.powered = on; this.draw(); } }

  /** output duty of every pin and which pins are driven */
  setOutputs(duty: number[], oe: number): void {
    this.duty = duty;
    this.oe = oe;
    // the header pins driven high are drawn lit: redraw when that changes
    const key = HEADER_GPIOS.map((g) => (oe >> g & 1) && (duty[g] ?? 0) > 0.5 ? 1 : 0).join('');
    if (key !== this.hiKey) { this.hiKey = key; this.draw(); } else this.leds();
    this.solve();
  }
  private hiKey = '';

  private leds(): void {
    for (const [k, id] of [[0, 'act'], [1, 'user']] as const) {
      const v = (this.oe >> k & 1) ? this.duty[k] ?? 0 : 0;
      for (const el of this.svg.querySelectorAll<SVGElement>(`[data-led="${id}"]`)) el.style.opacity = (v < 0.004 ? 0 : 0.3 + 0.7 * Math.sqrt(v)).toFixed(3);
    }
  }

  private solve(): void {
    const outputs = new Map<number, number>();
    const inputs = new Set<number>();
    for (const g of HEADER_GPIOS) { if (this.oe >> g & 1) outputs.set(g, this.duty[g] ?? 0); else inputs.add(g); }
    const r = solve(this.bb.parts, outputs, inputs, this.bb.pressed, tr);
    this.bb.setLeds(r.led);
    this.bb.setWarnings(r.warnings);
    let bits = 0;
    for (const [pin, v] of r.inputs) if (v) bits |= 1 << pin;
    if (bits !== this.bbInputs) { this.bbInputs = bits; this.send(); }
  }

  private send(): void { this.onInputs(this.bbInputs | (this.button ? 1 << 2 : 0)); }

  private draw(): void {
    let s = `<defs><filter id="piGlow" x="-1" y="-1" width="3" height="3"><feGaussianBlur stdDeviation="3"/></filter></defs>`;
    // the board
    s += `<rect x="10" y="10" width="540" height="230" rx="14" class="pi-pcb"/>`;
    for (const [x, y] of [[26, 26], [534, 26], [26, 224], [534, 224]]) s += `<circle cx="${x}" cy="${y}" r="7" class="pi-hole"/>`;
    // 40-pin header: pins 1, 3, ... on the lower row, 2, 4, ... on the upper row (as on a Pi seen from above)
    s += `<rect x="80" y="18" width="404" height="46" rx="3" class="pi-hdr"/>`;
    for (let i = 0; i < 40; i++) {
      const col = Math.floor(i / 2), up = i % 2 === 1;
      const x = 92 + col * 20, y = up ? 30 : 52;
      const what = PI_HEADER[i];
      const cls = what.startsWith('GPIO') ? 'gpio' : what === 'GND' ? 'gnd' : what === '—' ? 'nc' : 'pwr';
      const g = what.startsWith('GPIO') ? +what.slice(4) : -1;
      const lit = g >= 0 && (this.oe >> g & 1) && (this.duty[g] ?? 0) > 0.5;
      s += `<g class="pi-pin ${cls}${lit ? ' hi' : ''}"><title>${tr(`第 ${i + 1} 腳：${what === '—' ? '沒有接' : what}`, `pin ${i + 1}: ${what === '—' ? 'not connected' : what}`)}</title><rect x="${x - 6}" y="${y - 6}" width="12" height="12" rx="2"/></g>`;
      if (what.startsWith('GPIO')) s += `<text x="${x}" y="${up ? 14 : 75}" class="pi-t" text-anchor="middle">${g}</text>`;
    }
    s += `<text x="76" y="56" class="pi-t" text-anchor="end">1</text><text x="490" y="34" class="pi-t">40</text>`;
    // the SoC
    s += `<rect x="190" y="100" width="92" height="92" rx="6" class="pi-chip"/><text x="236" y="140" class="pi-chip-t" text-anchor="middle">Rv64Core</text><text x="236" y="156" class="pi-t" text-anchor="middle">RV64IMAC</text><text x="236" y="170" class="pi-t" text-anchor="middle">256 MB</text>`;
    s += `<text x="236" y="210" class="pi-t" text-anchor="middle">veryl2chip RV64 ${tr('開發板', 'board')}</text>`;
    // UART and power
    s += `<rect x="16" y="110" width="44" height="40" rx="4" class="pi-usb"/><text x="38" y="166" class="pi-t" text-anchor="middle">UART</text>`;
    // LEDs: PWR (red, while running), ACT = GPIO 0 (green), USER = GPIO 1 (yellow)
    const leds: [string, string, string, number][] = [['pwr', 'PWR', '#ff3b30', 92], ['act', 'ACT', '#34c759', 122], ['user', 'USER', '#ffcc00', 152]];
    for (const [id, label, color, y] of leds) {
      const on = id === 'pwr' ? (this.powered ? 1 : 0) : 0;
      s += `<g><circle cx="430" cy="${y}" r="12" fill="${color}" filter="url(#piGlow)" data-led="${id}" style="opacity:${on}"/><circle cx="430" cy="${y}" r="6" class="pi-led" stroke="${color}"/><circle cx="430" cy="${y}" r="6" fill="${color}" data-led="${id}" style="opacity:${on}"/>`
        + `<text x="446" y="${y + 4}" class="pi-t">${label}${id === 'act' ? ' (GPIO 0)' : id === 'user' ? ' (GPIO 1)' : ''}</text></g>`;
    }
    // the button (GPIO 2)
    s += `<g data-a="btn" class="pi-btn${this.button ? ' down' : ''}"><title>${tr('按鈕（GPIO 2，按下 = 1）', 'Button (GPIO 2, pressed = 1)')}</title><rect x="412" y="180" width="36" height="36" rx="4" class="pi-btn-base"/><circle cx="430" cy="198" r="11" class="pi-btn-cap"/></g><text x="456" y="202" class="pi-t">BTN (GPIO 2)</text>`;
    this.svg.innerHTML = s;
    this.leds();
  }
}
