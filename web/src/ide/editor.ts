// A code editor: a transparent textarea over a highlighted <pre>, with a
// line-number gutter, problem markers and the current line. The textarea
// grows to the text, so one scroll container moves everything together.

import { highlight, Lang } from './highlight';

export interface Marker { line: number; col: number; msg: string; severity: 'error' | 'warning' }

export class CodeEditor {
  private scroller: HTMLDivElement;
  private gutter: HTMLDivElement;
  private code: HTMLDivElement;
  private pre: HTMLPreElement;
  private ta: HTMLTextAreaElement;
  private curLine: HTMLDivElement;
  private markers: Marker[] = [];
  private raf = 0;
  private lines = 0;
  onChange: (text: string) => void = () => {};
  onCursor: (line: number, col: number) => void = () => {};
  /** keyboard shortcuts the page handles (return true when handled) */
  onKey: (e: KeyboardEvent) => boolean = () => false;
  /** pixels per line: 19, or larger on phones (ide.css --edlh) */
  get lineHeight(): number { return parseFloat(getComputedStyle(this.ta).lineHeight) || 19; }
  /** the language of the text (highlighting) */
  private _lang: Lang = 'veryl';
  get lang(): Lang { return this._lang; }
  set lang(l: Lang) { if (l !== this._lang) { this._lang = l; this.render(); } }

  constructor(host: HTMLElement) {
    host.classList.add('ed');
    this.scroller = el('div', 'ed-scroll');
    this.gutter = el('div', 'ed-gutter');
    this.code = el('div', 'ed-code');
    this.curLine = el('div', 'ed-cur');
    this.pre = el('pre', 'ed-hl');
    this.ta = el('textarea', 'ed-ta');
    this.ta.spellcheck = false;
    this.ta.wrap = 'off';
    this.ta.setAttribute('autocapitalize', 'off');
    this.ta.setAttribute('autocomplete', 'off');
    this.code.append(this.curLine, this.pre, this.ta);
    this.scroller.append(this.gutter, this.code);
    host.appendChild(this.scroller);
    this.ta.addEventListener('input', () => { this.render(); this.onChange(this.ta.value); });
    for (const ev of ['keyup', 'click', 'select', 'focus']) this.ta.addEventListener(ev, () => this.cursor());
    this.ta.addEventListener('keydown', e => this.key(e));
  }

  get value(): string { return this.ta.value; }
  set value(s: string) {
    this.ta.value = s;
    this.ta.setSelectionRange(0, 0);
    this.scroller.scrollTop = 0;
    this.scroller.scrollLeft = 0;
    this.render();
    this.cursor();
  }

  get readOnly(): boolean { return this.ta.readOnly; }
  set readOnly(v: boolean) { this.ta.readOnly = v; }

  focus(): void { this.ta.focus({ preventScroll: true }); }

  setMarkers(m: Marker[]): void { this.markers = m; this.render(); }

  /** put the cursor at line:col (1-based) and select to the end of the line */
  goto(line: number, col = 1, selectLine = false): void {
    const ls = this.ta.value.split('\n');
    line = Math.max(1, Math.min(line, ls.length));
    let off = 0;
    for (let k = 0; k < line - 1; k++) off += ls[k].length + 1;
    const start = off + Math.max(0, Math.min(col - 1, ls[line - 1].length));
    this.ta.focus({ preventScroll: true });
    this.ta.setSelectionRange(start, selectLine ? off + ls[line - 1].length : start);
    const y = (line - 1) * this.lineHeight;
    const h = this.scroller.clientHeight;
    if (y < this.scroller.scrollTop || y > this.scroller.scrollTop + h - 3 * this.lineHeight) this.scroller.scrollTop = Math.max(0, y - h / 3);
    this.cursor();
  }

  private render(): void {
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(() => this.paint());
  }

  private paint(): void {
    const text = this.ta.value;
    const hl = highlight(text, this._lang);
    const bad = new Map<number, Marker>();
    for (const m of this.markers) if (!bad.has(m.line) || m.severity === 'error') bad.set(m.line, m);
    this.pre.innerHTML = hl.map((h, i) => {
      const m = bad.get(i + 1);
      return m ? `<span class="ed-${m.severity}" title="${m.msg.replace(/"/g, '&quot;').replace(/</g, '&lt;')}">${h || ' '}</span>` : h;
    }).join('\n') + '\n ';
    if (hl.length !== this.lines || this.markers.length || this.gutter.dataset.marked) {
      this.lines = hl.length;
      let g = '';
      for (let i = 1; i <= hl.length; i++) {
        const m = bad.get(i);
        g += m ? `<div class="g-${m.severity}" title="${m.msg.replace(/"/g, '&quot;').replace(/</g, '&lt;')}">${i}</div>` : `<div>${i}</div>`;
      }
      this.gutter.innerHTML = g;
      this.gutter.dataset.marked = this.markers.length ? '1' : '';
    }
    // the textarea covers the highlighted text exactly
    this.ta.style.height = this.pre.offsetHeight + 'px';
    this.ta.style.width = Math.max(this.pre.scrollWidth, this.code.clientWidth) + 'px';
  }

  private cursor(): void {
    const s = this.ta.selectionStart;
    const before = this.ta.value.slice(0, s);
    const line = before.split('\n').length;
    const col = s - before.lastIndexOf('\n');
    this.curLine.style.top = (line - 1) * this.lineHeight + 4 + 'px';
    this.onCursor(line, col);
  }

  private key(e: KeyboardEvent): void {
    if (this.onKey(e)) { e.preventDefault(); return; }
    const ta = this.ta;
    if (ta.readOnly) return;
    if (e.key === 'Tab') {
      e.preventDefault();
      const [s, t] = [ta.selectionStart, ta.selectionEnd];
      const v = ta.value;
      if (s === t && !e.shiftKey) { this.edit(s, t, '    '); return; }
      // indent / outdent the selected lines
      const a = v.lastIndexOf('\n', s - 1) + 1;
      const b = t > s && v[t - 1] === '\n' ? t - 1 : (v.indexOf('\n', t) < 0 ? v.length : v.indexOf('\n', t));
      const block = v.slice(a, b).split('\n').map(l => e.shiftKey ? l.replace(/^ {1,4}/, '') : '    ' + l).join('\n');
      this.edit(a, b, block);
      ta.setSelectionRange(a, a + block.length);
    } else if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
      // keep the indentation; one more after an opening brace / paren
      e.preventDefault();
      const s = ta.selectionStart;
      const v = ta.value;
      const ls = v.lastIndexOf('\n', s - 1) + 1;
      const ind = /^ */.exec(v.slice(ls, s))![0];
      const more = /[{(\[]\s*$/.test(v.slice(ls, s)) ? '    ' : '';
      const close = more && /^\s*[})\]]/.test(v.slice(ta.selectionEnd));
      this.edit(s, ta.selectionEnd, '\n' + ind + more + (close ? '\n' + ind : ''));
      if (close) ta.setSelectionRange(s + 1 + ind.length + 4, s + 1 + ind.length + 4);
    } else if (e.key === '}' && ta.selectionStart === ta.selectionEnd) {
      // outdent a closing brace typed on an empty line
      const s = ta.selectionStart;
      const v = ta.value;
      const ls = v.lastIndexOf('\n', s - 1) + 1;
      if (/^ {4,}$/.test(v.slice(ls, s))) { e.preventDefault(); this.edit(s - 4, s, '}'); }
    } else if (e.key === '/' && (e.ctrlKey || e.metaKey)) {
      // toggle line comments
      e.preventDefault();
      const [s, t] = [ta.selectionStart, ta.selectionEnd];
      const v = ta.value;
      const a = v.lastIndexOf('\n', s - 1) + 1;
      const b = v.indexOf('\n', t) < 0 ? v.length : v.indexOf('\n', t);
      const ls = v.slice(a, b).split('\n');
      const all = ls.every(l => /^\s*\/\//.test(l) || !l.trim());
      const block = ls.map(l => all ? l.replace(/^(\s*)\/\/ ?/, '$1') : l.trim() ? l.replace(/^(\s*)/, '$1// ') : l).join('\n');
      this.edit(a, b, block);
      ta.setSelectionRange(a, a + block.length);
    }
  }

  /** replace [a, b) with `s` as one undoable edit */
  private edit(a: number, b: number, s: string): void {
    const ta = this.ta;
    ta.setSelectionRange(a, b);
    // execCommand keeps the browser's undo stack; fall back to setRangeText
    if (!document.execCommand || !document.execCommand('insertText', false, s)) {
      ta.setRangeText(s, a, b, 'end');
      ta.dispatchEvent(new Event('input'));
    }
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  return e;
}
