// The emulator's worker: runs a Machine (emu_machine.ts) in slices of about 50 ms,
// sends the UART output and the speed, takes typed bytes and pause / resume / reset.
//   in:  {type: 'start', wasm, meta, cfg, images: [{bytes, addr?}]} | {type: 'input', bytes}
//        {type: 'pause'} | {type: 'resume'} | {type: 'reset'}
//   out: {type: 'out', bytes, cycle, rate} | {type: 'finished', code, pass, cycle} | {type: 'error', msg}

import { Machine } from './emu_machine';

let m: Machine | null = null;
let images: { bytes: Uint8Array; addr?: string }[] = [];
let running = false;
let gen = 0;
const post = (msg: object) => (self as unknown as Worker).postMessage(msg);

function boot(): void {
  m!.clear();
  for (const im of images) m!.load(im.bytes, im.addr ? BigInt(im.addr) : undefined);
  m!.reset();
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
    post({ type: 'out', bytes: r.out, cycle: m!.cycle, rate });
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
      boot();
      running = true;
      loop(gen);
    } else if (d.type === 'input') {
      m?.input(d.bytes);
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
