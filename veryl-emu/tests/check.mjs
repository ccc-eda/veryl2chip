// The JavaScript half of the differential test (see check.veryl): drive the compiled
// ExprCheck with the same xorshift inputs as TestExprCheck and print the same lines.
//   node tests/check.mjs MODEL.wasm CYCLES
import { loadFiles } from '../js/emu.mjs';

const [wasm, cycles] = process.argv.slice(2);
const emu = await loadFiles(wasm);
const outs = ['o_add', 'o_w', 'o_shr', 'o_shl', 'o_sar', 'o_cmp', 'o_mul', 'o_div', 'o_sdv', 'o_rem', 'o_fn', 'o_cs', 'o_red', 'o_ps', 'o_ins', 'o_pop', 'o_neg', 'o_ter', 'o_acc', 'o_mem', 'o_sw'];
const o = outs.map((n) => [emu.sig(n), Math.ceil(emu.info(n).w / 4)]);
const [ra, rb, rs, rst] = ['i_a', 'i_b', 'i_s', 'i_rst'].map((n) => emu.sig(n));
const M = (1n << 64n) - 1n;
const xs = (x) => { x ^= (x << 13n) & M; x ^= x >> 7n; x ^= (x << 17n) & M; return x; };
let a = 0x0123456789abcdefn, b = 0xfedcba9876543210n;
rst.set(0); emu.settle(); emu.posedge();
rst.set(1);
const lines = [];
for (let i = 0; i < Number(cycles); i++) {
  ra.set(a); rb.set(b); rs.set((a & 0xffn) ^ ((b >> 8n) & 0xffn)); emu.settle();
  lines.push(o.map(([s, d]) => BigInt(s.get()).toString(16).padStart(d, '0')).join(' '));
  emu.posedge();
  a = xs(a); b = xs(b);
}
console.log(lines.join('\n'));
