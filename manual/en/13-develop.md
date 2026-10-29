# 13. Verification and development

This chapter is for people who want to check the tools' trustworthiness, or modify veryl2chip itself.

## How we know the tools are right

| Check | What it proves | Where |
|---|---|---|
| RTL simulation vs official | `v2c sim`'s semantics match the official `veryl test` / iverilog | the examples' testbenches |
| Gate-level simulation | the same testbench passes on the generic-gate, iCE40, vlib, and SKY130 netlists | `cargo test`, `v2c gatesim` |
| **Formal equivalence** | the synthesized netlist is **mathematically equivalent** to the SystemVerilog produced by the official `veryl build` (combinational circuits fully proven; sequential circuits by k-induction or bounded checking) | `veryl-eda/test.sh` (yosys + slang) |
| SKY130 netlist | yosys reads the cells with the PDK's Liberty functions and matches the RTL | `veryl-eda/test.sh` |
| Bitstream | the `.asc` from our own place & route is converted back to a circuit with IceStorm's `icebox_vlog` and compared cycle by cycle against the netlist with random inputs; the `.bin` matches icepack byte for byte | `fpga/pnr_test.sh`, `fpga/cosim.py` |
| FPGA flow | the RISC-V SoC is simulated once from the mapped netlist and once from the routed bitstream | `fpga/flow.sh` |
| Layout | DRC with 0 violations; KLayout reads the GDS back and checks cell counts, non-overlap, widths and spacings | the `asic` flow, `tools/gds_check.py` |
| C compiler | `src/rv/tests/*.c` produce the same output as the host's `cc`; RISC-V programs match spike | `cargo test` |
| Virtual board | the board engine matches netsim; bitstream decoding matches nextpnr's result | `cargo test board`, `cargo test bitstream` |
| Web | every example is run through the same wasm + TypeScript API the web page uses | `npm test` |

## Running the tests

```sh
./test.sh            # what CI runs: veryl-sim, veryl-eda's cargo test, tutorial/check.sh, npm test
./test.sh --full     # additionally veryl-eda/test.sh (needs OSS CAD Suite, tens of minutes)
```

Each step keeps running after failures and prints a summary at the end. Individually:

```sh
cd veryl-eda && cargo test --release          # synthesizes all examples, runs testbenches on netlists, C compiler, v2c commands
cd veryl-eda && cargo test --release --test v2c  # only the v2c subcommands
cd veryl-eda && ./test.sh                     # formal equivalence + FPGA flow + SKY130 (incl. GDS check)
cd veryl-eda && ./fpga/pnr_test.sh            # our own place & route: each design's bitstream vs netlist + icetime
cd web && npm test                            # web (needs npm run build first)
```

Environment variables used by `veryl-eda/test.sh`:

| Variable | Purpose |
|---|---|
| `YOSYS_SLANG` | a yosys with the slang frontend (OSS CAD Suite's). Homebrew's yosys cannot read the enum casts and functions in `veryl build`'s output |
| `GDS_PY` | a Python with the KLayout module (`pip install klayout`), used to check the SKY130 GDS; if unset, `python3` is used when it has it |
| `OUT` | output directory (default: a temp directory) |
| `VERYL_EDA_CHIPDB` | IceStorm chip database; if `./test.sh` can't find it, it is extracted from `web/dist/chipdb.js` |

The equivalence check uses `-set-init-zero`, because the optimizer assumes flip-flops power up at 0 (true on iCE40).

## Adding a test design

- Synthesis test designs go in `veryl-eda/examples/` and into the `DESIGNS` list of `veryl-eda/test.sh` (format `filename:module:mode`,
  mode `comb` / `ind` / `bmcN`). These files are copied into the official Veryl project to produce the golden result, so module names must not clash with `examples/src`.
- Use `veryl check` (run inside `examples/`) to confirm syntax; `v2c`'s "not supported" is not a syntax error, just a feature this project doesn't support.

## Source map

| Directory | Content |
|---|---|
| `veryl-sim/` | the simulator (crate `veryl2chip-sim`): `elab.rs` elaboration, `sim.rs` event-driven simulation, `value.rs` 4-state bit vectors, `cli.rs` |
| `veryl-eda/src/` | the synthesizer (crate `veryl2chip-eda`): `elab.rs` symbolic execution into gates, `netlist.rs` optimization, `ice40.rs`, `bram.rs`, `output.rs`, `netsim.rs`, `cli.rs`, `bin/v2c.rs` |
| `veryl-eda/src/pnr/` | our own iCE40 place & route and bitstream |
| `veryl-eda/src/asic/` | the standard-cell flow: `map` `place` `route` `detail` `sta` `layout` `drc` `gds` |
| `veryl-eda/src/pdk/` | technology abstraction, Liberty / LEF / DEF readers, SKY130 binding; `veryl-eda/pdk/sky130hd/` the bundled subset |
| `veryl-eda/src/board/` | the virtual board: engine, iCEBreaker, bitstream decoding, peripherals |
| `veryl-eda/src/rv/` | the C compiler, assembler, instruction-set simulator |
| `veryl-emu/` | the compiled emulator: compiles a design to WebAssembly (`ir.rs` typing, `gen.rs` scheduling and code generation, `wasm.rs` encoder), `js/emu.mjs`; the IDE's machine uses it |
| `veryl-wasm/` | WebAssembly for the web (C ABI, JSON in and out) |
| `web/` | the IDE and demo page (TypeScript); `web/dist/` is the built, ready-to-use page (committed to git) |
| `examples/` | Veryl examples (an official Veryl project), `examples/rv64/` the RV64 processor and xv6 / Linux, `examples/c/` C examples, `examples/sw/` RISC-V assembly tests |
| `tutorial/` | the tutorial and the virtual lab course |
| `tools/` | SKY130 download and subset, GDS check, font, Simplified-Chinese conversion |

More detail is in `AGENTS.md`, `web/PLAN.md`, and the two crates' READMEs.

## Building and publishing

```sh
./build.sh                 # Rust tools + web/dist; rebuild web/dist after changing Rust or TypeScript
./publish.sh               # dry run of the crates.io publish (no upload)
./publish.sh --yes         # actually publish veryl2chip-sim, veryl2chip-eda, and tag vX.Y
```

Before publishing a new version, bump the versions in both `Cargo.toml`s (and eda's dependency on sim).

The documentation comes in three languages: `README.md` (English), `README.tw.md` (Traditional), `README.cn.md` (Simplified, converted from Traditional by `tools/tocn.py`).
Web interface text is written as `tr('繁體', 'English')`; Simplified is derived from the mapping tables automatically.

CI (`.github/workflows/static.yml`) runs the content of `./test.sh`, and on pushes to main deploys the freshly built `web/dist` to GitHub Pages.
