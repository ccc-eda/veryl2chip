# veryl-sim (crate: `veryl2chip-sim`)
**English** | [繁體中文](https://github.com/ccc-eda/veryl2chip/blob/main/veryl-sim/README.tw.md) | [简体中文](https://github.com/ccc-eda/veryl2chip/blob/main/veryl-sim/README.cn.md)

An event-driven simulator for [Veryl](https://veryl-lang.org/) testbenches, in the spirit of Icarus Verilog
(`iverilog` + `vvp`), using [`veryl-parser`](https://docs.rs/veryl-parser/latest/veryl_parser/) as its front end.

Part of [veryl2chip](https://github.com/ccc-eda/veryl2chip) (online IDE: <https://ccc-eda.github.io/veryl2chip/web/dist/index.html>).

    cargo install veryl2chip-sim        # installs the `veryl-sim` command
    veryl-sim [--top MODULE] [--vcd out.vcd] [--max-time N] [--list] a.veryl b.veryl ...

In the source tree, `cargo run --release -- ...` works too.

- By default every module with a `#[test(...)]` attribute runs; without any, the last declared module. `--top` picks one.
- `--vcd` writes waveforms (GTKWave); the exit code is 1 when an assertion fails.

## Architecture
| File | Contents |
|---|---|
| `value.rs` | 4-state (0/1/x) bit vectors, up to 256 bits (`LIMBS` × 64, adjustable) |
| `iface.rs` | interfaces: collecting declarations, expanding their contents, resolving modports (shared with veryl-eda) |
| `gates.rs` | gate-level models: a module is simulated from its synthesized netlist (generic gates, iCE40, vlib standard cells, RAMs) under an unchanged testbench |
| `gen.rs`   | index sequences of generate-for (`rev`, `step +=`, ...; shared with veryl-eda) |
| `expr.rs`  | expression IR + precedence parser (over veryl-parser's tokens) |
| `elab.rs`  | walks the veryl-parser syntax tree, expands the hierarchy, builds the simulation IR |
| `sim.rs`   | evaluation, delta-cycle scheduling, non-blocking assignments (NBA), clock generator, VCD |

## Supported
module / parameters (`#(param ..)`, `const`) / ports / `var` / `let` / `assign` / `always_comb` / `always_ff`
(with `if_reset`, synchronous / asynchronous reset, posedge / negedge) / `if` / `case` / `switch` / `for` / `inst` (with parameter overrides, hierarchy) /
`initial` (`clk.next(n)`, `rst.assert(clk)`) / `$tb::clock_gen`, `$tb::reset_gen` /
packages / enums (`Pkg::Enum::Member`) / package constants / structs (field access and whole-value assignment; the first field is the MSB, as in SystemVerilog) / 1-D arrays /
user functions (not recursive) / generate for (with `rev`, `step += k`, ...), generate if / `import Pkg::*` /
interfaces (`inst b: Bus;`, `port: modport Bus::master`, modport defaults `..input` / `..output` / `..same(m)` / `..converse(m)`; members accessed as `b.valid`) /
widths up to 256 bits / clock domain annotations (`'a clock`) /
`$display $write $info $warning $error $fatal $assert $finish $time $clog2 $signed $unsigned $bits $random`.

## Not supported yet
generic interface ports (`port: interface`; name the modport), recursion, `inout` (tri-state needs a z plane and multi-driver resolution), widths > 256 bits.

Note: Veryl 0.22's own simulator (`veryl test`) gets interface designs wrong (e.g. it gives 0 for TestHs in `veryl-eda/examples/lang.veryl`);
iverilog and veryl-sim both give 145.
