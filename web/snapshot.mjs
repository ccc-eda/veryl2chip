// The emulator's snapshots (v2.17): boot an emulator example (machine.json "snapshot")
// in Node with the same core and machine as the page, to its shell prompt, and keep
// the whole machine state (the model's linear memory: non-zero 4 KB pages, gzip) as
// dist/img_snap_NAME.js, with the boot log and the fingerprint of the model's layout
// (a page only uses a snapshot made for the same compiled design).
//   node snapshot.mjs            (build.mjs runs it; skipped when nothing changed)
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, 'dist');
const ctx = {};
vm.createContext(ctx);
for (const f of ['wasm.js', 'examples.js']) vm.runInContext(fs.readFileSync(path.join(dist, f), 'utf8'), ctx);
const req = createRequire(import.meta.url);
const { Veryl, fromBase64 } = req(path.join(dist, 'api.cjs'));
const { Machine, machineStops, fingerprint } = req(path.join(dist, 'emu_machine.cjs'));
const core = await Veryl.load(fromBase64(ctx.VERYL_WASM_B64));

// examples on the same machine (same_hw) share its snapshot
for (const ex of ctx.VERYL_EXAMPLES.filter((e) => e.emu && !e.same_hw)) {
  const cfg = JSON.parse(ex.files.find((f) => f.name === 'machine.json').src);
  if (!cfg.snapshot) continue;
  const files = ex.files.filter((f) => f.name.endsWith('.veryl'));
  const r = core.call({ cmd: 'emu_compile', files, top: cfg.top, stops: machineStops(cfg) });
  const fp = fingerprint(r.meta);
  // the images the machine loads
  const images = [];
  for (const l of cfg.load ?? []) {
    const f = path.join(dist, `img_${l.image}.js`);
    const c = {};
    vm.createContext(c);
    vm.runInContext(fs.readFileSync(f, 'utf8'), c);
    images.push({ bytes: zlib.gunzipSync(Buffer.from(c.VERYL_IMAGES[l.image], 'base64')), addr: l.addr });
  }
  const key = crypto.createHash('sha1').update(fp).update(r.wasm).update(JSON.stringify(cfg));
  for (const im of images) key.update(im.bytes);
  const k = key.digest('hex');
  const out = path.join(dist, `img_snap_${cfg.snapshot}.js`);
  if (fs.existsSync(out) && fs.readFileSync(out, 'utf8').includes(`"key": "${k}"`)) { console.log(`img_snap_${cfg.snapshot}.js unchanged`); continue; }
  const t0 = Date.now();
  const m = await Machine.create(fromBase64(r.wasm), r.meta, cfg);
  for (const im of images) m.load(im.bytes, im.addr ? BigInt(im.addr) : undefined);
  m.reset();
  let log = '';
  const prompt = cfg.prompt ?? '$ ';
  while (m.cycle < 1_000_000_000 && !log.endsWith(prompt)) log += String.fromCharCode(...m.step(1_000_000).out);
  if (!log.endsWith(prompt)) throw new Error(`${ex.id}: no prompt "${prompt}" after ${m.cycle} cycles`);
  const gz = zlib.gzipSync(m.snapshot(), { level: 9 });
  const info = { key: k, fingerprint: fp, cycle: m.cycle, log };
  fs.writeFileSync(out, `// emulator snapshot of the example ${ex.id} at its shell prompt (web/snapshot.mjs): the machine's memory, gzip + base64\n`
    + `var VERYL_IMAGES = typeof VERYL_IMAGES === 'undefined' ? {} : VERYL_IMAGES;\nVERYL_IMAGES["snap_${cfg.snapshot}"] = ${JSON.stringify({ ...info, data: gz.toString('base64') }, null, 1).replace(/\n\s*/g, ' ')};\n`);
  console.log(`img_snap_${cfg.snapshot}.js ${(gz.length / 1e6).toFixed(1)} MB gzip, ${(m.cycle / 1e6).toFixed(0)} M cycles (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
}
