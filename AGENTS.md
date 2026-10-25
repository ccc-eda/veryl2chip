# AGENTS.md

EDA for Veryl HDL. Root has no build system; the real code lives in two independent Rust crates (each its own workspace root, not the repo root):
`veryl-sim/` (simulator) and `veryl-eda/` (logic synthesis → yosys JSON).

## Commands

```sh
cd veryl-sim
cargo build --release
./test.sh                          # runs examples/counter.veryl through the simulator
cargo run --release -- [--top MODULE] [--vcd out.vcd] [--max-time N] [--list] a.veryl ...
```

- Always use `--release`; simulation performance matters.
- Default top: all modules with a `#[test(...)]` attribute; if none, the last declared module. `--list` shows modules and which are tests.
- Exit code 1 on assertion failure; `--vcd` writes GTKWave-viewable waveforms.
- Official `veryl` CLI 0.22.0 is installed (`~/.cargo/bin/veryl`, see `install.md`). Run `veryl check` (from `examples/`, which has Veryl.toml) as the syntax/semantic ground truth; `veryl-sim` is a deliberately smaller simulator and its "not supported" errors are not language errors.

```sh
cd veryl-eda
cargo test --release               # synthesizes examples/, runs their testbenches on the gate netlist
./test.sh                          # + yosys read_json check + FPGA flow + formal equivalence vs `veryl build` output
./fpga/flow.sh                     # RISC-V SoC -> iCE40 bitstream (nextpnr-ice40, icepack) + post-route simulation
cargo run --release -- [--top MODULE] [-o out.json] [--verilog out.v] [--ice40 [--pcf P] [--asc A] [--bin B]] a.veryl ...
```

- veryl-eda default top: the last non-`#[test]` module (testbench modules are not synthesizable).
- Equivalence checking needs the oss-cad-suite yosys with the slang plugin (`YOSYS_SLANG`, default `/Users/Shared/ccc/oss-cad-suite/bin/yosys`); Homebrew `yosys` cannot parse veryl's enum casts/functions. Gold modules are named `examples_<Module>`.
- New synthesis test designs go in `veryl-eda/examples/` and the `DESIGNS` list in `veryl-eda/test.sh` (copied into the gold Veryl project, so module names must not clash with `examples/src`).
- FPGA target: iCE40UP5K-SG48 with iCEBreaker pins (`veryl-eda/examples/icebreaker.pcf`); `RiscvSoc` (`veryl-eda/examples/soc.veryl`) wraps `RiscvCore` from `examples/src/rv32i.veryl` and needs both files. `fpga/flow.sh` checks the routed bitstream by converting it back with `icebox_vlog` (its output needs the perl fix-up in the script for iverilog).
- The optimizer assumes flip-flops power up at 0 (true on iCE40); never-written registers become constants. Equivalence checks therefore use `-set-init-zero`.

## Veryl 0.22.0 quirks (verified against `veryl check`/`veryl test`)

- Bare `<` / `>` in expressions inside `function` bodies break the parser (generic scanner); use `<=` / `>=` / `<:` / `>:` instead.
- Enum members are `Pkg::EnumName::Member`, not `Pkg::Member`.
- `bit` is a reserved keyword — cannot be an identifier.
- Canonical testbench: `inst clk: $tb::clock_gen;` (the inst IS the clock), `inst rst: $tb::reset_gen(clk);`, then `initial { rst.assert(); clk.next(n); $assert(...); }`. Do not hand-toggle a `var clk: clock`.
- `veryl check` warns `missing_reset_statement` for un-reset RAMs/arrays; silence with `#[allow(missing_reset_statement)]` on the `always_ff`.

## Architecture (veryl-sim)

Parses Veryl source with the crates.io `veryl-parser` 0.22 crate (grammar tracking in Veryl.lock/examples). Flow: `main.rs` (CLI, parse, top selection) → `elab.rs` (syntax tree → sim IR, hierarchy/inst expansion) → `sim.rs` (eval, delta cycles, NBA scheduling, clock gen, VCD). `expr.rs` is a Pratt parser over veryl-parser tokens; `value.rs` is 4-state (0/1/x) bit vectors, max 128 bits.

## Architecture (veryl-eda)

Separate from veryl-sim on purpose (no shared elab). `elab.rs` lowers the syntax tree to a name-based statement IR and *symbolically executes* it into gates (if/case → mux, loops unrolled, functions inlined, always_ff → yosys `$_DFF_*`/`$_SDFF_*` cells). Every declared signal gets placeholder wires; drivers are recorded as aliases and resolved in `netlist::optimize`, which also rebuilds with constant folding/hashing, detects comb loops, and sweeps dead logic. Hierarchy is flattened (`inst.sig` net names). `optimize` also iterates constant-node proving (random sim + exhaustive check over ≤16-input supports) and removal of stuck-at-0 flip-flops. `ice40.rs` maps to SB_CARRY (recognized full-adder carries), SB_LUT4 (cut-based, depth-first) and SB_DFF*. `output.rs` writes yosys JSON + structural Verilog; `netsim.rs` is a 2-state gate simulator for tests (generic and iCE40 cells). Packed structs put the first field at the MSB (matches veryl's SV).

## Limits / gotchas

- Supported by the simulator: module/param/const/port/var/let/assign/always_comb/always_ff (if_reset, sync/async reset)/if/case/switch/for/inst/initial/final, packages, enums (`Pkg::Enum::Member`), structs (field access + whole-value), arrays (1-D, element sigs are contiguous: `sigs[first + i]`), user functions (non-recursive; args bound to param signals, `return` via `ret_val`/`ret_now`), generate for (loop var is a const param in a cloned scope), `import Pkg::*`.
- Still NOT supported: interfaces/modports, generate if, `rev`/`step` in generate-for, recursion, `inout`, widths > 128 bit.
- Testbench support is via `$tb::clock_gen` (the inst IS the clock), `$tb::reset_gen` (`rst.assert()` with no args uses the clock recorded from `inst rst: $tb::reset_gen(clk)`), `initial` blocks with `clk.next(n)`.
- The sim settles combinational logic after every `initial` statement (delta cycles), so clock-less comb testbenches work.
- `examples/` is a separate Veryl project (own Veryl.toml/lock); `_doc/` holds a Veryl grammar reference (`grammar.md`).
- README in veryl-sim is in Traditional Chinese; docs there are authoritative for supported syntax.
