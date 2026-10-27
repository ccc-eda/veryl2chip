// The emulator tab: a design too large for the FPGA and ASIC flows (the RV64 SoC with
// its 256 MB RAM) compiled by veryl-emu into a WebAssembly module and run as a machine
// in its own worker, with a terminal on its UART. What the ports mean comes from the
// project's machine.json (see emu_machine.ts).

import { tr } from '../i18n';
import type { MachineCfg } from '../emu_machine';
import type { Part } from './bbmodel';
import { PI_DEFAULT_BB, PiBoard } from './pi';

declare const EMU_WORKER_SRC: string;

/** what the IDE gives the tab to start a machine */
export interface EmuStart {
  wasm: Uint8Array;
  meta: object;
  cfg: MachineCfg;
  images: { bytes: Uint8Array; addr?: string }[];
  stats: string;
  /** the project's files for the exchange area (machine.json "files") */
  files?: Uint8Array;
  /** start from this state instead of a cold boot (memory, cycle, the terminal so far; where it comes from) */
  snap?: { data: Uint8Array; cycle: number; log: string; from: 'saved' | 'bundled' };
}

// ---- a small terminal: lines of characters, a cursor, the VT100 sequences Linux / busybox use ----
class Term {
  lines: string[][] = [[]];
  row = 0;
  col = 0;
  private esc = '';

  write(bytes: number[]): void {
    for (const b of bytes) {
      const ch = String.fromCharCode(b);
      if (this.esc.startsWith('\x1b]')) {
        // an operating system command (ESC ] ... BEL or ESC \): not shown
        this.esc += ch;
        if (b === 7 || this.esc.endsWith('\x1b\\') || this.esc.length > 200) this.esc = '';
        continue;
      }
      if (this.esc) {
        this.esc += ch;
        if (this.esc === '\x1b]') continue;
        if (this.esc === '\x1b[' || (this.esc.length > 2 && this.esc.startsWith('\x1b[') && !/[@-~]/.test(ch))) continue;
        if (this.esc.startsWith('\x1b[')) this.csi(this.esc.slice(2, -1), ch);
        this.esc = '';
        continue;
      }
      if (b === 0x1b) { this.esc = ch; continue; }
      if (b === 13) { this.col = 0; continue; }
      if (b === 10) { this.newline(); continue; }
      if (b === 8) { if (this.col > 0) this.col--; continue; }
      if (b === 9) { this.col = (this.col + 8) & ~7; continue; }
      if (b < 32 || b === 127) continue;
      const line = this.lines[this.row];
      while (line.length < this.col) line.push(' ');
      line[this.col++] = ch;
    }
  }

  private newline(): void {
    this.row++;
    if (this.row >= this.lines.length) this.lines.push([]);
    if (this.lines.length > 3000) { this.lines.splice(0, 1000); this.row -= 1000; }
  }

  private csi(p: string, f: string): void {
    const n = parseInt(p) || 1;
    const line = this.lines[this.row];
    switch (f) {
      case 'A': this.row = Math.max(0, this.row - n); break;
      case 'B': this.row = Math.min(this.lines.length - 1, this.row + n); break;
      case 'C': this.col += n; break;
      case 'D': this.col = Math.max(0, this.col - n); break;
      case 'K': if (p === '' || p === '0') line.length = Math.min(line.length, this.col); else if (p === '2') line.length = 0; break;
      case 'J': if (p === '2' || p === '3') { this.lines = [[]]; this.row = 0; this.col = 0; } else this.lines.length = this.row + 1; break;
      case 'H': this.col = 0; break;
      case 'P': line.splice(this.col, n); break;
      default: break; // colors (m) and the rest: ignored
    }
  }

  /** the terminal as text (for a saved state) */
  text(): string { return this.lines.map((l) => l.join('')).join('\r\n'); }

  html(cursor: boolean): string {
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    return this.lines.map((l, i) => {
      if (i !== this.row || !cursor) return esc(l.join(''));
      const s = l.join('');
      const c = s[this.col] ?? ' ';
      return esc(s.slice(0, this.col)) + `<span class="em-cur">${esc(c)}</span>` + esc(s.slice(this.col + 1));
    }).join('\n');
  }
}

/** gzip with the platform's CompressionStream */
export async function gzip(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export class Emulator {
  private w: Worker | null = null;
  private term = new Term();
  private dirty = false;
  private state: 'off' | 'run' | 'pause' | 'end' = 'off';
  private last: EmuStart | null = null;
  private stat = { cycle: 0, rate: 0 };
  /** the IDE: compile the project and get its images */
  onStart: (() => Promise<EmuStart | null>) | null = null;
  /** the IDE: keep a saved state (gzip of the memory, the cycle, the terminal text) */
  onSave: (s: { data: Uint8Array; cycle: number; log: string }) => Promise<void> = async () => {};
  /** the IDE: the project's files as an exchange area, and the files the board sent back */
  getFiles: () => Uint8Array | null = () => null;
  onFilesBack: (area: Uint8Array) => string = () => '';
  /** the IDE: the project's breadboard for the development board (null: the example's), and saving it */
  getParts: () => Part[] | null = () => null;
  /** the IDE: the file to run on the board and its command (null: nothing to run) */
  getRun: () => { name: string; cmd: string } | null = () => null;
  /** the IDE: the exchange area for running it (with a compiled program), or why it cannot run */
  getRunFiles: (r: { name: string; cmd: string }) => Promise<Uint8Array | string> = async () => this.getFiles() ?? '';
  onParts: (parts: Part[]) => void = () => {};
  private pi: PiBoard | null = null;

  constructor(private host: HTMLElement) {
    host.innerHTML = `<div class="vb-bar">
        <button class="tb-btn" data-a="boot" title="${tr('用 veryl-emu 把設計編譯成 WebAssembly，載入程式後開機', 'Compile the design to WebAssembly with veryl-emu, load the programs and boot')}">${tr('🖥 開機', '🖥 Boot')}</button>
        <button class="tb-btn" data-a="pause" disabled>⏸</button>
        <button class="tb-btn" data-a="reset" disabled title="${tr('冷開機（重新載入程式，從頭開機，不用快照）', 'Cold boot (reload the programs and boot from the start, no snapshot)')}">⟲</button>
        <button class="tb-btn hidden" data-a="run" title="${tr('在板子上執行這個檔案（.py 用 MicroPython、.sh 用 shell、.c 編譯成執行檔）：先停掉正在跑的程式，再把專案的檔案送進 /root', 'Run this file on the board (.py with MicroPython, .sh with the shell, .c compiled to a program): stops the running program, then puts the project\'s files into /root')}">▶</button>
        <button class="tb-btn ghost" data-a="files" disabled title="${tr('把專案的檔案（Veryl 與 machine.json 以外）放進板子的 /root（板子上打 savefiles 送回專案）', 'Put the project\'s files (other than Veryl and machine.json) into /root on the board (savefiles on the board sends them back)')}">${tr('⇅ 檔案', '⇅ Files')}</button>
        <button class="tb-btn ghost" data-a="save" disabled title="${tr('存下目前的狀態（存在這個瀏覽器；下次開機從這裡繼續）', 'Save the current state (in this browser; the next boot continues from here)')}">💾</button>
        <button class="tb-btn ghost" data-a="upload" title="${tr('載入自己的程式（ELF 或二進位檔，放在 RAM 的開頭）再開機', 'Load your own program (ELF or a binary at the start of the RAM), then boot')}">${tr('📂 程式', '📂 Program')}</button>
        <input type="file" class="hidden" data-a="file">
        <span class="vb-stat em-stat"></span>
      </div>
      <div class="em-note"></div>
      <div class="em-main"><div class="em-box"><pre class="em-term"></pre><textarea class="em-in" autocapitalize="off" autocomplete="off" spellcheck="false"></textarea></div><div class="em-board hidden"></div></div>`;
    const q = <T extends HTMLElement>(a: string) => host.querySelector(`[data-a="${a}"]`) as T;
    q('boot').onclick = () => this.boot();
    q('pause').onclick = () => this.pauseResume();
    q('reset').onclick = () => { if (this.w && this.last) { this.term = new Term(); this.dirty = true; this.w.postMessage({ type: 'reset' }); this.note(tr('冷開機', 'Cold boot')); this.set('run'); this.inEl.focus(); } };
    q('files').onclick = () => { const a = this.getFiles(); if (this.w && a) { this.w.postMessage({ type: 'files', area: a }); this.note(tr('專案的檔案送進板子的 /root', 'The project\'s files went to /root on the board')); } };
    q('run').onclick = () => this.run();
    q('save').onclick = () => { if (this.w) { this.w.postMessage({ type: 'save' }); this.note(tr('存狀態中…', 'Saving the state…')); } };
    q('upload').onclick = () => q<HTMLInputElement>('file').click();
    q<HTMLInputElement>('file').onchange = async () => {
      const f = q<HTMLInputElement>('file').files?.[0];
      if (!f) return;
      this.upload = new Uint8Array(await f.arrayBuffer());
      this.uploadName = f.name;
      q<HTMLInputElement>('file').value = '';
      this.boot();
    };
    // typing goes through a hidden textarea (keyboards, phones, input methods, paste):
    // special keys from keydown, text from the input events
    const inp = this.inEl;
    this.termEl.addEventListener('mousedown', (e) => { e.preventDefault(); inp.focus(); this.dirty = true; });
    inp.addEventListener('keydown', (e) => this.key(e));
    inp.addEventListener('input', () => {
      const v = inp.value;
      inp.value = '';
      if (v) this.send([...v].map((c) => (c === '\n' ? 13 : c.charCodeAt(0) & 0xff)));
    });
    inp.addEventListener('focus', () => { this.dirty = true; });
    inp.addEventListener('blur', () => { this.dirty = true; });
    this.note(tr('按「🖥 開機」：設計用 veryl-emu 編譯成 WebAssembly，在瀏覽器裡當成一台機器跑；點一下終端機就可以打字。', 'Press "🖥 Boot": veryl-emu compiles the design to WebAssembly and runs it as a machine in the browser; click the terminal to type.'));
    const tick = () => { if (this.dirty) this.render(); requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }

  private upload: Uint8Array | null = null;
  private uploadName = '';
  private get termEl(): HTMLElement { return this.host.querySelector('.em-term') as HTMLElement; }
  private get inEl(): HTMLTextAreaElement { return this.host.querySelector('.em-in') as HTMLTextAreaElement; }
  private note(s: string): void { (this.host.querySelector('.em-note') as HTMLElement).textContent = s; }
  get running(): boolean { return this.state === 'run'; }

  private set(s: Emulator['state']): void {
    this.state = s;
    this.pi?.setPower(s === 'run' || s === 'pause');
    const q = (a: string) => this.host.querySelector(`[data-a="${a}"]`) as HTMLButtonElement;
    q('pause').disabled = s === 'off' || s === 'end';
    q('pause').textContent = s === 'pause' ? '▶' : '⏸';
    q('reset').disabled = s === 'off';
    q('save').disabled = s === 'off' || s === 'end';
    q('files').disabled = s !== 'run' || !this.last?.cfg.files;
    this.runLabel();
    this.dirty = true;
  }

  private render(): void {
    this.dirty = false;
    const t = this.termEl;
    const atBottom = t.scrollTop + t.clientHeight >= t.scrollHeight - 30;
    t.innerHTML = this.term.html(document.activeElement === this.inEl);
    if (atBottom) t.scrollTop = t.scrollHeight;
    const st = this.host.querySelector('.em-stat') as HTMLElement;
    const mhz = (this.stat.rate / 1e6).toFixed(2);
    const what = { off: tr('關機', 'off'), run: tr('執行中', 'running'), pause: tr('暫停', 'paused'), end: tr('結束', 'ended') }[this.state];
    st.textContent = this.state === 'off' ? '' : tr(`${what}　${(this.stat.cycle / 1e6).toFixed(1)} M 拍　${mhz} MHz`, `${what}  ${(this.stat.cycle / 1e6).toFixed(1)} M cycles  ${mhz} MHz`);
  }

  async boot(): Promise<void> {
    if (!this.onStart) return;
    this.note(tr('編譯中…', 'Compiling…'));
    let s: EmuStart | null;
    try { s = await this.onStart(); } catch (e) { this.note(String((e as Error).message ?? e)); return; }
    if (!s) return;
    if (this.upload) s.images = [{ bytes: this.upload }];
    this.last = s;
    this.w?.terminate();
    const url = URL.createObjectURL(new Blob([EMU_WORKER_SRC], { type: 'text/javascript' }));
    this.w = new Worker(url);
    this.w.onmessage = (e) => this.msg(e.data);
    this.w.onerror = (e) => { this.note(tr('模擬機錯誤：', 'Emulator error: ') + (e.message ?? '')); this.set('end'); };
    this.term = new Term();
    this.stat = { cycle: s.snap?.cycle ?? 0, rate: 0 };
    if (s.snap) this.term.write([...s.snap.log].map((c) => c.charCodeAt(0) & 0xff));
    const prog = this.upload ? tr(`程式：${this.uploadName}`, `program: ${this.uploadName}`) : s.cfg.load?.length ? tr(`程式：${s.cfg.load.map((l) => l.image).join('、')}`, `program: ${s.cfg.load.map((l) => l.image).join(', ')}`) : '';
    const from = s.snap ? (s.snap.from === 'saved' ? tr('　從存下的狀態繼續（⟲ 冷開機）', '  continued from the saved state (⟲ cold boot)') : tr('　從快照開機（⟲ 冷開機）', '  booted from the snapshot (⟲ cold boot)')) : '';
    this.note(`${s.cfg.top}: ${s.stats}${prog ? '　' + prog : ''}${from}`);
    // the development board (machine.json "board": "pi")
    const bh = this.host.querySelector('.em-board') as HTMLElement;
    if (s.cfg.board === 'pi') {
      if (!this.pi) {
        this.pi = new PiBoard(bh);
        this.pi.onInputs = (bits) => this.w?.postMessage({ type: 'gpio', bits });
        this.pi.onLayout = (parts) => this.onParts(parts);
      }
      this.pi.setParts(this.getParts() ?? PI_DEFAULT_BB);
      this.pi.setScreenSize(s.cfg.fb ?? null);
      bh.classList.remove('hidden');
    } else bh.classList.add('hidden');
    this.w.postMessage({ type: 'start', wasm: s.wasm, meta: s.meta, cfg: s.cfg, images: s.images, snapshot: s.snap?.data, cycle: s.snap?.cycle, files: s.files });
    this.set('run');
    this.inEl.focus();
  }

  private msg(d: { type: string; bytes?: number[]; cycle?: number; rate?: number; code?: number; pass?: boolean; msg?: string; duty?: number[]; oe?: number }): void {
    if (d.type === 'out') {
      if (this.pi && d.duty) this.pi.setOutputs(d.duty, d.oe ?? 0);
      if (d.bytes!.length) { this.term.write(d.bytes!); }
      this.stat.cycle = d.cycle!;
      if (d.rate) this.stat.rate = d.rate;
      this.dirty = true;
    } else if (d.type === 'finished') {
      this.stat.cycle = d.cycle!;
      this.term.write([...`\r\n[${d.pass ? tr('結束（正常）', 'finished (pass)') : tr('結束，代碼', 'finished, code')} 0x${d.code!.toString(16)}]\r\n`].map((c) => c.charCodeAt(0)));
      this.set('end');
    } else if (d.type === 'fb') {
      this.pi?.setScreen((d as unknown as { data: Uint8Array }).data);
    } else if (d.type === 'files-back') {
      this.note(this.onFilesBack((d as unknown as { area: Uint8Array }).area));
    } else if (d.type === 'saved') {
      const data = (d as unknown as { data: Uint8Array }).data;
      gzip(data).then((gz) => this.onSave({ data: gz, cycle: d.cycle!, log: this.term.text() }))
        .then(() => this.note(tr(`狀態存好了（${(this.stat.cycle / 1e6).toFixed(0)} M 拍）：下次開機從這裡繼續`, `State saved (${(this.stat.cycle / 1e6).toFixed(0)} M cycles): the next boot continues from here`)))
        .catch((e) => this.note(String((e as Error).message ?? e)));
    } else if (d.type === 'error') {
      this.note(tr('模擬機錯誤：', 'Emulator error: ') + d.msg);
      this.set('end');
    }
  }

  /** the run button shows the file it runs (only for a machine with an exchange area) */
  runLabel(): void {
    const b = this.host.querySelector('[data-a="run"]') as HTMLButtonElement;
    const r = this.getRun();
    b.classList.toggle('hidden', !r || (!!this.last && !this.last.cfg.files));
    if (r) b.textContent = tr(`▶ 執行 ${r.name}`, `▶ Run ${r.name}`);
  }

  /** run the IDE's file on the board (booting it first when it is off) */
  async run(): Promise<void> {
    const r = this.getRun();
    if (!r) { this.note(tr('專案裡沒有可以在板子上執行的檔案（.py、.sh 或 .c）', 'The project has no file to run on the board (.py, .sh or .c)')); return; }
    const area = await this.getRunFiles(r);
    if (typeof area === 'string') { this.note(area); return; }
    if (this.state === 'off' || this.state === 'end') { await this.boot(); if (!this.w) return; }
    if (!this.last?.cfg.files) { this.note(tr('這台機器沒有交換區（machine.json 的 files），不能把檔案放進去', 'This machine has no exchange area (machine.json "files"): files cannot go in')); return; }
    if (this.state === 'pause') this.pauseResume();
    this.w!.postMessage({ type: 'run', area, cmd: r.cmd });
    this.note(tr(`在板子上執行 ${r.name}：${r.cmd}（Ctrl-C 停止）`, `Running ${r.name} on the board: ${r.cmd} (Ctrl-C stops it)`));
    this.inEl.focus();
  }

  pauseResume(): void {
    if (!this.w) return;
    if (this.state === 'run') { this.w.postMessage({ type: 'pause' }); this.set('pause'); }
    else if (this.state === 'pause') { this.w.postMessage({ type: 'resume' }); this.set('run'); }
  }

  private send(bytes: number[]): void { if (this.w && this.state === 'run') this.w.postMessage({ type: 'input', bytes }); }

  private key(e: KeyboardEvent): void {
    const k = e.key;
    const seq: Record<string, string> = { ArrowUp: '\x1b[A', ArrowDown: '\x1b[B', ArrowRight: '\x1b[C', ArrowLeft: '\x1b[D', Home: '\x1b[H', End: '\x1b[F', Delete: '\x1b[3~' };
    let s: string | null = null;
    if (e.ctrlKey && !e.metaKey && k.length === 1 && /[a-z]/i.test(k)) s = String.fromCharCode(k.toUpperCase().charCodeAt(0) - 64);
    else if (e.metaKey) return;
    else if (k === 'Enter') s = '\r';
    else if (k === 'Backspace') s = '\x7f';
    else if (k === 'Tab') s = '\t';
    else if (k === 'Escape') s = '\x1b';
    else if (seq[k]) s = seq[k];
    // ordinary characters arrive as input events
    if (s === null) return;
    e.preventDefault();
    this.send([...s].map((c) => c.charCodeAt(0) & 0xff));
  }

  stop(): void { this.w?.terminate(); this.w = null; this.set('off'); }
}
