// veryl2chip IDE (M11): a VS Code style workbench over the same WebAssembly
// core as the demo page — projects of .veryl files kept in the browser,
// live syntax checking, tests (RTL and gate-level), and every synthesis
// stage of the FPGA and ASIC flows as an editor tab.

import { fromBase64, ModuleInfo, SimResult, VFile } from '../api';
import { Core, startCore } from '../client';
import { Example, examples } from '../examples';
import { SynthOverlay } from '../synth/overlay';
import { newModule, projectZip } from '../templates';
import { WaveView } from '../wave';
import { saveAs } from '../zip';
import { CodeEditor, Marker } from './editor';

declare const VERYL_WASM_B64: string;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const mod = (e: KeyboardEvent) => e.ctrlKey || e.metaKey;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ---------------------------------------------------------------- projects

interface Project {
  id: string;
  name: string;
  files: VFile[];
  /** module synthesized by default */
  synth?: string;
  /** pin constraints for the FPGA flow */
  pcf?: string;
  /** example it was opened from */
  from?: string;
  open?: string[];
  active?: string;
}

const KEY = 'veryl2chip-ide:';
function store(): Storage | null { try { return window.localStorage; } catch { return null; } }
function load<T>(k: string, d: T): T { try { const s = store()?.getItem(KEY + k); return s ? JSON.parse(s) as T : d; } catch { return d; } }
function save(k: string, v: unknown): void { try { store()?.setItem(KEY + k, JSON.stringify(v)); } catch { /* storage full or blocked */ } }

let projects: Project[] = load<Project[]>('projects', []).filter(p => p && Array.isArray(p.files));
let proj: Project;
let saveTimer = 0;
function persist(): void {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => { save('projects', projects); save('cur', proj.id); }, 300);
}

function uid(): string { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

function fromExample(ex: Example): Project {
  return { id: uid(), name: ex.title, files: ex.files.map(f => ({ ...f })), synth: ex.synth, pcf: ex.pcf, from: ex.id, open: [ex.files[0].name], active: ex.files[0].name };
}

function blankProject(name: string): Project {
  const m = (name.replace(/[^A-Za-z0-9_]/g, '').replace(/^[^A-Za-z]+/, '') || 'Top');
  const top = m[0].toUpperCase() + m.slice(1);
  const f = `${top.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()}.veryl`;
  return { id: uid(), name, files: [{ name: f, src: newModule(top) }], synth: top, open: [f], active: f };
}

// ---------------------------------------------------------------- state

let core: Core | null = null;
let synth: SynthOverlay | null = null;
let wave: WaveView | null = null;
let ed: CodeEditor;
let vcds: { top: string; text: string }[] = [];
let mods: ModuleInfo[] = [];
let problems: { file?: string; line?: number; col?: number; msg: string; severity: 'error' | 'warning'; from: 'check' | 'run' }[] = [];
let testState = new Map<string, 'pass' | 'fail' | 'run'>();
/** files + top of the last synthesis, to know when the flow views are stale */
let synthKey = '';
let busy = 0;

const FPGA_FLOW: [string, string][] = [
  ['rtl', '共 ① RTL→Logic'], ['raw', '共 ② Logic Netlist'], ['opt', '共 ③ Tech-indep Syn'],
  ['map', 'F ④ LUT4 Techmap'], ['place', 'F ⑤ Placement 退火'], ['route', 'F ⑥ Global+Detail Routing'], ['sta', 'F ⑦ Timing (STA)'],
];
const ASIC_FLOW: [string, string][] = [
  ...FPGA_FLOW.slice(0, 3),
  ['amap', 'A ④ Standard Cell Map'], ['aplace', 'A ⑤ Row Placement 退火'], ['aroute', 'A ⑥ CTS + Global Routing'],
  ['adetail', 'A ⑦ Detail Routing'], ['asta', 'A ⑧ Timing (STA)'], ['apower', 'A ⑨ Power + IR Drop'],
];
const FLOW_TAB = '⚙ 合成流程';
const WELCOME = '歡迎';

function file(name: string): VFile | undefined { return proj.files.find(f => f.name === name); }
function original(name: string): string | undefined {
  return proj.from ? examples().find(e => e.id === proj.from)?.files.find(f => f.name === name)?.src : undefined;
}

// ---------------------------------------------------------------- editor tabs

function openTabs(): string[] { return (proj.open ??= []); }

function openFile(name: string, line?: number, col?: number): void {
  if (name !== FLOW_TAB && name !== WELCOME && !file(name)) return;
  if (!openTabs().includes(name)) openTabs().push(name);
  proj.active = name;
  persist();
  showActive();
  if (line && name !== FLOW_TAB) ed.goto(line, col ?? 1, true);
}

function closeTab(name: string): void {
  const t = openTabs();
  const i = t.indexOf(name);
  if (i < 0) return;
  t.splice(i, 1);
  if (proj.active === name) proj.active = t[Math.min(i, t.length - 1)];
  persist();
  showActive();
}

function showActive(): void {
  let a = proj.active;
  if (a && a !== FLOW_TAB && a !== WELCOME && !file(a)) a = undefined;
  if (!a) a = openTabs().find(n => n === FLOW_TAB || file(n)) ?? WELCOME;
  proj.active = a;
  if (!openTabs().includes(a)) openTabs().push(a);
  const isFile = !!file(a);
  $('editorHost').classList.toggle('hidden', !isFile);
  $('synOverlay').classList.toggle('hidden', a !== FLOW_TAB);
  $('welcome').classList.toggle('hidden', a !== WELCOME);
  if (isFile) {
    if (ed.value !== file(a)!.src || $('editorHost').dataset.file !== a) { ed.value = file(a)!.src; $('editorHost').dataset.file = a; }
    markers();
    ed.focus();
  } else {
    $('editorHost').dataset.file = '';
    $('sbPos').textContent = '';
  }
  if (a === WELCOME) welcome();
  renderTabs();
  renderFiles();
}

function renderTabs(): void {
  const box = $('edTabs');
  box.innerHTML = '';
  for (const n of openTabs()) {
    const t = document.createElement('div');
    const f = file(n);
    const errs = problems.some(p => p.file === n && p.severity === 'error');
    t.className = 'tab' + (n === proj.active ? ' cur' : '') + (f && original(n) !== undefined && original(n) !== f.src ? ' dirty' : '') + (errs ? ' err' : '');
    t.innerHTML = `<span class="ic">${n === FLOW_TAB ? '' : n === WELCOME ? '★' : f?.name.endsWith('.veryl') ? '◆' : '▤'}</span><span class="nm">${esc(n)}</span><span class="x" title="關閉"></span>`;
    t.onclick = () => { proj.active = n; persist(); showActive(); };
    t.onauxclick = e => { if (e.button === 1) closeTab(n); };
    t.querySelector('.x')!.addEventListener('click', e => { e.stopPropagation(); closeTab(n); });
    box.appendChild(t);
    if (n === proj.active) setTimeout(() => t.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
  }
}

// ---------------------------------------------------------------- explorer

function renderProjects(): void {
  const sel = $<HTMLSelectElement>('projSel');
  sel.innerHTML = '';
  for (const p of projects) {
    const o = document.createElement('option');
    o.value = p.id;
    o.textContent = p.name;
    sel.appendChild(o);
  }
  sel.value = proj.id;
}

function renderFiles(): void {
  const box = $('fileList');
  box.innerHTML = '';
  for (const f of proj.files) {
    const d = document.createElement('div');
    const n = problems.filter(p => p.file === f.name && p.severity === 'error').length;
    const changed = original(f.name) !== undefined && original(f.name) !== f.src;
    d.className = 'item' + (f.name === proj.active ? ' cur' : '');
    d.innerHTML = `<span class="ic">${f.name.endsWith('.veryl') ? '◆' : '▤'}</span><span class="nm">${esc(f.name)}</span>`
      + `<span class="acts"><button class="icon" data-a="ren" title="重新命名">✎</button><button class="icon" data-a="del" title="刪除">🗑</button></span>`
      + (n ? `<span class="tag" style="color:var(--err)">${n}</span>` : changed ? '<span class="tag dirty-dot" title="與範例原始碼不同">M</span>' : '');
    d.onclick = e => {
      const a = (e.target as HTMLElement).dataset.a;
      if (a === 'ren') renameFile(f.name); else if (a === 'del') deleteFile(f.name); else openFile(f.name);
    };
    box.appendChild(d);
  }
  renderOutline();
}

/** modules, interfaces and packages of the project with their line */
function declarations(): { kind: string; name: string; file: string; line: number; test: boolean }[] {
  const out: { kind: string; name: string; file: string; line: number; test: boolean }[] = [];
  for (const f of proj.files) {
    const ls = f.src.split('\n');
    ls.forEach((l, i) => {
      const m = /^\s*(?:pub\s+)?(module|interface|package)\s+([A-Za-z_]\w*)/.exec(l);
      if (m) out.push({ kind: m[1], name: m[2], file: f.name, line: i + 1, test: i > 0 && /#\[test/.test(ls[i - 1] + (ls[i - 2] ?? '')) });
    });
  }
  return out;
}

function renderOutline(): void {
  const box = $('outline');
  box.innerHTML = '';
  for (const d of declarations()) {
    const el = document.createElement('div');
    const top = d.kind === 'module' && d.name === synthTop();
    el.className = 'item';
    el.innerHTML = `<span class="ic">${d.kind === 'module' ? (d.test ? '✔' : '▣') : d.kind === 'interface' ? '⇄' : '{}'}</span><span class="nm">${esc(d.name)}</span><span class="tag">${top ? '合成頂層' : d.test ? 'test' : d.kind === 'module' ? '' : d.kind}</span>`;
    el.title = `${d.file}:${d.line}`;
    el.onclick = () => openFile(d.file, d.line);
    box.appendChild(el);
  }
}

function validName(name: string): string | null {
  if (!/^[\w.-]+$/.test(name)) return '檔名只能用英數字、底線、點和減號';
  if (file(name)) return `已經有 ${name}`;
  return null;
}

function newFile(): void {
  let name = prompt('新檔名（.veryl）', `module${proj.files.length}.veryl`)?.trim();
  if (!name) return;
  if (!/\.\w+$/.test(name)) name += '.veryl';
  const bad = validName(name);
  if (bad) { alert(bad); return; }
  const base = name.replace(/\.\w+$/, '').replace(/(^|[_-])(\w)/g, (_, _a, c: string) => c.toUpperCase()).replace(/\W/g, '');
  const m = /^[A-Za-z]/.test(base) ? base : 'M' + base;
  proj.files.push({ name, src: name.endsWith('.veryl') ? newModule(m) : '' });
  openFile(name);
  changed();
}

function renameFile(old: string): void {
  let name = prompt('新檔名', old)?.trim();
  if (!name || name === old) return;
  if (!/\.\w+$/.test(name)) name += '.veryl';
  const bad = validName(name);
  if (bad) { alert(bad); return; }
  file(old)!.name = name;
  proj.open = openTabs().map(n => n === old ? name! : n);
  if (proj.active === old) proj.active = name;
  showActive();
  changed();
}

function deleteFile(name: string): void {
  if (proj.files.length < 2) { alert('專案至少要有一個檔案'); return; }
  if (!confirm(`刪除 ${name}？`)) return;
  proj.files = proj.files.filter(f => f.name !== name);
  proj.open = openTabs().filter(n => n !== name);
  if (proj.active === name) proj.active = undefined;
  showActive();
  changed();
}

async function importFiles(list: FileList | null): Promise<void> {
  if (!list) return;
  let last = '';
  for (const f of Array.from(list)) {
    const src = await f.text();
    if (f.name.endsWith('.pcf')) { proj.pcf = src; continue; }
    const cur = file(f.name);
    if (cur) cur.src = src; else proj.files.push({ name: f.name, src });
    last = f.name;
  }
  if (last) openFile(last);
  changed();
}

function switchProject(id: string): void {
  const p = projects.find(x => x.id === id);
  if (!p) return;
  proj = p;
  synthKey = '';
  testState = new Map();
  problems = [];
  vcds = [];
  wave?.set(null);
  $('p-output').textContent = '';
  $('p-results').innerHTML = '';
  if (proj.active === FLOW_TAB) proj.active = undefined;
  proj.open = openTabs().filter(n => n !== FLOW_TAB);
  renderProjects();
  showActive();
  changed();
  persist();
  demoLink();
}

function demoLink(): void {
  $<HTMLAnchorElement>('demoLink').href = 'index.html' + (proj.from ? '#ex=' + proj.from : '');
}

function openExample(ex: Example): void {
  const have = projects.find(p => p.from === ex.id);
  if (have) { switchProject(have.id); return; }
  const p = fromExample(ex);
  projects.push(p);
  switchProject(p.id);
}

function newProject(): void {
  const name = prompt('專案名稱', 'MyDesign')?.trim();
  if (!name) return;
  const p = blankProject(name);
  projects.push(p);
  switchProject(p.id);
}

function renameProject(): void {
  const name = prompt('專案名稱', proj.name)?.trim();
  if (!name) return;
  proj.name = name;
  renderProjects();
  persist();
}

function deleteProject(): void {
  if (!confirm(`刪除專案「${proj.name}」？（存在瀏覽器裡的檔案會一起刪掉）`)) return;
  projects = projects.filter(p => p !== proj);
  if (!projects.length) projects.push(fromExample(examples().find(e => e.id === 'seq101') ?? examples()[0]));
  switchProject(projects[0].id);
}

function revertProject(): void {
  const ex = examples().find(e => e.id === proj.from);
  if (!ex) { alert('這個專案不是從範例開的'); return; }
  if (!confirm('捨棄所有修改，回到範例原始碼？')) return;
  proj.files = ex.files.map(f => ({ ...f }));
  proj.synth = ex.synth;
  proj.pcf = ex.pcf;
  showActive();
  changed();
}

function exportZip(): void {
  saveAs(`${proj.name.replace(/[^\w.-]+/g, '_') || 'project'}.zip`,
    projectZip(proj.name, proj.files, proj.pcf ? { name: `${proj.synth ?? 'top'}.pcf`, src: proj.pcf } : undefined), 'application/zip');
}

// ---------------------------------------------------------------- examples

function renderExamples(): void {
  const box = $('exList');
  box.innerHTML = '';
  let g = '';
  for (const ex of examples()) {
    if (ex.group !== g) {
      g = ex.group;
      const h = document.createElement('div');
      h.className = 'group';
      h.textContent = g;
      box.appendChild(h);
    }
    const d = document.createElement('div');
    const opened = projects.some(p => p.from === ex.id);
    d.className = 'item';
    d.title = (ex.note ? ex.note + '\n' : '') + ex.files.map(f => f.name).join(', ');
    d.innerHTML = `<span class="ic">${opened ? '●' : '○'}</span><span class="nm">${esc(ex.title)}</span>`;
    d.onclick = () => { openExample(ex); renderExamples(); };
    box.appendChild(d);
  }
}

function welcome(): void {
  const recent = projects.slice(-8).reverse();
  $('welcome').innerHTML = `<h2>veryl2chip IDE</h2><p>Veryl → 模擬 → 合成 → FPGA / ASIC，全部在瀏覽器裡。</p>
    <div class="cols">
      <div><h3>開始</h3><a data-a="newfile">＋ 新增 .veryl 檔</a><a data-a="newproj">＋ 新專案</a><a data-a="examples">📚 開啟範例…</a><a data-a="import">⇪ 匯入 .veryl 檔…</a></div>
      <div><h3>最近的專案</h3>${recent.map(p => `<a data-p="${p.id}">${esc(p.name)}</a>`).join('')}</div>
      <div><h3>這個專案</h3>${proj.files.map(f => `<a data-f="${esc(f.name)}">◆ ${esc(f.name)}</a>`).join('')}<a data-a="flow">⚙ 合成流程</a></div>
    </div>`;
  $('welcome').onclick = e => {
    const t = e.target as HTMLElement;
    const a = t.dataset.a;
    if (a === 'newfile') newFile();
    else if (a === 'newproj') newProject();
    else if (a === 'examples') sideView('examples');
    else if (a === 'import') $<HTMLInputElement>('importIn').click();
    else if (a === 'flow') runSynth();
    else if (t.dataset.p) switchProject(t.dataset.p);
    else if (t.dataset.f) openFile(t.dataset.f);
  };
}

// ---------------------------------------------------------------- checking

let checkTimer = 0;
let checkGen = 0;

/** the project changed: save, recheck, refresh the lists */
function changed(): void {
  persist();
  renderFiles();
  renderTabs();
  clearTimeout(checkTimer);
  checkTimer = window.setTimeout(check, 350);
}

/** parse every file (veryl-parser): syntax problems and the module list */
async function check(): Promise<void> {
  if (!core) return;
  const gen = ++checkGen;
  const files = proj.files.filter(f => f.name.endsWith('.veryl'));
  let errs: typeof problems = [];
  try {
    mods = (await core.call<{ modules: ModuleInfo[] }>({ cmd: 'list', files })).modules;
  } catch (e) {
    errs = parseErrors(String((e as Error).message ?? e), 'check');
  }
  if (gen !== checkGen) return;
  problems = [...errs, ...problems.filter(p => p.from === 'run')];
  if (errs.length) problems = problems.filter(p => p.from === 'check' || !p.file);
  refreshTops();
  renderProblems();
}

/** "file:line:col: message" lines (continuation lines join the message) */
function parseErrors(text: string, from: 'check' | 'run'): typeof problems {
  const out: typeof problems = [];
  for (const ln of text.split('\n')) {
    const m = /^([\w./-]+\.veryl):(\d+):(\d+):\s*(.*)$/.exec(ln);
    if (m) out.push({ file: m[1], line: +m[2], col: +m[3], msg: m[4], severity: 'error', from });
    else if (ln.trim() && out.length) out[out.length - 1].msg += '\n' + ln.trim();
    else if (ln.trim()) out.push({ msg: ln.trim(), severity: 'error', from, ...locate(ln) });
  }
  return out;
}

/** elaboration errors name the identifier but not the place: its first use in code */
function locate(msg: string): { file?: string; line?: number; col?: number } {
  const m = /'([A-Za-z_][\w.]*)'/.exec(msg);
  if (!m) return {};
  const id = m[1].split('.').pop()!;
  const re = new RegExp(`(^|[^\\w$])${id.replace(/[$]/g, '\\$')}(?!\\w)`);
  for (const f of proj.files) {
    const ls = f.src.split('\n');
    for (let i = 0; i < ls.length; i++) {
      const code = ls[i].replace(/\/\/.*$/, '');
      const k = re.exec(code);
      if (k) return { file: f.name, line: i + 1, col: k.index + k[1].length + 1 };
    }
  }
  return {};
}

function markers(): void {
  const a = proj.active;
  const ms: Marker[] = problems.filter(p => p.file === a && p.line).map(p => ({ line: p.line!, col: p.col ?? 1, msg: p.msg, severity: p.severity }));
  ed.setMarkers(ms);
}

function renderProblems(): void {
  const box = $('p-problems');
  box.innerHTML = '';
  const ne = problems.filter(p => p.severity === 'error').length, nw = problems.length - ne;
  $('sbProblems').textContent = `⊗ ${ne}  ⚠ ${nw}`;
  const badge = $('probCount');
  badge.textContent = String(problems.length);
  badge.classList.toggle('hidden', !problems.length);
  badge.classList.toggle('err', ne > 0);
  if (!problems.length) { box.innerHTML = '<div class="none">沒有問題。</div>'; }
  for (const p of problems) {
    const d = document.createElement('div');
    d.className = 'prob ' + p.severity;
    d.innerHTML = `<span class="sev">${p.severity === 'error' ? '⊗' : '⚠'}</span><span class="m">${esc(p.msg)}</span>${p.file ? `<span class="loc">${esc(p.file)} [${p.line}, ${p.col}]</span>` : ''}`;
    if (p.file) d.onclick = () => openFile(p.file!, p.line, p.col);
    box.appendChild(d);
  }
  markers();
  renderTabs();
  renderFiles();
}

// ---------------------------------------------------------------- tops

function synthTop(): string {
  const v = $<HTMLSelectElement>('synthTop').value;
  return v || proj.synth || '';
}

function refreshTops(): void {
  const st = $<HTMLSelectElement>('simTop');
  const keep = st.value;
  st.innerHTML = '<option value="">全部 #[test]</option>' + mods.map(m => `<option value="${esc(m.name)}">${esc(m.name)}${m.test ? '  (test)' : ''}</option>`).join('');
  if (mods.some(m => m.name === keep)) st.value = keep;
  const sy = $<HTMLSelectElement>('synthTop');
  const designs = mods.filter(m => !m.test);
  const want = sy.value && designs.some(m => m.name === sy.value) ? sy.value : designs.some(m => m.name === proj.synth) ? proj.synth! : designs[designs.length - 1]?.name ?? '';
  sy.innerHTML = designs.map(m => `<option value="${esc(m.name)}">${esc(m.name)}</option>`).join('');
  sy.value = want;
  renderTests();
  renderOutline();
}

// ---------------------------------------------------------------- tests

function renderTests(): void {
  const box = $('testList');
  box.innerHTML = '';
  const tests = mods.filter(m => m.test);
  if (!tests.length) { box.innerHTML = '<p class="side-hint">沒有 #[test] 模組。在模組前加上 <code>#[test(name)]</code>，用 <code>$tb::clock_gen</code>、<code>$assert</code> 寫 testbench。</p>'; return; }
  for (const t of tests) {
    const s = testState.get(t.name);
    const d = document.createElement('div');
    d.className = 'item ' + (s ?? '');
    d.innerHTML = `<span class="ic">${s === 'pass' ? '✓' : s === 'fail' ? '✗' : s === 'run' ? '…' : '○'}</span><span class="nm">${esc(t.name)}</span><span class="acts"><button class="icon" title="執行">▶</button></span>`;
    d.onclick = () => runTests(t.name);
    d.ondblclick = () => { const dcl = declarations().find(x => x.name === t.name); if (dcl) openFile(dcl.file, dcl.line); };
    box.appendChild(d);
  }
}

function setBusy(on: boolean, what = ''): void {
  busy += on ? 1 : -1;
  $('statusbar').classList.toggle('busy', busy > 0);
  if (on) $('sbTest').textContent = what;
}

const KIND: Record<string, string> = { rtl: 'RTL', opt: '通用閘', ice40: 'iCE40', asic: '標準元件' };

async function simulate(top: string | null, mode: string, vcd: boolean): Promise<SimResult & { gate: { top: string; cells: number } | null }> {
  const files = proj.files.filter(f => f.name.endsWith('.veryl'));
  const gate = mode === 'rtl' ? {} : { gate: mode, synth: synthTop() };
  if (mode !== 'rtl' && !synthTop()) throw new Error('沒有可合成的模組（閘級模擬需要合成頂層）');
  return core!.call({ cmd: 'simulate', files, top, max_time: 1_000_000, vcd, ...gate });
}

async function runTests(only?: string): Promise<void> {
  if (!core) return;
  const top = only ?? ($<HTMLSelectElement>('simTop').value || null);
  const mode = $<HTMLSelectElement>('simMode').value;
  const names = top ? [top] : mods.filter(m => m.test).map(m => m.name);
  for (const n of names) testState.set(n, 'run');
  renderTests();
  setBusy(true, `▶ 測試中（${KIND[mode]}）…`);
  const t0 = performance.now();
  problems = problems.filter(p => p.from !== 'run');
  try {
    const r = await simulate(top, mode, true);
    vcds = r.vcd;
    fillWaveTops();
    wave?.set(vcds[0]?.text ?? null);
    $('p-output').textContent = r.log;
    for (const t of r.tops) testState.set(t.name, t.fails ? 'fail' : 'pass');
    const fails = r.tops.filter(t => t.fails);
    const where = r.gate ? `　閘級：${r.gate.top} → ${r.gate.cells} 個${KIND[mode]}元件` : '';
    const msg = fails.length ? `✗ ${fails.reduce((a, t) => a + t.fails, 0)} 個斷言失敗（${fails.map(t => t.name).join(', ')}）` : `✓ ${r.tops.length} 個測試通過`;
    $('p-results').innerHTML = `<div class="banner ${fails.length ? 'fail' : 'pass'}">${esc(msg + where)}</div>`
      + `<table><tr><th>testbench</th><th>${KIND[mode]}</th><th>結束</th></tr>${r.tops.map(t => `<tr><td>${esc(t.name)}</td><td class="${t.fails ? 'fail' : 'pass'}">${t.fails ? `✗ ${t.fails} 個失敗` : '✓ PASS'}</td><td>${t.finished ? '$finish' : '時間到'}</td></tr>`).join('')}</table>`;
    $('sbTest').textContent = `${fails.length ? '✗' : '✓'} ${msg.slice(2)}（${((performance.now() - t0) / 1000).toFixed(2)} s）`;
    // assertion failures with their time stamps also go to the problems list
    for (const ln of r.log.split('\n')) if (/ASSERTION FAILED/.test(ln)) problems.push({ msg: ln.trim(), severity: 'error', from: 'run' });
    panel(fails.length ? 'output' : 'results');
  } catch (e) {
    for (const n of names) testState.delete(n);
    const errs = parseErrors(String((e as Error).message ?? e), 'run');
    problems.push(...errs);
    $('p-output').textContent = String((e as Error).message ?? e);
    $('sbTest').textContent = '✗ 錯誤';
    panel('problems');
    const first = errs.find(p => p.file);
    if (first) openFile(first.file!, first.line, first.col);
  }
  setBusy(false);
  renderTests();
  renderProblems();
}

/** every testbench on RTL and on the three synthesized netlists */
async function verifyAll(): Promise<void> {
  if (!core) return;
  const tests = mods.filter(m => m.test).map(m => m.name);
  if (!tests.length) { alert('沒有 #[test] 模組可以跑'); return; }
  panel('results');
  const modes = synthTop() ? ['rtl', 'opt', 'ice40', 'asic'] : ['rtl'];
  const res = new Map<string, Map<string, string>>();
  const cells = new Map<string, number>();
  const draw = (done: boolean) => {
    const rtl = res.get('rtl');
    let same = true;
    const rows = tests.map(t => `<tr><td>${esc(t)}</td>${modes.map(m => {
      const v = res.get(m)?.get(t);
      if (v === undefined) return `<td class="na">${done ? '—' : '…'}</td>`;
      if (m !== 'rtl' && rtl && v !== rtl.get(t)) same = false;
      return `<td class="${v === '0' ? 'pass' : v === 'err' ? 'fail' : 'fail'}">${v === '0' ? '✓' : v === 'err' ? '錯誤' : `✗ ${v}`}</td>`;
    }).join('')}</tr>`).join('');
    const allPass = [...res.values()].every(m => [...m.values()].every(v => v === '0'));
    $('p-results').innerHTML = (done ? `<div class="banner ${allPass && same ? 'pass' : 'fail'}">${allPass && same ? `✓ 全面驗證通過：${tests.length} 個 testbench × ${modes.length} 種實作結果一致` : same ? '✗ 有測試失敗（各實作結果一致）' : '✗ 合成前後結果不一致！'}</div>` : '<div class="banner">驗證中…</div>')
      + `<table><tr><th>testbench</th>${modes.map(m => `<th>${KIND[m]}${cells.has(m) ? `<br><small>${cells.get(m)} 元件</small>` : ''}</th>`).join('')}</tr>${rows}</table>`
      + (synthTop() ? `<p class="side-hint">閘級：把 ${esc(synthTop())} 換成合成後的網表，跑同一組 testbench。</p>` : '');
  };
  setBusy(true, '✔ 全面驗證中…');
  const t0 = performance.now();
  for (const m of modes) {
    draw(false);
    const col = new Map<string, string>();
    try {
      const r = await simulate(null, m, false);
      for (const t of r.tops) col.set(t.name, String(t.fails));
      if (r.gate) cells.set(m, r.gate.cells);
    } catch (e) {
      for (const t of tests) col.set(t, 'err');
      problems = problems.filter(p => p.from !== 'run');
      problems.push(...parseErrors(`[${KIND[m]}] ` + String((e as Error).message ?? e), 'run'));
      renderProblems();
    }
    res.set(m, col);
  }
  draw(true);
  for (const t of tests) testState.set(t, res.get('rtl')?.get(t) === '0' ? 'pass' : 'fail');
  renderTests();
  $('sbTest').textContent = `✔ 全面驗證 ${((performance.now() - t0) / 1000).toFixed(1)} s`;
  setBusy(false);
}

function fillWaveTops(): void {
  const sel = $<HTMLSelectElement>('waveTop');
  sel.innerHTML = vcds.map(v => `<option>${esc(v.top)}</option>`).join('');
  sel.classList.toggle('hidden', vcds.length < 2 || curPanel !== 'wave');
}

// ---------------------------------------------------------------- synthesis

function runSynth(stage?: string): void {
  if (!synth) return;
  const top = synthTop();
  if (!top) { alert('沒有可合成的模組（#[test] 模組不能合成）'); return; }
  const files = proj.files.filter(f => f.name.endsWith('.veryl'));
  const key = JSON.stringify([files, top, proj.pcf]);
  openFile(FLOW_TAB);
  // the chip views need the room on small screens; the panel comes back with the next run
  if (window.innerHeight < 900) $('panel').classList.add('collapsed');
  if (key !== synthKey || !synth.synthesized) {
    synthKey = key;
    const target = stage && ASIC_FLOW.some(s => s[0] === stage && s[0].startsWith('a')) ? 'asic' : stage && ['map', 'place', 'route', 'sta'].includes(stage) ? 'fpga' : undefined;
    synth.open(files, top, proj.pcf, target ?? ($<HTMLSelectElement>('flowTarget').value as 'fpga' | 'asic'), stage);
  } else if (stage) synth.showStage(stage);
  sideView('flow');
}

function renderFlow(cur?: string): void {
  const asic = $<HTMLSelectElement>('flowTarget').value === 'asic';
  const box = $('flowList');
  box.innerHTML = '';
  for (const [k, label] of [...(asic ? ASIC_FLOW : FPGA_FLOW), ['cmp', '⇄ FPGA vs ASIC 比較'] as [string, string]]) {
    const d = document.createElement('div');
    const tag = label.slice(0, 1);
    d.className = 'item' + (k === cur ? ' cur' : '') + (tag === 'F' ? ' stage-fpga' : tag === 'A' ? ' stage-asic' : '');
    d.innerHTML = `<span class="ic">${k === 'cmp' ? '⇄' : tag === '共' ? '◇' : '◆'}</span><span class="nm">${esc(label.replace(/^(共|F|A) /, ''))}</span><span class="tag">${tag === '共' ? '共用' : tag === 'F' ? 'FPGA' : tag === 'A' ? 'ASIC' : ''}</span>`;
    d.onclick = () => runSynth(k);
    box.appendChild(d);
  }
}

// ---------------------------------------------------------------- layout

let curPanel = 'problems';
function panel(p: string): void {
  curPanel = p;
  $('panel').classList.remove('collapsed');
  for (const b of $('panelTabs').querySelectorAll<HTMLElement>('button[data-panel]')) b.classList.toggle('cur', b.dataset.panel === p);
  for (const v of ['problems', 'output', 'results', 'wave']) $('p-' + v).classList.toggle('hidden', v !== p);
  $('waveTop').classList.toggle('hidden', p !== 'wave' || vcds.length < 2);
  if (p === 'wave') wave?.fit();
}

function sideView(v: string): void {
  const cur = $('activity').querySelector<HTMLElement>(`button[data-view="${v}"]`);
  const already = cur?.classList.contains('cur') && !$('sidebar').classList.contains('hidden');
  for (const b of $('activity').querySelectorAll<HTMLElement>('button')) b.classList.toggle('cur', b.dataset.view === v);
  for (const s of document.querySelectorAll<HTMLElement>('.sideview')) s.classList.toggle('hidden', s.id !== 'view-' + v);
  $('sidebar').classList.remove('hidden');
  $('sideResize').classList.remove('hidden');
  if (v === 'examples') renderExamples();
  void already;
}

function resizer(id: string, prop: string, axis: 'x' | 'y', min: number, max: () => number, invert = false): void {
  const r = $(id);
  const saved = load<number>(prop, 0);
  if (saved) document.body.style.setProperty(prop, saved + 'px');
  r.addEventListener('pointerdown', e => {
    e.preventDefault();
    r.classList.add('drag');
    r.setPointerCapture(e.pointerId);
    const start = axis === 'x' ? e.clientX : e.clientY;
    const target = id === 'sideResize' ? $('sidebar') : $('panel');
    const s0 = axis === 'x' ? target.getBoundingClientRect().width : target.getBoundingClientRect().height;
    const move = (ev: PointerEvent) => {
      const d = (axis === 'x' ? ev.clientX : ev.clientY) - start;
      const v = Math.max(min, Math.min(max(), s0 + (invert ? -d : d)));
      document.body.style.setProperty(prop, v + 'px');
      save(prop, v);
    };
    const up = () => { r.classList.remove('drag'); r.removeEventListener('pointermove', move); r.removeEventListener('pointerup', up); };
    r.addEventListener('pointermove', move);
    r.addEventListener('pointerup', up);
  });
}

// ---------------------------------------------------------------- command palette

interface Cmd { label: string; key?: string; run: () => void }

function commands(): Cmd[] {
  const c: Cmd[] = [
    { label: '執行測試', key: 'Ctrl+Enter', run: () => runTests() },
    { label: '全面驗證（RTL + 三種閘級網表）', run: verifyAll },
    { label: '合成並檢視流程', key: 'Ctrl+Shift+B', run: () => runSynth() },
    ...FPGA_FLOW.slice(3).map(([k, l]) => ({ label: `流程：${l}`, run: () => runSynth(k) })),
    ...ASIC_FLOW.slice(3).map(([k, l]) => ({ label: `流程：${l}`, run: () => runSynth(k) })),
    ...FPGA_FLOW.slice(0, 3).map(([k, l]) => ({ label: `流程：${l}`, run: () => runSynth(k) })),
    { label: '流程：⇄ FPGA vs ASIC 比較', run: () => runSynth('cmp') },
    { label: '新增檔案', run: newFile },
    { label: '新專案', run: newProject },
    { label: '匯入 .veryl 檔', run: () => $<HTMLInputElement>('importIn').click() },
    { label: '下載專案 .zip', run: exportZip },
    { label: '重新命名專案', run: renameProject },
    { label: '還原成範例原始碼', run: revertProject },
    { label: '刪除專案', run: deleteProject },
    { label: '切換面板', key: 'Ctrl+J', run: () => $('panel').classList.toggle('collapsed') },
    { label: '顯示：問題', run: () => panel('problems') },
    { label: '顯示：輸出', run: () => panel('output') },
    { label: '顯示：波形', run: () => panel('wave') },
    { label: '歡迎頁', run: () => openFile(WELCOME) },
    ...projects.filter(p => p !== proj).map(p => ({ label: `切換專案：${p.name}`, run: () => switchProject(p.id) })),
    ...examples().map(e => ({ label: `開啟範例：${e.title}`, run: () => openExample(e) })),
  ];
  return c;
}

let palItems: Cmd[] = [];
let palSel = 0;
function palette(files: boolean): void {
  $('palette').classList.remove('hidden');
  const inp = $<HTMLInputElement>('palIn');
  inp.value = files ? '' : '>';
  inp.focus();
  palFilter();
}

function palFilter(): void {
  const q = $<HTMLInputElement>('palIn').value;
  const isCmd = q.startsWith('>');
  const words = q.replace(/^>/, '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  const all: Cmd[] = isCmd ? commands() : [
    ...proj.files.map(f => ({ label: f.name, key: '檔案', run: () => openFile(f.name) })),
    ...declarations().map(d => ({ label: `${d.name}`, key: `${d.kind} · ${d.file}:${d.line}`, run: () => openFile(d.file, d.line) })),
  ];
  palItems = all.filter(c => words.every(w => (c.label + ' ' + (c.key ?? '')).toLowerCase().includes(w))).slice(0, 60);
  palSel = 0;
  drawPal();
}

function drawPal(): void {
  const box = $('palList');
  box.innerHTML = '';
  palItems.forEach((c, i) => {
    const d = document.createElement('div');
    d.className = i === palSel ? 'cur' : '';
    d.innerHTML = `<span>${esc(c.label)}</span>${c.key ? `<span class="k">${esc(c.key)}</span>` : ''}`;
    d.onmousedown = e => { e.preventDefault(); closePal(); c.run(); };
    box.appendChild(d);
    if (i === palSel) d.scrollIntoView({ block: 'nearest' });
  });
}

function closePal(): void { $('palette').classList.add('hidden'); }

// ---------------------------------------------------------------- keys

function globalKey(e: KeyboardEvent): boolean {
  if (mod(e) && e.key === 'Enter') { runTests(); return true; }
  if (mod(e) && e.shiftKey && (e.key === 'B' || e.key === 'b')) { runSynth(); return true; }
  if (mod(e) && e.shiftKey && (e.key === 'P' || e.key === 'p')) { palette(false); return true; }
  if (mod(e) && !e.shiftKey && (e.key === 'p' || e.key === 'P')) { palette(true); return true; }
  if (mod(e) && (e.key === 's' || e.key === 'S')) { persist(); $('sbTest').textContent = '已儲存（在瀏覽器）'; return true; }
  if (mod(e) && (e.key === 'j' || e.key === 'J')) { $('panel').classList.toggle('collapsed'); return true; }
  return false;
}

// ---------------------------------------------------------------- boot

function wire(): void {
  ed = new CodeEditor($('editorHost'));
  ed.onChange = text => {
    const f = file(proj.active ?? '');
    if (!f) return;
    f.src = text;
    // the file's problems are stale now: the check finds syntax errors again, the next run the others
    problems = problems.filter(p => p.file !== f.name);
    changed();
  };
  ed.onCursor = (l, c) => { $('sbPos').textContent = `行 ${l}，欄 ${c}`; };
  ed.onKey = globalKey;
  document.addEventListener('keydown', e => {
    if (!$('palette').classList.contains('hidden')) {
      if (e.key === 'Escape') { closePal(); e.preventDefault(); }
      else if (e.key === 'ArrowDown') { palSel = Math.min(palItems.length - 1, palSel + 1); drawPal(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { palSel = Math.max(0, palSel - 1); drawPal(); e.preventDefault(); }
      else if (e.key === 'Enter') { const c = palItems[palSel]; closePal(); c?.run(); e.preventDefault(); }
      return;
    }
    if ((e.target as HTMLElement).classList?.contains('ed-ta')) return;
    if (globalKey(e)) e.preventDefault();
  });
  $('palIn').addEventListener('input', palFilter);
  $('palIn').addEventListener('blur', () => setTimeout(closePal, 100));
  $('cmdPalette').onclick = () => palette(false);
  $('cmdRun').onclick = () => runTests();
  $('cmdVerify').onclick = verifyAll;
  $('cmdSynth').onclick = () => runSynth();
  $('testsRun').onclick = () => runTests();
  $('testsVerify').onclick = verifyAll;
  $<HTMLSelectElement>('synthTop').onchange = () => { renderOutline(); };
  $<HTMLSelectElement>('flowTarget').onchange = () => {
    renderFlow();
    if (proj.active === FLOW_TAB && synth?.synthesized) {
      const asic = $<HTMLSelectElement>('flowTarget').value === 'asic';
      const map: Record<string, string> = asic ? { map: 'amap', place: 'aplace', route: 'aroute', sta: 'asta' } : { amap: 'map', aplace: 'place', aroute: 'route', adetail: 'route', asta: 'sta', apower: 'sta' };
      const k = map[synth.current] ?? synth.current;
      synth.showStage(k);
    }
  };
  for (const b of $('activity').querySelectorAll<HTMLElement>('button')) b.onclick = () => sideView(b.dataset.view!);
  for (const b of $('panelTabs').querySelectorAll<HTMLElement>('button[data-panel]')) b.onclick = () => panel(b.dataset.panel!);
  $('panelToggle').onclick = () => $('panel').classList.toggle('collapsed');
  $('sbProblems').onclick = () => panel('problems');
  $<HTMLSelectElement>('projSel').onchange = () => switchProject($<HTMLSelectElement>('projSel').value);
  $('projNew').onclick = newProject;
  $('projRename').onclick = renameProject;
  $('projDel').onclick = deleteProject;
  $('fileNew').onclick = newFile;
  $('fileImport').onclick = () => $<HTMLInputElement>('importIn').click();
  $<HTMLInputElement>('importIn').onchange = () => { importFiles($<HTMLInputElement>('importIn').files); $<HTMLInputElement>('importIn').value = ''; };
  $('projZip').onclick = exportZip;
  wave = new WaveView($<HTMLCanvasElement>('waveCanvas'), $('wavePick'), $<HTMLInputElement>('waveFilter'));
  $<HTMLSelectElement>('waveTop').onchange = () => wave?.set(vcds.find(v => v.top === $<HTMLSelectElement>('waveTop').value)?.text ?? null);
  resizer('sideResize', '--sidew', 'x', 150, () => window.innerWidth * 0.5);
  resizer('panelResize', '--panelh', 'y', 60, () => window.innerHeight * 0.75, true);
  // the flow's stats line, mirrored into the side bar and the status bar
  new MutationObserver(() => {
    const t = $('synStats').innerHTML.split(/<span class="sep">[^<]*<\/span>/).map(x => x.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').trim()).filter(Boolean).join('\n');
    $('flowSum').innerText = t;
    const f = /Fmax\s*([\d.]+)\s*MHz/.exec(t);
    $('sbSynth').textContent = f ? `⚙ ${synthTop()} · Fmax ${f[1]} MHz` : $('synStats').innerText ? `⚙ ${synthTop()}` : '';
  }).observe($('synStats'), { childList: true, subtree: true, characterData: true });
}

async function boot(): Promise<void> {
  wire();
  const hash = location.hash;
  const exId = /ex=([\w-]+)/.exec(hash)?.[1];
  if (!projects.length) projects.push(fromExample(examples().find(e => e.id === (exId ?? 'seq101')) ?? examples()[0]));
  proj = projects.find(p => p.id === load<string>('cur', '')) ?? projects[0];
  const ex = exId ? examples().find(e => e.id === exId) : undefined;
  if (ex) {
    const have = projects.find(p => p.from === ex.id);
    if (have) proj = have; else { proj = fromExample(ex); projects.push(proj); }
  }
  if (proj.active === FLOW_TAB) proj.active = undefined;
  proj.open = openTabs().filter(n => n !== FLOW_TAB);
  renderProjects();
  renderFlow();
  showActive();
  renderProblems();
  demoLink();
  try {
    const t0 = performance.now();
    core = await startCore(fromBase64(VERYL_WASM_B64));
    $('sbCore').textContent = `✓ WebAssembly ${(performance.now() - t0).toFixed(0)} ms${core.inWorker ? '（背景執行緒）' : ''}`;
    for (const id of ['cmdRun', 'cmdVerify', 'cmdSynth']) $<HTMLButtonElement>(id).disabled = false;
    synth = new SynthOverlay(core, {
      embedded: true,
      onStage: k => {
        if (ASIC_FLOW.slice(3).some(s => s[0] === k)) $<HTMLSelectElement>('flowTarget').value = 'asic';
        else if (FPGA_FLOW.slice(3).some(s => s[0] === k)) $<HTMLSelectElement>('flowTarget').value = 'fpga';
        renderFlow(k);
      },
    });
    await check();
    const st = /stage=(\w+)/.exec(hash)?.[1];
    if (st) runSynth(st);
    if (/[#&]run=1/.test(hash)) runTests();
    if (/[#&]verify=1/.test(hash)) verifyAll();
  } catch (e) {
    $('sbCore').textContent = '✗ WebAssembly 載入失敗';
    $('statusbar').classList.add('bad');
    problems.push({ msg: String(e), severity: 'error', from: 'run' });
    renderProblems();
  }
}

boot();
