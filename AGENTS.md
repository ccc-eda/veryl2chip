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
- `examples/src/rv32i.veryl` is a full single-cycle RV32I core (no fence/ecall/ebreak/CSR). Its `TestRiscvCore` runs `examples/sw/rv32i_test.S` from the generated `examples/src/rv32i_rom.veryl`, so veryl-sim needs both files: `veryl-sim ../examples/src/rv32i.veryl ../examples/src/rv32i_rom.veryl`. After editing the program run `examples/sw/build.sh` (riscv64-unknown-elf toolchain); it regenerates the ROM and checks every `$assert(dmem[i] == ...)` against spike. The `$assert` lines are also parsed by veryl-eda's `rv32i_core` test, so keep their format.
- Official `veryl` CLI 0.22.0 is installed (`~/.cargo/bin/veryl`, see `install.md`). Run `veryl check` (from `examples/`, which has Veryl.toml) as the syntax/semantic ground truth; `veryl-sim` is a deliberately smaller simulator and its "not supported" errors are not language errors.

```sh
cd veryl-eda
cargo test --release               # synthesizes examples/, runs their testbenches on the gate netlist
./test.sh                          # + yosys read_json check + FPGA flow + formal equivalence vs `veryl build` output
./fpga/flow.sh                     # RISC-V SoC -> iCE40 bitstream (nextpnr-ice40, icepack) + post-route simulation
PNR=veryl ./fpga/flow.sh           # same with veryl-eda's own place & route (src/pnr/)
./fpga/pnr_test.sh                 # own P&R on every design: routed bitstream vs netlist co-simulation + icetime Fmax
cargo run --release -- [--top MODULE] [-o out.json] [--verilog out.v] [--ice40 [--pcf P] [--asc A] [--bin B]] a.veryl ...
cargo run --release -- --asic [-v] [--verilog out.v] a.veryl ...   # vlib standard cells: map, place, route, STA
```

- veryl-eda default top: the last non-`#[test]` module (testbench modules are not synthesizable).
- Equivalence checking needs the oss-cad-suite yosys with the slang plugin (`YOSYS_SLANG`, default `/Users/Shared/ccc/oss-cad-suite/bin/yosys`); Homebrew `yosys` cannot parse veryl's enum casts/functions. Gold modules are named `examples_<Module>`.
- `veryl-eda/examples/features.veryl` also has `#[test]` testbenches (run them with veryl-sim / `veryl test`). New synthesis test designs go in `veryl-eda/examples/` and the `DESIGNS` list in `veryl-eda/test.sh` (copied into the gold Veryl project, so module names must not clash with `examples/src`).
- FPGA target: iCE40UP5K-SG48 with iCEBreaker pins (`veryl-eda/examples/icebreaker.pcf`); `RiscvSoc` (`veryl-eda/examples/soc.veryl`) wraps `RiscvCore` from `examples/src/rv32i.veryl` and needs both files. `fpga/flow.sh` checks the routed bitstream by converting it back with `icebox_vlog` (its output needs the perl fix-up in the script for iverilog).
- Own P&R (`--pnr veryl`, `src/pnr/`) reads IceStorm's `chipdb-5k.txt` (`VERYL_EDA_CHIPDB`, else oss-cad-suite's `share/icebox`). Correctness oracle: `fpga/cosim.py` (icebox_vlog of the routed `.asc` vs the mapped netlist, random inputs). `icebox_vlog` ignores column buffers / IO electrical bits, so those are written exactly as nextpnr does (incl. the UP5K tile 25,14 exception for the DSP/IPCON `Cascade.*_inmux02_5` defaults). `icetime` needs `-C <chipdb>`.
- The optimizer assumes flip-flops power up at 0 (true on iCE40); never-written registers become constants. Equivalence checks therefore use `-set-init-zero`.

```sh
cd web
npm install                        # esbuild + typescript (dev only)
npm run build                      # cargo build veryl-wasm (wasm32) + bundle into web/dist/
npm test                           # Node: every example through the built dist/ (same wasm + TS API as the page)
open dist/index.html               # front-end only, works from file:// (no server, no fetch)
open dist/ide.html                 # M11 IDE (VS Code style): projects in localStorage, live check, tests, flow tabs
```

- Web architecture (`web/PLAN.md`): `veryl-sim` and `veryl-eda` are lib+bin crates; `veryl-wasm/` is a cdylib with a C ABI (`alloc`/`call(JSON)`/`result_len`/`dealloc`, zero imports, panic message via `panic_message`). The wasm is embedded as base64 in `dist/wasm.js` and examples in `dist/examples.js`, so the page needs no fetch. `src/api.ts` has no DOM and is also bundled as `dist/api.cjs` for the Node tests. `web/dist` is committed (open-and-use); rebuild it after changing Rust or TS.
- Two pages share the core: `index.html` (demo, `src/main.ts`, synthesis as an overlay) and `ide.html` (M11, `src/ide/`: `editor.ts` is a transparent textarea over highlighted `<pre>`, `highlight.ts` the Veryl tokenizer, `main.ts` projects/tests/flow). Both reuse `SynthOverlay` (`src/synth/overlay.ts`; the IDE passes `embedded` and hosts the same `syn*` element ids in an editor tab). Live checking uses the `list` command (parse only); elaboration errors come from `simulate`.
- Interface languages (IDE only; the demo page stays Traditional Chinese): `src/i18n.ts`. Write UI text as `tr('繁體', 'English')`; Simplified Chinese is derived by `hans()` with the tables in `src/i18n_hans.ts` (mainland terms first, e.g. 檔案→文件, 模擬→仿真, 繞線→布线, 列→行 / 欄→列, then characters) — add any new Traditional character or term there. Static HTML uses `data-en` / `data-en-title` / `data-en-ph` / `data-en-html`. `npm test` checks every `tr()` pair.
- `tutorial/` is a separate Veryl project for the course tutorial (`README.tw.md`; lessons `Blinky`, `KnightRider`; `icebreaker.pcf` uses only the board's own LEDs/buttons). `tutorial/check.sh` runs its whole flow; the lessons are also the web's first examples (`tut_*`). Keep the code shown in the tutorial text identical to `src/`.
- crates.io: the packages are `veryl2chip-sim` and `veryl2chip-eda` (not `veryl-*`, which is the official Veryl project's prefix); `[lib] name` / `[[bin]] name` keep `veryl_sim` / `veryl-sim` etc., and dependents use `veryl-sim = { package = "veryl2chip-sim", ... }`. `./publish.sh` dry-runs, `./publish.sh --yes` publishes sim then eda and tags `vX.Y` (1.1.0 -> v1.1, the repo's tag style); bump both versions (and eda's dependency version) for a new release. veryl-wasm has `publish = false`.
- CI: `.github/workflows/static.yml` builds and tests (veryl-sim, `cargo test` in veryl-eda, `tutorial/check.sh`, `npm run build` + `npm test`) and on pushes to main deploys a freshly built `web/dist` to Pages; the chipdb comes from `web/dist/chipdb.js` via `web/test/chipdb.mjs`. The yosys formal checks (`veryl-eda/test.sh`) are not in CI.
- The browser preview pane snapshots `file://` pages without their scripts; test the page over HTTP (`.claude/launch.json` serves `web/dist` on 8766).

## Veryl 0.22.0 quirks (verified against `veryl check`/`veryl test`)

- Bare `<` / `>` in expressions inside `function` bodies break the parser (generic scanner); use `<=` / `>=` / `<:` / `>:` instead.
- Enum members are `Pkg::EnumName::Member`, not `Pkg::Member`.
- `bit` is a reserved keyword — cannot be an identifier.
- Canonical testbench: `inst clk: $tb::clock_gen;` (the inst IS the clock), `inst rst: $tb::reset_gen(clk);`, then `initial { rst.assert(); clk.next(n); $assert(...); }`. Do not hand-toggle a `var clk: clock`.
- `veryl check` warns `missing_reset_statement` for un-reset RAMs/arrays; silence with `#[allow(missing_reset_statement)]` on the `always_ff`.

## Architecture (veryl-sim)

Parses Veryl source with the crates.io `veryl-parser` 0.22 crate (grammar tracking in Veryl.lock/examples). Flow: `main.rs` (CLI, parse, top selection) → `elab.rs` (syntax tree → sim IR, hierarchy/inst expansion) → `sim.rs` (eval, delta cycles, NBA scheduling, clock gen, VCD). `expr.rs` is a Pratt parser over veryl-parser tokens; `value.rs` is 4-state (0/1/x) bit vectors over a fixed-width multi-limb integer `Bits` (max `MAXW` = 256 bits); veryl-eda reuses it for constants. `iface.rs` (interfaces, modport resolution) and `gen.rs` (generate-for indices) are shared with veryl-eda (path dependency). `gates.rs` builds a module from a gate netlist instead of its RTL (`run_gates`); veryl-eda's `gatesim.rs` converts its netlists (`--gatesim opt|ice40|asic`, also the web's simulation selector). Gate models keep x-propagation like RTL (LUTs are mux trees, not table lookups).

## Architecture (veryl-eda)

Separate from veryl-sim on purpose (no shared elab). `elab.rs` lowers the syntax tree to a name-based statement IR and *symbolically executes* it into gates (if/case → mux, loops unrolled, functions inlined, always_ff → yosys `$_DFF_*`/`$_SDFF_*` cells). Every declared signal gets placeholder wires; drivers are recorded as aliases and resolved in `netlist::optimize`, which also rebuilds with constant folding/hashing, detects comb loops, and sweeps dead logic. Hierarchy is flattened (`inst.sig` net names). `optimize` also iterates constant-node proving (random sim + exhaustive check over ≤16-input supports) and removal of stuck-at-0 flip-flops. `ice40.rs` maps to SB_CARRY (recognized full-adder carries), SB_LUT4 (cut-based, depth-first) and SB_DFF*. `output.rs` writes yosys JSON + structural Verilog; `netsim.rs` is a 2-state gate simulator for tests (generic, iCE40 and vlib cells). `asic/` is the standard-cell back end: `lib.rs` (vlib cells), `map.rs` (tree-covering DP + BUF trees for fanout > 12), `place.rs` (legal row annealing), `route.rs` (gcell global routing, Prim order + A* + PathFinder), `sta.rs`; the `cargo test` scenarios also run on the vlib netlist and `test.sh` proves it equivalent to `veryl build`. Packed structs put the first field at the MSB (matches veryl's SV). Inside `always_ff`, module signals read as their register outputs (non-blocking semantics). Arrays written as whole elements from one `always_ff` and read as whole elements are recorded as memories (named nets `$mem:NAME:{clk,we,wa,wd,raN,rdN}`, still elaborated as flip-flops); `bram.rs` turns those with synchronous reads into `SB_RAM40_4K` during iCE40 mapping (own P&R places/routes RAMs; netsim models them per yosys `cells_sim.v`).

## Limits / gotchas

- Supported by the simulator: module/param/const/port/var/let/assign/always_comb/always_ff (if_reset, sync/async reset)/if/case/switch/for/inst/initial/final, packages (enums `Pkg::Enum::Member`, consts `Pkg::NAME`), structs (field access + whole-value; first field is the MSB, as in SV), arrays (1-D, element sigs are contiguous: `sigs[first + i]`), user functions (non-recursive; args bound to param signals, `return` via `ret_val`/`ret_now`), generate for (loop var is a const param in a cloned scope), generate if/else and generate blocks, `import Pkg::*`.
- Interfaces: an instance `inst b: Bus;` becomes signals `b.member`; a `modport Bus::m` port becomes ports `port.member`; in expressions `x.y` that is not a struct field is the signal `x.y`. Veryl 0.22's own simulator mis-simulates interfaces (`veryl test` gives 0 for TestHs in `veryl-eda/examples/lang.veryl`; iverilog and veryl-sim give 145).
- Still NOT supported: generic `interface` ports (name the modport), recursion, `inout`, widths > 256 bit.
- Testbench support is via `$tb::clock_gen` (the inst IS the clock), `$tb::reset_gen` (`rst.assert()` with no args uses the clock recorded from `inst rst: $tb::reset_gen(clk)`), `initial` blocks with `clk.next(n)`.
- The sim settles combinational logic after every `initial` statement (delta cycles), so clock-less comb testbenches work.
- `examples/` is a separate Veryl project (own Veryl.toml/lock); `_doc/` holds a Veryl grammar reference (`grammar.md`).
- Docs come in three languages: `README.md` (English, the crates.io page), `README.tw.md` (Traditional), `README.cn.md` (Simplified) at the root and in veryl-sim / veryl-eda. Edit the Traditional and English texts; regenerate the Simplified one with `tools/tocn.py` (OpenCC + mainland EDA terms). The veryl-sim README is authoritative for supported syntax.
