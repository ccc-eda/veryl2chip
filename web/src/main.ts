// veryl2chip web environment: page controller.

import { fromBase64, ModuleInfo, SimResult, VFile } from './api';
import { Core, startCore } from './client';
import { Example, examples } from './examples';
import { SynthOverlay } from './synth/overlay';

declare const VERYL_WASM_B64: string;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

interface State {
  ex: Example;
  files: VFile[];
  cur: number;
}

let core: Core | null = null;
let synth: SynthOverlay | null = null;
let st: State | null = null;

function store(): Storage | null {
  try { return window.localStorage; } catch { return null; }
}

function savedFiles(ex: Example): VFile[] {
  try {
    const s = store()?.getItem('veryl2chip:' + ex.id);
    if (s) {
      const v = JSON.parse(s) as VFile[];
      if (Array.isArray(v) && v.length === ex.files.length) return v;
    }
  } catch { /* ignore */ }
  return ex.files.map(f => ({ ...f }));
}

function persist(): void {
  if (!st) return;
  try {
    const same = st.files.every((f, i) => f.src === st!.ex.files[i].src);
    if (same) store()?.removeItem('veryl2chip:' + st.ex.id);
    else store()?.setItem('veryl2chip:' + st.ex.id, JSON.stringify(st.files));
  } catch { /* storage unavailable */ }
}

function status(s: string): void { $('status').textContent = s; }

function renderTabs(): void {
  const tabs = $('tabs');
  tabs.innerHTML = '';
  st!.files.forEach((f, i) => {
    const b = document.createElement('button');
    b.textContent = f.name;
    if (i === st!.cur) b.classList.add('cur');
    if (f.src !== st!.ex.files[i].src) b.classList.add('dirty');
    b.onclick = () => { st!.cur = i; showFile(); };
    tabs.appendChild(b);
  });
}

function gutter(): void {
  const ed = $<HTMLTextAreaElement>('editor');
  const n = ed.value.split('\n').length;
  let s = '';
  for (let i = 1; i <= n; i++) s += i + '\n';
  $('gutter').textContent = s;
  $('gutter').scrollTop = ed.scrollTop;
}

function showFile(): void {
  const ed = $<HTMLTextAreaElement>('editor');
  ed.value = st!.files[st!.cur].src;
  ed.scrollTop = 0;
  renderTabs();
  gutter();
}

async function refreshTops(): Promise<void> {
  const sel = $<HTMLSelectElement>('top');
  const keep = sel.value;
  if (!core || !st) return;
  let mods: ModuleInfo[] = [];
  try { mods = (await core.call<{ modules: ModuleInfo[] }>({ cmd: 'list', files: st.files })).modules; } catch { /* parse errors show up when running */ }
  sel.innerHTML = '';
  const all = document.createElement('option');
  all.value = '';
  all.textContent = '全部 #[test]';
  sel.appendChild(all);
  for (const m of mods) {
    const o = document.createElement('option');
    o.value = m.name;
    o.textContent = m.name + (m.test ? '  (#[test])' : '');
    sel.appendChild(o);
  }
  if (mods.some(m => m.name === keep)) sel.value = keep;
}

function selectExample(id: string): void {
  const ex = examples().find(e => e.id === id) ?? examples()[0];
  if (!ex) return;
  st = { ex, files: savedFiles(ex), cur: 0 };
  $<HTMLSelectElement>('example').value = ex.id;
  $('exnote').textContent = ex.note ?? '';
  try { history.replaceState(null, '', '#ex=' + ex.id); } catch { /* file:// in some browsers */ }
  showFile();
  refreshTops();
  $('log').textContent = '';
  $('msg').textContent = '';
  $('banner').className = 'hidden';
}

/** select `line` (1-based) of file `name` in the editor */
function jumpTo(name: string, line: number, col: number): void {
  if (!st) return;
  const i = st.files.findIndex(f => f.name === name);
  if (i < 0) return;
  st.cur = i;
  showFile();
  const ed = $<HTMLTextAreaElement>('editor');
  const lines = ed.value.split('\n');
  let off = 0;
  for (let k = 0; k < line - 1 && k < lines.length; k++) off += lines[k].length + 1;
  const end = off + (lines[line - 1]?.length ?? 0);
  ed.focus();
  ed.setSelectionRange(off + Math.max(0, col - 1), end);
  ed.scrollTop = Math.max(0, (line - 6) * 17.4);
  gutter();
}

/** show an error; `file:line:col:` prefixes become links into the editor */
function showError(text: string): void {
  const msg = $('msg');
  msg.innerHTML = '';
  for (const ln of text.split('\n')) {
    const m = /^([\w./-]+\.veryl):(\d+):(\d+):/.exec(ln);
    const div = document.createElement('div');
    if (m) {
      const a = document.createElement('a');
      a.href = '#';
      a.textContent = m[0];
      a.onclick = e => { e.preventDefault(); jumpTo(m[1], +m[2], +m[3]); };
      div.append(a, ln.slice(m[0].length));
    } else div.textContent = ln;
    msg.appendChild(div);
  }
}

async function runSim(): Promise<void> {
  if (!core || !st) return;
  const top = $<HTMLSelectElement>('top').value || null;
  status('模擬中…');
  $('msg').textContent = '';
  $<HTMLButtonElement>('run').disabled = true;
  {
    const t0 = performance.now();
    const banner = $('banner');
    try {
      const r = await core.call<SimResult>({ cmd: 'simulate', files: st.files, top, max_time: 1_000_000, vcd: false });
      $('log').textContent = r.log;
      const fails = r.tops.reduce((a, t) => a + t.fails, 0);
      banner.className = fails ? 'fail' : 'pass';
      banner.textContent = fails
        ? `✗ ${fails} 個斷言失敗（${r.tops.filter(t => t.fails).map(t => t.name).join(', ')}）`
        : `✓ PASS：${r.tops.map(t => t.name).join(', ')}`;
      status(`模擬完成 ${(performance.now() - t0).toFixed(0)} ms`);
    } catch (e) {
      banner.className = 'fail';
      banner.textContent = '✗ 錯誤';
      $('log').textContent = '';
      showError(String((e as Error).message ?? e));
      const m = /^([\w./-]+\.veryl):(\d+):(\d+):/.exec(String((e as Error).message));
      if (m) jumpTo(m[1], +m[2], +m[3]);
      status('失敗');
    }
    $<HTMLButtonElement>('run').disabled = false;
  }
}

function fillExamples(): void {
  const sel = $<HTMLSelectElement>('example');
  const groups = new Map<string, HTMLOptGroupElement>();
  for (const ex of examples()) {
    let g = groups.get(ex.group);
    if (!g) { g = document.createElement('optgroup'); g.label = ex.group; groups.set(ex.group, g); sel.appendChild(g); }
    const o = document.createElement('option');
    o.value = ex.id;
    o.textContent = ex.title;
    g.appendChild(o);
  }
  sel.onchange = () => selectExample(sel.value);
}

function wire(): void {
  const ed = $<HTMLTextAreaElement>('editor');
  ed.addEventListener('input', () => {
    st!.files[st!.cur].src = ed.value;
    persist();
    gutter();
    renderTabs();
  });
  ed.addEventListener('scroll', () => { $('gutter').scrollTop = ed.scrollTop; });
  ed.addEventListener('change', refreshTops);
  ed.addEventListener('keydown', e => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const s = ed.selectionStart;
      ed.setRangeText('    ', s, ed.selectionEnd, 'end');
      ed.dispatchEvent(new Event('input'));
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      runSim();
    }
  });
  $('run').onclick = runSim;
  $('synth').onclick = () => { if (synth && st) synth.open(st.files, st.ex.synth, st.ex.pcf); };
  $('revert').onclick = () => {
    if (!st) return;
    st.files = st.ex.files.map(f => ({ ...f }));
    persist();
    showFile();
    refreshTops();
  };
}

async function boot(): Promise<void> {
  const hash = location.hash;
  fillExamples();
  wire();
  const id = /ex=([\w-]+)/.exec(hash)?.[1] ?? 'seq101';
  selectExample(id);
  window.addEventListener('hashchange', () => {
    const h = /ex=([\w-]+)/.exec(location.hash)?.[1];
    if (h && h !== st?.ex.id) selectExample(h);
  });
  try {
    const t0 = performance.now();
    core = await startCore(fromBase64(VERYL_WASM_B64));
    status(`就緒（WebAssembly 載入 ${(performance.now() - t0).toFixed(0)} ms${core.inWorker ? '，背景執行緒' : ''}）`);
    $<HTMLButtonElement>('run').disabled = false;
    $<HTMLButtonElement>('synth').disabled = false;
    synth = new SynthOverlay(core);
    if (/[#&]synth=1/.test(hash)) synth.open(st!.files, st!.ex.synth, st!.ex.pcf);
    refreshTops();
  } catch (e) {
    status('WebAssembly 載入失敗');
    $('msg').textContent = String(e);
  }
}

boot();
