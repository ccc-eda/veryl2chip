// Starting points for new files and projects, and a project as a .zip.

import type { VFile } from './api';
import { zip } from './zip';

/** a small module and its testbench, a starting point for a new design */
export function newModule(m: string): string {
  return `module ${m} (
    i_clk: input  clock   ,
    i_rst: input  reset   ,
    i_en : input  logic   ,
    o_cnt: output logic<8>,
) {
    var cnt: logic<8>;

    always_ff {
        if_reset {
            cnt = 0;
        } else if i_en {
            cnt = cnt + 1;
        }
    }

    assign o_cnt = cnt;
}

#[test(test_${m.toLowerCase()})]
module Test${m} {
    inst clk: $tb::clock_gen;
    inst rst: $tb::reset_gen(clk);

    var en : logic   ;
    var cnt: logic<8>;

    inst dut: ${m} (
        i_clk: clk,
        i_rst: rst,
        i_en : en ,
        o_cnt: cnt,
    );

    initial {
        en = 0;
        rst.assert();
        en = 1;
        clk.next(5);
        $assert(cnt == 8'd5, "counts to 5");
        $finish();
    }
}
`;
}

/** a Veryl project (Veryl.toml + src/), ready for `veryl build` / `veryl test` */
export function projectZip(name: string, files: VFile[], extra?: VFile): Uint8Array {
  const dir = name.replace(/[^\w.-]+/g, '_') || 'project';
  const out = files.map(f => ({ name: f.name.endsWith('.veryl') ? `${dir}/src/${f.name}` : `${dir}/${f.name}`, data: f.src }));
  out.push({ name: `${dir}/Veryl.toml`, data: `[project]\nname = "${dir.replace(/[^\w]/g, '_')}"\nversion = "0.1.0"\n\n[build]\nsources = ["src"]\ntarget = { type = "directory", path = "target" }\n` });
  if (extra) out.push({ name: `${dir}/${extra.name}`, data: extra.src });
  return zip(out);
}
