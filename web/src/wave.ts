// Waveform viewer for the VCD that veryl-sim records.

import { tr } from './i18n';

export interface VcdSignal { id: string; name: string; width: number; changes: [number, string][] }
export interface Vcd { signals: VcdSignal[]; end: number }

export function parseVcd(text: string): Vcd {
  const byId = new Map<string, VcdSignal[]>();
  const signals: VcdSignal[] = [];
  let t = 0;
  let end = 0;
  const lines = text.split('\n');
  let i = 0;
  for (; i < lines.length; i++) {
    const l = lines[i].trim();
    if (l.startsWith('$var')) {
      const p = l.split(/\s+/);
      const s: VcdSignal = { id: p[3], name: p[4], width: +p[2], changes: [] };
      signals.push(s);
      byId.set(s.id, [...(byId.get(s.id) ?? []), s]);
    } else if (l.startsWith('$enddefinitions')) { i++; break; }
  }
  for (; i < lines.length; i++) {
    const l = lines[i].trim();
    if (!l) continue;
    if (l[0] === '#') { t = +l.slice(1); end = Math.max(end, t); continue; }
    let v: string, id: string;
    if (l[0] === 'b' || l[0] === 'B') { const sp = l.indexOf(' '); v = l.slice(1, sp); id = l.slice(sp + 1); }
    else { v = l[0]; id = l.slice(1); }
    for (const s of byId.get(id) ?? []) s.changes.push([t, v]);
  }
  return { signals, end };
}

function fmt(v: string, width: number): string {
  if (width === 1) return v;
  if (/[xz]/i.test(v)) return v.length > 8 ? 'x' : v;
  const n = BigInt('0b' + v);
  return n.toString(16);
}

function valueAt(s: VcdSignal, t: number): string | undefined {
  let lo = 0, hi = s.changes.length - 1, r = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (s.changes[m][0] <= t) { r = m; lo = m + 1; } else hi = m - 1; }
  return r < 0 ? undefined : s.changes[r][1];
}

const NAME_W = 170, ROW = 22, TOP = 22;

export class WaveView {
  private vcd: Vcd | null = null;
  private shown: VcdSignal[] = [];
  private t0 = 0;
  private scale = 1; // px per time unit
  private cursor: number | null = null;
  private drag: { x: number; t0: number } | null = null;

  constructor(private canvas: HTMLCanvasElement, private picker: HTMLElement, private filter: HTMLInputElement) {
    new ResizeObserver(() => this.draw()).observe(canvas.parentElement!);
    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      if (!this.vcd) return;
      const x = e.offsetX - NAME_W;
      const tAt = this.t0 + x / this.scale;
      this.scale = Math.min(Math.max(this.scale * Math.exp(-e.deltaY * 0.002), 1e-4), 200);
      this.t0 = Math.max(0, tAt - x / this.scale);
      this.draw();
    }, { passive: false });
    canvas.addEventListener('pointerdown', e => { this.drag = { x: e.clientX, t0: this.t0 }; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener('pointermove', e => {
      if (this.drag) { this.t0 = Math.max(0, this.drag.t0 - (e.clientX - this.drag.x) / this.scale); }
      this.cursor = e.offsetX > NAME_W ? this.t0 + (e.offsetX - NAME_W) / this.scale : null;
      this.draw();
    });
    canvas.addEventListener('pointerup', () => { this.drag = null; });
    canvas.addEventListener('dblclick', () => this.fit());
    filter.addEventListener('input', () => this.fillPicker());
  }

  set(text: string | null): void {
    this.vcd = text ? parseVcd(text) : null;
    // default: the testbench's own signals (no hierarchy), at most 16
    this.shown = this.vcd ? this.vcd.signals.filter(s => !s.name.includes('.')).slice(0, 16) : [];
    this.fillPicker();
    this.fit();
  }

  fit(): void {
    if (!this.vcd) { this.draw(); return; }
    // hidden panes measure 0 wide: keep a sane scale
    const w = Math.max(this.canvas.parentElement!.clientWidth - NAME_W - 10, 200);
    this.t0 = 0;
    this.scale = w / Math.max(this.vcd.end, 1);
    this.draw();
  }

  private fillPicker(): void {
    this.picker.innerHTML = '';
    if (!this.vcd) return;
    const q = this.filter.value.toLowerCase();
    for (const s of this.vcd.signals) {
      if (q && !s.name.toLowerCase().includes(q)) continue;
      const l = document.createElement('label');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = this.shown.includes(s);
      cb.onchange = () => {
        this.shown = cb.checked ? [...this.shown, s] : this.shown.filter(x => x !== s);
        this.draw();
      };
      l.append(cb, ` ${s.name}${s.width > 1 ? `[${s.width}]` : ''}`);
      this.picker.appendChild(l);
    }
  }

  draw(): void {
    const c = this.canvas, r = c.parentElement!.getBoundingClientRect();
    if (r.width < NAME_W + 20 || !(this.scale > 0)) return;
    const h = Math.max(r.height, TOP + ROW * this.shown.length + 10);
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(r.width * dpr); c.height = Math.round(h * dpr);
    c.style.width = r.width + 'px'; c.style.height = h + 'px';
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#171c24'; g.fillRect(0, 0, r.width, h);
    g.font = '11px ui-monospace, Menlo, monospace';
    g.textBaseline = 'middle';
    if (!this.vcd) { g.fillStyle = '#9fb2c8'; g.fillText(tr('按「▶ 模擬」後顯示波形', 'Run a simulation (▶) to see the waveform'), 12, 20); return; }
    const W = r.width - NAME_W;
    const X = (t: number) => NAME_W + (t - this.t0) * this.scale;
    const t1 = this.t0 + W / this.scale;
    // time axis
    const step = Math.max(niceStep(80 / this.scale), (t1 - this.t0) / 200, 1e-9);
    g.strokeStyle = '#2a3441'; g.fillStyle = '#9fb2c8';
    for (let t = Math.ceil(this.t0 / step) * step; t <= t1; t += step) {
      const x = X(t);
      g.beginPath(); g.moveTo(x, TOP - 4); g.lineTo(x, h); g.stroke();
      g.fillText(String(t), x + 2, 9);
    }
    this.shown.forEach((s, k) => {
      const y = TOP + k * ROW, mid = y + ROW / 2, hi = y + 4, lo = y + ROW - 4;
      const cv = this.cursor !== null ? valueAt(s, this.cursor) : undefined;
      g.fillStyle = '#c9d4e2';
      g.fillText(s.name + (cv !== undefined ? ` = ${fmt(cv, s.width)}` : ''), 6, mid, NAME_W - 10);
      g.strokeStyle = s.width === 1 ? '#57c27a' : '#7ec3ff';
      g.lineWidth = 1.2;
      const ch = s.changes;
      for (let i = 0; i < ch.length; i++) {
        const [ta, v] = ch[i];
        const tb = i + 1 < ch.length ? ch[i + 1][0] : this.vcd!.end;
        if (tb < this.t0 || ta > t1) continue;
        const xa = Math.max(X(ta), NAME_W), xb = Math.min(X(tb), r.width);
        if (s.width === 1) {
          const yv = v === '1' ? hi : v === '0' ? lo : mid;
          g.strokeStyle = v === '1' || v === '0' ? '#57c27a' : '#e06c75';
          g.beginPath(); g.moveTo(xa, yv); g.lineTo(xb, yv);
          if (i + 1 < ch.length && X(tb) <= r.width) { const nv = ch[i + 1][1]; g.lineTo(xb, nv === '1' ? hi : nv === '0' ? lo : mid); }
          g.stroke();
        } else {
          g.strokeStyle = /[xz]/i.test(v) ? '#e06c75' : '#7ec3ff';
          g.beginPath();
          g.moveTo(xa, hi); g.lineTo(xb - 2, hi); g.lineTo(xb, mid); g.lineTo(xb - 2, lo); g.lineTo(xa, lo);
          if (X(ta) >= NAME_W) { g.lineTo(xa - 2 < NAME_W ? xa : xa - 0, mid); }
          g.stroke();
          const label = fmt(v, s.width);
          if (xb - xa > label.length * 7 + 6) { g.fillStyle = '#dce1e8'; g.fillText(label, xa + 4, mid); }
        }
      }
      g.strokeStyle = '#232b36'; g.beginPath(); g.moveTo(0, y + ROW); g.lineTo(r.width, y + ROW); g.stroke();
    });
    g.strokeStyle = '#3a4a5e'; g.beginPath(); g.moveTo(NAME_W - 2, 0); g.lineTo(NAME_W - 2, h); g.stroke();
    if (this.cursor !== null) {
      const x = X(this.cursor);
      g.strokeStyle = '#ffd479'; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke();
      g.fillStyle = '#ffd479'; g.fillText(`t=${Math.round(this.cursor)}`, x + 3, TOP - 9);
    }
  }
}

function niceStep(raw: number): number {
  const p = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1e-9))));
  for (const m of [1, 2, 5, 10]) if (m * p >= raw) return m * p;
  return 10 * p;
}
