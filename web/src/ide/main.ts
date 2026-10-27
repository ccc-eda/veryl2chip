// veryl2chip IDE (M11): a VS Code style workbench over the same WebAssembly
// core as the demo page — projects of .veryl files kept in the browser,
// live syntax checking, tests (RTL and gate-level), and every synthesis
// stage of the FPGA and ASIC flows as an editor tab.

import { fromBase64, gunzip, ModuleInfo, SimResult, VFile } from '../api';
import { Core, startCore } from '../client';
import { Example, examples, exGroup, exNote, exTitle } from '../examples';
import { fromLocale, Lang, LANGS, setLang, tr, translateDom } from '../i18n';
import { ASIC_STAGES, FPGA_STAGES, stageLabel, SynthOverlay } from '../synth/overlay';
import { newModule, projectZip } from '../templates';
import { WaveView } from '../wave';
import { saveAs } from '../zip';
import { BoardSetup, DEFAULT_SETUP, VirtualBoard } from './board';
import { Emulator, EmuStart } from './emu';
import { fingerprint, MachineCfg, machineStops } from '../emu_machine';
import { exchangeArea, readExchangeArea, tarFiles, untarFiles } from '../tar';
import { CodeEditor, Marker } from './editor';
import { langOf } from './highlight';
import { Act, actHint, actName, badges, CapInput, caps, Fix, start, steps } from './caps';

declare const VERYL_WASM_B64: string;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const mod = (e: KeyboardEvent) => e.ctrlKey || e.metaKey;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const attr = (s: string) => esc(s).replace(/"/g, '&quot;');

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
  /** what is plugged into the virtual board */
  board?: BoardSetup;
  /** the development board's breadboard (emulator, machine.json "board": "pi") */
  piBoard?: import('./bbmodel').Part[];
  /** the emulator's engine for a machine riscv-emu can run (machine.json "riscv") */
  emuEngine?: 'veryl' | 'riscv';
  /** the suggested steps bar was closed */
  guideOff?: boolean;
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

/** a project's name; an example project not renamed shows the example's title in the current language */
function projName(p: Project): string {
  const ex = p.from ? examples().find(e => e.id === p.from) : undefined;
  return ex && (p.name === ex.title || p.name === ex.title_en) ? exTitle(ex) : p.name;
}

function uid(): string { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

function fromExample(ex: Example): Project {
  const files = ex.files.map(f => ({ ...f }));
  if (ex.pcf) files.push({ name: PCF, src: ex.pcf });
  return { id: uid(), name: ex.title, files, synth: ex.synth, from: ex.id, open: [ex.files[0].name], active: ex.files[0].name, board: ex.board };
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
/** mods are the current project's (the parser answered since the project was opened) */
let modsKnown = false;
let problems: { file?: string; line?: number; col?: number; msg: string; severity: 'error' | 'warning'; from: 'check' | 'run' }[] = [];
let testState = new Map<string, 'pass' | 'fail' | 'run'>();
/** files + top of the last synthesis, to know when the flow views are stale */
let synthKey = '';
let busy = 0;

/** [key, label, tag] of the flow stages, in the current language (the back end is the menu's, not a prefix) */
const flow = (asic: boolean) => (asic ? ASIC_STAGES : FPGA_STAGES).map(s => [s.key, stageLabel(s).replace(/^(共|C|F|A) /, ''), s.tag] as const);
const isAsicStage = (k: string) => ASIC_STAGES.some(s => s.key === k && s.tag === 'asic');
const isFpgaStage = (k: string) => FPGA_STAGES.some(s => s.key === k && s.tag === 'fpga');
/** tab ids of the non-file tabs (kept in the saved tab list, so not translated) */
const FLOW_TAB = '\u2699flow';
const WELCOME = '\u2605welcome';
const BOARD_TAB = '\u26a1board';
const EMU_TAB = '\u{1f5a5}emu';
/** the course tutorial (Traditional Chinese) */
const TUTORIAL = 'https://github.com/ccc-eda/veryl2chip/blob/main/tutorial/README.tw.md';
const ASM_TAB = '\u2699asm';
const tabName = (n: string) => n === FLOW_TAB ? tr('⚙ 合成流程', '⚙ Synthesis flow') : n === WELCOME ? tr('歡迎', 'Welcome') : n === BOARD_TAB ? tr('⚡ 虛擬 iCEBreaker', '⚡ Virtual iCEBreaker') : n === EMU_TAB ? tr('🖥 模擬機', '🖥 Emulator') : n === ASM_TAB ? tr('組合語言', 'Assembly') : n;
/** tabs that are not files */
const special = (n: string) => n === FLOW_TAB || n === WELCOME || n === BOARD_TAB || n === EMU_TAB || n === ASM_TAB;

function file(name: string): VFile | undefined { return proj.files.find(f => f.name === name); }

/** the pin file is an ordinary project file (the first .pcf) */
const PCF = 'pins.pcf';
function pcfOf(p: Project): string | undefined { return p.files.find(f => f.name.endsWith('.pcf'))?.src; }
/** older projects kept the pins in `pcf`: make it a file */
function migratePcf(p: Project): void {
  if (p.pcf !== undefined) {
    if (!p.files.some(f => f.name.endsWith('.pcf')) && p.pcf.trim()) p.files.push({ name: PCF, src: p.pcf });
    delete p.pcf;
  }
}
function original(name: string): string | undefined {
  return proj.from ? examples().find(e => e.id === proj.from)?.files.find(f => f.name === name)?.src : undefined;
}

// ---------------------------------------------------------------- editor tabs

function openTabs(): string[] { return (proj.open ??= []); }

function openFile(name: string, line?: number, col?: number): void {
  if (!special(name) && !file(name)) return;
  if (!openTabs().includes(name)) openTabs().push(name);
  proj.active = name;
  persist();
  showActive();
  if (line && !special(name)) ed.goto(line, col ?? 1, true);
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
  if (a && !special(a) && !file(a)) a = undefined;
  if (!a) a = openTabs().find(n => n === FLOW_TAB || file(n)) ?? WELCOME;
  proj.active = a;
  if (!openTabs().includes(a)) openTabs().push(a);
  const isFile = !!file(a) || a === ASM_TAB;
  $('editorHost').classList.toggle('hidden', !isFile);
  $('synOverlay').classList.toggle('hidden', a !== FLOW_TAB);
  syncStage();
  $('boardPane').classList.toggle('hidden', a !== BOARD_TAB);
  $('emuPane').classList.toggle('hidden', a !== EMU_TAB);
  document.body.classList.toggle('tab-flow', a === FLOW_TAB);
  if (boardCmd(a) && file(a)) boardFile = a;
  // ▶ runs a script open in a board project on the board
  const onBoard = !!(machineCfg()?.files && boardCmd(a));
  $('cmdRun').textContent = onBoard ? tr('▶ 執行', '▶ Run') : tr('▶ 測試', '▶ Test');
  $('cmdRun').title = onBoard ? tr(`在板子上執行 ${a}（Ctrl/⌘+Enter）`, `Run ${a} on the board (Ctrl/⌘+Enter)`) : tr('執行測試（Ctrl/⌘+Enter）', 'Run tests (Ctrl/⌘+Enter)');
  if (a === EMU_TAB) ensureEmu().runLabel();
  syncTarget();
  // the board simulates only while it is visible
  if (board) {
    if (a === BOARD_TAB) { if (boardWasRunning) { boardWasRunning = false; board.resume(); } }
    else if (board.isRunning) { boardWasRunning = true; board.stop(); }
  }
  $('welcome').classList.toggle('hidden', a !== WELCOME);
  if (a === ASM_TAB) {
    // the compiled C program: address, machine code, assembly (read only)
    const text = cprog?.compiled ? cprog.listing! : cFile() ? tr('（程式有錯誤，還沒有組合語言）', '(the program has errors: no assembly yet)') : tr('（這個專案沒有 .c 檔）', '(this project has no .c file)');
    ed.readOnly = true;
    ed.lang = 'asm';
    if (ed.value !== text || $('editorHost').dataset.file !== a) { ed.value = text; $('editorHost').dataset.file = a; }
    ed.setMarkers([]);
  } else if (isFile) {
    ed.readOnly = false;
    ed.lang = langOf(a);
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
  applyCaps();
}

function renderTabs(): void {
  const box = $('edTabs');
  box.innerHTML = '';
  for (const n of openTabs()) {
    const t = document.createElement('div');
    const f = file(n);
    const errs = problems.some(p => p.file === n && p.severity === 'error');
    t.className = 'tab' + (n === proj.active ? ' cur' : '') + (f && original(n) !== undefined && original(n) !== f.src ? ' dirty' : '') + (errs ? ' err' : '');
    t.innerHTML = `<span class="ic">${n === FLOW_TAB || n === BOARD_TAB || n === EMU_TAB || n === ASM_TAB ? '' : n === WELCOME ? '★' : f?.name.endsWith('.veryl') ? '◆' : f?.name.endsWith('.c') ? 'C' : '▤'}</span><span class="nm">${esc(tabName(n))}</span><span class="x" title="${tr('關閉', 'Close')}"></span>`;
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
    o.textContent = projName(p);
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
    d.innerHTML = `<span class="ic">${f.name.endsWith('.veryl') ? '◆' : f.name.endsWith('.c') ? 'C' : '▤'}</span><span class="nm">${esc(f.name)}</span>`
      + `<span class="acts"><button class="icon" data-a="ren" title="${tr('重新命名', 'Rename')}">✎</button><button class="icon" data-a="del" title="${tr('刪除', 'Delete')}">🗑</button></span>`
      + (n ? `<span class="tag" style="color:var(--err)">${n}</span>` : changed ? `<span class="tag dirty-dot" title="${tr('與範例原始碼不同', 'Changed from the example')}">M</span>` : '');
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
    el.innerHTML = `<span class="ic">${d.kind === 'module' ? (d.test ? '✔' : '▣') : d.kind === 'interface' ? '⇄' : '{}'}</span><span class="nm">${esc(d.name)}</span><span class="tag">${top ? tr('合成頂層', 'synth top') : d.test ? 'test' : d.kind === 'module' ? '' : d.kind}</span>`;
    el.title = `${d.file}:${d.line}`;
    el.onclick = () => openFile(d.file, d.line);
    box.appendChild(el);
  }
}

function validName(name: string): string | null {
  if (!/^[\w.-]+$/.test(name)) return tr('檔名只能用英數字、底線、點和減號', 'File names may only use letters, digits, _ . and -');
  if (file(name)) return tr(`已經有 ${name}`, `${name} already exists`);
  return null;
}

function newFile(): void {
  let name = prompt(tr('新檔名（.veryl，或 .c：給 RISC-V SoC 的 C 程式）', 'New file name (.veryl, or .c: a C program for the RISC-V SoC)'), `module${proj.files.length}.veryl`)?.trim();
  if (!name) return;
  if (!/\.\w+$/.test(name)) name += '.veryl';
  const bad = validName(name);
  if (bad) { alert(bad); return; }
  const base = name.replace(/\.\w+$/, '').replace(/(^|[_-])(\w)/g, (_, _a, c: string) => c.toUpperCase()).replace(/\W/g, '');
  const m = /^[A-Za-z]/.test(base) ? base : 'M' + base;
  if (name.endsWith('.c') && cFile() && !boardProject()) { alert(tr('一個專案只能有一個 .c 檔', 'A project has one .c file')); return; }
  proj.files.push({ name, src: name.endsWith('.veryl') ? newModule(m) : name.endsWith('.c') ? (boardProject() ? C_BOARD_TEMPLATE : C_TEMPLATE) : '' });
  openFile(name);
  changed();
}

function renameFile(old: string): void {
  let name = prompt(tr('新檔名', 'New file name'), old)?.trim();
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
  if (proj.files.length < 2) { alert(tr('專案至少要有一個檔案', 'A project needs at least one file')); return; }
  if (!confirm(tr(`刪除 ${name}？`, `Delete ${name}?`))) return;
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
    if (f.name.endsWith('.json')) {
      try { importLab(JSON.parse(src), ''); } catch (e) { alert(String((e as Error).message ?? e)); }
      return;
    }
    if (f.name.endsWith('.pcf')) { proj.files = proj.files.filter(x => !x.name.endsWith('.pcf')); }
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
  modsKnown = false;
  problems = [];
  vcds = [];
  wave?.set(null);
  $('p-output').textContent = '';
  $('p-results').innerHTML = '';
  if (proj.active === FLOW_TAB || proj.active === BOARD_TAB || proj.active === EMU_TAB) proj.active = undefined;
  proj.open = openTabs().filter(n => n === WELCOME || file(n));
  renderProjects();
  showActive();
  changed();
  persist();
  demoLink();
}

function demoLink(): void {
  $<HTMLAnchorElement>('demoLink').href = 'demo.html' + (proj.from ? '#ex=' + proj.from : '');
}

function openExample(ex: Example): void {
  const have = projects.find(p => p.from === ex.id);
  if (have) { switchProject(have.id); return; }
  const p = fromExample(ex);
  projects.push(p);
  switchProject(p.id);
}

function newProject(): void {
  const name = prompt(tr('專案名稱', 'Project name'), 'MyDesign')?.trim();
  if (!name) return;
  const p = blankProject(name);
  projects.push(p);
  switchProject(p.id);
}

function renameProject(): void {
  const name = prompt(tr('專案名稱', 'Project name'), projName(proj))?.trim();
  if (!name) return;
  proj.name = name;
  renderProjects();
  persist();
}

function deleteProject(): void {
  if (!confirm(tr(`刪除專案「${projName(proj)}」？（存在瀏覽器裡的檔案會一起刪掉）`, `Delete the project "${projName(proj)}"? (its files stored in the browser are deleted too)`))) return;
  projects = projects.filter(p => p !== proj);
  if (!projects.length) projects.push(fromExample(examples().find(e => e.id === 'seq101') ?? examples()[0]));
  switchProject(projects[0].id);
}

function revertProject(): void {
  const ex = examples().find(e => e.id === proj.from);
  if (!ex) { alert(tr('這個專案不是從範例開的', 'This project was not opened from an example')); return; }
  if (!confirm(tr('捨棄所有修改，回到範例原始碼？', 'Discard all changes and go back to the example\'s source?'))) return;
  proj.files = ex.files.map(f => ({ ...f }));
  proj.synth = ex.synth;
  if (ex.pcf) proj.files.push({ name: PCF, src: ex.pcf });
  showActive();
  changed();
}

// ---------------------------------------------------------------- sharing labs

/** a lab: everything a student needs (sources, pins, what is plugged in, the breadboard) */
interface Lab { v: 1; name: string; files: VFile[]; synth?: string; board?: BoardSetup; from?: string }
const labOf = (p: Project): Lab => ({ v: 1, name: projName(p), files: p.files, synth: p.synth, board: p.board, from: p.from });

async function gz(data: string | Uint8Array, compress: boolean): Promise<Uint8Array> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const stream = new Blob([bytes as BlobPart]).stream()
    .pipeThrough(compress ? new CompressionStream('gzip') : new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
const b64url = (u: Uint8Array) => { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const unb64url = (s: string) => { const b = atob(s.replace(/-/g, '+').replace(/_/g, '/')); const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; };

/** a link that opens this lab as a new project */
async function shareLab(): Promise<void> {
  const code = b64url(await gz(JSON.stringify(labOf(proj)), true));
  const url = `${location.origin}${location.pathname}#lab=${code}`;
  try { await navigator.clipboard.writeText(url); } catch { /* not allowed: the prompt shows it */ }
  prompt(tr(`分享連結（${url.length} 字元，已複製到剪貼簿）：開啟它會把這個實驗匯入成新專案`, `Share link (${url.length} characters, copied): opening it imports this lab as a new project`), url);
}

function exportLab(): void {
  saveAs(`${projName(proj).replace(/[^\w.-]+/g, '_') || 'lab'}.lab.json`, JSON.stringify(labOf(proj), null, 1), 'application/json');
}

function importLab(l: Lab, suffix: string): void {
  if (!l || !Array.isArray(l.files)) throw new Error(tr('不是實驗檔', 'not a lab file'));
  const files = l.files.filter(f => typeof f.name === 'string' && typeof f.src === 'string');
  const first = files.find(f => f.name.endsWith('.veryl'))?.name ?? files[0]?.name;
  const p: Project = { id: uid(), name: (l.name || 'lab') + suffix, files, synth: l.synth, board: l.board, from: l.from, open: first ? [first] : [], active: first };
  projects.push(p);
  switchProject(p.id);
}

async function labFromHash(code: string): Promise<void> {
  try {
    const text = new TextDecoder().decode(await gz(unb64url(code), false));
    importLab(JSON.parse(text), tr('（分享）', ' (shared)'));
  } catch (e) {
    alert(tr('無法開啟分享的實驗：', 'Cannot open the shared lab: ') + String((e as Error).message ?? e));
  }
  try { history.replaceState(null, '', location.pathname); } catch { /* file:// */ }
}

function exportZip(): void {
  saveAs(`${projName(proj).replace(/[^\w.-]+/g, '_') || 'project'}.zip`,
    projectZip(projName(proj), proj.files), 'application/zip');
}

// ---------------------------------------------------------------- examples

function renderExamples(): void {
  const chips = $('exFilter');
  chips.innerHTML = EX_FILTERS().map(([f, label]) => `<button class="${f === exFilter ? 'cur' : ''}" data-f="${f}" title="${attr(filterHint(f))}">${esc(label)} <small>${exCount(f)}</small></button>`).join('');
  chips.onclick = e => { const f = (e.target as HTMLElement).closest<HTMLElement>('[data-f]')?.dataset.f as ExFilter | undefined; if (f) setExFilter(f); };
  const box = $('exList');
  box.innerHTML = '';
  let g = '';
  for (const ex of examples()) {
    if (!exMatches(ex, exFilter)) continue;
    if (ex.group !== g) {
      g = ex.group;
      const h = document.createElement('div');
      h.className = 'group';
      h.textContent = exGroup(ex);
      box.appendChild(h);
    }
    const d = document.createElement('div');
    const opened = projects.some(p => p.from === ex.id);
    d.className = 'item';
    const ci = exCapIn(ex);
    const first = start(ci);
    const bs = badges(ci);
    d.title = (ex.note ? exNote(ex) + '\n' : '') + ex.files.map(f => f.name).join(', ')
      + '\n' + bs.map(b => `${b.icon} ${badgeName(b.act)}`).join('  ') + tr(`　建議第一步：${actName(first)}`, `  first step: ${actName(first)}`);
    d.innerHTML = `<span class="ic">${opened ? '●' : '○'}</span><span class="nm">${esc(exTitle(ex))}</span>`
      + `<span class="badges">${bs.map(b => `<span class="${b.act === first ? 'st' : ''}" title="${attr(badgeName(b.act))}">${b.icon}</span>`).join('')}</span>`;
    d.onclick = () => { openExample(ex); renderExamples(); };
    box.appendChild(d);
  }
}

// ---------------------------------------------------------------- where to start

/** what the example list shows: every example, or those that can do one thing */
type ExFilter = 'all' | 'test' | 'board' | 'emu' | 'synth';
let exFilter: ExFilter = load<ExFilter>('exFilter', 'all');
const EX_FILTERS = (): [ExFilter, string][] => [['all', tr('全部', 'All')], ['test', '🧪'], ['board', '⚡'], ['emu', '🖥'], ['synth', '⚙']];
function filterHint(f: ExFilter): string {
  return f === 'all' ? tr('所有範例', 'every example') : f === 'test' ? tr('有 testbench：▶ 測試、看波形', 'with testbenches: ▶ Test, waveforms')
    : f === 'board' ? tr('能放上虛擬板（有腳位）', 'go on the virtual board (have pins)') : f === 'emu' ? tr('一台機器：🖥 模擬機開機', 'a machine: boot it in the 🖥 emulator')
    : tr('能合成：FPGA、ASIC 晶片版圖', 'can be synthesized: FPGA, ASIC layout');
}
function exMatches(ex: Example, f: ExFilter): boolean { return f === 'all' || caps(exCapIn(ex))[f].on; }
const exCount = (f: ExFilter) => examples().filter(e => exMatches(e, f)).length;
function setExFilter(f: ExFilter): void { exFilter = f; save('exFilter', f); renderExamples(); }

/** the welcome page's starting points: what the user wants to do, an example to begin with, the matching examples */
type Goal = 'learn' | 'board' | 'emu' | 'chip';
const goals = (): { goal: Goal; icon: string; title: string; text: string; ex: string; filter: ExFilter }[] => [
  { goal: 'learn', icon: '🧪', title: tr('學 Veryl', 'Learn Veryl'), ex: 'tut_blinky', filter: 'test',
    text: tr('從教學第 1 課開始：寫電路和它的 testbench，跑測試、看波形。', 'Begin with lesson 1 of the tutorial: write a circuit and its testbench, run the tests, read the waveform.') },
  { goal: 'board', icon: '⚡', title: tr('做電路，放上開發板', 'Build a circuit, put it on a board'), ex: 'lab_traffic', filter: 'board',
    text: tr('像 Arduino：燒進虛擬 iCEBreaker 開發板，按按鈕、看 LED、接麵包板。', 'Like an Arduino: flash it to a virtual iCEBreaker, press buttons, watch LEDs, wire a breadboard.') },
  { goal: 'emu', icon: '🖥', title: tr('開一台電腦，寫程式', 'Boot a computer, write programs'), ex: 'rv64_linux', filter: 'emu',
    text: tr('像樹莓派：RV64 開發板開 Linux，用 MicroPython、C 控制 GPIO、麵包板和螢幕。', 'Like a Raspberry Pi: the RV64 board boots Linux; MicroPython and C drive its GPIO, breadboard and screen.') },
  { goal: 'chip', icon: '⚙', title: tr('看電路變成晶片', 'See the circuit become a chip'), ex: 'fifo', filter: 'synth',
    text: tr('合成成邏輯閘，放進 FPGA 佈局繞線，或做成 SKY130 晶片版圖。', 'Synthesize it to gates, place and route it on an FPGA, or make a SKY130 chip layout.') },
];

/** a starting point: its example (opened, or switched to), the first thing to do, the matching examples in the list */
async function startGoal(goal: Goal): Promise<void> {
  const g = goals().find(x => x.goal === goal)!;
  exFilter = g.filter;
  save('exFilter', g.filter);
  const ex = examples().find(e => e.id === g.ex);
  if (!ex) return;
  openExample(ex);
  renderExamples();
  if (!core) return;
  await check();
  if (goal === 'learn') runTests();
  else if (goal === 'board') flashBoard();
  else if (goal === 'emu') openEmu();
  else runSynth();
}

function welcome(): void {
  const recent = projects.slice(-8).reverse();
  $('welcome').innerHTML = `<h2>veryl2chip IDE</h2><p>${tr('Veryl → 模擬 → 合成 → FPGA / ASIC，全部在瀏覽器裡。', 'Veryl → simulation → synthesis → FPGA / ASIC, all in the browser.')}</p>
    <h3 class="goal-h">${tr('你想做什麼？', 'What do you want to do?')}</h3>
    <div class="goals">${goals().map(g => {
      const ex = examples().find(e => e.id === g.ex);
      return `<div class="goal"><div class="gi">${g.icon}</div><b>${esc(g.title)}</b><p>${esc(g.text)}</p>`
        + `<button class="tb-btn primary" data-goal="${g.goal}">${esc(tr('從這裡開始：', 'Start with: '))}${esc(ex ? exTitle(ex) : g.ex)}</button>`
        + `<a data-goalex="${g.goal}">${esc(tr(`看這一類的範例（${exCount(g.filter)} 個）`, `See the examples of this kind (${exCount(g.filter)})`))}</a></div>`;
    }).join('')}</div>
    <div class="cols">
      <div><h3>${tr('開始', 'Start')}</h3><a data-a="newfile">${tr('＋ 新增 .veryl 檔', '＋ New .veryl file')}</a><a data-a="newproj">${tr('＋ 新專案', '＋ New project')}</a><a data-a="examples">${tr('📚 開啟範例…', '📚 Open an example…')}</a><a data-a="import">${tr('⇪ 匯入 .veryl 檔…', '⇪ Import .veryl files…')}</a><a href="${TUTORIAL}" target="_blank" rel="noopener">${tr('📖 從零開始的教學（寫 Veryl → 燒進 iCEBreaker）', '📖 Tutorial from scratch (write Veryl → flash an iCEBreaker)')}</a></div>
      <div><h3>${tr('最近的專案', 'Recent projects')}</h3>${recent.map(p => `<a data-p="${p.id}">${esc(projName(p))}</a>`).join('')}</div>
      <div><h3>${tr('這個專案', 'This project')}</h3>${proj.files.map(f => `<a data-f="${esc(f.name)}">◆ ${esc(f.name)}</a>`).join('')}<a data-a="flow">${tr('⚙ 合成流程', '⚙ Synthesis flow')}</a></div>
    </div>`;
  $('welcome').onclick = e => {
    const t = e.target as HTMLElement;
    const a = t.dataset.a;
    if (a === 'newfile') newFile();
    else if (a === 'newproj') newProject();
    else if (a === 'examples') sideView('examples');
    else if (a === 'import') $<HTMLInputElement>('importIn').click();
    else if (a === 'flow') runSynth();
    else if (t.dataset.goal) startGoal(t.dataset.goal as Goal);
    else if (t.dataset.goalex) { setExFilter(goals().find(g => g.goal === t.dataset.goalex)!.filter); sideView('examples'); }
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
    modsKnown = true;
  } catch (e) {
    errs = parseErrors(String((e as Error).message ?? e), 'check');
  }
  if (cFile()) {
    try { errs.push(...cProblems(await compileC(core))); } catch (e) { errs.push({ msg: String((e as Error).message ?? e), severity: 'error', from: 'check' }); }
  } else cprog = null;
  if (gen !== checkGen) return;
  if (proj.active === ASM_TAB) showActive();
  problems = [...errs, ...problems.filter(p => p.from === 'run')];
  if (errs.length) problems = problems.filter(p => p.from === 'check' || !p.file);
  refreshTops();
  renderProblems();
  applyCaps();
}

// ---------------------------------------------------------------- C programs (RISC-V SoC)

const C_TEMPLATE = `// A C program for the RISC-V SoC (RvSoc in rvsoc.veryl): ⚡ Virtual board compiles it
// into the SoC's block RAM. Library: printf, putchar, getchar, puts, delay_ms, millis, rand,
// strlen ...; peripherals: LED, BUTTONS, SWITCHES, TIMER, UART_DATA, UART_STATUS.

int main(void) {
    int n = 0;
    printf("Hello from C!\\n");
    while (1) {
        LED = n++;
        delay_ms(200);
    }
}
`;

const C_BOARD_TEMPLATE = `// A C program for the RV64 board's Linux: ▶ Run compiles it in the browser and runs it
// in /root. Library: printf, puts, getchar, read_line, sleep, usleep, delay_ms, millis,
// open / read / write / close, malloc, strlen ...; GPIO: gpio_write, gpio_read, pin_mode
// (0 / 1 = ACT / USER LED, 2 = the button, 3-15 the header).

int main(void) {
    int i;
    for (i = 0; i < 5; i++) {
        gpio_write(5, 1);
        delay_ms(500);
        gpio_write(5, 0);
        delay_ms(500);
        printf("blink %d\\n", i + 1);
    }
    return 0;
}
`;

interface CProgram { compiled: boolean; bin?: string; listing?: string; size?: number; end?: number; mem?: number; elf?: string; errors: { file: string; line: number; msg: string }[] }
/** the last compiled C program */
let cprog: CProgram | null = null;
/** the hardware last flashed (veryl files, top, pins, mode): only the program changed -> swap it */
let boardHw = '';

/** a project for the RV64 board (machine.json with an exchange area): its C programs run on Linux */
function boardProject(): boolean { return !!machineCfg()?.files; }

/** the project's C program (one .c file; on the board: the one open, else the last one run, else the first) */
function cFile(): VFile | undefined {
  const cs = proj.files.filter(f => f.name.endsWith('.c'));
  if (boardProject()) return cs.find(f => f.name === proj.active) ?? cs.find(f => f.name === boardFile) ?? cs[0];
  return cs[0];
}

async function compileC(c: Core, f = cFile()!): Promise<CProgram> {
  cprog = await c.call<CProgram>({ cmd: 'cc', src: f.src, name: f.name, linux: boardProject() });
  return cprog;
}

function cProblems(r: CProgram): typeof problems {
  const f = cFile();
  return r.errors.map(e => e.file === f?.name
    ? { file: f.name, line: e.line, col: 1, msg: e.msg, severity: 'error' as const, from: 'check' as const }
    : { msg: `${e.file}:${e.line}: ${e.msg}`, severity: 'error' as const, from: 'check' as const });
}

/** run the C program on the instruction-set simulator: its serial output in the Output panel */
async function runC(): Promise<void> {
  if (!core || !cFile()) { alert(tr('這個專案沒有 .c 檔', 'This project has no .c file')); return; }
  if (boardProject()) { runOnBoard(); return; }
  const f = cFile()!;
  const input = prompt(tr('要從序列埠送給程式的文字（可以空白）', 'Text the program receives on the serial port (may be empty)'), '') ?? '';
  const r = await core.call<CProgram & { run?: { tx: string; halted: boolean; error: string | null; instret: number; cycles: number; led: number } }>({ cmd: 'cc', src: f.src, name: f.name, run: 5_000_000, input: input ? input + '\r' : '' });
  if (!r.compiled) { problems = [...cProblems(r), ...problems.filter(p => p.from === 'run')]; renderProblems(); panel('problems'); return; }
  const x = r.run!;
  $('p-output').textContent = x.tx.replace(/\r\n/g, '\n') + '\n' + (x.error ?? '') + tr(
    `── ${f.name}：${x.halted ? '執行完畢' : '執行了 500 萬個指令後停止'}，${x.instret} 個指令、${x.cycles} 個時脈（12 MHz 下 ${(x.cycles / 12e3).toFixed(1)} ms），LED = 0x${x.led.toString(16)}（指令集模擬器，不是硬體）`,
    `── ${f.name}: ${x.halted ? 'finished' : 'stopped after 5 million instructions'}, ${x.instret} instructions, ${x.cycles} clock cycles (${(x.cycles / 12e3).toFixed(1)} ms at 12 MHz), LED = 0x${x.led.toString(16)} (instruction-set simulator, not the hardware)`);
  panel('output');
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
  if (!problems.length) { box.innerHTML = `<div class="none">${tr('沒有問題。', 'No problems.')}</div>`; }
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
  st.innerHTML = `<option value="">${tr('全部 #[test]', 'all #[test]')}</option>` + mods.map(m => `<option value="${esc(m.name)}">${esc(m.name)}${m.test ? '  (test)' : ''}</option>`).join('');
  if (mods.some(m => m.name === keep)) st.value = keep;
  const sy = $<HTMLSelectElement>('synthTop');
  const designs = mods.filter(m => !m.test);
  const want = sy.value && designs.some(m => m.name === sy.value) ? sy.value : designs.some(m => m.name === proj.synth) ? proj.synth! : designs[designs.length - 1]?.name ?? '';
  sy.innerHTML = designs.map(m => `<option value="${esc(m.name)}">${esc(m.name)}</option>`).join('');
  sy.value = want;
  renderTests();
  renderOutline();
  syncStage();
}

// ---------------------------------------------------------------- tests

function renderTests(): void {
  const box = $('testList');
  box.innerHTML = '';
  const tests = mods.filter(m => m.test);
  if (!tests.length) { box.innerHTML = `<p class="side-hint">${tr('沒有 #[test] 模組。在模組前加上 <code>#[test(name)]</code>，用 <code>$tb::clock_gen</code>、<code>$assert</code> 寫 testbench。', 'No #[test] modules. Put <code>#[test(name)]</code> before a module and write the testbench with <code>$tb::clock_gen</code> and <code>$assert</code>.')}</p>`; return; }
  for (const t of tests) {
    const s = testState.get(t.name);
    const d = document.createElement('div');
    d.className = 'item ' + (s ?? '');
    d.innerHTML = `<span class="ic">${s === 'pass' ? '✓' : s === 'fail' ? '✗' : s === 'run' ? '…' : '○'}</span><span class="nm">${esc(t.name)}</span><span class="acts"><button class="icon" title="${tr('執行', 'Run')}">▶</button></span>`;
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

const KIND = (k: string) => ({ rtl: 'RTL', opt: tr('通用閘', 'generic gates'), ice40: 'iCE40', asic: tr('標準元件', 'standard cells') } as Record<string, string>)[k] ?? k;

async function simulate(top: string | null, mode: string, vcd: boolean): Promise<SimResult & { gate: { top: string; cells: number } | null }> {
  const files = proj.files.filter(f => f.name.endsWith('.veryl'));
  // a machine (machine.json) is too large for the testbench simulator: it runs in the emulator
  const mc = machineCfg();
  if (mc && ((!top && !mods.some(m => m.test)) || top === mc.top)) throw new Error(tr(`${mc.top} 是模擬機（machine.json），太大不適合 testbench 模擬：請按「🖥 模擬機」`, `${mc.top} is a machine (machine.json), too large for the testbench simulator: use "🖥 Emulator"`));
  const gate = mode === 'rtl' ? {} : { gate: mode, synth: synthTop() };
  if (mode !== 'rtl' && !synthTop()) throw new Error(tr('沒有可合成的模組（閘級模擬需要合成頂層）', 'No synthesizable module (gate-level simulation needs a synthesis top)'));
  return core!.call({ cmd: 'simulate', files, top, max_time: 1_000_000, vcd, ...gate });
}

async function runTests(only?: string): Promise<void> {
  if (!core) return;
  const top = only ?? ($<HTMLSelectElement>('simTop').value || null);
  const mode = $<HTMLSelectElement>('simMode').value;
  const names = top ? [top] : mods.filter(m => m.test).map(m => m.name);
  for (const n of names) testState.set(n, 'run');
  renderTests();
  setBusy(true, tr(`▶ 測試中（${KIND(mode)}）…`, `▶ Testing (${KIND(mode)})…`));
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
    const where = r.gate ? tr(`　閘級：${r.gate.top} → ${r.gate.cells} 個${KIND(mode)}元件`, `　gate level: ${r.gate.top} → ${r.gate.cells} ${KIND(mode)}`) : '';
    const msg = fails.length ? tr(`✗ ${fails.reduce((a, t) => a + t.fails, 0)} 個斷言失敗（${fails.map(t => t.name).join(', ')}）`, `✗ ${fails.reduce((a, t) => a + t.fails, 0)} assertion(s) failed (${fails.map(t => t.name).join(', ')})`) : tr(`✓ ${r.tops.length} 個測試通過`, `✓ ${r.tops.length} test(s) passed`);
    $('p-results').innerHTML = `<div class="banner ${fails.length ? 'fail' : 'pass'}">${esc(msg + where)}</div>`
      + `<table><tr><th>testbench</th><th>${KIND(mode)}</th><th>${tr('結束', 'End')}</th></tr>${r.tops.map(t => `<tr><td>${esc(t.name)}</td><td class="${t.fails ? 'fail' : 'pass'}">${t.fails ? tr(`✗ ${t.fails} 個失敗`, `✗ ${t.fails} failed`) : '✓ PASS'}</td><td>${t.finished ? '$finish' : tr('時間到', 'time limit')}</td></tr>`).join('')}</table>`;
    $('sbTest').textContent = `${fails.length ? '✗' : '✓'} ${msg.slice(2)}（${((performance.now() - t0) / 1000).toFixed(2)} s）`;
    // assertion failures with their time stamps also go to the problems list
    for (const ln of r.log.split('\n')) if (/ASSERTION FAILED/.test(ln)) problems.push({ msg: ln.trim(), severity: 'error', from: 'run' });
    panel(fails.length ? 'output' : 'results');
  } catch (e) {
    for (const n of names) testState.delete(n);
    const errs = parseErrors(String((e as Error).message ?? e), 'run');
    problems.push(...errs);
    $('p-output').textContent = String((e as Error).message ?? e);
    $('sbTest').textContent = tr('✗ 錯誤', '✗ Error');
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
  if (!tests.length) { alert(tr('沒有 #[test] 模組可以跑', 'There are no #[test] modules to run')); return; }
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
      return `<td class="${v === '0' ? 'pass' : v === 'err' ? 'fail' : 'fail'}">${v === '0' ? '✓' : v === 'err' ? tr('錯誤', 'error') : `✗ ${v}`}</td>`;
    }).join('')}</tr>`).join('');
    const allPass = [...res.values()].every(m => [...m.values()].every(v => v === '0'));
    $('p-results').innerHTML = (done ? `<div class="banner ${allPass && same ? 'pass' : 'fail'}">${allPass && same ? tr(`✓ 全面驗證通過：${tests.length} 個 testbench × ${modes.length} 種實作結果一致`, `✓ Full verification passed: ${tests.length} testbench(es) × ${modes.length} implementations agree`) : same ? tr('✗ 有測試失敗（各實作結果一致）', '✗ Tests fail (the same in every implementation)') : tr('✗ 合成前後結果不一致！', '✗ Results before and after synthesis differ!')}</div>` : `<div class="banner">${tr('驗證中…', 'Verifying…')}</div>`)
      + `<table><tr><th>testbench</th>${modes.map(m => `<th>${KIND(m)}${cells.has(m) ? `<br><small>${tr(`${cells.get(m)} 元件`, `${cells.get(m)} cells`)}</small>` : ''}</th>`).join('')}</tr>${rows}</table>`
      + (synthTop() ? `<p class="side-hint">${tr(`閘級：把 ${esc(synthTop())} 換成合成後的網表，跑同一組 testbench。`, `Gate level: ${esc(synthTop())} is replaced by its synthesized netlist under the same testbenches.`)}</p>` : '');
  };
  setBusy(true, tr('✔ 全面驗證中…', '✔ Verifying…'));
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
      problems.push(...parseErrors(`[${KIND(m)}] ` + String((e as Error).message ?? e), 'run'));
      renderProblems();
    }
    res.set(m, col);
  }
  draw(true);
  for (const t of tests) testState.set(t, res.get('rtl')?.get(t) === '0' ? 'pass' : 'fail');
  renderTests();
  $('sbTest').textContent = tr(`✔ 全面驗證 ${((performance.now() - t0) / 1000).toFixed(1)} s`, `✔ Full verification ${((performance.now() - t0) / 1000).toFixed(1)} s`);
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
  if (!top) { alert(tr('沒有可合成的模組（#[test] 模組不能合成）', 'No synthesizable module (#[test] modules cannot be synthesized)')); return; }
  if (machineCfg()?.top === top) { alert(tr(`${top} 是模擬機（machine.json），太大不能合成：請選它裡面的模組，或按「🖥 模擬機」`, `${top} is a machine (machine.json), too large to synthesize: pick a module inside it, or use "🖥 Emulator"`)); return; }
  const files = proj.files.filter(f => f.name.endsWith('.veryl'));
  const key = JSON.stringify([files, top, pcfOf(proj)]);
  openFile(FLOW_TAB);
  // the chip views need the room on small screens; the panel comes back with the next run
  if (window.innerHeight < 900) $('panel').classList.add('collapsed');
  synth.setPdk(flowPdk());
  if (key !== synthKey || !synth.synthesized) {
    synthKey = key;
    const target = stage && isAsicStage(stage) ? 'asic' : stage && isFpgaStage(stage) ? 'fpga' : undefined;
    synth.open(files, top, pcfOf(proj), target ?? flowTarget(), stage);
  } else if (stage) synth.showStage(stage);
}

/** the title bar's back end: FPGA, or ASIC on vlib / SKY130 */
/** the target menu has the synthesis back ends and the emulators: the last synthesis one chosen */
let synthTarget = 'fpga';
const synthValue = (): string => { const v = $<HTMLSelectElement>('flowTarget').value; if (!v.startsWith('emu-')) synthTarget = v; return synthTarget; };
const flowTarget = (): 'fpga' | 'asic' => synthValue() === 'fpga' ? 'fpga' : 'asic';
const flowPdk = (): 'vlib' | 'sky130' => synthValue() === 'sky130' ? 'sky130' : 'vlib';

/** the target menu follows the tab: the emulator's engine there, else the synthesis target; emulators the project cannot use are off */
function syncTarget(): void {
  const sel = $<HTMLSelectElement>('flowTarget');
  const cfg = machineCfg();
  (sel.querySelector('[value="emu-veryl"]') as HTMLOptionElement).disabled = !cfg;
  (sel.querySelector('[value="emu-riscv"]') as HTMLOptionElement).disabled = !cfg?.riscv;
  const want = proj.active === EMU_TAB && cfg ? `emu-${emuEngine()}` : synthValue();
  if (sel.value !== want) sel.value = want;
}

/** the title bar's stage menu: the back end's stages, then the comparison; "⚙ Synthesize" while the flow tab is not shown */
function fillStages(): void {
  const sel = $<HTMLSelectElement>('flowStage');
  sel.innerHTML = `<option value="" hidden>${tr('⚙ 合成', '⚙ Synthesize')}</option>`
    + flow(flowTarget() === 'asic').map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')
    + `<option disabled>──────────</option><option value="cmp">${tr('⇄ FPGA vs ASIC 比較', '⇄ FPGA vs ASIC')}</option>`;
  syncStage();
}

/** show the stage on view in the menu and the breadcrumb */
function syncStage(): void {
  const k = proj.active === FLOW_TAB && synth?.synthesized ? synth.current : '';
  const sel = $<HTMLSelectElement>('flowStage');
  sel.value = [...sel.options].some(o => o.value === k) ? k : '';
  const label = sel.value ? sel.selectedOptions[0].textContent! : '';
  $('synCrumb').innerHTML = `<span class="c" data-c="synthTop">${esc(synthTop())}</span><span class="sep">›</span>`
    + (k === 'cmp' ? '' : `<span class="c" data-c="flowTarget">${flowTarget() === 'asic' ? (flowPdk() === 'sky130' ? 'ASIC · SKY130' : 'ASIC') : 'FPGA'}</span><span class="sep">›</span>`)
    + `<span class="c last" data-c="flowStage">${esc(label)}</span>`;
  // the download menu only where there is something to download
  $('synDl').classList.toggle('hidden', ![...$('synDlMenu').children].some(b => !b.classList.contains('hidden')));
}

/** the flow's numbers, compact in the status bar (all of them in its tooltip) */
function synthStatus(): void {
  const items = $('synStats').innerHTML.split(/<span class="sep">[^<]*<\/span>/).map(x => x.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').trim()).filter(Boolean);
  const sb = $('sbSynth');
  if (!items.length) { sb.textContent = sb.title = ''; return; }
  const pick = items.filter((x, i) => i === 1 || /^LUT4 |DFF \d|^Fmax/.test(x)).map(x => x.replace(/ → /, '→'));
  sb.textContent = `⚙ ${synthTop()} · ${pick.join(' · ')}`;
  sb.title = items.join('\n');
}

// ---------------------------------------------------------------- emulator

let emu: Emulator | null = null;
declare const VERYL_IMAGES: Record<string, string> | undefined;

/** the project's machine.json (null: none or not valid JSON) */
function machineCfg(): MachineCfg | null {
  const f = proj.files.find(x => x.name === 'machine.json');
  if (!f) return null;
  try { return JSON.parse(f.src) as MachineCfg; } catch { return null; }
}

/** the project's files for the board (not the hardware: Veryl, machine.json, pins) and programs as an exchange area */
function projectArea(programs: { name: string; src: Uint8Array; mode: number }[] = []): Uint8Array {
  const fs = proj.files.filter(f => !f.name.endsWith('.veryl') && f.name !== 'machine.json' && !f.name.endsWith('.pcf'));
  return exchangeArea(tarFiles([...fs, ...programs]));
}

/** savefiles on the board: its /root (no hidden files) into the project */
function filesBack(area: Uint8Array): string {
  const t = readExchangeArea(area);
  if (!t) return tr('板子沒有送回檔案', 'The board sent no files');
  // text files only (not the compiled programs)
  const got = untarFiles(t).filter(f => !f.name.split('/').some(p => p.startsWith('.')) && !f.name.includes('/') && !f.data.includes(0));
  for (const f of got) {
    const cur = file(f.name);
    if (cur) cur.src = f.src; else proj.files.push({ name: f.name, src: f.src });
  }
  changed();
  if (proj.active && file(proj.active) && !special(proj.active)) showActive();
  return tr(`板子送回 ${got.length} 個檔案：${got.map(f => f.name).join('、')}`, `The board sent back ${got.length} file(s): ${got.map(f => f.name).join(', ')}`);
}

/** the layout of the model the emulator runs now (saved states only fit it) */
let emuFp = '';

/** a small IndexedDB store for the emulator's saved states (they are megabytes: not localStorage) */
function idb(): Promise<IDBDatabase> {
  return new Promise((ok, fail) => {
    const r = indexedDB.open('veryl2chip-ide', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => ok(r.result);
    r.onerror = () => fail(r.error);
  });
}
async function idbGet<T>(k: string): Promise<T | undefined> {
  try {
    const db = await idb();
    return await new Promise<T | undefined>((ok, fail) => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => ok(q.result as T); q.onerror = () => fail(q.error); });
  } catch { return undefined; }
}
async function idbPut(k: string, v: unknown): Promise<void> {
  const db = await idb();
  await new Promise<void>((ok, fail) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = () => ok(); t.onerror = () => fail(t.error); });
}

/** a bundled snapshot (img_snap_NAME.js: memory as gzip + base64, the cycle, the boot log, the layout's fingerprint) */
async function bundledSnap(name: string): Promise<{ fingerprint: string; cycle: number; log: string; data: Uint8Array } | null> {
  const id = `snap_${name}`;
  const get = () => (typeof VERYL_IMAGES !== 'undefined' ? (VERYL_IMAGES as unknown as Record<string, { fingerprint: string; cycle: number; log: string; data: string }>)[id] : undefined);
  if (!get()) {
    await new Promise<void>((ok) => {
      const s = document.createElement('script');
      s.src = `img_${id}.js`;
      s.onload = () => ok();
      s.onerror = () => ok();
      document.head.appendChild(s);
    });
  }
  const x = get();
  return x ? { fingerprint: x.fingerprint, cycle: x.cycle, log: x.log, data: await gunzip(fromBase64(x.data)) } : null;
}

/** a bundled program image (img_NAME.js, loaded when first needed; gzip + base64) */
async function image(name: string): Promise<Uint8Array> {
  const have = () => typeof VERYL_IMAGES !== 'undefined' && VERYL_IMAGES[name];
  if (!have()) {
    await new Promise<void>((ok, fail) => {
      const s = document.createElement('script');
      s.src = `img_${name}.js`;
      s.onload = () => ok();
      s.onerror = () => fail(new Error(tr(`找不到程式映像 img_${name}.js`, `program image img_${name}.js not found`)));
      document.head.appendChild(s);
    });
  }
  if (!have()) throw new Error(tr(`程式映像 ${name} 沒有載入`, `program image ${name} is not loaded`));
  return gunzip(fromBase64(VERYL_IMAGES![name]));
}

function ensureEmu(): Emulator {
  if (!emu) {
    emu = new Emulator($('emuPane'));
    emu.onStart = startEmu;
    emu.getParts = () => proj.piBoard ?? null;
    emu.getRun = boardRun;
    emu.getRunFiles = boardRunFiles;
    emu.getEngine = () => (machineCfg()?.riscv ? emuEngine() : null);
    emu.onEngine = (e) => { proj.emuEngine = e; persist(); syncTarget(); };
    emu.getFiles = projectArea;
    emu.onFilesBack = filesBack;
    emu.onSave = async (st) => { if (emuFp) await idbPut(`state:${proj.id}`, { fingerprint: emuFp, ...st }); };
    emu.onParts = (parts) => { proj.piBoard = parts.map(p => ({ ...p })); persist(); };
  }
  return emu;
}

/** how the board runs a file (.py with MicroPython, .sh with the shell, .c compiled: ./NAME; null: it does not) */
const boardCmd = (n: string): string | null => n.endsWith('.py') ? `micropython ${n}` : n.endsWith('.sh') ? `sh ${n}` : n.endsWith('.c') ? `./${n.slice(0, -2)}` : null;
/** the last file opened that the board can run */
let boardFile = '';

/** what "▶ run on the board" runs: the open file, else the last one, else main.py, else the first one */
function boardRun(): { name: string; cmd: string } | null {
  if (!machineCfg()?.files) return null;
  const ok = (n: string) => !!file(n) && !!boardCmd(n);
  const n = [proj.active ?? '', boardFile, 'main.py'].find(ok) ?? proj.files.map(f => f.name).find(ok);
  return n ? { name: n, cmd: boardCmd(n)! } : null;
}

/** the exchange area for a run: the project's files, and a C program compiled (errors: the Problems panel) */
async function boardRunFiles(r: { name: string; cmd: string }): Promise<Uint8Array | string> {
  if (!r.name.endsWith('.c')) return projectArea();
  if (!core) return tr('核心還沒載入', 'The core is not loaded yet');
  const f = file(r.name)!;
  const p = await compileC(core, f);
  const errs = cProblems(p);
  problems = [...errs, ...problems.filter(x => x.file !== f.name)];
  renderProblems();
  if (!p.compiled) { panel('problems'); return tr(`${f.name} 有 ${errs.length} 個錯誤（見「問題」面板）`, `${f.name} has ${errs.length} error(s) (see the Problems panel)`); }
  return projectArea([{ name: f.name.slice(0, -2), src: fromBase64(p.elf!), mode: 0o755 }]);
}

function runOnBoard(): void {
  const e = ensureEmu();
  const r = boardRun();
  if (r) boardFile = r.name;
  openFile(EMU_TAB);
  e.run();
}

/** ▶ / Ctrl+Enter: a script open in a board project runs on the board, else the tests */
function runKey(): void {
  if (!core) return;
  if (!projCaps().test.on) { showWhy('test', $('cmdRun')); return; }
  if (machineCfg()?.files && boardCmd(proj.active ?? '')) runOnBoard(); else runTests();
}

// ---------------------------------------------------------------- the main button and its menu

/** the title bar: 'basic' (the main button, its menu; the flow menus on the flow tab) or 'full' (every control, grouped by intent) */
let uiMode: 'basic' | 'full' = load<'basic' | 'full'>('mode', 'basic');
function setMode(m: 'basic' | 'full'): void { uiMode = m; save('mode', m); applyMode(); }
function applyMode(): void {
  document.body.classList.toggle('basic', uiMode === 'basic');
  $('modeBtn').textContent = uiMode === 'basic' ? tr('進階 ▸', 'Advanced ▸') : tr('◂ 簡易', '◂ Simple');
  $('modeBtn').title = uiMode === 'basic'
    ? tr('顯示所有控制：驗證（測試的頂層、閘級模擬、全面驗證）、看電路（目標、階段、頂層）、跑起來（虛擬板、模擬機）', 'Show every control: verify (simulation top, gate level, verify all), circuit (target, stage, top), run it (virtual board, emulator)')
    : tr('簡易：只留主按鈕與它的選單（▾），合成流程分頁裡才出現合成的選單', 'Simple: only the main button and its menu (▾); the synthesis menus appear on the flow tab');
}

/** the main button: the suggested step (a board program open: run it) */
function mainClick(): void {
  if (!core) return;
  const onBoard = !!machineCfg()?.files && !!boardCmd(proj.active ?? '');
  if (onBoard) runKey(); else act(start(capIn()), $('mainBtn'));
}

/** synthesize for a back end of the target menu (fpga, asic, sky130), at a stage */
function synthOn(v: string, stage?: string): void {
  $<HTMLSelectElement>('flowTarget').value = v;
  synthValue();
  fillStages();
  runSynth(stage);
}

/** boot the machine on an engine (a running machine of the other engine boots again) */
function bootEngine(engine: 'veryl' | 'riscv'): void {
  if (machineCfg()?.riscv) proj.emuEngine = engine;
  persist();
  const e = ensureEmu();
  openFile(EMU_TAB);
  if (!e.running || e.engine !== emuEngine()) e.boot();
}

interface MenuItem { act: Act; label: string; hint: string; run: () => void; /** not the suggested way of its action */ alt?: boolean }
/** every action, by what the user wants: verify, see the circuit, run it */
function menuItems(): [string, MenuItem[]][] {
  const ci = capIn();
  const run = boardRun();
  const onBoard = !!machineCfg()?.files && !!boardCmd(proj.active ?? '');
  const synth = (v: string, name: string, hint: string): MenuItem => ({ act: 'synth', label: `⚙ ${tr('合成', 'Synthesize')}${tr('：', ': ')}${name}`, hint, run: () => synthOn(v), alt: v !== 'fpga' });
  const mc = machineCfg();
  return [
    [tr('驗證', 'Verify'), [
      onBoard && run ? { act: 'test', label: tr(`▶ 執行 ${run.name}`, `▶ Run ${run.name}`), hint: tr('在板子上執行（Ctrl/⌘+Enter）', 'on the board (Ctrl/⌘+Enter)'), run: runKey }
        : { act: 'test', label: actName('test'), hint: actHint('test', ci) + tr('（Ctrl/⌘+Enter）', ' (Ctrl/⌘+Enter)'), run: () => runTests() },
      { act: 'verify', label: actName('verify'), hint: tr('RTL 和三種合成後的網表跑同一組 testbench，結果要一致', 'the same testbenches on the RTL and three synthesized netlists: they must agree'), run: verifyAll },
    ]],
    [tr('看電路', 'See the circuit'), [
      synth('fpga', 'FPGA（iCE40）', tr('LUT、進位鏈、block RAM、佈局繞線、時序', 'LUTs, carry chains, block RAM, place and route, timing')),
      synth('asic', 'ASIC · vlib', tr('標準元件、擺放、繞線、時序、功耗', 'standard cells, placement, routing, timing, power')),
      synth('sky130', 'ASIC · SKY130', tr('SkyWater 130 nm 製程：DRC、GDSII 晶片版圖', 'SkyWater 130 nm: DRC, a GDSII chip layout')),
      { act: 'synth', label: tr('⇄ FPGA 與 ASIC 比較', '⇄ FPGA vs ASIC'), hint: tr('同一個設計兩種做法的面積與速度', 'area and speed of the same design both ways'), run: () => runSynth('cmp'), alt: true },
    ]],
    [tr('跑起來', 'Run it'), [
      { act: 'board', label: actName('board'), hint: actHint('board', ci), run: flashBoard },
      ...(mc?.riscv
        ? [{ act: 'emu' as Act, label: tr('🖥 模擬機 · riscv-emu（指令集，快）', '🖥 Emulator · riscv-emu (instruction set, fast)'), hint: tr('像 QEMU：開機幾秒，寫程式用', 'like QEMU: boots in seconds, for writing software'), run: () => bootEngine('riscv') },
          { act: 'emu' as Act, label: tr('🖥 模擬機 · veryl-emu（硬體本身）', '🖥 Emulator · veryl-emu (the hardware itself)'), hint: tr('你的 Veryl 電路一拍一拍地跑：改了硬體用這個', 'your Veryl circuit cycle by cycle: use it after changing the hardware'), run: () => bootEngine('veryl'), alt: true }]
        : [{ act: 'emu' as Act, label: actName('emu'), hint: actHint('emu', ci), run: openEmu }]),
    ]],
  ];
}

function showMenu(): void {
  if (!core) return;
  hideWhy();
  const c = projCaps();
  const first = start(capIn());
  const groups = menuItems();
  const items = groups.flatMap(([, it]) => it);
  const m = $('mainMenu');
  let k = 0;
  m.innerHTML = groups.map(([name, it]) => `<div class="sec">${esc(name)}</div>` + it.map(x => {
    const on = c[x.act].on;
    const star = on && x.act === first && !x.alt ? `<i>${tr('建議', 'suggested')}</i>` : '';
    return `<button class="mi${on ? '' : ' off'}" data-k="${k++}"><b>${esc(x.label)}${star}</b><span>${esc(on ? x.hint : c[x.act].why ?? '')}</span></button>`;
  }).join('')).join('')
    + `<button class="mi foot" data-k="mode"><b>${uiMode === 'basic' ? tr('進階 ▸ 標題列顯示所有控制', 'Advanced ▸ every control in the title bar') : tr('◂ 簡易：只留主按鈕', '◂ Simple: only the main button')}</b></button>`;
  m.classList.remove('hidden');
  const r = $('mainAct').getBoundingClientRect();
  m.style.top = `${r.bottom + 4}px`;
  m.style.left = `${Math.max(8, Math.min(r.left, innerWidth - m.offsetWidth - 8))}px`;
  m.onclick = e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-k]');
    if (!b) return;
    hideMenu();
    if (b.dataset.k === 'mode') { setMode(uiMode === 'basic' ? 'full' : 'basic'); return; }
    const x = items[+b.dataset.k!];
    if (!c[x.act].on) showWhy(x.act, $('mainBtn')); else x.run();
  };
}
function hideMenu(): void { $('mainMenu').classList.add('hidden'); }

// ---------------------------------------------------------------- what the project can do

function capIn(): CapInput { return { files: proj.files, mods: modsKnown ? mods : null, top: synthTop(), active: proj.active }; }
function projCaps(): ReturnType<typeof caps> { return caps(capIn()); }
function exCapIn(ex: Example): CapInput { return { files: ex.pcf ? [...ex.files, { name: PCF, src: ex.pcf }] : ex.files, mods: null, top: ex.synth ?? '' }; }
const badgeName = (a: Act) => a === 'test' ? tr('有 testbench：▶ 測試', 'has testbenches: ▶ Test')
  : a === 'board' ? tr('有腳位：⚡ 放上虛擬板', 'has pins: ⚡ virtual board') : tr('一台機器：🖥 模擬機開機', 'a machine: 🖥 boot it in the emulator');
/** the title bar button of each action */
const ACT_BTN: [Act, string][] = [['test', 'cmdRun'], ['verify', 'cmdVerify'], ['board', 'cmdBoard'], ['emu', 'cmdEmu']];
/** the buttons' own tooltips [Chinese, English] */
const btnTitle = new Map<string, [string, string]>();

/** buttons the project cannot use look off and explain why when clicked; the suggested first step is the primary button */
function applyCaps(): void {
  if (!core) return;
  const c = projCaps();
  const first = start(capIn());
  const onBoard = c.test.on && !!machineCfg()?.files && !!boardCmd(proj.active ?? '');
  for (const [a, id] of ACT_BTN) {
    const b = $(id);
    if (!btnTitle.has(id)) btnTitle.set(id, [b.title, b.dataset.enTitle ?? b.title]);
    const [zh, en] = btnTitle.get(id)!;
    b.classList.toggle('off', !c[a].on);
    b.setAttribute('aria-disabled', String(!c[a].on));
    b.title = !c[a].on ? `${c[a].why}\n${tr('（點一下看怎麼辦）', '(click for what to do)')}`
      : id === 'cmdRun' && onBoard ? tr(`在板子上執行 ${proj.active}（Ctrl/⌘+Enter）`, `Run ${proj.active} on the board (Ctrl/⌘+Enter)`) : tr(zh, en);
    b.classList.remove('primary');
  }
  const mb = $<HTMLButtonElement>('mainBtn');
  mb.disabled = $<HTMLButtonElement>('mainMore').disabled = false;
  mb.textContent = onBoard ? tr(`▶ 執行 ${proj.active}`, `▶ Run ${proj.active}`) : actName(first);
  mb.title = onBoard ? tr(`在板子上執行 ${proj.active}（Ctrl/⌘+Enter）`, `Run ${proj.active} on the board (Ctrl/⌘+Enter)`)
    : tr(`這個專案建議的下一步：${actHint(first, capIn())}。▾ 有其他做法`, `The suggested next step for this project: ${actHint(first, capIn())}. ▾ has the others`);
  const fs = $<HTMLSelectElement>('flowStage');
  fs.disabled = !c.synth.on;
  fs.title = c.synth.on ? tr('合成並檢視這個階段（Ctrl/⌘+Shift+B）', 'Synthesize and view this stage (Ctrl/⌘+Shift+B)') : c.synth.why!;
  renderGuide();
}

/** a title bar action or a suggested step: done if the project can, else why not */
function act(a: Act, el: HTMLElement): void {
  if (!core) return;
  if (!projCaps()[a].on) { showWhy(a, el); return; }
  hideWhy();
  if (a === 'test') runKey();
  else if (a === 'verify') verifyAll();
  else if (a === 'board') flashBoard();
  else if (a === 'emu') openEmu();
  else runSynth();
}

const PCF_TEMPLATE = `# Pins of the iCEBreaker (iCE40UP5K-SG48): set_io PORT PIN, PORT = a port of the design
# synthesized (rename these to yours). -nowarn: the design may leave pins out.
set_io -nowarn i_clk    35  # 12 MHz oscillator
set_io -nowarn i_rst    10  # BTN_N, onboard button (pressed = 0)
set_io -nowarn o_ledr   11  # LEDR_N, onboard red LED (lit at 0)
set_io -nowarn o_ledg   37  # LEDG_N, onboard green LED (lit at 0)
set_io -nowarn o_led[0] 26  # LED1 (break-off section, lit at 1)
set_io -nowarn o_led[1] 27  # LED2
set_io -nowarn o_led[2] 25  # LED3
set_io -nowarn o_led[3] 23  # LED4
set_io -nowarn o_led[4] 21  # LED5
set_io -nowarn i_btn    20  # BTN1 (break-off section, pressed = 1)
set_io -nowarn i_rx     6   # RX: the FTDI serial port into the FPGA
set_io -nowarn o_tx     9   # TX: from the FPGA to the computer
`;

/** the first program for the board: main.py, else the first .py / .c / .sh */
const firstProgram = () => file('main.py') ? 'main.py' : proj.files.map(f => f.name).find(n => !!boardCmd(n));
function fixName(f: Fix): string {
  return f === 'flashAnyway' ? tr('仍要燒錄（預設腳位）', 'Flash anyway (default pins)')
    : f === 'addPcf' ? tr(`新增 ${PCF}`, `Add ${PCF}`)
    : f === 'openProgram' ? tr(`打開 ${firstProgram() ?? ''}`, `Open ${firstProgram() ?? ''}`)
    : f === 'emu' ? tr('🖥 開機', '🖥 Boot')
    : tr('開啟範例「RV64 開發板」', 'Open the "RV64 board" example');
}
function doFix(f: Fix): void {
  if (f === 'flashAnyway') flashBoard();
  else if (f === 'addPcf') { if (!file(PCF)) proj.files.push({ name: PCF, src: PCF_TEMPLATE }); openFile(PCF); changed(); }
  else if (f === 'openProgram') { const n = firstProgram(); if (n) openFile(n); }
  else if (f === 'emu') openEmu();
  else { const ex = examples().find(e => e.id === 'rv64_linux'); if (ex) openExample(ex); }
}

function showWhy(a: Act, anchor: HTMLElement): void {
  const c = projCaps()[a];
  const pop = $('capPop');
  pop.innerHTML = `<b>${esc(actName(a))} ${tr('不能直接用', 'is not available')}</b><p>${esc(c.why ?? '')}</p>`
    + (c.fix?.length ? `<div class="fixes">${c.fix.map(f => `<button class="tb-btn" data-fix="${f}">${esc(fixName(f))}</button>`).join('')}</div>` : '');
  pop.classList.remove('hidden');
  const r = anchor.getBoundingClientRect();
  pop.style.top = `${r.bottom + 6}px`;
  pop.style.left = `${Math.max(8, Math.min(r.left, innerWidth - pop.offsetWidth - 8))}px`;
  pop.onclick = e => { const f = (e.target as HTMLElement).dataset.fix as Fix | undefined; if (f) { hideWhy(); doFix(f); } };
}
function hideWhy(): void { $('capPop').classList.add('hidden'); }

/** the suggested steps above the editor (closed with ×, back from the command palette) */
function renderGuide(): void {
  const g = $('guide');
  // the welcome page has its own starting points
  const show = !!core && !proj.guideOff && proj.active !== WELCOME;
  g.classList.toggle('hidden', !show);
  if (!show) return;
  const ci = capIn();
  g.innerHTML = `<span class="lbl">${tr('建議步驟', 'Suggested steps')}</span>`
    + steps(ci).map((a, i) => `<button class="step${i ? '' : ' first'}" data-step="${a}"><b>${'①②③'[i]} ${esc(actName(a))}</b><span>${esc(actHint(a, ci))}</span></button>`).join('<span class="arr">→</span>')
    + `<button class="close" title="${attr(tr('關閉（命令選單的「顯示建議步驟」可以再打開）', 'Close (the command palette\'s "Show the suggested steps" brings it back)'))}">×</button>`;
}

function openEmu(): void {
  const e = ensureEmu();
  openFile(EMU_TAB);
  if (!e.running) e.boot();
}

/** the emulator's engine: riscv-emu (instruction set, fast) where it can run the machine, else veryl-emu (the hardware) */
function emuEngine(): 'veryl' | 'riscv' { return machineCfg()?.riscv ? proj.emuEngine ?? 'riscv' : 'veryl'; }

declare const VERYL_RVEMU_B64: string | undefined;
/** riscv-emu's wasm (rvemu.js, loaded when first needed) */
async function rvWasm(): Promise<Uint8Array> {
  if (typeof VERYL_RVEMU_B64 === 'undefined') {
    await new Promise<void>((ok, fail) => {
      const s = document.createElement('script');
      s.src = 'rvemu.js';
      s.onload = () => ok();
      s.onerror = () => fail(new Error(tr('找不到 rvemu.js', 'rvemu.js not found')));
      document.head.appendChild(s);
    });
  }
  return fromBase64(VERYL_RVEMU_B64!);
}

async function startEmu(): Promise<EmuStart | null> {
  if (!core) return null;
  const f = proj.files.find(x => x.name === 'machine.json');
  if (!f) throw new Error(tr('這個專案沒有 machine.json：模擬機要知道頂層模組、重設、UART、RAM 等腳位（可以參考範例「RV64 + Linux」）', 'This project has no machine.json: the emulator needs the top module, the reset, UART and RAM ports (see the example "RV64 + Linux")'));
  let cfg: MachineCfg;
  try { cfg = JSON.parse(f.src); } catch (e) { throw new Error('machine.json: ' + (e as Error).message); }
  if (emuEngine() === 'riscv') {
    // riscv-emu: the board's programs on the instruction-set emulator (the Veryl source is not used); a cold boot takes seconds
    const wasm = await rvWasm();
    const images: EmuStart['images'] = [];
    for (const l of cfg.load ?? []) images.push({ bytes: await image(l.image), addr: l.addr });
    emuFp = `riscv-emu:${wasm.length}`;
    let snap: EmuStart['snap'];
    const saved = await idbGet<{ fingerprint: string; cycle: number; log: string; data: Uint8Array }>(`state:${proj.id}`);
    if (saved && saved.fingerprint === emuFp) snap = { data: await gunzip(saved.data), cycle: saved.cycle, log: saved.log, from: 'saved' };
    $('sbTest').textContent = tr('🖥 模擬機開機（riscv-emu）', '🖥 Emulator booted (riscv-emu)');
    return { engine: 'riscv', wasm, meta: {}, cfg, images, stats: tr('riscv-emu：指令集模擬（不看 Veryl 原始碼）', 'riscv-emu: instruction-set emulation (the Veryl source is not used)'), snap, files: cfg.files ? projectArea() : undefined };
  }
  setBusy(true, tr('🖥 veryl-emu 編譯中…', '🖥 veryl-emu compiling…'));
  try {
    const files = proj.files.filter(x => x.name.endsWith('.veryl'));
    const r = await core.call<{ wasm: string; meta: object; stats: string }>({ cmd: 'emu_compile', files, top: cfg.top, stops: machineStops(cfg) });
    const images: EmuStart['images'] = [];
    for (const l of cfg.load ?? []) images.push({ bytes: await image(l.image), addr: l.addr });
    // a state saved in this browser, else the bundled snapshot: only for the same compiled layout
    emuFp = fingerprint(r.meta as Parameters<typeof fingerprint>[0]);
    let snap: EmuStart['snap'];
    const saved = await idbGet<{ fingerprint: string; cycle: number; log: string; data: Uint8Array }>(`state:${proj.id}`);
    if (saved && saved.fingerprint === emuFp) snap = { data: await gunzip(saved.data), cycle: saved.cycle, log: saved.log, from: 'saved' };
    else if (cfg.snapshot) {
      const b = await bundledSnap(cfg.snapshot);
      if (b && b.fingerprint === emuFp) snap = { data: b.data, cycle: b.cycle, log: b.log, from: 'bundled' };
    }
    $('sbTest').textContent = tr('🖥 模擬機開機', '🖥 Emulator booted');
    return { engine: 'veryl', wasm: fromBase64(r.wasm), meta: r.meta, cfg, images, stats: `veryl-emu: ${r.stats}`, snap, files: cfg.files ? projectArea() : undefined };
  } finally {
    setBusy(false);
  }
}

// ---------------------------------------------------------------- virtual board

let board: VirtualBoard | null = null;
let boardWasRunning = false;
let boardCore: Promise<Core> | null = null;

/** the board has its own core (worker), so synthesis does not wait for the simulation */
function getBoardCore(): Promise<Core> { return (boardCore ??= startCore(fromBase64(VERYL_WASM_B64))); }

function ensureBoard(): VirtualBoard {
  if (board) return board;
  board = new VirtualBoard($('boardPane'), getBoardCore);
  board.flashButton.onclick = () => flashBoard();
  board.onSetup = s => { proj.board = s; persist(); };
  board.onPins = text => {
    const f = proj.files.find(x => x.name.endsWith('.pcf'));
    if (f) f.src = text; else proj.files.push({ name: PCF, src: text });
    changed();
    flashBoard();
  };
  board.onLoaded = info => {
    boardHw = '';
    problems = problems.filter(p => p.from !== 'run');
    for (const w of info.warnings) problems.push({ msg: tr('虛擬板：', 'Virtual board: ') + w, severity: 'warning', from: 'run' });
    renderProblems();
  };
  return board;
}

async function flashBoard(): Promise<void> {
  const top = synthTop();
  if (!top) { alert(tr('沒有可合成的模組（#[test] 模組不能燒錄）', 'No synthesizable module (#[test] modules cannot be flashed)')); return; }
  ensureBoard();
  // what is plugged in: the project's choice, else its example's
  const exBoard = examples().find(e => e.id === proj.from)?.board;
  board!.setSetup({ ...(proj.board ?? exBoard ?? DEFAULT_SETUP), mode: proj.board?.mode ?? exBoard?.mode ?? board!.mode });
  openFile(BOARD_TAB);
  if (window.innerHeight < 900) $('panel').classList.add('collapsed');
  setBusy(true, tr('⚡ 燒錄到虛擬板…', '⚡ Flashing the virtual board…'));
  try {
    // a C program: compile it; when only the program changed, swap it in (no synthesis, no place and route)
    let program: string | undefined;
    if (cFile()) {
      const r = await compileC(await getBoardCore());
      if (!r.compiled) {
        problems = [...cProblems(r), ...problems.filter(p => p.from === 'run')];
        $('sbTest').textContent = tr('✗ C 程式有錯誤', '✗ The C program has errors');
        panel('problems');
        setBusy(false);
        renderProblems();
        return;
      }
      program = r.bin;
    }
    const files = proj.files.filter(f => f.name.endsWith('.veryl'));
    const hw = JSON.stringify([files, top, pcfOf(proj) ?? '', board!.mode]);
    if (program && hw === boardHw && board!.loaded?.program_mem) {
      await board!.program(program);
      $('sbTest').textContent = tr(`⚡ 新程式（${cprog!.size} 位元組）已放進虛擬板的 block RAM`, `⚡ The new program (${cprog!.size} bytes) is in the board's block RAM`);
      setBusy(false);
      return;
    }
    const info = await board!.flash(files, top, pcfOf(proj), program);
    boardHw = hw;
    $('sbTest').textContent = program
      ? tr(`⚡ ${info.top} 和 C 程式（${cprog!.size} 位元組）已燒錄到虛擬板`, `⚡ ${info.top} and the C program (${cprog!.size} bytes) flashed to the virtual board`)
      : tr(`⚡ ${info.top} 已燒錄到虛擬板`, `⚡ ${info.top} flashed to the virtual board`);
    problems = problems.filter(p => p.from !== 'run');
    for (const w of info.warnings) problems.push({ msg: tr('虛擬板：', 'Virtual board: ') + w, severity: 'warning', from: 'run' });
    if (program && !info.program_mem) problems.push({ msg: tr(`虛擬板：${info.top} 沒有程式記憶體（RvSoc 的 RvMem），C 程式沒有放進去`, `Virtual board: ${info.top} has no program memory (RvSoc's RvMem): the C program is not in it`), severity: 'warning', from: 'run' });
  } catch (e) {
    problems = problems.filter(p => p.from !== 'run');
    problems.push(...parseErrors(String((e as Error).message ?? e), 'run'));
    $('sbTest').textContent = tr('✗ 燒錄失敗', '✗ Flashing failed');
    panel('problems');
  }
  setBusy(false);
  renderProblems();
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

/** phone layout (ide.css): the sidebar is a drawer, the title bar's menus are behind ⋯ */
const phone = () => matchMedia('(max-width: 760px)').matches;
const drawer = (open: boolean) => document.body.classList.toggle('side-open', open);

function moreMenu(on: boolean): void {
  $('titlebar').classList.toggle('more', on);
  $('tbMore').classList.toggle('on', on);
}

function sideView(v: string): void {
  const cur = $('activity').querySelector<HTMLElement>(`button[data-view="${v}"]`);
  const already = cur?.classList.contains('cur') && !$('sidebar').classList.contains('hidden');
  if (phone()) drawer(!(already && document.body.classList.contains('side-open')));
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

/** the next / previous stage of the current back end */
function stepStage(d: number): void {
  const keys = flow(flowTarget() === 'asic').map(([k]) => k);
  const i = keys.indexOf(synth?.current ?? '');
  runSynth(keys[Math.max(0, Math.min(keys.length - 1, i < 0 ? 0 : i + d))]);
}

// ---------------------------------------------------------------- command palette

interface Cmd { label: string; key?: string; run: () => void }

function commands(): Cmd[] {
  const c: Cmd[] = [
    { label: tr('執行測試', 'Run tests'), key: 'Ctrl+Enter', run: () => runTests() },
    { label: tr('全面驗證（RTL + 三種閘級網表）', 'Full verification (RTL + three gate-level netlists)'), run: verifyAll },
    { label: tr('合成並檢視流程', 'Synthesize and view the flow'), key: 'Ctrl+Shift+B', run: () => runSynth() },
    { label: tr('流程：下一個階段', 'Flow: next stage'), run: () => stepStage(1) },
    { label: tr('流程：上一個階段', 'Flow: previous stage'), run: () => stepStage(-1) },
    ...[...flow(false).slice(3), ...flow(true).slice(3), ...flow(false).slice(0, 3)].map(([k, l]) => ({ label: `${tr('流程：', 'Flow: ')}${l}`, run: () => runSynth(k) })),
    { label: tr('流程：⇄ FPGA vs ASIC 比較', 'Flow: ⇄ FPGA vs ASIC'), run: () => runSynth('cmp') },
    { label: tr('⚡ 燒錄到虛擬板', '⚡ Flash to the virtual board'), run: flashBoard },
    { label: tr('C：檢視組合語言', 'C: view the assembly'), run: () => openFile(ASM_TAB) },
    { label: tr('🖥 在板子上執行（.py、.sh）', '🖥 Run on the board (.py, .sh)'), run: runOnBoard },
    { label: tr('C：在指令集模擬器上執行（輸出到「輸出」面板）', 'C: run on the instruction-set simulator (Output panel)'), run: runC },
    { label: tr('新增檔案', 'New file'), run: newFile },
    { label: tr('新專案', 'New project'), run: newProject },
    { label: tr('匯入 .veryl 檔', 'Import .veryl files'), run: () => $<HTMLInputElement>('importIn').click() },
    { label: tr('下載專案 .zip', 'Download the project .zip'), run: exportZip },
    { label: tr('🔗 分享實驗（產生連結）', '🔗 Share the lab (link)'), run: shareLab },
    { label: tr('匯出實驗檔 .lab.json', 'Export the lab .lab.json'), run: exportLab },
    { label: tr('重新命名專案', 'Rename project'), run: renameProject },
    { label: tr('還原成範例原始碼', 'Revert to the example source'), run: revertProject },
    { label: tr('刪除專案', 'Delete project'), run: deleteProject },
    { label: tr('切換面板', 'Toggle panel'), key: 'Ctrl+J', run: () => $('panel').classList.toggle('collapsed') },
    { label: tr('顯示：問題', 'View: Problems'), run: () => panel('problems') },
    { label: tr('顯示：輸出', 'View: Output'), run: () => panel('output') },
    { label: tr('顯示：波形', 'View: Waveform'), run: () => panel('wave') },
    { label: tr('歡迎頁', 'Welcome page'), run: () => openFile(WELCOME) },
    { label: uiMode === 'basic' ? tr('標題列：顯示所有控制（進階）', 'Title bar: every control (advanced)') : tr('標題列：簡易（主按鈕與選單）', 'Title bar: simple (the main button and its menu)'), run: () => setMode(uiMode === 'basic' ? 'full' : 'basic') },
    { label: tr('顯示建議步驟', 'Show the suggested steps'), run: () => { proj.guideOff = false; persist(); renderGuide(); } },
    ...LANGS.map(([l, name]) => ({ label: `${tr('介面語言：', 'Language: ')}${name}`, run: () => switchLang(l) })),
    ...projects.filter(p => p !== proj).map(p => ({ label: `${tr('切換專案：', 'Switch project: ')}${projName(p)}`, run: () => switchProject(p.id) })),
    ...examples().map(e => ({ label: `${tr('開啟範例：', 'Open example: ')}${exTitle(e)}`, run: () => openExample(e) })),
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
    ...proj.files.map(f => ({ label: f.name, key: tr('檔案', 'file'), run: () => openFile(f.name) })),
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
  if (mod(e) && e.key === 'Enter') { runKey(); return true; }
  if (mod(e) && e.shiftKey && (e.key === 'B' || e.key === 'b')) { runSynth(); return true; }
  if (mod(e) && e.shiftKey && (e.key === 'P' || e.key === 'p')) { palette(false); return true; }
  if (mod(e) && !e.shiftKey && (e.key === 'p' || e.key === 'P')) { palette(true); return true; }
  if (mod(e) && (e.key === 's' || e.key === 'S')) { persist(); $('sbTest').textContent = tr('已儲存（在瀏覽器）', 'Saved (in the browser)'); return true; }
  if (mod(e) && (e.key === 'j' || e.key === 'J')) { $('panel').classList.toggle('collapsed'); return true; }
  return false;
}

// ---------------------------------------------------------------- boot

function wire(): void {
  ($('tgSynth') as HTMLOptGroupElement).label = tr('合成（看電路）', 'Synthesis (the circuit)');
  ($('tgEmu') as HTMLOptGroupElement).label = tr('模擬機（跑軟體）', 'Emulator (software)');
  ed = new CodeEditor($('editorHost'));
  ed.onChange = text => {
    const f = file(proj.active ?? '');
    if (!f || ed.readOnly) return;
    f.src = text;
    // the file's problems are stale now: the check finds syntax errors again, the next run the others
    problems = problems.filter(p => p.file !== f.name);
    changed();
  };
  ed.onCursor = (l, c) => { $('sbPos').textContent = tr(`行 ${l}，欄 ${c}`, `Ln ${l}, Col ${c}`); };
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
  $('cmdRun').onclick = () => runKey();
  $('cmdVerify').onclick = () => act('verify', $('cmdVerify'));
  $('mainBtn').onclick = () => mainClick();
  $('mainMore').onclick = () => $('mainMenu').classList.contains('hidden') ? showMenu() : hideMenu();
  $('modeBtn').onclick = () => setMode(uiMode === 'basic' ? 'full' : 'basic');
  $('cmdBoard').onclick = () => act('board', $('cmdBoard'));
  $('cmdEmu').onclick = () => act('emu', $('cmdEmu'));
  $('guide').onclick = e => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-step]');
    if (t) act(t.dataset.step as Act, t);
    else if ((e.target as HTMLElement).closest('.close')) { proj.guideOff = true; persist(); renderGuide(); }
  };
  document.addEventListener('mousedown', e => {
    const t = e.target as HTMLElement;
    if (!t.closest('#capPop, .off, [data-step]')) hideWhy();
    if (!t.closest('#mainMenu, #mainMore')) hideMenu();
  });
  $('testsRun').onclick = () => runTests();
  $('testsVerify').onclick = verifyAll;
  $<HTMLSelectElement>('synthTop').onchange = () => {
    renderOutline();
    if (proj.active === FLOW_TAB) runSynth(synth?.current); else syncStage();
  };
  $<HTMLSelectElement>('flowTarget').onchange = () => {
    const v = $<HTMLSelectElement>('flowTarget').value;
    if (v.startsWith('emu-')) {
      // an emulator: open it with that engine (a running machine of the other engine boots again)
      bootEngine(v.slice(4) as 'veryl' | 'riscv');
      return;
    }
    if (proj.active === EMU_TAB) { openFile(FLOW_TAB); }
    fillStages();
    if (proj.active === FLOW_TAB && synth?.synthesized) {
      const asic = flowTarget() === 'asic';
      const map: Record<string, string> = asic ? { map: 'amap', place: 'aplace', route: 'aroute', sta: 'asta' } : { amap: 'map', aplace: 'place', aroute: 'route', adetail: 'route', asta: 'sta', apower: 'sta' };
      runSynth(map[synth.current] ?? synth.current);
    }
  };
  $<HTMLSelectElement>('flowStage').onchange = () => { const k = $<HTMLSelectElement>('flowStage').value; if (k) runSynth(k); };
  // the breadcrumb opens the title bar's menus
  $('synCrumb').onclick = e => {
    const id = (e.target as HTMLElement).dataset.c;
    if (!id) return;
    const sel = $<HTMLSelectElement>(id);
    if (!sel.offsetParent) moreMenu(true);
    try { sel.showPicker(); } catch { sel.focus(); }
  };
  const infoOpen = (on: boolean) => { $('synInfo').classList.toggle('hidden', !on); $('synInfoBtn').classList.toggle('on', on); };
  $('synInfoBtn').onclick = () => infoOpen($('synInfo').classList.contains('hidden'));
  $('synMsg').onclick = () => infoOpen(true);
  $('synDlBtn').onclick = e => { e.stopPropagation(); $('synDlMenu').classList.toggle('hidden'); };
  document.addEventListener('click', e => {
    if (!(e.target as HTMLElement).closest?.('#synDlBtn')) $('synDlMenu').classList.add('hidden');
    if (!(e.target as HTMLElement).closest?.('#synInfo, #synInfoBtn, #synMsg')) infoOpen(false);
  });
  $('sbSynth').onclick = () => runSynth();
  for (const b of $('activity').querySelectorAll<HTMLElement>('button')) b.onclick = () => sideView(b.dataset.view!);
  // phones: a tap on an item in the drawer (not on its ✎ / 🗑) or outside it closes the drawer
  // (capture: the lists redraw themselves on click)
  $('sidebar').addEventListener('click', e => {
    const t = e.target as HTMLElement;
    if (phone() && t.closest('.tree .item') && !t.closest('button')) drawer(false);
  }, true);
  $('center').addEventListener('pointerdown', () => drawer(false));
  $('tbMore').onclick = () => moreMenu(!$('titlebar').classList.contains('more'));
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
  $('projShare').onclick = () => shareLab();
  wave = new WaveView($<HTMLCanvasElement>('waveCanvas'), $('wavePick'), $<HTMLInputElement>('waveFilter'));
  $<HTMLSelectElement>('waveTop').onchange = () => wave?.set(vcds.find(v => v.top === $<HTMLSelectElement>('waveTop').value)?.text ?? null);
  resizer('sideResize', '--sidew', 'x', 150, () => window.innerWidth * 0.5);
  resizer('panelResize', '--panelh', 'y', 60, () => window.innerHeight * 0.75, true);
  // the flow's numbers in the status bar
  new MutationObserver(synthStatus).observe($('synStats'), { childList: true, subtree: true, characterData: true });
}

/** the interface language: saved choice, else the browser's */
function initLang(): void {
  const saved = load<Lang | ''>('lang', '');
  setLang(LANGS.some(([l]) => l === saved) ? saved as Lang : fromLocale(navigator.language));
  translateDom(document.body);
  const sel = $<HTMLSelectElement>('langSel');
  sel.innerHTML = LANGS.map(([l, name]) => `<option value="${l}">${name}</option>`).join('');
  sel.value = LANGS.find(([l]) => l === load<string>('lang', ''))?.[0] ?? fromLocale(navigator.language);
  sel.onchange = () => switchLang(sel.value as Lang);
}

/** switching reloads the page (like VS Code); projects and layout are saved */
function switchLang(l: Lang): void {
  clearTimeout(saveTimer);
  save('projects', projects);
  save('cur', proj.id);
  save('lang', l);
  location.reload();
}

async function boot(): Promise<void> {
  for (const p of projects) migratePcf(p);
  initLang();
  wire();
  applyMode();
  const hash = location.hash;
  const exId = /ex=([\w-]+)/.exec(hash)?.[1];
  const labCode = /lab=([\w-]+)/.exec(hash)?.[1];
  const firstVisit = !projects.length;
  if (firstVisit) projects.push(fromExample(examples().find(e => e.id === (exId ?? 'tut_blinky')) ?? examples()[0]));
  proj = projects.find(p => p.id === load<string>('cur', '')) ?? projects[0];
  // the first time (no link to an example or a lab): the welcome page asks what to do
  if (firstVisit && !exId && !labCode) { proj.active = WELCOME; if (phone()) $('panel').classList.add('collapsed'); }
  const ex = exId ? examples().find(e => e.id === exId) : undefined;
  if (ex) {
    const have = projects.find(p => p.from === ex.id);
    if (have) proj = have; else { proj = fromExample(ex); projects.push(proj); }
  }
  if (proj.active === FLOW_TAB || proj.active === BOARD_TAB || proj.active === EMU_TAB) proj.active = undefined;
  proj.open = openTabs().filter(n => n === WELCOME || file(n));
  renderProjects();
  fillStages();
  showActive();
  renderProblems();
  demoLink();
  if (labCode) await labFromHash(labCode);
  try {
    const t0 = performance.now();
    core = await startCore(fromBase64(VERYL_WASM_B64));
    $('sbCore').textContent = `✓ WebAssembly ${(performance.now() - t0).toFixed(0)} ms${core.inWorker ? tr('（背景執行緒）', ' (worker thread)') : ''}`;
    for (const id of ['cmdRun', 'cmdVerify', 'cmdBoard', 'cmdEmu', 'flowTarget', 'flowStage']) $<HTMLButtonElement>(id).disabled = false;
    applyCaps();
    synth = new SynthOverlay(core, {
      embedded: true,
      onStage: k => {
        const t = isAsicStage(k) ? 'asic' : isFpgaStage(k) ? 'fpga' : flowTarget();
        if (t !== flowTarget()) { $<HTMLSelectElement>('flowTarget').value = t === 'asic' && flowPdk() === 'sky130' ? 'sky130' : t; fillStages(); } else syncStage();
      },
    });
    await check();
    // #…&pdk=sky130: the ASIC flow on SkyWater SKY130
    if (/[#&]pdk=sky130/.test(hash)) { $<HTMLSelectElement>('flowTarget').value = 'sky130'; fillStages(); }
    const st = /stage=(\w+)/.exec(hash)?.[1];
    if (st) runSynth(st);
    // the old demo page's links (index.html#ex=…&synth=1&target=asic)
    else if (/[#&]synth=1/.test(hash)) {
      if (/[#&]target=asic/.test(hash)) { $<HTMLSelectElement>('flowTarget').value = 'asic'; fillStages(); }
      runSynth();
    }
    if (/[#&]run=1/.test(hash)) runTests();
    if (/[#&]verify=1/.test(hash)) verifyAll();
    if (/[#&]board=1/.test(hash)) flashBoard();
  } catch (e) {
    $('sbCore').textContent = tr('✗ WebAssembly 載入失敗', '✗ WebAssembly failed to load');
    $('statusbar').classList.add('bad');
    problems.push({ msg: String(e), severity: 'error', from: 'run' });
    renderProblems();
  }
}

boot();
