// The emulator's worker: runs a Machine (emu_machine.ts) in slices of about 50 ms,
// sends the UART output and the speed, takes typed bytes and pause / resume / reset.
//   in:  {type: 'start', wasm, meta, cfg, images: [{bytes, addr?}], snapshot?, cycle?, files?} | {type: 'input', bytes}
//        {type: 'files', area} (the project's files into the exchange area, then getfiles is typed)
//        {type: 'run', area, cmd} (Ctrl-C, leave a MicroPython REPL, then at the shell prompt: the files, cd /root, getfiles, cmd)
//        {type: 'pause'} | {type: 'resume'} | {type: 'reset'} (a cold boot) | {type: 'gpio', bits} | {type: 'save'}
//   out: {type: 'out', bytes, cycle, rate, duty?, oe?} | {type: 'finished', code, pass, cycle} | {type: 'error', msg}
//        {type: 'saved', data, cycle} (the state, Machine.snapshot())
//        {type: 'files-back', area} (savefiles on the board: ESC ] 1337 ; veryl-save BEL seen)
//        {type: 'fb', data} (the screen's pixels, RGB565, when they changed; at most 10 times a second)

import { Machine } from './emu_machine';

let m: Machine | null = null;
let images: { bytes: Uint8Array; addr?: string }[] = [];
let running = false;
let gen = 0;
/** the GPIO inputs (kept across resets) */
let gpio = 0;
/** the exchange area for the next cold boot */
let files: Uint8Array | null = null;
/** the end of the output so far (the savefiles notice may span two slices) */
let tail = '';
const NOTICE = '\x1b]1337;veryl-save\x07';
/** a program to start at the next shell prompt */
let pending: { area: Uint8Array | null; cmd: string } | null = null;
/** the screen: a hash of the pixels last sent, when they were looked at */
let fbHash = -1, fbTime = 0;

/** send the screen when it changed (FNV over 32-bit words) */
function screen(force = false): void {
  const px = m?.screen();
  if (!px) return;
  const w = new Uint32Array(px.buffer, px.byteOffset, px.length >> 2);
  let h = 0x811c9dc5;
  for (let i = 0; i < w.length; i++) h = Math.imul(h ^ w[i], 0x01000193);
  if (h !== fbHash || force) { fbHash = h; post({ type: 'fb', data: px.slice() }); }
}
const typeLine = (s: string) => m!.input([...s].map((c) => c.charCodeAt(0)));
const post = (msg: object) => (self as unknown as Worker).postMessage(msg);

function boot(): void {
  m!.clear();
  for (const im of images) m!.load(im.bytes, im.addr ? BigInt(im.addr) : undefined);
  if (files) m!.writeArea(files);
  m!.reset();
  m!.setGpio(gpio);
}

async function loop(my: number): Promise<void> {
  let chunk = 20_000;
  let t = performance.now(), c0 = m!.cycle, rate = 0;
  while (running && my === gen) {
    const s = performance.now();
    const r = m!.step(chunk);
    const dt = performance.now() - s;
    // keep a slice near 50 ms
    chunk = Math.max(1000, Math.min(2_000_000, Math.round(chunk * (dt > 0 ? Math.min(2, 50 / dt) : 2))));
    const now = performance.now();
    if (now - t > 500) { rate = (m!.cycle - c0) / ((now - t) / 1000); t = now; c0 = m!.cycle; }
    post({ type: 'out', bytes: r.out, cycle: m!.cycle, rate, duty: r.duty, oe: r.oe });
    if (r.out.length) {
      tail = (tail + String.fromCharCode(...r.out)).slice(-200);
      const k = tail.lastIndexOf(NOTICE);
      if (k >= 0) { tail = tail.slice(k + NOTICE.length); const area = m!.readArea(); if (area) post({ type: 'files-back', area }); }
      if (pending && tail.endsWith('>>> ')) { tail = ''; m!.input([4]); } // Ctrl-D leaves the REPL
      else if (pending && /\$ $/.test(tail)) {
        tail = '';
        if (pending.area) m!.writeArea(pending.area);
        typeLine(`cd /root && getfiles > /dev/null && ${pending.cmd}\r`);
        pending = null;
      }
    }
    if (now - fbTime > 100) { fbTime = now; screen(); }
    if (r.finished) { running = false; post({ type: 'finished', ...r.finished, cycle: m!.cycle }); break; }
    await new Promise((ok) => setTimeout(ok, 0));
  }
}

self.onmessage = async (e: MessageEvent) => {
  const d = e.data;
  try {
    if (d.type === 'start') {
      gen++;
      running = false;
      m = await Machine.create(d.wasm, d.meta, d.cfg);
      images = d.images;
      files = d.files ?? null;
      tail = '';
      fbHash = -1;
      // from a snapshot (the booted machine: getfiles is typed), else a cold boot (/init runs getfiles)
      if (d.snapshot) {
        m.restore(d.snapshot, d.cycle ?? 0);
        m.setGpio(gpio);
        if (files) { m.writeArea(files); typeLine('getfiles\r'); }
      } else boot();
      // a run asked for while the machine was starting (it waits for the prompt)
      if (pending) m.input([3]);
      running = true;
      loop(gen);
    } else if (d.type === 'input') {
      m?.input(d.bytes);
    } else if (d.type === 'gpio') {
      gpio = d.bits;
      m?.setGpio(gpio);
    } else if (d.type === 'files') {
      files = d.area;
      if (m && files) { m.writeArea(files); typeLine('getfiles\r'); }
    } else if (d.type === 'run') {
      pending = { area: d.area ?? null, cmd: d.cmd };
      m?.input([3]); // Ctrl-C: stop what runs now; the shell answers with a prompt
    } else if (d.type === 'save') {
      if (!m) return;
      const data = m.snapshot();
      post({ type: 'saved', data, cycle: m.cycle });
    } else if (d.type === 'pause') {
      running = false;
    } else if (d.type === 'resume') {
      if (m && !running && !m.finished) { running = true; loop(++gen); }
    } else if (d.type === 'reset') {
      if (!m) return;
      gen++;
      boot();
      running = true;
      loop(gen);
    }
  } catch (err) {
    running = false;
    post({ type: 'error', msg: String((err as Error).message ?? err) });
  }
};
