// The RV64 development board (machine.json "board": "pi"): a Raspberry Pi style
// board drawn next to the emulator's terminal. The SoC's GPIO 0 and 1 are the
// board's ACT and USER LEDs, GPIO 2 its button; GPIO 3-15 are on the 40-pin
// header where the Pi has the same BCM numbers, and on a breadboard below
// (the FPGA board's breadboard and electrical model).

import { tr } from '../i18n';
import { Part, solve } from './bbmodel';
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
    host.innerHTML = `<svg class="pi-svg" viewBox="0 0 560 250" xmlns="http://www.w3.org/2000/svg"></svg><div class="pi-bb"></div>`;
    this.svg = host.querySelector('.pi-svg')!;
    this.bb = new Breadboard(host.querySelector('.pi-bb')!, BB_HEADER);
    this.bb.onChange = (layout) => { if (layout) this.onLayout(this.bb.parts); this.solve(); };
    this.draw();
    const press = (on: boolean) => { if (this.button !== on) { this.button = on; this.draw(); this.send(); } };
    this.svg.addEventListener('mousedown', (e) => { if ((e.target as Element).closest('[data-a="btn"]')) { e.preventDefault(); press(true); } });
    this.svg.addEventListener('touchstart', (e) => { if ((e.target as Element).closest('[data-a="btn"]')) { e.preventDefault(); press(true); } });
    window.addEventListener('mouseup', () => press(false));
    window.addEventListener('touchend', () => press(false));
  }

  setParts(parts: Part[]): void { this.bb.parts = parts.map((p) => ({ ...p })); this.bb.render(); this.solve(); }
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
