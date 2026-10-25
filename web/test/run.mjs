// Node test: load the built dist/ exactly as the page does and run every
// example's testbenches through the WebAssembly core.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const ctx = {};
vm.createContext(ctx);
for (const f of ['wasm.js', 'examples.js']) vm.runInContext(fs.readFileSync(path.join(dist, f), 'utf8'), ctx);
const { Veryl, fromBase64 } = createRequire(import.meta.url)(path.join(dist, 'api.cjs'));
const core = await Veryl.load(fromBase64(ctx.VERYL_WASM_B64));

let bad = 0;
const expectFail = new Set(['alu_fail']);
for (const ex of ctx.VERYL_EXAMPLES) {
  const t0 = Date.now();
  let line;
  try {
    const r = core.simulate(ex.files);
    const fails = r.tops.reduce((a, t) => a + t.fails, 0);
    const ok = expectFail.has(ex.id) ? fails > 0 : fails === 0 && r.tops.length > 0;
    if (!ok) bad++;
    line = `${ok ? 'ok  ' : 'FAIL'} ${ex.id.padEnd(9)} simulate ${r.tops.map((t) => `${t.name}:${t.fails ? t.fails + ' fail' : 'PASS'}`).join(' ')}`;
  } catch (e) {
    bad++;
    line = `FAIL ${ex.id.padEnd(9)} ${e.message}`;
  }
  console.log(`${line}  (${Date.now() - t0} ms)`);
}
// a broken source must come back as a message, not crash the core
try { core.simulate([{ name: 'x.veryl', src: 'module X ( a: input logic ) { assign b = ; }' }]); bad++; console.log('FAIL parse error not reported'); }
catch (e) { console.log(`ok   parse error reported: ${e.message}`); }
console.log(bad ? `${bad} failure(s)` : 'all passed');
process.exit(bad ? 1 : 0);
