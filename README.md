# veryl2chip
**English** | [繁體中文](README.tw.md) | [简体中文](README.cn.md)

**Try it online** (no install): [demo page](https://ccc-eda.github.io/veryl2chip/web/dist/index.html) · [IDE](https://ccc-eda.github.io/veryl2chip/web/dist/ide.html)

**Tutorial from scratch** (Traditional Chinese, course material): [write Veryl → simulate → waveforms → synthesize → flash an iCEBreaker](tutorial/README.tw.md)

An EDA for Veryl HDL: simulation, logic synthesis, an FPGA flow (iCE40UP5K, down to a
bitstream) and an ASIC flow (standard cells, placement, routing, timing), all written in Rust.

| | |
|---|---|
| [`veryl-sim/`](veryl-sim/) | event-driven simulator for Veryl testbenches (`$tb::clock_gen`, `$assert`, VCD) |
| [`veryl-eda/`](veryl-eda/) | synthesis to a gate netlist, iCE40 mapping, own place & route + bitstream, ASIC back end (`--asic`) |
| [`veryl-wasm/`](veryl-wasm/) | both crates compiled to WebAssembly behind a JSON API |
| [`web/`](web/) | front-end-only web environment (TypeScript) |
| [`examples/`](examples/) | Veryl project with the example designs, incl. a single-cycle RV32I CPU |

## Web environment
Open `web/dist/index.html` in a browser. It needs no server and no install, and also works from `file://`.

- **Source**: example projects (several files each, incl. UART, FIFO and VGA) in an editor; edits are kept in the browser
  (localStorage). Files can be added (with a module + testbench template), deleted or imported, and the project
  downloaded as a `.zip` (`Veryl.toml` + `src/`) that the official `veryl build` / `veryl test` accept.
- **▶ 模擬**: runs every `#[test]` testbench in WebAssembly, with a log, clickable errors and a waveform viewer.
  The selector next to it switches to **post-synthesis simulation**: the example's design module is replaced by its
  synthesized netlist (generic gates, iCE40 LUTs / block RAM, or standard cells) under the same testbench.
- **⚙ 合成**: the synthesis view. Each stage shows a report, a zoomable drawing and a detail panel:
  - common: ① RTL→Logic → ② Logic Netlist → ③ Tech-indep Syn
  - FPGA: ④ LUT4 Techmap → ⑤ Placement (annealing animation) → ⑥ Global+Detail Routing → ⑦ Timing (STA).
    Downloads: `.asc`, `.pcf` and `.bin`. The `.bin` is byte-identical to icepack's and can be flashed with `iceprog`.
  - ASIC: ④ Standard Cell Map → ⑤ Row Placement (animation) → ⑥ CTS + Global Routing → ⑦ Detail Routing →
    ⑧ Timing (STA) → ⑨ Power + IR Drop. Downloads: standard-cell Verilog and DEF.
  - ⇄ FPGA vs ASIC: both placements side by side and a table (cells, area, wiring, Fmax, energy, power).

(The demo page's interface is in Traditional Chinese; the IDE below also has Simplified Chinese and English.)

The URL hash selects an example and stage, e.g. `index.html#ex=soc&synth=1&target=asic`.

### IDE
`web/dist/ide.html` is a fuller, VS Code style IDE on the same core (the demo page above stays as it is):

- activity bar and side bar: project files and module outline, example library, the synthesis flow stages, tests, help
- tabbed editor with Veryl syntax highlighting and live syntax checking (problems panel, gutter markers, squiggles)
- projects kept in the browser: several projects, new / rename / delete / import files, `.zip` export
- ▶ tests (RTL or gate-level), ✔ full verification: every testbench on RTL and on the three synthesized netlists
- ⚙ the flow as an editor tab: common ① RTL→Logic → ② Logic Netlist → ③ Tech-indep Syn, then FPGA ④–⑦ or
  ASIC ④–⑨, and FPGA vs ASIC
- bottom panel (problems, output, test results, waveform), status bar, command palette (Ctrl/⌘+Shift+P), quick open (Ctrl/⌘+P)
- ⚡ **virtual iCEBreaker**: flash the design onto a drawn board; LEDs light (brightness from the duty cycle) and buttons can be pressed, with the same pins as the real board (a cycle-by-cycle simulation of the iCE40 netlist, about 0.4× real time for small designs)
- interface in Traditional Chinese, Simplified Chinese or English (menu in the title bar; the browser's language by default)

`ide.html#ex=fifo&stage=place` opens an example at a stage; `&run=1` / `&verify=1` start the tests.

Build and test everything from the repository root:

```sh
./build.sh          # veryl-sim, veryl-eda (release) and web/dist (wasm + pages); --no-web for the Rust tools only
./test.sh           # veryl-sim, cargo test of veryl-eda, the tutorial's flow, npm test (what CI runs)
./test.sh --full    # + veryl-eda/test.sh: formal equivalence with yosys, FPGA flows (needs OSS CAD Suite)
```

Install the command-line tools from crates.io (`veryl-sim`, `veryl-eda`):

```sh
cargo install veryl2chip-sim veryl2chip-eda
```

Rebuild (Rust + wasm32 target, Node.js):

```sh
cd web
npm install
npm run build
npm test
```

`npm run build` rebuilds `web/dist`. `npm test` runs every example through the built `dist/`: simulation, synthesis, FPGA P&R (`.asc` equals the CLI's, `.bin` equals icepack's) and the ASIC flow (results equal the CLI's), gate-level simulation of every example, and a project `.zip` unpacked and checked with `veryl test`, and the interface translations.

See [AGENTS.md](AGENTS.md) for commands and architecture, and the READMEs in each crate ([veryl-sim](veryl-sim/README.md), [veryl-eda](veryl-eda/README.md); English, 繁體中文, 简体中文) for details.
