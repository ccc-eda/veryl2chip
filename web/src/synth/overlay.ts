// The synthesis overlay: stage bar, report, drawing, side panel.

import { fromBase64, VFile } from '../api';
import type { Core } from '../client';
import { Box, CanvasView } from '../view/canvas';
import { AsicResult, asicRouteLines, congestion, detailLines, dieScene, LAYER_COLOR, powerScene, stdColor } from './asic';
import { deviceScene, heat, lcColor, PnrResult, RAM_COLOR, routeLines } from './device';
import { tr } from '../i18n';
import { saveAs } from '../zip';
import { compareRows, compareScene } from './compare';
import { cellColor, edgeCount, hierScene, NetLayout, netLines, netScene, shortType } from './layouts';
import { bitName, cellCount, countTypes, isFF, isOut, JNetlist, levelize, Leveled, lutBits, lutInputs, netNames, SynthResult } from './model';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

interface StageDef { key: string; tag: 'common' | 'fpga' | 'asic'; label: string; en: string }

/** a stage's chip label in the current language */
export function stageLabel(s: StageDef): string { return tr(s.label, s.en); }

export const FPGA_STAGES: StageDef[] = [
  { key: 'rtl', tag: 'common', label: '共 ① RTL→Logic', en: 'C ① RTL→Logic' },
  { key: 'raw', tag: 'common', label: '共 ② Logic Netlist', en: 'C ② Logic Netlist' },
  { key: 'opt', tag: 'common', label: '共 ③ Tech-indep Syn', en: 'C ③ Tech-indep Syn' },
  { key: 'map', tag: 'fpga', label: 'F ④ LUT4 Techmap', en: 'F ④ LUT4 Techmap' },
  { key: 'place', tag: 'fpga', label: 'F ⑤ Placement 退火', en: 'F ⑤ Placement (annealing)' },
  { key: 'route', tag: 'fpga', label: 'F ⑥ Global+Detail Routing', en: 'F ⑥ Global+Detail Routing' },
  { key: 'sta', tag: 'fpga', label: 'F ⑦ Timing (STA)', en: 'F ⑦ Timing (STA)' },
];
export const ASIC_STAGES: StageDef[] = [
  ...FPGA_STAGES.slice(0, 3),
  { key: 'amap', tag: 'asic', label: 'A ④ Standard Cell Map', en: 'A ④ Standard Cell Map' },
  { key: 'aplace', tag: 'asic', label: 'A ⑤ Row Placement 退火', en: 'A ⑤ Row Placement (annealing)' },
  { key: 'aroute', tag: 'asic', label: 'A ⑥ CTS + Global Routing', en: 'A ⑥ CTS + Global Routing' },
  { key: 'adetail', tag: 'asic', label: 'A ⑦ Detail Routing', en: 'A ⑦ Detail Routing' },
  { key: 'asta', tag: 'asic', label: 'A ⑧ Timing (STA)', en: 'A ⑧ Timing (STA)' },
  { key: 'apower', tag: 'asic', label: 'A ⑨ Power + IR Drop', en: 'A ⑨ Power + IR Drop' },
];
const PNR = new Set(['place', 'route', 'sta']);
const ASIC = new Set(['amap', 'aplace', 'aroute', 'adetail', 'asta', 'apower']);
const APHYS = new Set(['aplace', 'aroute', 'adetail', 'asta', 'apower']);
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

  /** `embedded`: the views live in a page pane (the IDE), not an overlay to close */
  constructor(private core: Core, private opts: { embedded?: boolean; onStage?: (key: string) => void } = {}) {
    this.view = new CanvasView($<HTMLCanvasElement>('synCanvas'));
    this.view.onPick = b => this.pick(b);
    if (!opts.embedded) $('synClose').onclick = () => this.close();
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
    if (!opts.embedded) document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('synOverlay').classList.contains('hidden')) this.close(); });
    this.chips();
  }

  open(files: VFile[], top?: string, pcf?: string, target?: 'fpga' | 'asic', stage?: string): void {
    this.files = files;
    this.pcf = pcf;
    if (target) this.setTarget(target, false);
    if (stage) this.stage = stage;
    $('synOverlay').classList.remove('hidden');
    this.run(top);
  }

  /** the stage shown */
  get current(): string { return this.stage; }
  /** show a stage (the synthesis must have been started with `open`) */
  showStage(key: string): void {
    if (ASIC.has(key) && this.target !== 'asic') this.setTarget('asic', false);
    else if ((PNR.has(key) || key === 'map') && this.target !== 'fpga') this.setTarget('fpga', false);
    this.stage = key;
    this.show(key);
  }
  get synthesized(): boolean { return this.res !== null; }

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
    this.note(tr('合成中…', 'Synthesizing…'));
    $('synSide').innerHTML = '';
    this.view.set({ boxes: [], lines: [], texts: [] });
    this.buttons();
    const t0 = performance.now();
    let res: SynthResult;
    try {
      res = await this.core.call<SynthResult>({ cmd: 'synth', files: this.files, top: top || null });
    } catch (e) {
      if (gen !== this.gen) return;
      this.note(tr('合成失敗：\n', 'Synthesis failed:\n') + String((e as Error).message ?? e), true);
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
      if (gen === this.gen && PNR.has(this.stage)) this.note(tr(`佈局繞線中…（iCE40UP5K，${((performance.now() - t0) / 1000).toFixed(1)} s）`, `Placing and routing… (iCE40UP5K, ${((performance.now() - t0) / 1000).toFixed(1)} s)`));
    }, 200);
    try {
      this.note(tr('載入晶片資料庫（IceStorm chipdb-5k，4 MB）…', 'Loading the chip database (IceStorm chipdb-5k, 4 MB)…'));
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
    if (PNR.has(this.stage) || this.stage === 'cmp') this.show(this.stage);
  }

  private pnrMs = 0;
  private synMs = 0;

  private setTarget(t: 'fpga' | 'asic', show = true): void {
    this.target = t;
    $<HTMLSelectElement>('synTarget').value = t;
    $('synTitle').textContent = t === 'fpga' ? tr('合成 → FPGA（iCE40UP5K）', 'Synthesis → FPGA (iCE40UP5K)') : tr('合成 → ASIC（vlib 標準元件）', 'Synthesis → ASIC (vlib standard cells)');
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
      if (gen === this.gen && ASIC.has(this.stage)) this.note(tr(`ASIC 流程中：標準元件對應 → 列式佈局退火 → 全域繞線 → STA…（${((performance.now() - t0) / 1000).toFixed(1)} s）`, `ASIC flow: standard-cell mapping → row placement → global routing → STA… (${((performance.now() - t0) / 1000).toFixed(1)} s)`));
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
    if (ASIC.has(this.stage) || this.stage === 'cmp') this.show(this.stage);
  }

  private chips(): void {
    const box = $('synChips');
    box.innerHTML = '';
    (this.target === 'fpga' ? FPGA_STAGES : ASIC_STAGES).forEach((s, i) => {
      if (i) { const a = document.createElement('span'); a.className = 'arrow'; a.textContent = '→'; box.appendChild(a); }
      const b = document.createElement('button');
      b.textContent = stageLabel(s);
      b.dataset.key = s.key;
      b.className = s.tag === 'fpga' ? 'tagf' : s.tag === 'asic' ? 'taga' : '';
      b.onclick = () => this.show(s.key);
      box.appendChild(b);
    });
    const sep = document.createElement('span');
    sep.className = 'arrow';
    sep.textContent = '│';
    const c = document.createElement('button');
    c.textContent = '⇄ FPGA vs ASIC';
    c.dataset.key = 'cmp';
    c.title = tr('同一個設計的兩種實作並排比較', 'The two implementations of the same design side by side');
    c.onclick = () => this.show('cmp');
    box.append(sep, c);
  }

  /** stage-dependent buttons */
  private buttons(): void {
    const p = PNR.has(this.stage), a = ASIC.has(this.stage);
    $('synAnim').classList.toggle('hidden', this.stage !== 'place' && this.stage !== 'aplace');
    $<HTMLButtonElement>('synAnim').disabled = a ? !this.asic : !this.pnr;
    for (const id of ['synAsc', 'synPcf', 'synBin']) { $(id).classList.toggle('hidden', !p); $<HTMLButtonElement>(id).disabled = !this.pnr; }
    for (const id of ['synV', 'synDef']) { $(id).classList.toggle('hidden', !a); $<HTMLButtonElement>(id).disabled = !this.asic; }
    $('synEdges').classList.toggle('hidden', this.stage === 'place' || this.stage === 'aplace' || this.stage === 'cmp');
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
    const ffs = m.filter(c => c.t.includes("DFF")).length;
    const carry = m.filter(c => c.t === 'SB_CARRY').length;
    const brams = m.filter(c => c.t === 'SB_RAM40_4K').length;
    const lev = this.netView('map').lev;
    const items = [
      `${tr('頂層', 'Top')} <b>${r.top}</b>`,
      `${tr('閘', 'Gates')} <b>${cellCount(r.raw)}</b> → <b>${cellCount(r.opt)}</b>`,
      `LUT4 <b>${luts}</b>`,
      `CARRY <b>${carry}</b>`,
      `DFF <b>${ffs}</b>`,
      ...(brams ? [`BRAM <b>${brams}</b>`] : []),
      `${tr('LUT 層數', 'LUT levels')} <b>${lev.depth}</b>`,
    ];
    if (this.pnr) {
      const p = this.pnr;
      items.push(`LC <b>${p.lcs.length}</b>/5280（${(100 * p.lcs.length / 5280).toFixed(1)}%）`, ...(p.rams.length ? [`BRAM <b>${p.rams.length}</b>/30`] : []), `pip <b>${p.pips}</b>`,
        `F<sub>max</sub> <b>${p.timing.fmax.toFixed(1)}</b> MHz`, `${tr('關鍵路徑', 'Critical path')} <b>${p.timing.period.toFixed(2)}</b> ns`);
    }
    items.push(`${tr('合成', 'Synthesis')} <b>${ms.toFixed(0)}</b> ms` + (this.pnr ? `${tr('，佈局繞線', ', place & route')} <b>${(this.pnrMs / 1000).toFixed(1)}</b> s` : ''));
    $('synStats').innerHTML = items.join('<span class="sep">│</span>');
  }

  private asicStats(ms: number): void {
    const r = this.res!;
    const items = [`${tr('頂層', 'Top')} <b>${r.top}</b>`, `${tr('閘', 'Gates')} <b>${cellCount(r.raw)}</b> → <b>${cellCount(r.opt)}</b>`];
    const a = this.asic;
    if (a) {
      const ffs = a.map.cells.filter(c => c.t.includes("DFF")).length;
      items.push(tr(`標準元件 <b>${a.map.cells.length}</b>（DFF ${ffs}）`, `Cells <b>${a.map.cells.length}</b> (DFF ${ffs})`), `${tr('面積', 'Area')} <b>${fmtArea(a.area)}</b>`,
        tr(`晶粒 <b>${a.die.w.toFixed(0)}×${a.die.h.toFixed(0)}</b> µm（${a.die.rows} 列，利用率 ${(a.die.util * 100).toFixed(0)}%）`, `Die <b>${a.die.w.toFixed(0)}×${a.die.h.toFixed(0)}</b> µm (${a.die.rows} rows, ${(a.die.util * 100).toFixed(0)}% utilization)`),
        `${tr('線長', 'Wirelength')} <b>${(a.route.wirelength / 1000).toFixed(2)}</b> mm`, `F<sub>max</sub> <b>${a.timing.fmax.toFixed(1)}</b> MHz`);
    }
    items.push(`${tr('合成', 'Synthesis')} <b>${ms.toFixed(0)}</b> ms` + (a ? `${tr('，ASIC 流程', ', ASIC flow')} <b>${(this.asicMs / 1000).toFixed(1)}</b> s` : ''));
    $('synStats').innerHTML = items.join('<span class="sep">│</span>');
  }

  private show(key: string): void {
    if (!this.res) return;
    this.stopAnim();
    this.stage = key;
    this.sel = null;
    for (const b of $('synChips').querySelectorAll('button')) b.classList.toggle('cur', (b as HTMLElement).dataset.key === key);
    this.buttons();
    this.opts.onStage?.(key);
    const r = this.res;
    if (key === 'cmp') { this.showCompare(); return; }
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
        tr('解析 Veryl（veryl-parser）→ 展開 package / enum / struct / 參數 → 由頂層往下實例化子模組並攤平（flatten），每個訊號配置「佔位」線。',
          'Parse Veryl (veryl-parser) → expand packages / enums / structs / parameters → instantiate the submodules from the top down and flatten them; every signal gets placeholder wires.'),
        '',
        tr(`頂層：${r.top}　實例 ${r.hier.length - 1} 個　模組種類 ${new Set(r.hier.map(h => h.module)).size}`, `Top: ${r.top}　${r.hier.length - 1} instances　${new Set(r.hier.map(h => h.module)).size} module types`),
        `${tr('埠：', 'Ports: ')}${r.ports.map(p => `${p.dir === 'in' ? '→' : '←'}${p.name}${p.width > 1 ? `[${p.width}]` : ''}`).join('  ')}`,
        tr(`訊號 ${r.signals.length} 個，共 ${bits} bit`, `${r.signals.length} signals, ${bits} bits`),
        ...(r.warnings.length ? ['', tr('警告：', 'Warnings:'), ...r.warnings] : []),
      ]);
      this.side(this.rtlSide());
      return;
    }
    if (ASIC.has(key) && !this.asic) {
      this.view.set({ boxes: [], lines: [], texts: [] });
      this.side(document.createElement('div'));
      if (this.asicErr) { this.note([tr('ASIC 流程失敗：', 'ASIC flow failed:'), this.asicErr].join('\n'), true); return; }
      this.info([]);
      this.note(tr('ASIC 流程中…', 'Running the ASIC flow…'));
      this.runAsic();
      return;
    }
    if (APHYS.has(key)) {
      this.drawAsic(true);
      this.info(this.asicReport(key));
      this.side(this.asicSide(key));
      return;
    }
    if ((key === 'raw' || key === 'opt') && r[key].n !== undefined) {
      // too big to draw: the counts only
      const nl = r[key];
      this.view.set({ boxes: [], lines: [], texts: [] });
      this.side(document.createElement('div'));
      const types = Object.entries(nl.types ?? {}).sort((a, b) => b[1] - a[1]).map(([t, n]) => `${shortType(t)} ${n}`).join('  ');
      this.info([
        key === 'raw' ? '② Logic Netlist' : tr('③ Tech-indep Syn（與技術無關的最佳化）', '③ Tech-indep Syn (technology-independent optimization)'),
        tr(`${nl.n} 個元件，太多了，不畫出來：在這個階段記憶體還是一個個正反器和讀取多工器，到了 ④ 才變成 block RAM（SB_RAM40_4K）。`,
          `${nl.n} cells: too many to draw. At this stage the memories are still flip-flops and read multiplexers; ④ turns them into block RAM (SB_RAM40_4K).`),
        '',
        types,
      ]);
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
        this.note([tr('佈局繞線失敗：', 'Place and route failed:'), this.pnrErr, ...(fit ? ['', tr('iCE40UP5K-SG48 只有 5280 個 LC、39 個 IO 腳：整顆 RV32I 核心（暫存器檔用正反器）放不下。請改用「RISC-V SoC（FPGA）」範例，或改看 ASIC 流程。', 'The iCE40UP5K-SG48 has only 5280 LCs and 39 IO pins: the whole RV32I core (register file in flip-flops) does not fit. Use the "RISC-V SoC (FPGA)" example, or look at the ASIC flow.')] : [])].join('\n'), true);
        return;
      }
      this.info([]);
      this.note(tr('佈局繞線中…', 'Placing and routing…'));
      this.runPnr();
      return;
    }
    this.drawPnr(true);
    this.info(this.pnrReport(key));
    this.side(this.pnrSide(key));
  }

  private showCompare(): void {
    const p = this.pnr, a = this.asic;
    if (!p || !a) {
      this.view.set({ boxes: [], lines: [], texts: [] });
      this.side(document.createElement('div'));
      const lines = [tr('⇄ FPGA vs ASIC：兩個後端都要跑完才能比較', '⇄ FPGA vs ASIC: both back ends must finish first')];
      lines.push(p ? tr('✓ FPGA 佈局繞線完成', '✓ FPGA place and route done') : this.pnrErr ? `✗ FPGA: ${this.pnrErr}` : tr('… FPGA 佈局繞線中', '… FPGA place and route running'));
      lines.push(a ? tr('✓ ASIC 流程完成', '✓ ASIC flow done') : this.asicErr ? `✗ ASIC: ${this.asicErr}` : tr('… ASIC 流程中', '… ASIC flow running'));
      this.info(lines);
      if (!p && !this.pnrErr) this.runPnr();
      if (!a && !this.asicErr) this.runAsic();
      return;
    }
    this.view.set(compareScene(p, a), true);
    const rows = compareRows(p, a);
    this.info([
      tr('⇄ FPGA vs ASIC：同一個網表（共 ①–③）分別走 iCE40 與標準元件流程', '⇄ FPGA vs ASIC: the same netlist (common ①–③) through the iCE40 and the standard-cell flows'),
      tr('FPGA 用現成的 LUT / 可程式繞線開關，彈性大但每個邏輯和每段繞線都慢、都耗電；ASIC 把邏輯直接做成電晶體與金屬線，面積小、快、省電，但要流片。',
        'An FPGA uses ready-made LUTs and programmable routing switches: flexible, but every logic level and every wire segment is slow and power hungry. An ASIC builds the logic directly from transistors and metal: small, fast and frugal, but it needs a tape-out.'),
      '',
      tr(`F_max：FPGA ${p.timing.fmax.toFixed(1)} MHz vs ASIC ${a.timing.fmax.toFixed(1)} MHz　左：iCE40 佈局，右：標準元件晶粒（放大到同高）`, `F_max: FPGA ${p.timing.fmax.toFixed(1)} MHz vs ASIC ${a.timing.fmax.toFixed(1)} MHz　left: iCE40 placement, right: standard-cell die (scaled to the same height)`),
    ]);
    const d = document.createElement('div');
    d.innerHTML = `<h3>${tr('比較', 'Comparison')}</h3><div class="cmpw">` + table([tr('項目', 'Item'), 'FPGA', 'ASIC'], rows.map(r => [r[0], r[1], r[2]])) + '</div>'
      + `<p class="hint">${tr('功耗以兩者 F<sub>max</sub> 較低者為共同頻率，翻轉率來自同一組隨機輸入模擬。', 'Power at the lower of the two F<sub>max</sub> as a common frequency; toggle rates from the same random-input simulation.')}</p>`;
    this.side(d);
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
        tr('⑤ Placement 退火（iCE40UP5K：26×32 tile，邏輯 tile 每個 8 個 LC）', '⑤ Placement, simulated annealing (iCE40UP5K: 26×32 tiles, 8 LCs per logic tile)'),
        tr('先打包（LUT+FF+CARRY → LC），進位鏈放在整欄邏輯 tile 並從 LC 0 開始；其餘以模擬退火最小化線長（HPWL），同一 tile 的 DFF 必須同 clock / reset / 邊緣。',
          'Packing first (LUT+FF+CARRY → LC); carry chains go into a column of logic tiles starting at LC 0; the rest is placed by simulated annealing minimizing wirelength (HPWL); the DFFs of one tile must share clock / reset / edge.'),
        '',
        tr(`LC ${p.lcs.length} 個（${(100 * p.lcs.length / 5280).toFixed(1)}%），進位鏈 ${chains.length} 條${chains.length ? `（${chains.join(', ')} LC）` : ''}，IO ${p.ios.length} 個${p.rams.length ? `，block RAM ${p.rams.length} 個（RAM 欄 x = 6 / 19，每個佔上下兩個 tile）` : ''}`,
          `${p.lcs.length} LCs (${(100 * p.lcs.length / 5280).toFixed(1)}%), ${chains.length} carry chains${chains.length ? ` (${chains.join(', ')} LCs)` : ''}, ${p.ios.length} IOs${p.rams.length ? `, ${p.rams.length} block RAMs (RAM columns x = 6 / 19, two tiles each)` : ''}`),
        tr(`HPWL：初始 ${h[0].cost.toFixed(0)} → 退火後 ${h[h.length - 1].cost.toFixed(0)}（${h.length - 1} 個溫度快照）　按「▶ 退火動畫」重播`,
          `HPWL: initial ${h[0].cost.toFixed(0)} → annealed ${h[h.length - 1].cost.toFixed(0)} (${h.length - 1} temperature snapshots)　press "▶ Annealing" to replay`),
      ];
    }
    if (key === 'route') {
      const glb = p.globals.map(g => `${g.net} → glb_netwk_${g.glb}`).join(', ') || tr('無', 'none');
      return [
        '⑥ Global + Detail Routing',
        tr('clock / reset 走全域網路（來源 → fabout → glb_netwk → 各 tile 的 clk / s_r mux）；其餘以 PathFinder 協商擁塞 + A* 在 IceStorm 繞線圖上找路（每條線只能給一個訊號）。',
          'Clock / reset use the global networks (source → fabout → glb_netwk → each tile\'s clk / s_r mux); everything else is routed with PathFinder congestion negotiation + A* on the IceStorm routing graph (each wire carries one signal).'),
        '',
        `${tr('全域：', 'Globals: ')}${glb}`,
        tr(`${p.nets.length} 條 net，使用 ${p.pips} 個 pip；每輪過度使用的線：${p.route_iters.join(' → ')}`, `${p.nets.length} nets, ${p.pips} pips; overused wires per iteration: ${p.route_iters.join(' → ')}`),
        tr('顏色：藍＝span4、紫＝span12、灰＝local / 輸入、綠＝全域、黃＝IO（點 LC 看細節）', 'Colors: blue = span4, purple = span12, gray = local / inputs, green = global, yellow = IO (click an LC for details)'),
      ];
    }
    const t = p.timing;
    return [
      '⑦ Timing (STA)',
      tr('延遲取自 IceStorm timings_up5k（慢速角）：LC in→out、carry、clk→Q、setup，每段繞線依所驅動的線種類計 mux 延遲；clock 視為理想（全域網路）。',
        'Delays from IceStorm timings_up5k (slow corner): LC in→out, carry, clk→Q, setup; each routing segment adds the mux delay of the wire type it drives; the clock is ideal (global network).'),
      '',
      tr(`關鍵路徑 ${t.period.toFixed(2)} ns → Fmax ${t.fmax.toFixed(2)} MHz（${t.endpoints} 個端點）；紅線＝關鍵路徑，LC 顏色＝到達時間（綠早紅晚）`,
        `Critical path ${t.period.toFixed(2)} ns → Fmax ${t.fmax.toFixed(2)} MHz (${t.endpoints} endpoints); red = critical path, LC color = arrival time (green early, red late)`),
      tr(`功耗估計（隨機輸入模擬的翻轉率；net 電容 ≈ 5 fF × 負載 + 8 fF × 繞線段，全域時脈網路每拍，block RAM 每次存取 ≈ 24 pJ，靜態 ≈ 75 µA）：在 ${t.fmax.toFixed(1)} MHz 約 ${t.power.total.toFixed(3)} mW（動態 ${t.power.dynamic.toFixed(3)} + 靜態 ${t.power.static.toFixed(3)}；每週期 ${(t.power.e_nets + t.power.e_clock + t.power.e_ram).toFixed(1)} pJ）`,
        `Power estimate (toggle rates from a random-input simulation; net capacitance ≈ 5 fF × loads + 8 fF × routing segments, the global clock network every cycle, ≈ 24 pJ per block RAM access, static ≈ 75 µA): about ${t.power.total.toFixed(3)} mW at ${t.fmax.toFixed(1)} MHz (dynamic ${t.power.dynamic.toFixed(3)} + static ${t.power.static.toFixed(3)}; ${(t.power.e_nets + t.power.e_clock + t.power.e_ram).toFixed(1)} pJ per cycle)`),
      ...(t.fmax_wl ? [tr(`時序導向：第一輪只看線長 ${t.fmax_wl.toFixed(2)} MHz；再以每條 net 的關鍵度（經過它的最長路徑 / 關鍵路徑）加權重新佈局，繞線時關鍵 net 優先走快的線 → ${t.fmax.toFixed(2)} MHz（取較快的一輪）`,
        `Timing driven: the wirelength-only pass gives ${t.fmax_wl.toFixed(2)} MHz; placing again with nets weighted by criticality (longest path through the net / critical path), and routing critical nets on fast wires first → ${t.fmax.toFixed(2)} MHz (the faster pass is kept)`)] : []),
    ];
  }

  private pnrSide(key: string): HTMLElement {
    const p = this.pnr!;
    const d = document.createElement('div');
    const det = document.createElement('div');
    det.id = 'synDetail';
    det.innerHTML = `<p class="hint">${tr('點 LC 看細節（LUT 真值表、DFF、接腳訊號、到達時間）。', 'Click an LC for details (LUT truth table, DFF, pin signals, arrival time).')}</p>`;
    d.appendChild(det);
    let h = '';
    if (key === 'sta') {
      h += `<h3>${tr('關鍵路徑', 'Critical path')}（${p.timing.period.toFixed(2)} ns）</h3>` + table([tr('累計 ns', 'At ns'), tr('延遲', 'Delay'), tr('經過', 'Through')], p.timing.path.map(s => [s.at.toFixed(2), s.delay.toFixed(3), esc(stepText(s.what))]));
    }
    if (key === 'route') {
      h += `<h3>${tr(`Net（${p.nets.length}，依 pip 數）`, `Nets (${p.nets.length}, by pips)`)}</h3>`;
    }
    h += `<h3>IO</h3>` + table([tr('訊號', 'Signal'), tr('方向', 'Dir'), tr('腳位', 'Pin'), 'tile'], p.ios.map(io => [esc(io.name), io.dir === 'in' ? 'in' : 'out', io.pin, `${io.x},${io.y}/${io.z}`]));
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
        row.textContent = `${n.name}  ${n.pips} pip  ${n.sinks} ${tr('負載', 'loads')}${n.global ? tr('  [全域]', '  [global]') : ''}`;
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
      const scene = deviceScene(p, fr.pos, undefined, fr.ram);
      this.view.set(scene, false);
      this.note(tr(`⑤ 退火動畫：第 ${f + 1}/${p.history.length} 個快照　溫度 ${fr.temp.toFixed(2)}　HPWL ${fr.cost.toFixed(0)}　接受率 ${(fr.accept * 100).toFixed(0)}%`, `⑤ Annealing: snapshot ${f + 1}/${p.history.length}　temperature ${fr.temp.toFixed(2)}　HPWL ${fr.cost.toFixed(0)}　acceptance ${(fr.accept * 100).toFixed(0)}%`));
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
      this.note(tr(`A ⑤ 退火動畫：第 ${f + 1}/${a.history.length} 個快照　溫度 ${fr.temp.toFixed(2)}　HPWL ${(fr.cost / 1000).toFixed(2)} mm　接受率 ${(fr.accept * 100).toFixed(0)}%`, `A ⑤ Annealing: snapshot ${f + 1}/${a.history.length}　temperature ${fr.temp.toFixed(2)}　HPWL ${(fr.cost / 1000).toFixed(2)} mm　acceptance ${(fr.accept * 100).toFixed(0)}%`));
      f++;
      if (f < a.history.length) this.anim = window.setTimeout(step, 110);
      else this.anim = window.setTimeout(() => { this.anim = 0; this.info(this.asicReport('aplace')); }, 1200);
    };
    step();
  }

  private selNetA: number | null = null;
  private selNetD: number | null = null;
  private layers = [true, true, true, true];
  private power = true;
  private showIr = false;

  private drawAsic(fit: boolean): void {
    const a = this.asic!;
    const k = this.stage;
    let color: ((i: number) => string) | undefined;
    if (k === 'asta') {
      const max = Math.max(...a.cells.map(c => c[3]), 1e-9);
      color = i => heat(a.cells[i][3] / max);
    }
    if (k === 'apower') {
      const v = this.showIr ? a.power.ir : a.power.cell;
      const max = Math.max(...v, 1e-12);
      color = i => heat(v[i] / max);
    }
    const scene = dieScene(a, undefined, color);
    for (const b of scene.boxes) b.hl = b.id === this.sel || (k === 'asta' && b.id < a.cells.length && a.cells[b.id][4] === 1);
    if (k === 'aroute') {
      scene.bg = [...(scene.bg ?? []), ...congestion(a)];
      scene.lines = this.edges ? asicRouteLines(a, { net: this.selNetA }) : [];
    }
    if (k === 'adetail') {
      const pw = powerScene(a);
      scene.bg = [...(scene.bg ?? []), ...pw.bg];
      scene.lines = [...(this.power ? pw.lines : []), ...(this.edges ? detailLines(a, this.selNetD, this.layers) : [])];
    }
    if (k === 'asta') scene.lines = asicRouteLines(a, { dim: true });
    this.view.set(scene, fit);
  }

  private asicReport(key: string): string[] {
    const a = this.asic!;
    if (key === 'aplace') {
      const h = a.history;
      return [
        tr(`A ⑤ Row Placement 退火（晶粒 ${a.die.w.toFixed(1)} × ${a.die.h.toFixed(1)} µm，${a.die.rows} 列 × ${a.die.sites} site）`, `A ⑤ Row Placement, simulated annealing (die ${a.die.w.toFixed(1)} × ${a.die.h.toFixed(1)} µm, ${a.die.rows} rows × ${a.die.sites} sites)`),
        tr(`依目標利用率決定晶粒大小（${(a.die.util * 100).toFixed(0)}%；太擠繞不通就自動放大），IO 腳平均放在四周（輸入：左、上；輸出：右、下）。初始依網表順序蛇形填列，再以模擬退火最小化 HPWL + 密度懲罰：每一步把元件移到空位或與另一個元件交換，永遠保持合法（不重疊、對齊 site）；16 × 16 µm 的格子超過目標密度 ${(a.die.target_density * 100).toFixed(0)}% 的部分要付代價，元件才不會全擠到 IO 腳旁邊、留下局部繞不通的熱點。`,
          `The die size follows the target utilization (${(a.die.util * 100).toFixed(0)}%; enlarged automatically when too crowded to route); IO pins are spread around the edge (inputs: left, top; outputs: right, bottom). Rows are first filled in netlist order like a snake, then simulated annealing minimizes HPWL + a density penalty: each move takes a cell to a free spot or swaps it with another, always legal (no overlap, on sites); 16 × 16 µm bins above the target density of ${(a.die.target_density * 100).toFixed(0)}% pay a cost, so cells do not pile up next to the IO pins and leave unroutable hot spots.`),
        tr(`最滿的格子 ${(a.die.max_density * 100).toFixed(0)}%`, `Fullest bin ${(a.die.max_density * 100).toFixed(0)}%`),
        '',
        tr(`${a.cells.length} 個元件，列利用率 ${(a.die.util * 100).toFixed(1)}%；HPWL：初始 ${(h[0].cost / 1000).toFixed(2)} mm → 退火後 ${(h[h.length - 1].cost / 1000).toFixed(2)} mm　按「▶ 退火動畫」重播`,
          `${a.cells.length} cells, row utilization ${(a.die.util * 100).toFixed(1)}%; HPWL: initial ${(h[0].cost / 1000).toFixed(2)} mm → annealed ${(h[h.length - 1].cost / 1000).toFixed(2)} mm　press "▶ Annealing" to replay`),
        tr('顏色：橘＝DFF、黃＝MUX2、藍＝AND/OR 類、紫＝XOR/AOI/OAI、綠＝INV、青＝BUF；綠/紅小方塊＝輸入/輸出腳', 'Colors: orange = DFF, yellow = MUX2, blue = AND/OR family, purple = XOR/AOI/OAI, green = INV, cyan = BUF; small green / red squares = input / output pins'),
      ];
    }
    if (key === 'aroute') {
      const r = a.route;
      const c = a.cts;
      return [
        tr(`A ⑥ CTS + Global Routing（${r.gx} × ${r.gy} 個 gcell，每格 4 µm；水平線走 M2/M4、垂直線走 M3/M5，每邊 ${r.cap} 軌）`, `A ⑥ CTS + Global Routing (${r.gx} × ${r.gy} gcells of 4 µm; horizontal on M2/M4, vertical on M3/M5, ${r.cap} tracks per edge)`),
        tr(`時脈樹合成（CTS）：佈局完成後，把 clock（與非同步 reset）的負載依位置遞迴對半切（沿較長的方向取中位數，像 H-tree），每群 ≤ 16 個負載由一個 CLKBUF 驅動，緩衝器放在所驅動者的重心；平衡的切法讓每個正反器經過一樣多級、差不多長的線 → skew 小。`,
          `Clock tree synthesis (CTS): after placement the loads of the clock (and asynchronous reset) are split in halves by position, recursively (median along the longer side, like an H-tree); each group of ≤ 16 loads is driven by one CLKBUF placed at their centroid; balanced splits give every flip-flop the same number of levels and similar wire lengths → small skew.`),
        c.buffers ? tr(`→ ${c.trees.map(t => `${t.net}：${t.sinks} 個負載，${t.buffers} 個 CLKBUF，${t.levels} 級`).join('；')}；插入延遲 ${a.timing.insertion.toFixed(3)} ns，skew ${(a.timing.skew * 1000).toFixed(0)} ps`,
          `→ ${c.trees.map(t => `${t.net}: ${t.sinks} loads, ${t.buffers} CLKBUFs, ${t.levels} levels`).join('; ')}; insertion delay ${a.timing.insertion.toFixed(3)} ns, skew ${(a.timing.skew * 1000).toFixed(0)} ps`) : tr('→ 負載不多（≤ 16），不需要時脈樹', '→ few loads (≤ 16), no clock tree needed'),
        tr('每條 net 的端點依 Prim 最小生成樹順序，用 A* 從端點連到已建好的樹；超過容量的邊以 PathFinder（現況 + 歷史成本）協商重繞，直到沒有溢出。',
          'The pins of each net are connected in Prim minimum-spanning-tree order, A* from a pin to the tree built so far; edges over capacity are renegotiated with PathFinder (present + history cost) until nothing overflows.'),
        '',
        tr(`${r.nets.length} 條 net，總線長 ${(r.wirelength / 1000).toFixed(2)} mm，via ${r.vias} 個；每輪溢出：${r.iters.join(' → ')}`, `${r.nets.length} nets, wirelength ${(r.wirelength / 1000).toFixed(2)} mm, ${r.vias} vias; overflow per iteration: ${r.iters.join(' → ')}`),
        tr('顏色：藍＝水平、紫＝垂直、綠＝clock / reset；底色＝擁塞（綠鬆 → 紅滿）。點元件看細節、點右側 net 高亮。', 'Colors: blue = horizontal, purple = vertical, green = clock / reset; background = congestion (green free → red full). Click a cell for details, a net on the right to highlight it.'),
      ];
    }
    if (key === 'apower') {
      const p = a.power;
      const e = p.e_nets + p.e_clock + p.e_internal + p.e_sram;
      return [
        'A ⑨ Power + IR Drop',
        tr(`以隨機輸入模擬最後的網表 ${p.cycles} 個週期（有 reset 就先拉兩拍），統計每條 net 的翻轉率 α；切換功耗 = ½·α·C·V²·f（C = 負載腳位 + 0.2 fF/µm 的實際線長，V = 1.2 V），時脈樹每拍充放電；元件內部能量依大小計、正反器每拍有時脈能量、SRAM 每次存取；漏電依面積。`,
          `The final netlist is simulated for ${p.cycles} cycles with random inputs (reset held for two cycles first, if any) to get each net's toggle rate α; switching power = ½·α·C·V²·f (C = load pins + 0.2 fF/µm of actual wire, V = 1.2 V); the clock tree charges every cycle; internal energy by cell size, clock energy per flip-flop per cycle, SRAM per access; leakage by area.`),
        tr(`IR drop：每個元件的平均電流流過所在列的 VDD 軌與 VSS 軌；兩條電源帶之間的軌是兩端供電的電阻線（M1 0.2 Ω/µm），算出每個元件看到的壓降。`,
          `IR drop: each cell's average current flows through the VDD and VSS rails of its row; a rail between two straps is a resistive line fed from both ends (M1 0.2 Ω/µm), giving the drop each cell sees.`),
        '',
        tr(`每週期能量 ${e.toFixed(2)} pJ（訊號 ${p.e_nets.toFixed(2)}、時脈樹 ${p.e_clock.toFixed(2)}、元件內部 ${p.e_internal.toFixed(2)}、SRAM ${p.e_sram.toFixed(2)}）→ 在 Fmax ${p.freq.toFixed(1)} MHz：${p.total.toFixed(3)} mW（動態 ${p.dynamic.toFixed(3)}、漏電 ${p.leakage.toFixed(4)}）`,
          `Energy per cycle ${e.toFixed(2)} pJ (signals ${p.e_nets.toFixed(2)}, clock tree ${p.e_clock.toFixed(2)}, cell internal ${p.e_internal.toFixed(2)}, SRAM ${p.e_sram.toFixed(2)}) → at Fmax ${p.freq.toFixed(1)} MHz: ${p.total.toFixed(3)} mW (dynamic ${p.dynamic.toFixed(3)}, leakage ${p.leakage.toFixed(4)})`),
        tr(`最大 IR drop ${p.ir_worst.toFixed(2)} mV（${(p.ir_worst / 12).toFixed(2)}% of VDD）；顏色＝${this.showIr ? 'IR drop' : '每個元件的功耗'}（綠低紅高），側欄可切換`,
          `Worst IR drop ${p.ir_worst.toFixed(2)} mV (${(p.ir_worst / 12).toFixed(2)}% of VDD); color = ${this.showIr ? 'IR drop' : 'power per cell'} (green low, red high), switch in the side panel`),
      ];
    }
    if (key === 'adetail') {
      const d = a.detail;
      const um = (x: number) => (x / 1000).toFixed(2) + ' mm';
      return [
        tr(`A ⑦ Detail Routing（軌道格點：每 ${(a.die.row_h / d.tracks).toFixed(1)} µm 一條，${d.nx} × ${d.ny} × 4 層；M2/M4 水平、M3/M5 垂直）`, `A ⑦ Detail Routing (track grid: one every ${(a.die.row_h / d.tracks).toFixed(1)} µm, ${d.nx} × ${d.ny} × 4 layers; M2/M4 horizontal, M3/M5 vertical)`),
        tr('每條 net 只在全域繞線選的 gcell 走廊內（外加一圈）以 A* 找路：端點依 Prim 順序連到已建好的樹，換層一個 via 成本較高；每個格點只能屬於一條 net（所以沒有短路），重疊以 PathFinder 協商重繞，卡住的 net 走廊會加寬。元件腳位從 M1 經 via 上來，SRAM 巨集上方擋住 M2/M3，IO 腳在 M5。',
          'Each net is routed with A* only inside the gcell corridor chosen by global routing (plus one ring): pins join the tree in Prim order, a layer change (via) costs more; every grid point belongs to one net at most (so no shorts), overlaps are renegotiated with PathFinder and a stuck net\'s corridor widens. Cell pins come up from M1 through vias, SRAM macros block M2/M3 above them, IO pins are on M5.'),
        '',
        tr(`電源網路：每條列邊界一條 M1 電源軌（VSS / VDD 交替，共 ${a.pdn.rails} 條），M5 垂直電源帶 ${a.pdn.straps.length} 條（VDD / VSS 成對，每 40 µm 一對），${a.pdn.vias} 個 via 疊把帶子接到同名的軌；繞線器避開帶子與 via 疊。空位補上 ${a.pdn.fillers.length / 3} 個填充元件（FILL8/4/2/1，深灰），讓井與電源軌連續。`,
          `Power grid: an M1 rail on every row boundary (VSS / VDD alternating, ${a.pdn.rails} rails), ${a.pdn.straps.length} vertical M5 straps (VDD / VSS pairs, one pair every 40 µm), ${a.pdn.vias} via stacks tie the straps to the rails of the same net; the router avoids straps and via stacks. ${a.pdn.fillers.length / 3} filler cells (FILL8/4/2/1, dark gray) fill the gaps so wells and rails are continuous.`),
        tr(`線長 ${um(d.wirelength)}（M2 ${um(d.per_layer[0])}、M3 ${um(d.per_layer[1])}、M4 ${um(d.per_layer[2])}、M5 ${um(d.per_layer[3])}），via ${d.vias} 個；衝突 ${d.conflicts}、未接通 ${d.opens}；每輪衝突：${d.iters.join(' → ')}`,
          `Wirelength ${um(d.wirelength)} (M2 ${um(d.per_layer[0])}, M3 ${um(d.per_layer[1])}, M4 ${um(d.per_layer[2])}, M5 ${um(d.per_layer[3])}), ${d.vias} vias; ${d.conflicts} conflicts, ${d.opens} opens; conflicts per iteration: ${d.iters.join(' → ')}`),
        d.nets.length ? tr('顏色：藍 M2、紅 M3、綠 M4、黃 M5；側欄可切換層、點 net 高亮。這一步的線長也回饋給 STA。', 'Colors: blue M2, red M3, green M4, yellow M5; switch layers in the side panel, click a net to highlight it. These wire lengths also feed the STA.') : tr(`（共 ${d.segments} 段線，太多不畫，只列統計）`, `(${d.segments} segments: too many to draw, statistics only)`),
      ];
    }
    const t = a.timing;
    return [
      'A ⑧ Timing (STA)',
      tr('元件延遲 = 本徵延遲 + 每扇出負載 × 扇出；線延遲 = 驅動整條繞線的電容 + 到該負載的分佈 RC（依曼哈頓距離）。路徑起點為輸入腳與 DFF（clk→Q），終點為 DFF D（加 setup）與輸出腳；clock 視為理想。',
        'Cell delay = intrinsic delay + load per fanout × fanout; wire delay = driving the whole routed net\'s capacitance + the distributed RC to that load (by Manhattan distance). Paths start at input pins and DFFs (clk→Q) and end at DFF D (plus setup) and output pins; the clock is ideal here.'),
      '',
      tr(`關鍵路徑 ${t.period.toFixed(3)} ns → Fmax ${t.fmax.toFixed(1)} MHz（${t.endpoints} 個端點）；紅線＝關鍵路徑，元件顏色＝到達時間（綠早紅晚）`,
        `Critical path ${t.period.toFixed(3)} ns → Fmax ${t.fmax.toFixed(1)} MHz (${t.endpoints} endpoints); red = critical path, cell color = arrival time (green early, red late)`),
      tr(`時序導向：只看線長的佈局 ${t.fmax_wl.toFixed(1)} MHz；以 net 關鍵度加權後再退火（微調 + 小設計重新退火，只取繞得通的）→ ${t.fmax_ideal.toFixed(1)} MHz（理想時脈）`,
        `Timing driven: wirelength-only placement ${t.fmax_wl.toFixed(1)} MHz; annealing again with nets weighted by criticality (refinement, plus a fresh anneal for small designs, routable results only) → ${t.fmax_ideal.toFixed(1)} MHz (ideal clock)`),
      tr(`時脈樹之後（propagated clock）：路徑從發送端正反器的時脈到達時間出發、對接收端的時脈檢查 setup → ${t.fmax.toFixed(1)} MHz；skew ${(t.skew * 1000).toFixed(0)} ps。`,
        `With the clock tree (propagated clock): paths start at the launching flip-flop's clock arrival and check setup against the capturing clock → ${t.fmax.toFixed(1)} MHz; skew ${(t.skew * 1000).toFixed(0)} ps.`),
      tr(`Hold 檢查（最短路徑：最早到達 ≥ 接收時脈 + hold）：最差餘裕 ${t.hold_slack.toFixed(3)} ns${a.cts.hold_bufs ? `，插入 ${a.cts.hold_bufs} 個延遲 BUF 修正` : '，沒有違規'}。`,
        `Hold check (shortest paths: earliest arrival ≥ capture clock + hold): worst slack ${t.hold_slack.toFixed(3)} ns${a.cts.hold_bufs ? `, fixed by inserting ${a.cts.hold_bufs} delay BUFs` : ', no violations'}.`),
    ];
  }

  private asicSide(key: string): HTMLElement {
    const a = this.asic!;
    const d = document.createElement('div');
    const det = document.createElement('div');
    det.id = 'synDetail';
    det.innerHTML = `<p class="hint">${tr('點元件看細節（種類、位置、接腳訊號、到達時間）。', 'Click a cell for details (type, position, pin signals, arrival time).')}</p>`;
    d.appendChild(det);
    const div = document.createElement('div');
    if (key === 'apower') {
      const p = a.power;
      const lab = document.createElement('label');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = this.showIr;
      cb.onchange = () => { this.showIr = cb.checked; this.drawAsic(false); this.info(this.asicReport('apower')); };
      lab.append(cb, tr(' 顯示 IR drop（否則顯示功耗）', ' show IR drop (otherwise power)'));
      div.appendChild(lab);
      const byType = new Map<string, number>();
      a.map.cells.forEach((c, i) => byType.set(c.t, (byType.get(c.t) ?? 0) + p.cell[i]));
      div.insertAdjacentHTML('beforeend', `<h3>${tr('每週期能量（pJ）', 'Energy per cycle (pJ)')}</h3>` + table([tr('來源', 'Source'), 'pJ'], [[tr('訊號 net', 'signal nets'), p.e_nets.toFixed(3)], [tr('時脈樹', 'clock tree'), p.e_clock.toFixed(3)], [tr('元件內部', 'cell internal'), p.e_internal.toFixed(3)], ['SRAM', p.e_sram.toFixed(3)]])
        + `<h3>${tr('功耗（依元件種類，µW）', 'Power by cell type (µW)')}</h3>` + table([tr('元件', 'Cell'), 'µW'], [...byType.entries()].sort((x, y) => y[1] - x[1]).map(([t, v]) => [`<span class="sw" style="background:${stdColor(t)}"></span>${t}`, v.toFixed(2)])));
    } else if (key === 'adetail') {
      const d = a.detail;
      div.innerHTML = `<h3>${tr('層', 'Layers')}</h3>`;
      const pw = document.createElement('label');
      pw.style.display = 'block';
      const pcb = document.createElement('input');
      pcb.type = 'checkbox';
      pcb.checked = this.power;
      pcb.onchange = () => { this.power = pcb.checked; this.drawAsic(false); };
      pw.append(pcb, tr(' 電源網路（紅 VDD、藍 VSS）', ' power grid (red VDD, blue VSS)'));
      div.appendChild(pw);
      [tr('M2 水平', 'M2 horizontal'), tr('M3 垂直', 'M3 vertical'), tr('M4 水平', 'M4 horizontal'), tr('M5 垂直', 'M5 vertical')].forEach((name, l) => {
        const lab = document.createElement('label');
        lab.style.display = 'block';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = this.layers[l];
        cb.onchange = () => { this.layers[l] = cb.checked; this.drawAsic(false); };
        lab.append(cb, ` `, Object.assign(document.createElement('span'), { className: 'sw', style: `background:${LAYER_COLOR[l]}` }), `${name}　${(d.per_layer[l] / 1000).toFixed(2)} mm`);
        div.appendChild(lab);
      });
      if (d.nets.length) {
        const h = document.createElement('h3');
        h.textContent = tr(`Net（${d.nets.length}，依線長）`, `Nets (${d.nets.length}, by length)`);
        div.appendChild(h);
        const list = document.createElement('div');
        list.className = 'clist';
        const order = d.nets.map((_, i) => i).sort((x, y) => d.nets[y].len - d.nets[x].len);
        for (const i of order.slice(0, 400)) {
          const n = d.nets[i];
          const row = document.createElement('div');
          row.textContent = `${n.name}  ${n.len.toFixed(1)} µm  ${n.vias.length / 3} via`;
          row.onclick = () => { this.selNetD = i; this.drawAsic(false); };
          list.appendChild(row);
        }
        div.appendChild(list);
      }
    } else if (key === 'asta') {
      div.innerHTML = `<h3>${tr('關鍵路徑', 'Critical path')}（${a.timing.period.toFixed(3)} ns）</h3>` + table([tr('累計 ns', 'At ns'), tr('延遲', 'Delay'), tr('經過', 'Through')], a.timing.path.map(s => [s.at.toFixed(3), s.delay.toFixed(3), esc(s.what)]));
    } else if (key === 'aroute') {
      div.innerHTML = `<h3>${tr(`Net（${a.route.nets.length}，依線長）`, `Nets (${a.route.nets.length}, by length)`)}</h3>`;
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
      const areaOf = new Map<string, number>();
      a.cells.forEach(([, , w, , , h], i) => { const t = a.map.cells[i].t; areaOf.set(t, (areaOf.get(t) ?? 0) + w * a.die.site_w * h * a.die.row_h); });
      div.innerHTML = `<h3>${tr('元件數量', 'Cell counts')}</h3>` + table([tr('元件', 'Cell'), tr('數量', 'Count'), tr('面積 µm²', 'Area µm²')], a.counts.map(([t, n]) => [`<span class="sw" style="background:${stdColor(t)}"></span>${t}`, String(n), (areaOf.get(t) ?? 0).toFixed(0)]));
    }
    div.insertAdjacentHTML('beforeend', `<h3>${tr('IO 腳', 'IO pins')}</h3>` + table([tr('訊號', 'Signal'), tr('方向', 'Dir'), 'x µm', 'y µm'], a.pins.map(p => [esc(p.name), p.dir, p.x.toFixed(1), p.y.toFixed(1)])));
    d.appendChild(div);
    return d;
  }

  private stdDetail(): void {
    const det = document.getElementById('synDetail');
    if (!det || !this.asic) return;
    if (this.sel === null) { det.innerHTML = `<p class="hint">${tr('點元件看細節（種類、位置、接腳訊號、到達時間）。', 'Click a cell for details (type, position, pin signals, arrival time).')}</p>`; return; }
    const a = this.asic;
    const v = this.netView('amap');
    const c = a.map.cells[this.sel];
    const [row, site, w, arr, crit] = a.cells[this.sel];
    const lib = a.lib.find(l => l.name === c.t);
    let h = `<h3><span class="sw" style="background:${stdColor(c.t)}"></span>#${this.sel} ${c.t}${crit ? tr('（關鍵路徑）', ' (critical path)') : ''}</h3>`;
    h += `<p>${tr(`第 ${row} 列，site ${site}–${site + w - 1}（x = ${(site * a.die.site_w).toFixed(1)} µm）<br>輸出到達時間 ${arr.toFixed(3)} ns`, `Row ${row}, sites ${site}–${site + w - 1} (x = ${(site * a.die.site_w).toFixed(1)} µm)<br>output arrival ${arr.toFixed(3)} ns`)}</p>`;
    if (lib) h += `<p><code>${esc(lib.verilog)}</code></p>`;
    if (c.t === 'SRAM') {
      const n = (k: string) => parseInt(c.p?.[k] ?? '0', 2);
      h += `<p>${tr(`SRAM 巨集（記憶體編譯器產生的硬巨集）：${n('DEPTH')} 字 × ${n('WIDTH')} bit，一個寫入埠、一個同步讀取埠（RA 在 CK 正緣取樣，RDATA 下一拍有效）；佔 ${w} site × ${a.cells[this.sel][5]} 列。`, `SRAM macro (a hard macro from a memory compiler): ${n('DEPTH')} words × ${n('WIDTH')} bits, one write port and one synchronous read port (RA sampled on the CK rising edge, RDATA valid the next cycle); ${w} sites × ${a.cells[this.sel][5]} rows.`)}</p>`;
    }
    h += table([tr('接腳', 'Pin'), tr('訊號', 'Signal')], c.c.map(([p, b]) => [p, esc(bitName(v.names, b))]));
    det.innerHTML = h;
  }

  private stopAnim(): void { if (this.anim) { clearTimeout(this.anim); this.anim = 0; } }

  private redrawLines(): void {
    const eb = $('synEdges');
    eb.classList.toggle('on', this.edges);
    if (this.opts.embedded) eb.title = tr(`連線：${this.edges ? '開' : '關'}`, `Wires: ${this.edges ? 'on' : 'off'}`);
    else eb.textContent = tr(`⌁ 連線：${this.edges ? '開' : '關'}`, `⌁ Wires: ${this.edges ? 'on' : 'off'}`);
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
    const ffs = v.nl.cells.filter(c => c.t.includes("DFF")).length;
    const big = edgeCount(v.nl) > 6000 ? tr('（連線太多：只畫選取元件的扇入/扇出）', '(too many wires: only the selected cell\'s fan-in / fan-out is drawn)') : '';
    if (key === 'raw') return [
      '② Logic Netlist',
      tr('每個 assign / always_comb / always_ff 經「符號執行」變成 2 輸入閘、MUX 與 DFF：if/case → MUX（常數標籤的 case → 平行 one-hot），for 展開，function 內嵌，always_ff → $_DFF_* / $_SDFF_*。', 'Every assign / always_comb / always_ff is symbolically executed into 2-input gates, MUXes and DFFs: if/case → MUX (case with constant labels → parallel one-hot), for loops unrolled, functions inlined, always_ff → $_DFF_* / $_SDFF_*.'),
      tr('建閘時就做局部常數摺疊與 structural hashing；這裡已解析佔位別名，但還沒做整體最佳化。', 'Local constant folding and structural hashing happen while the gates are built; placeholder aliases are resolved here, but nothing is optimized globally yet.'),
      '',
      tr(`${v.nl.cells.length} 個元件：${types}`, `${v.nl.cells.length} cells: ${types}`),
      tr(`組合邏輯深度 ${v.lev.depth} 層，DFF ${ffs} 個 ${big}`, `combinational depth ${v.lev.depth}, ${ffs} DFFs ${big}`),
    ];
    if (key === 'opt') {
      const nraw = cellCount(r.raw);
      const d = nraw - r.opt.cells.length;
      const rf = r.raw.n !== undefined ? Object.entries(r.raw.types ?? {}).filter(([t]) => t.includes('DFF')).reduce((x, [, n]) => x + n, 0) : r.raw.cells.filter(c => c.t.includes("DFF")).length;
      return [
        tr('③ Tech-indep Syn（與技術無關的最佳化）', '③ Tech-indep Syn (technology-independent optimization)'),
        tr('依拓撲順序重建整個網表：常數傳播、structural hashing、x&!x 等化簡、組合迴路檢查、移除不影響輸出的邏輯；', 'The whole netlist is rebuilt in topological order: constant propagation, structural hashing, simplifications such as x&!x, combinational loop check, removal of logic that does not reach an output;'),
        tr('反覆「證明常數節點」（隨機模擬找候選、對 ≤16 個輸入窮舉證明）並移除卡在 0 的暫存器。', 'repeatedly proving constant nodes (candidates from random simulation, exhaustive proof over ≤16 inputs) and removing registers stuck at 0.'),
        '',
        tr(`${nraw} → ${v.nl.cells.length} 個元件（少了 ${d}，${(100 * d / Math.max(1, nraw)).toFixed(1)}%）；DFF ${rf} → ${ffs}`, `${nraw} → ${v.nl.cells.length} cells (${d} fewer, ${(100 * d / Math.max(1, nraw)).toFixed(1)}%); DFF ${rf} → ${ffs}`),
        `${types}`,
        tr(`組合邏輯深度 ${v.lev.depth} 層 ${big}`, `combinational depth ${v.lev.depth} ${big}`),
      ];
    }
    if (key === 'amap') {
      const a = this.asic!;
      const bufs = v.nl.cells.filter(c => c.t === 'BUF').length;
      return [
        tr('A ④ Standard Cell Map（vlib：列高 4.0 µm、site 0.5 µm，約 130 nm 慢速角）', 'A ④ Standard Cell Map (vlib: row height 4.0 µm, site 0.5 µm, about a 130 nm slow corner)'),
        tr('把網表在多扇出點切成樹，對每棵樹做動態規劃的 tree covering（最小面積）：反相器併入 NAND2 / NOR2 / XNOR2 / AOI21 / OAI21；同步 set/reset 變成 D 前的邏輯，非同步的用 DFFR / DFFS（低態有效，必要時加 INV）；扇出 > 12 的訊號插入 BUF 樹；同步讀取的記憶體變成 SRAM 巨集（每個讀取埠一個）。', 'The netlist is cut into trees at multi-fanout points and each tree is covered by dynamic programming (minimum area): inverters merge into NAND2 / NOR2 / XNOR2 / AOI21 / OAI21; synchronous set/reset becomes logic before D, asynchronous ones use DFFR / DFFS (active low, INV added when needed); signals with fanout > 12 get BUF trees; memories with synchronous reads become SRAM macros (one per read port).'),
        '',
        `${types}`,
        tr(`元件面積 ${fmtArea(a.area)}，BUF ${bufs} 個，組合邏輯深度 ${v.lev.depth} 層 ${big}`, `cell area ${fmtArea(a.area)}, ${bufs} BUFs, combinational depth ${v.lev.depth} ${big}`),
      ];
    }
    const luts = v.nl.cells.filter(c => c.t === 'SB_LUT4');
    const hist = [0, 0, 0, 0, 0];
    luts.forEach(c => hist[lutInputs(c)]++);
    return [
      '④ LUT4 Techmap（iCE40）',
      tr('全加器進位 (a&b)|((a^b)&c) 對到硬體進位鏈 SB_CARRY；其餘以 cut-based 方式覆蓋成 4 輸入 LUT（先求最淺、再看 area flow）；DFF → SB_DFF[N][S]{R,S}。', 'Full-adder carries (a&b)|((a^b)&c) map to the hardware carry chain SB_CARRY; the rest is covered by 4-input LUTs, cut-based (depth first, then area flow); DFF → SB_DFF[N][S]{R,S}.'),
      '',
      `${types}`,
      `${tr('LUT 輸入數分布：', 'LUT inputs: ')}${hist.map((n, i) => tr(`${i} 入 ${n}`, `${i}-in ${n}`)).filter((_, i) => i > 0).join('  ')}`,
      `${tr('LUT 層數', 'LUT levels')} ${v.lev.depth} ${big}`,
    ];
  }

  /** the stage's report; clears the progress line */
  private info(lines: string[]): void {
    $('synInfo').textContent = lines.join('\n');
    const m = document.getElementById('synMsg');
    if (m) { m.textContent = m.title = ''; m.classList.remove('err'); }
  }

  /** progress or an error: the IDE's flow bar has a line for it (#synMsg), the demo shows it as the report */
  private note(text: string, err = false): void {
    const m = document.getElementById('synMsg');
    if (m) {
      m.textContent = text.replace(/\s*\n\s*/g, ' ');
      m.title = text;
      m.classList.toggle('err', err);
      if (!err) return;
    }
    $('synInfo').textContent = text;
  }

  private side(html: HTMLElement): void {
    const s = $('synSide');
    s.innerHTML = '';
    s.appendChild(html);
  }

  private rtlSide(): HTMLElement {
    const r = this.res!;
    const d = document.createElement('div');
    d.innerHTML = `<h3>${tr('埠', 'Ports')}</h3>` + table([tr('名稱', 'Name'), tr('方向', 'Dir'), tr('寬度', 'Width')], r.ports.map(p => [esc(p.name), p.dir === 'in' ? 'input' : 'output', String(p.width)]))
      + `<h3>${tr('實例', 'Instances')}</h3>` + table([tr('路徑', 'Path'), tr('模組', 'Module')], r.hier.map(h => [esc(h.path || '(top)'), esc(h.module)]))
      + `<h3>${tr('訊號', 'Signals')}（${r.signals.length}）</h3>` + table([tr('名稱', 'Name'), tr('寬度', 'Width')], r.signals.slice(0, 400).map(s => [esc(s.name), String(s.width)]));
    return d;
  }

  private netSide(v: NetView): HTMLElement {
    const d = document.createElement('div');
    const types = countTypes(v.nl);
    d.innerHTML = `<h3>${tr('元件種類', 'Cell types')}</h3>` + table([tr('種類', 'Type'), tr('數量', 'Count')], types.map(([t, n]) => [`<span class="sw" style="background:${cellColor(t, 4)}"></span>${shortType(t)}`, String(n)]))
      + `<h3>${tr('元件清單（點選）', 'Cells (click one)')}</h3>`;
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
    if (v.nl.cells.length > n) { const m = document.createElement('div'); m.className = 'more'; m.textContent = tr(`… 共 ${v.nl.cells.length} 個（點圖上的方塊看其他元件）`, `… ${v.nl.cells.length} in all (click a box in the drawing for the others)`); list.appendChild(m); }
    d.appendChild(list);
    if (v.nl === this.asic?.map) {
      const lib = document.createElement('div');
      lib.innerHTML = `<h3>${tr('vlib 元件庫', 'vlib cell library')}</h3>` + table([tr('元件', 'Cell'), tr('寬', 'Width'), tr('面積 µm²', 'Area µm²'), tr('延遲 ns', 'Delay ns'), tr('+每扇出', '+per fanout'), tr('功能', 'Function')],
        this.asic.lib.map(c => [`<span class="sw" style="background:${stdColor(c.name)}"></span>${c.name}`, String(c.width), c.area.toFixed(0), c.delay.toFixed(3), c.load.toFixed(3), esc(c.verilog.replace(/^assign Y = |;$/g, ''))]));
      d.appendChild(lib);
    }
    const det = document.createElement('div');
    det.id = 'synDetail';
    det.innerHTML = `<p class="hint">${tr('點圖上的元件看細節：接腳、所連訊號、LUT 真值表。', 'Click a cell in the drawing for details: pins, connected signals, LUT truth table.')}</p>`;
    d.prepend(det);
    return d;
  }

  private pick(b: Box | null): void {
    const k = this.stage;
    if (k === 'cmp') return;
    if (PNR.has(k)) {
      if (!this.pnr || this.anim) return;
      const n = this.pnr.lcs.length + this.pnr.ios.length;
      this.sel = b && (b.id < this.pnr.lcs.length || b.id >= n) ? b.id : null;
      this.drawPnr(false);
      if (this.sel !== null && this.sel >= n) this.ramDetail(this.sel - n); else this.lcDetail();
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

  private ramDetail(k: number): void {
    const det = document.getElementById('synDetail');
    if (!det || !this.pnr) return;
    const r = this.pnr.rams[k];
    let h = `<h3><span class="sw" style="background:${RAM_COLOR}"></span>block RAM #${k}　tile (${r.x},${r.y})–(${r.x},${r.y + 1})</h3>`;
    h += `<p>${tr(`SB_RAM40_4K（4 Kbit），讀 ${r.read}、寫 ${r.write}；同步讀取：RADDR 在 RCLK 正緣取樣，RDATA 下一拍有效。`, `SB_RAM40_4K (4 Kbit), read ${r.read}, write ${r.write}; synchronous read: RADDR sampled on the RCLK rising edge, RDATA valid the next cycle.`)}</p>`;
    h += table([tr('接腳', 'Pin'), tr('訊號', 'Signal')], [...r.ins.map(([p, n]) => [p, esc(n)]), ...r.outs.map(([p, n]) => [p + ' →', esc(n)])]);
    det.innerHTML = h;
  }

  private lcDetail(): void {
    const det = document.getElementById('synDetail');
    if (!det || !this.pnr) return;
    if (this.sel === null) { det.innerHTML = `<p class="hint">${tr('點 LC 看細節（LUT 真值表、DFF、接腳訊號、到達時間）。', 'Click an LC for details (LUT truth table, DFF, pin signals, arrival time).')}</p>`; return; }
    const lc = this.pnr.lcs[this.sel];
    const init = parseInt(lc.init, 16).toString(2).padStart(16, '0');
    let h = `<h3>LC #${this.sel}　tile (${lc.x},${lc.y}) LC ${lc.z}</h3>`;
    h += `<p><span class="sw" style="background:${lcColor(lc)}"></span>${lc.carry ? 'CARRY ' : ''}${lc.ff ? `DFF${lc.ff.neg ? tr('（負緣）', ' (falling edge)') : ''}${lc.ff.sr ? (lc.ff.async ? tr('（非同步', ' (async') : tr('（同步', ' (sync')) + (lc.ff.set ? tr(' set）', ' set)') : tr(' reset）', ' reset)')) : ''} ` : ''}LUT 16'h${lc.init}${lc.in3c ? tr('（in3 = 進位鏈）', ' (in3 = carry chain)') : ''}</p>`;
    h += `<p>${tr('輸出到達時間', 'Output arrival')} ${lc.arr.toFixed(2)} ns</p>`;
    h += table([tr('接腳', 'Pin'), tr('訊號', 'Signal')], [...lc.ins.map((n, k) => [`in${k}`, esc(k === 3 && lc.in3c ? '(carry in)' : n || '—')]), ['out', esc(lc.out || '—')]]);
    h += `<h3>${tr('LUT 真值表', 'LUT truth table')}</h3>` + table(['I3 I2 I1 I0', 'O'], lutBits(init).map((o, k) => [`${(k >> 3) & 1}  ${(k >> 2) & 1}  ${(k >> 1) & 1}  ${k & 1}`, String(o)]));
    det.innerHTML = h;
  }

  private select(i: number | null): void {
    this.sel = i;
    this.redrawLines();
    const det = document.getElementById('synDetail');
    const k = this.stage;
    if (!det || !isNet(k)) return;
    if (i === null) { det.innerHTML = `<p class="hint">${tr('點圖上的元件看細節：接腳、所連訊號、LUT 真值表。', 'Click a cell in the drawing for details: pins, connected signals, LUT truth table.')}</p>`; return; }
    const v = this.netView(k);
    const c = v.nl.cells[i];
    let h = `<h3>#${i} ${c.t}</h3><p>${tr('層級', 'Level')} L${v.lev.level[i]}</p>`;
    h += table([tr('接腳', 'Pin'), tr('訊號', 'Signal'), tr('來源', 'Source')], c.c.map(([p, b]) => {
      const src = typeof b === 'number' && !isOut(p) ? (v.lev.driver.has(b) ? `#${v.lev.driver.get(b)} ${shortType(v.nl.cells[v.lev.driver.get(b)!].t)}` : tr('輸入埠', 'input port')) : isOut(p) ? tr(`→ ${(typeof b === 'number' ? v.lev.users.get(b)?.length ?? 0 : 0)} 個負載`, `→ ${(typeof b === 'number' ? v.lev.users.get(b)?.length ?? 0 : 0)} loads`) : tr('常數', 'constant');
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

/** the FPGA STA's path steps (written in Chinese by veryl-eda) in the current language */
function stepText(w: string): string {
  let m = /^繞線 (.*)（(\d+) 段）$/.exec(w);
  if (m) return tr(w, `route ${m[1]} (${m[2]} segments)`);
  m = /^(輸出|輸入)腳 (.*)$/.exec(w);
  if (m) return tr(w, `${m[1] === '輸出' ? 'output' : 'input'} pin ${m[2]}`);
  return w;
}

function esc(s: string): string { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;'); }

function table(head: string[], rows: string[][]): string {
  return `<table><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</table>`;
}

function download(name: string, data: string | Uint8Array): void {
  saveAs(name, data, typeof data === 'string' ? 'text/plain' : 'application/octet-stream');
}

function fmtArea(um2: number): string {
  return um2 >= 1e5 ? `${(um2 / 1e6).toFixed(3)} mm²` : `${um2.toFixed(0)} µm²`;
}
