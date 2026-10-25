// The synthesis overlay: stage bar, report, drawing, side panel.

import type { Veryl, VFile } from '../api';
import { Box, CanvasView } from '../view/canvas';
import { cellColor, edgeCount, hierScene, NetLayout, netLines, netScene, shortType } from './layouts';
import { bitName, countTypes, isFF, isOut, JNetlist, levelize, Leveled, lutBits, lutInputs, netNames, SynthResult } from './model';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

interface StageDef { key: string; tag: 'common' | 'fpga' | 'asic'; label: string; ready: boolean }

const FPGA_STAGES: StageDef[] = [
  { key: 'rtl', tag: 'common', label: '共 ① RTL→Logic', ready: true },
  { key: 'raw', tag: 'common', label: '共 ② Logic Netlist', ready: true },
  { key: 'opt', tag: 'common', label: '共 ③ Tech-indep Syn', ready: true },
  { key: 'map', tag: 'fpga', label: 'F ④ LUT4 Techmap', ready: true },
  { key: 'place', tag: 'fpga', label: 'F ⑤ Placement 退火', ready: false },
  { key: 'route', tag: 'fpga', label: 'F ⑥ Global+Detail Routing', ready: false },
  { key: 'sta', tag: 'fpga', label: 'F ⑦ Timing (STA)', ready: false },
];

interface NetView { nl: JNetlist; lev: Leveled; lay: NetLayout; names: Map<number, string> }

export class SynthOverlay {
  private view: CanvasView;
  private res: SynthResult | null = null;
  private stage = 'rtl';
  private nets = new Map<string, NetView>();
  private sel: number | null = null;
  private edges = true;
  private files: VFile[] = [];

  constructor(private core: Veryl) {
    this.view = new CanvasView($<HTMLCanvasElement>('synCanvas'));
    this.view.onPick = b => this.pick(b);
    $('synClose').onclick = () => this.close();
    $('synZin').onclick = () => this.view.zoom(1.4);
    $('synZout').onclick = () => this.view.zoom(1 / 1.4);
    $('synZfit').onclick = () => this.view.fit();
    $('synEdges').onclick = () => { this.edges = !this.edges; this.updateLines(); };
    $<HTMLSelectElement>('synTop').onchange = () => this.run($<HTMLSelectElement>('synTop').value);
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('synOverlay').classList.contains('hidden')) this.close(); });
    this.chips();
  }

  open(files: VFile[], top?: string): void {
    this.files = files;
    $('synOverlay').classList.remove('hidden');
    this.run(top);
  }

  close(): void { $('synOverlay').classList.add('hidden'); }

  private run(top?: string): void {
    $('synInfo').textContent = '合成中…';
    $('synSide').innerHTML = '';
    setTimeout(() => {
      const t0 = performance.now();
      try {
        this.res = this.core.call<SynthResult>({ cmd: 'synth', files: this.files, top: top || null });
      } catch (e) {
        this.res = null;
        $('synInfo').textContent = '合成失敗：\n' + String((e as Error).message ?? e);
        this.view.set({ boxes: [], lines: [], texts: [] });
        $('synStats').innerHTML = '';
        return;
      }
      const ms = performance.now() - t0;
      this.nets.clear();
      const sel = $<HTMLSelectElement>('synTop');
      sel.innerHTML = '';
      for (const m of this.res.modules.filter(m => !m.test)) {
        const o = document.createElement('option');
        o.value = o.textContent = m.name;
        sel.appendChild(o);
      }
      sel.value = this.res.top;
      this.stats(ms);
      this.show(this.stage);
    }, 10);
  }

  private chips(): void {
    const box = $('synChips');
    box.innerHTML = '';
    FPGA_STAGES.forEach((s, i) => {
      if (i) { const a = document.createElement('span'); a.className = 'arrow'; a.textContent = '→'; box.appendChild(a); }
      const b = document.createElement('button');
      b.textContent = s.label;
      b.dataset.key = s.key;
      b.className = s.tag === 'fpga' ? 'tagf' : s.tag === 'asic' ? 'taga' : '';
      b.disabled = !s.ready;
      if (!s.ready) b.title = '下一個里程碑';
      b.onclick = () => this.show(s.key);
      box.appendChild(b);
    });
  }

  private netView(key: 'raw' | 'opt' | 'map'): NetView {
    let v = this.nets.get(key);
    if (!v) {
      const nl = this.res![key];
      const lev = levelize(nl);
      v = { nl, lev, lay: netScene(nl, lev), names: netNames(nl) };
      this.nets.set(key, v);
    }
    return v;
  }

  private stats(ms: number): void {
    const r = this.res!;
    const m = r.map.cells;
    const luts = m.filter(c => c.t === 'SB_LUT4').length;
    const ffs = m.filter(c => isFF(c.t)).length;
    const carry = m.filter(c => c.t === 'SB_CARRY').length;
    const lev = this.netView('map').lev;
    $('synStats').innerHTML = [
      `頂層 <b>${r.top}</b>`,
      `閘 <b>${r.raw.cells.length}</b> → <b>${r.opt.cells.length}</b>`,
      `LUT4 <b>${luts}</b>`,
      `CARRY <b>${carry}</b>`,
      `DFF <b>${ffs}</b>`,
      `LUT 層數 <b>${lev.depth}</b>`,
      `合成 <b>${ms.toFixed(0)}</b> ms`,
    ].join('<span class="sep">│</span>');
  }

  private show(key: string): void {
    if (!this.res) return;
    this.stage = key;
    this.sel = null;
    for (const b of $('synChips').querySelectorAll('button')) b.classList.toggle('cur', (b as HTMLElement).dataset.key === key);
    const r = this.res;
    if (key === 'rtl') {
      const counts = new Map<string, number>();
      for (const s of r.signals) {
        const p = s.name.includes('.') ? s.name.slice(0, s.name.lastIndexOf('.')) : '';
        counts.set(p, (counts.get(p) ?? 0) + 1);
      }
      this.view.set(hierScene(r.hier, counts));
      const bits = r.signals.reduce((a, s) => a + s.width, 0);
      this.info([
        '① RTL→Logic',
        '解析 Veryl（veryl-parser）→ 展開 package / enum / struct / 參數 → 由頂層往下實例化子模組並攤平（flatten），每個訊號配置「佔位」線。',
        '',
        `頂層：${r.top}　實例 ${r.hier.length - 1} 個　模組種類 ${new Set(r.hier.map(h => h.module)).size}`,
        `埠：${r.ports.map(p => `${p.dir === 'in' ? '→' : '←'}${p.name}${p.width > 1 ? `[${p.width}]` : ''}`).join('  ')}`,
        `訊號 ${r.signals.length} 個，共 ${bits} bit`,
        ...(r.warnings.length ? ['', '警告：', ...r.warnings] : []),
      ]);
      this.side(this.rtlSide());
      return;
    }
    if (key === 'raw' || key === 'opt' || key === 'map') {
      const v = this.netView(key);
      this.view.set({ ...v.lay.scene, lines: netLines(v.nl, v.lev, v.lay, this.edges && edgeCount(v.nl) <= 6000, null) });
      this.info(this.netReport(key, v));
      this.side(this.netSide(key, v));
    }
  }

  private updateLines(): void {
    const k = this.stage;
    $('synEdges').textContent = `⌁ 連線：${this.edges ? '開' : '關'}`;
    if (k !== 'raw' && k !== 'opt' && k !== 'map') return;
    const v = this.netView(k);
    const all = this.edges && edgeCount(v.nl) <= 6000;
    for (const b of v.lay.scene.boxes) b.hl = b.id === this.sel;
    this.view.set({ ...v.lay.scene, lines: netLines(v.nl, v.lev, v.lay, all, this.sel) }, false);
  }

  private netReport(key: string, v: NetView): string[] {
    const r = this.res!;
    const types = countTypes(v.nl).map(([t, n]) => `${shortType(t)} ${n}`).join('  ');
    const ffs = v.nl.cells.filter(c => isFF(c.t)).length;
    const big = edgeCount(v.nl) > 6000 ? '（連線太多：只畫選取元件的扇入/扇出）' : '';
    if (key === 'raw') return [
      '② Logic Netlist',
      '每個 assign / always_comb / always_ff 經「符號執行」變成 2 輸入閘、MUX 與 DFF：if/case → MUX（常數標籤的 case → 平行 one-hot），for 展開，function 內嵌，always_ff → $_DFF_* / $_SDFF_*。',
      '建閘時就做局部常數摺疊與 structural hashing；這裡已解析佔位別名，但還沒做整體最佳化。',
      '',
      `${v.nl.cells.length} 個元件：${types}`,
      `組合邏輯深度 ${v.lev.depth} 層，DFF ${ffs} 個 ${big}`,
    ];
    if (key === 'opt') {
      const d = r.raw.cells.length - r.opt.cells.length;
      const rf = r.raw.cells.filter(c => isFF(c.t)).length;
      return [
        '③ Tech-indep Syn（與技術無關的最佳化）',
        '依拓撲順序重建整個網表：常數傳播、structural hashing、x&!x 等化簡、組合迴路檢查、移除不影響輸出的邏輯；',
        '反覆「證明常數節點」（隨機模擬找候選、對 ≤16 個輸入窮舉證明）並移除卡在 0 的暫存器。',
        '',
        `${r.raw.cells.length} → ${v.nl.cells.length} 個元件（少了 ${d}，${(100 * d / Math.max(1, r.raw.cells.length)).toFixed(1)}%）；DFF ${rf} → ${ffs}`,
        `${types}`,
        `組合邏輯深度 ${v.lev.depth} 層 ${big}`,
      ];
    }
    const luts = v.nl.cells.filter(c => c.t === 'SB_LUT4');
    const hist = [0, 0, 0, 0, 0];
    luts.forEach(c => hist[lutInputs(c)]++);
    return [
      '④ LUT4 Techmap（iCE40）',
      '全加器進位 (a&b)|((a^b)&c) 對到硬體進位鏈 SB_CARRY；其餘以 cut-based 方式覆蓋成 4 輸入 LUT（先求最淺、再看 area flow）；DFF → SB_DFF[N][S]{R,S}。',
      '',
      `${types}`,
      `LUT 輸入數分布：${hist.map((n, i) => `${i} 入 ${n}`).filter((_, i) => i > 0).join('  ')}`,
      `LUT 層數 ${v.lev.depth} ${big}`,
    ];
  }

  private info(lines: string[]): void { $('synInfo').textContent = lines.join('\n'); }

  private side(html: HTMLElement): void {
    const s = $('synSide');
    s.innerHTML = '';
    s.appendChild(html);
  }

  private rtlSide(): HTMLElement {
    const r = this.res!;
    const d = document.createElement('div');
    d.innerHTML = `<h3>埠</h3>` + table(['名稱', '方向', '寬度'], r.ports.map(p => [p.name, p.dir === 'in' ? 'input' : 'output', String(p.width)]))
      + `<h3>實例</h3>` + table(['路徑', '模組'], r.hier.map(h => [h.path || '(top)', h.module]))
      + `<h3>訊號（${r.signals.length}）</h3>` + table(['名稱', '寬度'], r.signals.slice(0, 400).map(s => [s.name, String(s.width)]));
    return d;
  }

  private netSide(_key: string, v: NetView): HTMLElement {
    const d = document.createElement('div');
    const types = countTypes(v.nl);
    d.innerHTML = `<h3>元件種類</h3>` + table(['種類', '數量'], types.map(([t, n]) => [`<span class="sw" style="background:${cellColor(t, 4)}"></span>${shortType(t)}`, String(n)]))
      + `<h3>元件清單（點選）</h3>`;
    const list = document.createElement('div');
    list.className = 'clist';
    const n = Math.min(v.nl.cells.length, 500);
    for (let i = 0; i < n; i++) {
      const c = v.nl.cells[i];
      const row = document.createElement('div');
      row.textContent = `#${i} ${shortType(c.t)}  L${v.lev.level[i]}  → ${bitName(v.names, c.c.find(x => isOut(x[0]))?.[1] ?? '0')}`;
      row.onclick = () => this.select(i);
      list.appendChild(row);
    }
    if (v.nl.cells.length > n) { const m = document.createElement('div'); m.className = 'more'; m.textContent = `… 共 ${v.nl.cells.length} 個（點圖上的方塊看其他元件）`; list.appendChild(m); }
    d.appendChild(list);
    const det = document.createElement('div');
    det.id = 'synDetail';
    det.innerHTML = '<p class="hint">點圖上的元件看細節：接腳、所連訊號、LUT 真值表。</p>';
    d.prepend(det);
    return d;
  }

  private pick(b: Box | null): void {
    if (!b) { this.select(null); return; }
    const k = this.stage;
    if (k === 'raw' || k === 'opt' || k === 'map') {
      const v = this.netView(k);
      if (b.id < v.nl.cells.length) this.select(b.id);
    }
  }

  private select(i: number | null): void {
    this.sel = i;
    this.updateLines();
    const det = document.getElementById('synDetail');
    const k = this.stage;
    if (!det || (k !== 'raw' && k !== 'opt' && k !== 'map')) return;
    if (i === null) { det.innerHTML = '<p class="hint">點圖上的元件看細節：接腳、所連訊號、LUT 真值表。</p>'; return; }
    const v = this.netView(k);
    const c = v.nl.cells[i];
    let h = `<h3>#${i} ${c.t}</h3><p>層級 L${v.lev.level[i]}</p>`;
    h += table(['接腳', '訊號', '來源'], c.c.map(([p, b]) => {
      const src = typeof b === 'number' && !isOut(p) ? (v.lev.driver.has(b) ? `#${v.lev.driver.get(b)} ${shortType(v.nl.cells[v.lev.driver.get(b)!].t)}` : '輸入埠') : isOut(p) ? `→ ${(typeof b === 'number' ? v.lev.users.get(b)?.length ?? 0 : 0)} 個負載` : '常數';
      return [p, esc(bitName(v.names, b)), src];
    }));
    if (c.t === 'SB_LUT4' && c.p?.LUT_INIT) {
      const bits = lutBits(c.p.LUT_INIT);
      h += `<h3>LUT_INIT = 16'b${c.p.LUT_INIT}</h3>`;
      h += table(['I3 I2 I1 I0', 'O'], bits.map((o, k) => [`${(k >> 3) & 1}  ${(k >> 2) & 1}  ${(k >> 1) & 1}  ${k & 1}`, String(o)]));
    }
    det.innerHTML = h;
    det.scrollIntoView({ block: 'nearest' });
  }
}

function esc(s: string): string { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;'); }

function table(head: string[], rows: string[][]): string {
  return `<table><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</table>`;
}

