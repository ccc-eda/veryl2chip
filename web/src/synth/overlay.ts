// The synthesis overlay: stage bar, report, drawing, side panel.

import { fromBase64, VFile } from '../api';
import type { Core } from '../client';
import { Box, CanvasView } from '../view/canvas';
import { AsicResult, asicRouteLines, congestion, dieScene, stdColor } from './asic';
import { deviceScene, heat, lcColor, PnrResult, routeLines } from './device';
import { cellColor, edgeCount, hierScene, NetLayout, netLines, netScene, shortType } from './layouts';
import { bitName, countTypes, isFF, isOut, JNetlist, levelize, Leveled, lutBits, lutInputs, netNames, SynthResult } from './model';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

interface StageDef { key: string; tag: 'common' | 'fpga' | 'asic'; label: string }

const FPGA_STAGES: StageDef[] = [
  { key: 'rtl', tag: 'common', label: '共 ① RTL→Logic' },
  { key: 'raw', tag: 'common', label: '共 ② Logic Netlist' },
  { key: 'opt', tag: 'common', label: '共 ③ Tech-indep Syn' },
  { key: 'map', tag: 'fpga', label: 'F ④ LUT4 Techmap' },
  { key: 'place', tag: 'fpga', label: 'F ⑤ Placement 退火' },
  { key: 'route', tag: 'fpga', label: 'F ⑥ Global+Detail Routing' },
  { key: 'sta', tag: 'fpga', label: 'F ⑦ Timing (STA)' },
];
const ASIC_STAGES: StageDef[] = [
  ...FPGA_STAGES.slice(0, 3),
  { key: 'amap', tag: 'asic', label: 'A ④ Standard Cell Map' },
  { key: 'aplace', tag: 'asic', label: 'A ⑤ Row Placement 退火' },
  { key: 'aroute', tag: 'asic', label: 'A ⑥ Global Routing' },
  { key: 'asta', tag: 'asic', label: 'A ⑦ Timing (STA)' },
];
const PNR = new Set(['place', 'route', 'sta']);
const ASIC = new Set(['amap', 'aplace', 'aroute', 'asta']);
const APHYS = new Set(['aplace', 'aroute', 'asta']);
/** the matching stage of the other back end */
const OTHER: Record<string, string> = { map: 'amap', place: 'aplace', route: 'aroute', sta: 'asta', amap: 'map', aplace: 'place', aroute: 'route', asta: 'sta' };

type NetKey = 'raw' | 'opt' | 'map' | 'amap';
const isNet = (k: string): k is NetKey => k === 'raw' || k === 'opt' || k === 'map' || k === 'amap';

interface NetView { nl: JNetlist; lev: Leveled; lay: NetLayout; names: Map<number, string> }

export class SynthOverlay {
  private view: CanvasView;
  private res: SynthResult | null = null;
  private pnr: PnrResult | null = null;
  private pnrErr: string | null = null;
  private pnrBusy = false;
  private stage = 'rtl';
  private nets = new Map<string, NetView>();
  private sel: number | null = null;
  private edges = true;
  private files: VFile[] = [];
  private pcf: string | undefined;
  private anim = 0;
  private gen = 0;
  private target: 'fpga' | 'asic' = 'fpga';
  private asic: AsicResult | null = null;
  private asicErr: string | null = null;
  private asicBusy = false;
  private asicMs = 0;

  constructor(private core: Core) {
    this.view = new CanvasView($<HTMLCanvasElement>('synCanvas'));
    this.view.onPick = b => this.pick(b);
    $('synClose').onclick = () => this.close();
    $('synZin').onclick = () => this.view.zoom(1.4);
    $('synZout').onclick = () => this.view.zoom(1 / 1.4);
    $('synZfit').onclick = () => this.view.fit();
    $('synEdges').onclick = () => { this.edges = !this.edges; this.redrawLines(); };
    $('synAnim').onclick = () => this.animate();
    $('synAsc').onclick = () => this.pnr && download(`${this.pnr.top}.asc`, this.pnr.asc);
    $('synPcf').onclick = () => this.pnr && download(`${this.pnr.top}.pcf`, this.pnr.pcf);
    $('synBin').onclick = () => this.pnr && download(`${this.pnr.top}.bin`, fromBase64(this.pnr.bin));
    $('synV').onclick = () => this.asic && download(`${this.asic.top}_vlib.v`, this.asic.verilog);
    $('synDef').onclick = () => this.asic && download(`${this.asic.top}.def`, this.asic.def);
    $<HTMLSelectElement>('synTarget').onchange = () => this.setTarget($<HTMLSelectElement>('synTarget').value as 'fpga' | 'asic');
    $<HTMLSelectElement>('synTop').onchange = () => this.run($<HTMLSelectElement>('synTop').value);
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('synOverlay').classList.contains('hidden')) this.close(); });
    this.chips();
  }

  open(files: VFile[], top?: string, pcf?: string, target?: 'fpga' | 'asic'): void {
    this.files = files;
    this.pcf = pcf;
    if (target) this.setTarget(target, false);
    $('synOverlay').classList.remove('hidden');
    this.run(top);
  }

  close(): void { this.stopAnim(); $('synOverlay').classList.add('hidden'); }

  private async run(top?: string): Promise<void> {
    const gen = ++this.gen;
    this.stopAnim();
    this.res = null;
    this.pnr = null;
    this.pnrErr = null;
    this.asic = null;
    this.asicErr = null;
    this.nets.clear();
    $('synInfo').textContent = '合成中…';
    $('synSide').innerHTML = '';
    this.view.set({ boxes: [], lines: [], texts: [] });
    this.buttons();
    const t0 = performance.now();
    let res: SynthResult;
    try {
      res = await this.core.call<SynthResult>({ cmd: 'synth', files: this.files, top: top || null });
    } catch (e) {
      if (gen !== this.gen) return;
      $('synInfo').textContent = '合成失敗：\n' + String((e as Error).message ?? e);
      $('synStats').innerHTML = '';
      return;
    }
    if (gen !== this.gen) return;
    this.res = res;
    const sel = $<HTMLSelectElement>('synTop');
    sel.innerHTML = '';
    for (const m of res.modules.filter(m => !m.test)) {
      const o = document.createElement('option');
      o.value = o.textContent = m.name;
      sel.appendChild(o);
    }
    sel.value = res.top;
    this.stats(performance.now() - t0);
    this.show(this.stage);
  }

  private async runPnr(): Promise<void> {
    if (!this.res || this.pnr || this.pnrBusy) return;
    const gen = this.gen;
    this.pnrBusy = true;
    const t0 = performance.now();
    const tick = setInterval(() => {
      if (gen === this.gen && PNR.has(this.stage)) $('synInfo').textContent = `佈局繞線中…（iCE40UP5K，${((performance.now() - t0) / 1000).toFixed(1)} s）`;
    }, 200);
    try {
      $('synInfo').textContent = '載入晶片資料庫（IceStorm chipdb-5k，4 MB）…';
      await this.core.chipdb();
      const r = await this.core.call<PnrResult>({ cmd: 'pnr', files: this.files, top: this.res.top, pcf: this.pcf ?? null, seed: 1 });
      if (gen !== this.gen) return;
      this.pnr = r;
      this.pnrMs = performance.now() - t0;
    } catch (e) {
      if (gen !== this.gen) return;
      this.pnrErr = String((e as Error).message ?? e);
    } finally {
      clearInterval(tick);
      this.pnrBusy = false;
    }
    this.stats(this.synMs);
    this.buttons();
    if (PNR.has(this.stage)) this.show(this.stage);
  }

  private pnrMs = 0;
  private synMs = 0;

  private setTarget(t: 'fpga' | 'asic', show = true): void {
    this.target = t;
    $<HTMLSelectElement>('synTarget').value = t;
    $('synTitle').textContent = t === 'fpga' ? '合成 → FPGA（iCE40UP5K）' : '合成 → ASIC（vlib 標準元件）';
    this.chips();
    const cur = ASIC.has(this.stage) !== (t === 'asic') && OTHER[this.stage] ? OTHER[this.stage] : this.stage;
    if (this.res) this.stats(this.synMs);
    if (show) this.show(cur); else this.stage = cur;
  }

  private async runAsic(): Promise<void> {
    if (!this.res || this.asic || this.asicBusy) return;
    const gen = this.gen;
    this.asicBusy = true;
    const t0 = performance.now();
    const tick = setInterval(() => {
      if (gen === this.gen && ASIC.has(this.stage)) $('synInfo').textContent = `ASIC 流程中：標準元件對應 → 列式佈局退火 → 全域繞線 → STA…（${((performance.now() - t0) / 1000).toFixed(1)} s）`;
    }, 200);
    try {
      const r = await this.core.call<AsicResult>({ cmd: 'asic', files: this.files, top: this.res.top, seed: 1 });
      if (gen !== this.gen) return;
      this.asic = r;
      this.asicMs = performance.now() - t0;
    } catch (e) {
      if (gen !== this.gen) return;
      this.asicErr = String((e as Error).message ?? e);
    } finally {
      clearInterval(tick);
      this.asicBusy = false;
    }
    this.stats(this.synMs);
    this.buttons();
    if (ASIC.has(this.stage)) this.show(this.stage);
  }

  private chips(): void {
    const box = $('synChips');
    box.innerHTML = '';
    (this.target === 'fpga' ? FPGA_STAGES : ASIC_STAGES).forEach((s, i) => {
      if (i) { const a = document.createElement('span'); a.className = 'arrow'; a.textContent = '→'; box.appendChild(a); }
      const b = document.createElement('button');
      b.textContent = s.label;
      b.dataset.key = s.key;
      b.className = s.tag === 'fpga' ? 'tagf' : s.tag === 'asic' ? 'taga' : '';
      b.onclick = () => this.show(s.key);
      box.appendChild(b);
    });
  }

  /** stage-dependent buttons */
  private buttons(): void {
    const p = PNR.has(this.stage), a = ASIC.has(this.stage);
    $('synAnim').classList.toggle('hidden', this.stage !== 'place' && this.stage !== 'aplace');
    $<HTMLButtonElement>('synAnim').disabled = a ? !this.asic : !this.pnr;
    for (const id of ['synAsc', 'synPcf', 'synBin']) { $(id).classList.toggle('hidden', !p); $<HTMLButtonElement>(id).disabled = !this.pnr; }
    for (const id of ['synV', 'synDef']) { $(id).classList.toggle('hidden', !a); $<HTMLButtonElement>(id).disabled = !this.asic; }
    $('synEdges').classList.toggle('hidden', this.stage === 'place' || this.stage === 'aplace');
  }

  private netView(key: NetKey): NetView {
    let v = this.nets.get(key);
    if (!v) {
      const nl = key === 'amap' ? this.asic!.map : this.res![key];
      const lev = levelize(nl);
      v = { nl, lev, lay: netScene(nl, lev), names: netNames(nl) };
      this.nets.set(key, v);
    }
    return v;
  }

  private stats(ms: number): void {
    this.synMs = ms;
    const r = this.res!;
    if (this.target === 'asic') { this.asicStats(ms); return; }
    const m = r.map.cells;
    const luts = m.filter(c => c.t === 'SB_LUT4').length;
    const ffs = m.filter(c => isFF(c.t)).length;
    const carry = m.filter(c => c.t === 'SB_CARRY').length;
    const lev = this.netView('map').lev;
    const items = [
      `頂層 <b>${r.top}</b>`,
      `閘 <b>${r.raw.cells.length}</b> → <b>${r.opt.cells.length}</b>`,
      `LUT4 <b>${luts}</b>`,
      `CARRY <b>${carry}</b>`,
      `DFF <b>${ffs}</b>`,
      `LUT 層數 <b>${lev.depth}</b>`,
    ];
    if (this.pnr) {
      const p = this.pnr;
      items.push(`LC <b>${p.lcs.length}</b>/5280（${(100 * p.lcs.length / 5280).toFixed(1)}%）`, `pip <b>${p.pips}</b>`,
        `F<sub>max</sub> <b>${p.timing.fmax.toFixed(1)}</b> MHz`, `關鍵路徑 <b>${p.timing.period.toFixed(2)}</b> ns`);
    }
    items.push(`合成 <b>${ms.toFixed(0)}</b> ms` + (this.pnr ? `，佈局繞線 <b>${(this.pnrMs / 1000).toFixed(1)}</b> s` : ''));
    $('synStats').innerHTML = items.join('<span class="sep">│</span>');
  }

  private asicStats(ms: number): void {
    const r = this.res!;
    const items = [`頂層 <b>${r.top}</b>`, `閘 <b>${r.raw.cells.length}</b> → <b>${r.opt.cells.length}</b>`];
    const a = this.asic;
    if (a) {
      const ffs = a.map.cells.filter(c => isFF(c.t)).length;
      items.push(`標準元件 <b>${a.map.cells.length}</b>（DFF ${ffs}）`, `面積 <b>${fmtArea(a.area)}</b>`,
        `晶粒 <b>${a.die.w.toFixed(0)}×${a.die.h.toFixed(0)}</b> µm（${a.die.rows} 列，利用率 ${(a.die.util * 100).toFixed(0)}%）`,
        `線長 <b>${(a.route.wirelength / 1000).toFixed(2)}</b> mm`, `F<sub>max</sub> <b>${a.timing.fmax.toFixed(1)}</b> MHz`);
    }
    items.push(`合成 <b>${ms.toFixed(0)}</b> ms` + (a ? `，ASIC 流程 <b>${(this.asicMs / 1000).toFixed(1)}</b> s` : ''));
    $('synStats').innerHTML = items.join('<span class="sep">│</span>');
  }

  private show(key: string): void {
    if (!this.res) return;
    this.stopAnim();
    this.stage = key;
    this.sel = null;
    for (const b of $('synChips').querySelectorAll('button')) b.classList.toggle('cur', (b as HTMLElement).dataset.key === key);
    this.buttons();
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
    if (ASIC.has(key) && !this.asic) {
      this.view.set({ boxes: [], lines: [], texts: [] });
      this.side(document.createElement('div'));
      if (this.asicErr) { this.info(['ASIC 流程失敗：', this.asicErr]); return; }
      this.info(['ASIC 流程中…']);
      this.runAsic();
      return;
    }
    if (APHYS.has(key)) {
      this.drawAsic(true);
      this.info(this.asicReport(key));
      this.side(this.asicSide(key));
      return;
    }
    if (isNet(key)) {
      const v = this.netView(key);
      this.view.set({ ...v.lay.scene, lines: netLines(v.nl, v.lev, v.lay, this.edges && edgeCount(v.nl) <= 6000, null) });
      this.info(this.netReport(key, v));
      this.side(this.netSide(v));
      return;
    }
    // place and route stages
    if (!this.pnr) {
      this.view.set({ boxes: [], lines: [], texts: [] });
      this.side(document.createElement('div'));
      if (this.pnrErr) {
        const fit = /does not fit/.test(this.pnrErr);
        this.info(['佈局繞線失敗：', this.pnrErr, ...(fit ? ['', 'iCE40UP5K-SG48 只有 5280 個 LC、39 個 IO 腳：整顆 RV32I 核心（暫存器檔用正反器）放不下。請改用「RISC-V SoC（FPGA）」範例，或改看 ASIC 流程。'] : [])]);
        return;
      }
      this.info(['佈局繞線中…']);
      this.runPnr();
      return;
    }
    this.drawPnr(true);
    this.info(this.pnrReport(key));
    this.side(this.pnrSide(key));
  }

  private drawPnr(fit: boolean): void {
    const p = this.pnr!;
    const k = this.stage;
    let color: ((i: number) => string) | undefined;
    if (k === 'sta') {
      const max = Math.max(...p.lcs.map(l => l.arr), 1e-9);
      color = i => heat(p.lcs[i].arr / max);
    }
    const scene = deviceScene(p, undefined, color);
    const crit = new Set(p.timing.crit_lcs);
    for (const b of scene.boxes) b.hl = b.id === this.sel || (k === 'sta' && crit.has(b.id));
    if (k === 'route') scene.lines = this.edges ? routeLines(p, { net: this.selNet }) : [];
    if (k === 'sta') scene.lines = routeLines(p, { dim: true, net: this.selNet });
    this.view.set(scene, fit);
  }

  private selNet: number | null = null;

  private pnrReport(key: string): string[] {
    const p = this.pnr!;
    if (key === 'place') {
      const h = p.history;
      const chains = p.chains.map(c => c.length);
      return [
        '⑤ Placement 退火（iCE40UP5K：26×32 tile，邏輯 tile 每個 8 個 LC）',
        '先打包（LUT+FF+CARRY → LC），進位鏈放在整欄邏輯 tile 並從 LC 0 開始；其餘以模擬退火最小化線長（HPWL），同一 tile 的 DFF 必須同 clock / reset / 邊緣。',
        '',
        `LC ${p.lcs.length} 個（${(100 * p.lcs.length / 5280).toFixed(1)}%），進位鏈 ${chains.length} 條${chains.length ? `（${chains.join(', ')} LC）` : ''}，IO ${p.ios.length} 個`,
        `HPWL：初始 ${h[0].cost.toFixed(0)} → 退火後 ${h[h.length - 1].cost.toFixed(0)}（${h.length - 1} 個溫度快照）　按「▶ 退火動畫」重播`,
      ];
    }
    if (key === 'route') {
      const glb = p.globals.map(g => `${g.net} → glb_netwk_${g.glb}`).join('，') || '無';
      return [
        '⑥ Global + Detail Routing',
        'clock / reset 走全域網路（來源 → fabout → glb_netwk → 各 tile 的 clk / s_r mux）；其餘以 PathFinder 協商擁塞 + A* 在 IceStorm 繞線圖上找路（每條線只能給一個訊號）。',
        '',
        `全域：${glb}`,
        `${p.nets.length} 條 net，使用 ${p.pips} 個 pip；每輪過度使用的線：${p.route_iters.join(' → ')}`,
        '顏色：藍＝span4、紫＝span12、灰＝local / 輸入、綠＝全域、黃＝IO（點 LC 看細節）',
      ];
    }
    const t = p.timing;
    return [
      '⑦ Timing (STA)',
      '延遲取自 IceStorm timings_up5k（慢速角）：LC in→out、carry、clk→Q、setup，每段繞線依所驅動的線種類計 mux 延遲；clock 視為理想（全域網路）。',
      '',
      `關鍵路徑 ${t.period.toFixed(2)} ns → Fmax ${t.fmax.toFixed(2)} MHz（${t.endpoints} 個端點）；紅線＝關鍵路徑，LC 顏色＝到達時間（綠早紅晚）`,
    ];
  }

  private pnrSide(key: string): HTMLElement {
    const p = this.pnr!;
    const d = document.createElement('div');
    const det = document.createElement('div');
    det.id = 'synDetail';
    det.innerHTML = '<p class="hint">點 LC 看細節（LUT 真值表、DFF、接腳訊號、到達時間）。</p>';
    d.appendChild(det);
    let h = '';
    if (key === 'sta') {
      h += `<h3>關鍵路徑（${p.timing.period.toFixed(2)} ns）</h3>` + table(['累計 ns', '延遲', '經過'], p.timing.path.map(s => [s.at.toFixed(2), s.delay.toFixed(3), esc(s.what)]));
    }
    if (key === 'route') {
      h += `<h3>Net（${p.nets.length}，依 pip 數）</h3>`;
    }
    h += `<h3>IO</h3>` + table(['訊號', '方向', '腳位', 'tile'], p.ios.map(io => [esc(io.name), io.dir === 'in' ? 'in' : 'out', io.pin, `${io.x},${io.y}/${io.z}`]));
    const div = document.createElement('div');
    div.innerHTML = h;
    d.appendChild(div);
    if (key === 'route') {
      const list = document.createElement('div');
      list.className = 'clist';
      const order = p.nets.map((n, i) => i).sort((a, b) => p.nets[b].pips - p.nets[a].pips);
      for (const i of order.slice(0, 400)) {
        const n = p.nets[i];
        const row = document.createElement('div');
        row.textContent = `${n.name}  ${n.pips} pip  ${n.sinks} 負載${n.global ? '  [全域]' : ''}`;
        row.onclick = () => { this.selNet = i; this.drawPnr(false); };
        list.appendChild(row);
      }
      div.insertBefore(list, div.querySelector('h3:nth-of-type(2)'));
    }
    return d;
  }

  private animate(): void {
    if (this.stage === 'aplace') { this.animateAsic(); return; }
    if (!this.pnr || this.stage !== 'place') return;
    this.stopAnim();
    const p = this.pnr;
    let f = 0;
    const step = () => {
      const fr = p.history[f];
      const scene = deviceScene(p, fr.pos);
      this.view.set(scene, false);
      $('synInfo').textContent = `⑤ 退火動畫：第 ${f + 1}/${p.history.length} 個快照　溫度 ${fr.temp.toFixed(2)}　HPWL ${fr.cost.toFixed(0)}　接受率 ${(fr.accept * 100).toFixed(0)}%`;
      f++;
      if (f < p.history.length) this.anim = window.setTimeout(step, 90);
      else this.anim = window.setTimeout(() => { this.anim = 0; this.info(this.pnrReport('place')); }, 1200);
    };
    step();
  }

  private animateAsic(): void {
    const a = this.asic;
    if (!a) return;
    this.stopAnim();
    let f = 0;
    const step = () => {
      const fr = a.history[f];
      this.view.set(dieScene(a, fr.pos), false);
      $('synInfo').textContent = `A ⑤ 退火動畫：第 ${f + 1}/${a.history.length} 個快照　溫度 ${fr.temp.toFixed(2)}　HPWL ${(fr.cost / 1000).toFixed(2)} mm　接受率 ${(fr.accept * 100).toFixed(0)}%`;
      f++;
      if (f < a.history.length) this.anim = window.setTimeout(step, 110);
      else this.anim = window.setTimeout(() => { this.anim = 0; this.info(this.asicReport('aplace')); }, 1200);
    };
    step();
  }

  private selNetA: number | null = null;

  private drawAsic(fit: boolean): void {
    const a = this.asic!;
    const k = this.stage;
    let color: ((i: number) => string) | undefined;
    if (k === 'asta') {
      const max = Math.max(...a.cells.map(c => c[3]), 1e-9);
      color = i => heat(a.cells[i][3] / max);
    }
    const scene = dieScene(a, undefined, color);
    for (const b of scene.boxes) b.hl = b.id === this.sel || (k === 'asta' && b.id < a.cells.length && a.cells[b.id][4] === 1);
    if (k === 'aroute') {
      scene.bg = [...(scene.bg ?? []), ...congestion(a)];
      scene.lines = this.edges ? asicRouteLines(a, { net: this.selNetA }) : [];
    }
    if (k === 'asta') scene.lines = asicRouteLines(a, { dim: true });
    this.view.set(scene, fit);
  }

  private asicReport(key: string): string[] {
    const a = this.asic!;
    if (key === 'aplace') {
      const h = a.history;
      return [
        `A ⑤ Row Placement 退火（晶粒 ${a.die.w.toFixed(1)} × ${a.die.h.toFixed(1)} µm，${a.die.rows} 列 × ${a.die.sites} site）`,
        '依目標利用率 65% 決定晶粒大小，IO 腳平均放在四周（輸入：左、上；輸出：右、下）。初始依網表順序蛇形填列，再以模擬退火最小化 HPWL：每一步把元件移到空位或與另一個元件交換，永遠保持合法（不重疊、對齊 site）。',
        '',
        `${a.cells.length} 個元件，列利用率 ${(a.die.util * 100).toFixed(1)}%；HPWL：初始 ${(h[0].cost / 1000).toFixed(2)} mm → 退火後 ${(h[h.length - 1].cost / 1000).toFixed(2)} mm　按「▶ 退火動畫」重播`,
        '顏色：橘＝DFF、黃＝MUX2、藍＝AND/OR 類、紫＝XOR/AOI/OAI、綠＝INV、青＝BUF；綠/紅小方塊＝輸入/輸出腳',
      ];
    }
    if (key === 'aroute') {
      const r = a.route;
      return [
        `A ⑥ Global Routing（${r.gx} × ${r.gy} 個 gcell，每格 4 µm；水平線走 M2/M4、垂直線走 M3/M5，每邊 ${r.cap} 軌）`,
        '每條 net 的端點依 Prim 最小生成樹順序，用 A* 從端點連到已建好的樹；超過容量的邊以 PathFinder（現況 + 歷史成本）協商重繞，直到沒有溢出。',
        '',
        `${r.nets.length} 條 net，總線長 ${(r.wirelength / 1000).toFixed(2)} mm，via ${r.vias} 個；每輪溢出：${r.iters.join(' → ')}`,
        '顏色：藍＝水平、紫＝垂直、綠＝clock / reset；底色＝擁塞（綠鬆 → 紅滿）。點元件看細節、點右側 net 高亮。',
      ];
    }
    const t = a.timing;
    return [
      'A ⑦ Timing (STA)',
      '元件延遲 = 本徵延遲 + 每扇出負載 × 扇出；線延遲 = 驅動整條繞線的電容 + 到該負載的分佈 RC（依曼哈頓距離）。路徑起點為輸入腳與 DFF（clk→Q），終點為 DFF D（加 setup）與輸出腳；clock 視為理想。',
      '',
      `關鍵路徑 ${t.period.toFixed(3)} ns → Fmax ${t.fmax.toFixed(1)} MHz（${t.endpoints} 個端點）；紅線＝關鍵路徑，元件顏色＝到達時間（綠早紅晚）`,
    ];
  }

  private asicSide(key: string): HTMLElement {
    const a = this.asic!;
    const d = document.createElement('div');
    const det = document.createElement('div');
    det.id = 'synDetail';
    det.innerHTML = '<p class="hint">點元件看細節（種類、位置、接腳訊號、到達時間）。</p>';
    d.appendChild(det);
    const div = document.createElement('div');
    if (key === 'asta') {
      div.innerHTML = `<h3>關鍵路徑（${a.timing.period.toFixed(3)} ns）</h3>` + table(['累計 ns', '延遲', '經過'], a.timing.path.map(s => [s.at.toFixed(3), s.delay.toFixed(3), esc(s.what)]));
    } else if (key === 'aroute') {
      div.innerHTML = `<h3>Net（${a.route.nets.length}，依線長）</h3>`;
      const list = document.createElement('div');
      list.className = 'clist';
      const order = a.route.nets.map((_, i) => i).sort((x, y) => a.route.nets[y].len - a.route.nets[x].len);
      for (const i of order.slice(0, 400)) {
        const n = a.route.nets[i];
        const row = document.createElement('div');
        row.textContent = `${n.name}  ${n.len.toFixed(0)} µm  ${n.vias} via${n.clock ? '  [clock/reset]' : ''}`;
        row.onclick = () => { this.selNetA = i; this.drawAsic(false); };
        list.appendChild(row);
      }
      div.appendChild(list);
    } else {
      div.innerHTML = `<h3>元件數量</h3>` + table(['元件', '數量', '面積 µm²'], a.counts.map(([t, n]) => [`<span class="sw" style="background:${stdColor(t)}"></span>${t}`, String(n), (n * (a.lib.find(l => l.name === t)?.area ?? 0)).toFixed(0)]));
    }
    div.innerHTML += `<h3>IO 腳</h3>` + table(['訊號', '方向', 'x µm', 'y µm'], a.pins.map(p => [esc(p.name), p.dir, p.x.toFixed(1), p.y.toFixed(1)]));
    d.appendChild(div);
    return d;
  }

  private stdDetail(): void {
    const det = document.getElementById('synDetail');
    if (!det || !this.asic) return;
    if (this.sel === null) { det.innerHTML = '<p class="hint">點元件看細節（種類、位置、接腳訊號、到達時間）。</p>'; return; }
    const a = this.asic;
    const v = this.netView('amap');
    const c = a.map.cells[this.sel];
    const [row, site, w, arr, crit] = a.cells[this.sel];
    const lib = a.lib.find(l => l.name === c.t);
    let h = `<h3><span class="sw" style="background:${stdColor(c.t)}"></span>#${this.sel} ${c.t}${crit ? '（關鍵路徑）' : ''}</h3>`;
    h += `<p>第 ${row} 列，site ${site}–${site + w - 1}（x = ${(site * a.die.site_w).toFixed(1)} µm）<br>輸出到達時間 ${arr.toFixed(3)} ns</p>`;
    if (lib) h += `<p><code>${esc(lib.verilog)}</code></p>`;
    h += table(['接腳', '訊號'], c.c.map(([p, b]) => [p, esc(bitName(v.names, b))]));
    det.innerHTML = h;
  }

  private stopAnim(): void { if (this.anim) { clearTimeout(this.anim); this.anim = 0; } }

  private redrawLines(): void {
    $('synEdges').textContent = `⌁ 連線：${this.edges ? '開' : '關'}`;
    const k = this.stage;
    if (PNR.has(k)) { if (this.pnr) this.drawPnr(false); return; }
    if (APHYS.has(k)) { if (this.asic) this.drawAsic(false); return; }
    if (!isNet(k)) return;
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
    if (key === 'amap') {
      const a = this.asic!;
      const bufs = v.nl.cells.filter(c => c.t === 'BUF').length;
      return [
        'A ④ Standard Cell Map（vlib：列高 4.0 µm、site 0.5 µm，約 130 nm 慢速角）',
        '把網表在多扇出點切成樹，對每棵樹做動態規劃的 tree covering（最小面積）：反相器併入 NAND2 / NOR2 / XNOR2 / AOI21 / OAI21；同步 set/reset 變成 D 前的邏輯，非同步的用 DFFR / DFFS（低態有效，必要時加 INV）；扇出 > 12 的訊號插入 BUF 樹。',
        '',
        `${types}`,
        `元件面積 ${fmtArea(a.area)}，BUF ${bufs} 個，組合邏輯深度 ${v.lev.depth} 層 ${big}`,
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
    d.innerHTML = `<h3>埠</h3>` + table(['名稱', '方向', '寬度'], r.ports.map(p => [esc(p.name), p.dir === 'in' ? 'input' : 'output', String(p.width)]))
      + `<h3>實例</h3>` + table(['路徑', '模組'], r.hier.map(h => [esc(h.path || '(top)'), esc(h.module)]))
      + `<h3>訊號（${r.signals.length}）</h3>` + table(['名稱', '寬度'], r.signals.slice(0, 400).map(s => [esc(s.name), String(s.width)]));
    return d;
  }

  private netSide(v: NetView): HTMLElement {
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
    if (v.nl === this.asic?.map) {
      const lib = document.createElement('div');
      lib.innerHTML = `<h3>vlib 元件庫</h3>` + table(['元件', '寬', '面積 µm²', '延遲 ns', '+每扇出', '功能'],
        this.asic.lib.map(c => [`<span class="sw" style="background:${stdColor(c.name)}"></span>${c.name}`, String(c.width), c.area.toFixed(0), c.delay.toFixed(3), c.load.toFixed(3), esc(c.verilog.replace(/^assign Y = |;$/g, ''))]));
      d.appendChild(lib);
    }
    const det = document.createElement('div');
    det.id = 'synDetail';
    det.innerHTML = '<p class="hint">點圖上的元件看細節：接腳、所連訊號、LUT 真值表。</p>';
    d.prepend(det);
    return d;
  }

  private pick(b: Box | null): void {
    const k = this.stage;
    if (PNR.has(k)) {
      if (!this.pnr || this.anim) return;
      this.sel = b && b.id < this.pnr.lcs.length ? b.id : null;
      this.drawPnr(false);
      this.lcDetail();
      return;
    }
    if (APHYS.has(k)) {
      if (!this.asic || this.anim) return;
      this.sel = b && b.id < this.asic.cells.length ? b.id : null;
      this.drawAsic(false);
      this.stdDetail();
      return;
    }
    if (!b) { this.select(null); return; }
    if (isNet(k)) {
      const v = this.netView(k);
      if (b.id < v.nl.cells.length) this.select(b.id);
    }
  }

  private lcDetail(): void {
    const det = document.getElementById('synDetail');
    if (!det || !this.pnr) return;
    if (this.sel === null) { det.innerHTML = '<p class="hint">點 LC 看細節（LUT 真值表、DFF、接腳訊號、到達時間）。</p>'; return; }
    const lc = this.pnr.lcs[this.sel];
    const init = parseInt(lc.init, 16).toString(2).padStart(16, '0');
    let h = `<h3>LC #${this.sel}　tile (${lc.x},${lc.y}) LC ${lc.z}</h3>`;
    h += `<p><span class="sw" style="background:${lcColor(lc)}"></span>${lc.carry ? 'CARRY ' : ''}${lc.ff ? `DFF${lc.ff.neg ? '（負緣）' : ''}${lc.ff.sr ? (lc.ff.async ? '（非同步' : '（同步') + (lc.ff.set ? ' set）' : ' reset）') : ''} ` : ''}LUT 16'h${lc.init}${lc.in3c ? '（in3 = 進位鏈）' : ''}</p>`;
    h += `<p>輸出到達時間 ${lc.arr.toFixed(2)} ns</p>`;
    h += table(['接腳', '訊號'], [...lc.ins.map((n, k) => [`in${k}`, esc(k === 3 && lc.in3c ? '(carry in)' : n || '—')]), ['out', esc(lc.out || '—')]]);
    h += `<h3>LUT 真值表</h3>` + table(['I3 I2 I1 I0', 'O'], lutBits(init).map((o, k) => [`${(k >> 3) & 1}  ${(k >> 2) & 1}  ${(k >> 1) & 1}  ${k & 1}`, String(o)]));
    det.innerHTML = h;
  }

  private select(i: number | null): void {
    this.sel = i;
    this.redrawLines();
    const det = document.getElementById('synDetail');
    const k = this.stage;
    if (!det || !isNet(k)) return;
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

/** save text as a file (a Blob URL works from file:// too) */
function download(name: string, data: string | Uint8Array): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data as BlobPart], { type: typeof data === 'string' ? 'text/plain' : 'application/octet-stream' }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

function fmtArea(um2: number): string {
  return um2 >= 1e5 ? `${(um2 / 1e6).toFixed(3)} mm²` : `${um2.toFixed(0)} µm²`;
}
