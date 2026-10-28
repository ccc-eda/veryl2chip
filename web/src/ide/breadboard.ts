// The breadboard editor: a header strip with the board's pins (the iCEBreaker's
// PMOD pins, or the header of another board), 3V3 and GND, power rails and 30
// columns of 5-hole strips; parts are placed by two clicks (pin A, pin B). The
// electrical model is in bbmodel.ts.

import { tr } from '../i18n';
import { Part, PartKind } from './bbmodel';

/** the header strip: groups of pins (number = the point `p:<pin>`), each with a label and pin names */
export interface Header { groups: { label: string; pins: number[]; names: string[]; title?: (i: number) => string }[] }
const NAMES = ['1', '2', '3', '4', '7', '8', '9', '10'];
/** the iCEBreaker's PMOD1A and PMOD1B */
export const PMOD_HEADER: Header = { groups: [
  { label: 'PMOD1A', pins: [4, 2, 47, 45, 3, 48, 46, 44], names: NAMES },
  { label: 'PMOD1B', pins: [43, 38, 34, 31, 42, 36, 32, 28], names: NAMES },
] };
const COLS = 30;
const SVGNS = 'http://www.w3.org/2000/svg';

type Tool = 'select' | PartKind;
const TOOLS: [Tool, string, string][] = [
  ['select', '↖ 選取', '↖ Select'], ['wire', '〰 導線', '〰 Wire'], ['led', '◉ LED', '◉ LED'], ['res', '▭ 電阻', '▭ Resistor'],
  ['btn', '⏺ 按鈕', '⏺ Button'], ['sw', '⇋ 開關', '⇋ Switch'],
];
const LED_COLORS = ['#ff3b30', '#34c759', '#ffcc00', '#0a84ff'];
const WIRE_COLORS = ['#e5484d', '#3e63dd', '#30a46c', '#f76b15', '#8e4ec6', '#e5e5e5'];

/** x of the k-th pin of group g in the header strip */
function pinX(h: Header, g: number, k: number): number {
  let i = k;
  for (let j = 0; j < g; j++) i += h.groups[j].pins.length;
  return 34 + i * 26 + g * 14;
}

/** where each point is drawn */
function points(h: Header): Map<string, { x: number; y: number }> {
  const m = new Map<string, { x: number; y: number }>();
  h.groups.forEach((gr, g) => gr.pins.forEach((pin, k) => m.set(`p:${pin}`, { x: pinX(h, g, k), y: 30 })));
  const last = pinX(h, h.groups.length - 1, h.groups[h.groups.length - 1].pins.length - 1);
  m.set('vcc', { x: last + 42, y: 30 });
  m.set('gnd', { x: last + 68, y: 30 });
  for (let c = 1; c <= COLS; c++) {
    const x = 40 + (c - 1) * 16;
    m.set(`r:top+:${c}`, { x, y: 64 });
    m.set(`r:top-:${c}`, { x, y: 78 });
    'abcde'.split('').forEach((r, i) => m.set(`h:${c}:${r}`, { x, y: 104 + i * 14 }));
    'fghij'.split('').forEach((r, i) => m.set(`h:${c}:${r}`, { x, y: 186 + i * 14 }));
    m.set(`r:bot+:${c}`, { x, y: 264 });
    m.set(`r:bot-:${c}`, { x, y: 278 });
  }
  return m;
}

export class Breadboard {
  parts: Part[] = [];
  pressed = new Set<number>();
  blocked = new Set<number>();
  private tool: Tool = 'select';
  private first: string | null = null;
  private sel: number | null = null;
  private pts: Map<string, { x: number; y: number }>;
  private svg: SVGSVGElement;
  private ledColor = 0;
  private wireColor = 0;
  /** layout changed (save it) / a button or switch changed (solve again) */
  onChange: (layoutChanged: boolean) => void = () => {};

  constructor(private host: HTMLElement, private header: Header = PMOD_HEADER) {
    this.pts = points(header);
    host.innerHTML = `<div class="bb-tools">${TOOLS.map(([t, h, e]) => `<button class="tb-btn bb-tool" data-tool="${t}">${tr(h, e)}</button>`).join('')}
      <span class="bb-hint">${tr('選工具，點兩個孔放零件（LED：先點正極）；選取後按 Delete 刪除，右鍵也可刪除；按住按鈕、點一下開關', 'Pick a tool and click two holes (LED: anode first); select + Delete, or right-click, removes; hold buttons, click switches')}</span>
      <button class="tb-btn ghost bb-clear" title="${tr('清空麵包板', 'Clear the breadboard')}">🗑</button></div>
      <svg class="bb-svg" viewBox="0 0 560 296" xmlns="${SVGNS}"></svg>
      <div class="bb-warn"></div>`;
    this.svg = host.querySelector('.bb-svg')!;
    for (const b of host.querySelectorAll<HTMLButtonElement>('.bb-tool')) b.onclick = () => this.setTool(b.dataset.tool as Tool);
    host.querySelector<HTMLButtonElement>('.bb-clear')!.onclick = () => { if (!this.parts.length || confirm(tr('清空麵包板？', 'Clear the breadboard?'))) { this.parts = []; this.render(); this.onChange(true); } };
    this.svg.addEventListener('pointerdown', e => this.down(e));
    this.svg.addEventListener('pointerup', () => this.release());
    this.svg.addEventListener('pointerleave', () => this.release());
    this.svg.addEventListener('pointermove', e => this.hover(e));
    this.svg.addEventListener('contextmenu', e => { e.preventDefault(); const id = this.partAt(e); if (id !== null) this.remove(id); });
    host.tabIndex = 0;
    host.addEventListener('keydown', e => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && this.sel !== null) { this.remove(this.sel); e.preventDefault(); }
      if (e.key === 'Escape') { this.first = null; this.setTool('select'); }
    });
    this.setTool('select');
  }

  setParts(parts: Part[]): void { this.parts = parts.map(p => ({ ...p })); this.pressed.clear(); this.render(); }

  /** hold or let go of a button (from the keyboard) */
  hold(id: number, on: boolean): void {
    if (on === this.pressed.has(id)) return;
    if (on) this.pressed.add(id); else this.pressed.delete(id);
    this.render();
    this.onChange(false);
  }

  private setTool(t: Tool): void {
    this.tool = t;
    this.first = null;
    for (const b of this.host.querySelectorAll<HTMLElement>('.bb-tool')) b.classList.toggle('cur', b.dataset.tool === t);
    this.render();
  }

  private local(e: MouseEvent): { x: number; y: number } {
    const p = this.svg.createSVGPoint();
    p.x = e.clientX;
    p.y = e.clientY;
    const m = this.svg.getScreenCTM();
    return m ? p.matrixTransform(m.inverse()) : { x: 0, y: 0 };
  }

  private pointAt(e: MouseEvent): string | null {
    const { x, y } = this.local(e);
    let best: string | null = null, bd = 64;
    for (const [id, q] of this.pts) {
      if (id.startsWith('p:') && this.blocked.has(+id.slice(2))) continue;
      const d = (q.x - x) ** 2 + (q.y - y) ** 2;
      if (d < bd) { bd = d; best = id; }
    }
    return best;
  }

  private partAt(e: MouseEvent): number | null {
    const el = (e.target as Element).closest('[data-part]');
    return el ? +(el as HTMLElement).dataset.part! : null;
  }

  private down(e: PointerEvent): void {
    this.host.focus();
    if (e.button !== 0) return;
    const id = this.partAt(e);
    if (this.tool === 'select') {
      if (id === null) { this.sel = null; this.render(); return; }
      const p = this.parts.find(q => q.id === id)!;
      this.sel = id;
      if (p.kind === 'btn') { this.pressed.add(id); this.onChange(false); }
      if (p.kind === 'sw') { p.on = !p.on; this.onChange(true); }
      this.render();
      return;
    }
    const pt = this.pointAt(e);
    if (!pt) return;
    if (!this.first) { this.first = pt; this.render(); return; }
    if (pt === this.first) return;
    const id2 = this.parts.reduce((m, p) => Math.max(m, p.id), 0) + 1;
    const part: Part = { id: id2, kind: this.tool, a: this.first, b: pt };
    if (this.tool === 'led') part.color = LED_COLORS[this.ledColor++ % LED_COLORS.length];
    if (this.tool === 'wire') part.color = WIRE_COLORS[this.wireColor++ % WIRE_COLORS.length];
    if (this.tool === 'sw') part.on = false;
    this.parts.push(part);
    this.first = null;
    this.render();
    this.onChange(true);
  }

  private release(): void {
    if (this.pressed.size) { this.pressed.clear(); this.render(); this.onChange(false); }
  }

  private hover(e: PointerEvent): void {
    const h = this.svg.querySelector('.bb-hover') as SVGCircleElement | null;
    const pt = this.tool === 'select' ? null : this.pointAt(e);
    if (!h) return;
    if (!pt) { h.setAttribute('r', '0'); return; }
    const q = this.pts.get(pt)!;
    h.setAttribute('cx', String(q.x));
    h.setAttribute('cy', String(q.y));
    h.setAttribute('r', '6');
  }

  private remove(id: number): void {
    this.parts = this.parts.filter(p => p.id !== id);
    if (this.sel === id) this.sel = null;
    this.render();
    this.onChange(true);
  }

  /** LED brightness by part id */
  setLeds(led: Map<number, number>): void {
    for (const el of this.svg.querySelectorAll<SVGElement>('[data-glow]')) {
      const v = led.get(+el.dataset.glow!) ?? 0;
      el.style.opacity = (v < 0.004 ? 0 : 0.25 + 0.75 * Math.sqrt(v)).toFixed(3);
    }
  }

  setWarnings(w: string[]): void {
    this.host.querySelector<HTMLElement>('.bb-warn')!.innerHTML = w.map(x => `⚠ ${x.replace(/</g, '&lt;')}`).join('<br>');
  }

  render(): void {
    const P = this.pts;
    let s = '';
    // header strip
    s += `<rect x="14" y="8" width="532" height="38" rx="5" class="bb-header"/>`;
    const h = this.header;
    h.groups.forEach((gr, g) => {
      const mid = (pinX(h, g, 0) + pinX(h, g, gr.pins.length - 1)) / 2;
      s += `<text x="${mid}" y="18" class="bb-t" text-anchor="middle">${gr.label}</text>`;
      gr.pins.forEach((pin, k) => {
        const q = P.get(`p:${pin}`)!;
        const off = this.blocked.has(pin);
        const t = gr.title ? gr.title(k) : `${gr.label} ${gr.names[k]}（${tr('腳', 'pin')} ${pin}）`;
        s += `<g class="bb-pin${off ? ' off' : ''}"><title>${t}${off ? tr('：已接模組', ': a module is plugged in') : ''}</title><rect x="${q.x - 6}" y="${q.y - 6}" width="12" height="12" rx="2"/><text x="${q.x}" y="${q.y + 15}" class="bb-t" text-anchor="middle">${gr.names[k]}</text></g>`;
      });
    });
    for (const [id, label, cls] of [['vcc', '3V3', 'bb-vcc'], ['gnd', 'GND', 'bb-gnd']]) {
      const q = P.get(id)!;
      s += `<g class="bb-pin ${cls}"><rect x="${q.x - 6}" y="${q.y - 6}" width="12" height="12" rx="2"/><text x="${q.x}" y="${q.y + 15}" class="bb-t" text-anchor="middle">${label}</text></g>`;
    }
    // the breadboard
    s += `<rect x="22" y="54" width="516" height="236" rx="6" class="bb-board"/>`;
    s += `<line x1="30" y1="64" x2="530" y2="64" class="bb-rail-p"/><line x1="30" y1="78" x2="530" y2="78" class="bb-rail-n"/>`;
    s += `<line x1="30" y1="264" x2="530" y2="264" class="bb-rail-p"/><line x1="30" y1="278" x2="530" y2="278" class="bb-rail-n"/>`;
    s += `<rect x="30" y="168" width="500" height="6" class="bb-gap"/>`;
    for (let c = 1; c <= COLS; c += 1) if (c % 5 === 0 || c === 1) s += `<text x="${40 + (c - 1) * 16}" y="96" class="bb-t" text-anchor="middle">${c}</text>`;
    'abcdefghij'.split('').forEach((r, i) => s += `<text x="30" y="${(i < 5 ? 104 + i * 14 : 186 + (i - 5) * 14) + 3}" class="bb-t" text-anchor="middle">${r}</text>`);
    for (const [id, q] of P) {
      if (id.startsWith('p:') || id === 'vcc' || id === 'gnd') continue;
      s += `<rect x="${q.x - 3}" y="${q.y - 3}" width="6" height="6" rx="1" class="bb-hole"/>`;
    }
    // parts
    for (const p of this.parts) {
      const [a, b] = [P.get(p.a), P.get(p.b)];
      if (!a || !b) continue;
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const sel = p.id === this.sel ? ' sel' : '';
      let g = `<g data-part="${p.id}" class="bb-part${sel}">`;
      if (p.kind === 'wire') {
        g += `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${p.color}" class="bb-wire"/>`;
      } else {
        g += `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" class="bb-leg"/>`;
        const ang = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
        if (p.kind === 'led') {
          g += `<circle cx="${mx}" cy="${my}" r="15" fill="${p.color}" filter="url(#bbGlow)" data-glow="${p.id}" style="opacity:0"/>`;
          g += `<g transform="translate(${mx} ${my}) rotate(${ang})"><circle r="8" class="bb-led" stroke="${p.color}"/><circle r="8" fill="${p.color}" data-glow="${p.id}" style="opacity:0"/><path d="M-3 -4 L3 0 L-3 4 Z M3 -4 V4" class="bb-sym"/></g>`;
        } else if (p.kind === 'res') {
          g += `<g transform="translate(${mx} ${my}) rotate(${ang})"><rect x="-11" y="-4" width="22" height="8" rx="3" class="bb-res"/><path d="M-6 -4 v8 M-2 -4 v8 M4 -4 v8" class="bb-band"/></g>`;
        } else if (p.kind === 'btn') {
          g += `<g transform="translate(${mx} ${my})"><rect x="-9" y="-9" width="18" height="18" rx="2" class="bb-btn-base"/><circle r="6" class="bb-btn${this.pressed.has(p.id) ? ' down' : ''}"/></g>`;
        } else if (p.kind === 'sw') {
          g += `<g transform="translate(${mx} ${my})"><rect x="-11" y="-7" width="22" height="14" rx="3" class="bb-sw-base"/><rect x="${p.on ? 0 : -9}" y="-5" width="9" height="10" rx="2" class="bb-sw${p.on ? ' on' : ''}"/></g>`;
        }
      }
      g += `<title>${this.title(p)}</title></g>`;
      s += g;
    }
    if (this.first) { const q = P.get(this.first)!; s += `<circle cx="${q.x}" cy="${q.y}" r="6" class="bb-first"/>`; }
    s += `<circle class="bb-hover" r="0"/>`;
    this.svg.innerHTML = `<defs><filter id="bbGlow" x="-1" y="-1" width="3" height="3"><feGaussianBlur stdDeviation="4"/></filter></defs>` + s;
  }

  private title(p: Part): string {
    const name = (pt: string) => pt.startsWith('p:') ? `${tr('腳', 'pin')} ${pt.slice(2)}` : pt === 'vcc' ? '3V3' : pt === 'gnd' ? 'GND'
      : pt.startsWith('r:') ? tr(`電源軌 ${pt.split(':')[1]}`, `rail ${pt.split(':')[1]}`) : pt.slice(2).replace(':', '');
    const k: Record<PartKind, string> = { led: 'LED', res: tr('電阻', 'resistor'), btn: tr('按鈕', 'button'), sw: tr('開關', 'switch'), wire: tr('導線', 'wire') };
    return `${k[p.kind]}：${name(p.a)} → ${name(p.b)}${p.kind === 'led' ? tr('（正極 → 負極）', ' (anode → cathode)') : ''}`;
  }
}
