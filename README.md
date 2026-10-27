# veryl2chip
**English** | [繁體中文](README.tw.md) | [简体中文](README.cn.md)

**Try it online** (no install): [IDE](https://ccc-eda.github.io/veryl2chip/web/dist/index.html) · [demo page](https://ccc-eda.github.io/veryl2chip/web/dist/demo.html)

**Tutorial from scratch** (Traditional Chinese, course material): [write Veryl → simulate → waveforms → synthesize → flash an iCEBreaker](tutorial/README.tw.md); **virtual lab course** (no board needed): [8 labs on the virtual iCEBreaker](tutorial/labs.tw.md)

An EDA for Veryl HDL: simulation, logic synthesis, an FPGA flow (iCE40UP5K, down to a
bitstream) and an ASIC flow (standard cells, placement, routing, timing), all written in Rust.
Since v2.0 the ASIC flow also runs on SkyWater's open **SKY130** PDK (`sky130_fd_sc_hd`) all the way to a
DRC-clean GDSII layout ([details](veryl-eda/README.md#sky130---pdk-sky130-srcpdk)). Since v2.2 the FPGA flow also maps to Lattice **ECP5** (ULX3S), placed and routed by nextpnr-ecp5 (`v2c fpga --arch ecp5`). [`examples/rv64/`](examples/rv64/README.md) is an RV64IMAC processor written in Veryl (M/S/U modes, SV39) that boots **xv6** and **Linux** (verified with the official `veryl build` + Verilator). Version history: [history.md](history.md) (Traditional Chinese). User manual: [manual/](manual/README.md) (Traditional Chinese, every command with `v2c`).

| | |
|---|---|
| [`veryl-sim/`](veryl-sim/) | event-driven simulator for Veryl testbenches (`$tb::clock_gen`, `$assert`, VCD) |
| [`veryl-eda/`](veryl-eda/) | synthesis to a gate netlist, iCE40 and ECP5 mapping, own place & route + bitstream (iCE40), ASIC back end (`--asic`) |
| [`veryl-emu/`](veryl-emu/) | compiles a design to WebAssembly for fast cycle-based simulation (like Verilator; runs in Node or a browser): the RV64 SoC boots Linux in it at ~2 MHz |
| [`veryl-wasm/`](veryl-wasm/) | both crates compiled to WebAssembly behind a JSON API |
| [`web/`](web/) | front-end-only web environment (TypeScript) |
| [`examples/`](examples/) | Veryl project with the example designs, incl. a single-cycle RV32I CPU |

## Web environment
Open `web/dist/index.html` in a browser: a VS Code style IDE. It needs no server and no install, and also works from `file://`.

- activity bar and side bar: project files and module outline, example library, tests, help
- tabbed editor with Veryl syntax highlighting and live syntax checking (problems panel, gutter markers, squiggles)
- projects kept in the browser: several projects, new / rename / delete / import files, `.zip` export
- ▶ tests (RTL or gate-level), ✔ full verification: every testbench on RTL and on the three synthesized netlists
- synthesis: the title bar's back end (**FPGA**, **ASIC · vlib** or **ASIC · SKY130**: SkyWater's open PDK, with a DRC and a downloadable GDS) and **stage** menus (① RTL→Logic → ② Logic Netlist → ③ Tech-indep Syn, then FPGA ④–⑦
  or ASIC ④–⑨, last the FPGA vs ASIC comparison) show that stage in the flow tab, which has just a breadcrumb and icon buttons
  (ⓘ about the stage, wires, annealing animation, ⬇ downloads, zoom); the numbers are in the status bar
- bottom panel (problems, output, test results, waveform), status bar, command palette (Ctrl/⌘+Shift+P), quick open (Ctrl/⌘+P)
- ⚡ **virtual iCEBreaker**: flash the design onto a drawn board; LEDs light (brightness from the duty cycle) and buttons can be pressed, with the same pins as the real board (it runs the real placed-and-routed bitstream, decoded back into a circuit and simulated cycle by cycle, about 0.3–0.4× real time for small designs; any iCE40UP5K `.bin`, e.g. from nextpnr, can be dropped on it); plug in a USB serial terminal and PMOD modules (8 LEDs, 8 switches, a 2-digit 7-segment display, a VGA monitor, a buzzer) and a **breadboard** (LEDs, resistors, buttons, switches, wires on the PMOD pins, with warnings for shorts, missing series resistors and floating inputs); a pin table writes the project's `pins.pcf`; a lab (files, pins, modules, breadboard) can be shared as a link
- **C programs on your own RISC-V**: `RvSoc` (`examples/src/rvsoc.veryl`, a multi-cycle RV32IMA + Zicsr with interrupts, its registers and 8 KB of memory in block RAM, LEDs, buttons, switches, UART, timer) runs C compiled in the browser by veryl-eda's own compiler (`src/rv/`: a C subset, assembler, instruction-set simulator); ⚡ puts the program into the block RAMs (only the program changes: no synthesis or place and route), the board's CPU mode runs it in real time, the gate-level SoC at about 1%; a VGA text mode (`RvVgaBoard`, 40 × 30 characters); a preemptive multithreading kernel in C (timer interrupts, ecall, atomics); examples in the C programs group
- 🖥 **emulator**: for designs too large for the FPGA and ASIC flows: veryl-emu compiles the design to WebAssembly and runs it as a machine in a worker, its UART on a terminal (the project's `machine.json` names the ports); the example **RV64 + Linux** boots OpenSBI + Linux + busybox in the browser (about 1.5 M cycles/s, a shell in 2–3 minutes)
- interface in Traditional Chinese, Simplified Chinese or English (menu in the title bar; the browser's language by default)

`index.html#ex=fifo&stage=place` opens an example at a stage; `&run=1` / `&verify=1` start the tests, `&board=1` flashes the virtual board.
The IDE used to be `ide.html`: that page now forwards to `index.html` (with the `#…`), so old links keep working.

### Demo page
`web/dist/demo.html` is the original, simpler page on the same core (interface in Traditional Chinese only):

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

The URL hash selects an example and stage, e.g. `demo.html#ex=soc&synth=1&target=asic` (the IDE accepts the same hash).

Build and test everything from the repository root:

```sh
./build.sh          # veryl-sim, veryl-eda (release) and web/dist (wasm + pages); --no-web for the Rust tools only
./test.sh           # veryl-sim, cargo test of veryl-eda, the tutorial's flow, npm test (what CI runs)
./test.sh --full    # + veryl-eda/test.sh: formal equivalence with yosys, FPGA flows (needs OSS CAD Suite)
```

Install the command-line tools from crates.io (`v2c`, `veryl-sim`, `veryl-eda`):

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

## Command line: `v2c`
One command for everything, git style (`v2c help`, `v2c help <subcommand>` or `v2c <subcommand> -h` for the options):

| | |
|---|---|
| `v2c sim [--top M] [--vcd F] FILE...` | run the `#[test]` testbenches (exit code 1 on a failed `$assert`) |
| `v2c list FILE...` | the modules, and which are testbenches |
| `v2c synth [-o OUT.json] [--verilog OUT.v] FILE...` | gate netlist (yosys JSON, Verilog) and its statistics |
| `v2c fpga [--pcf P] [--asc A] [--bin B] [--pnr veryl] FILE...` | iCE40UP5K: LUT mapping, place & route, bitstream |
| `v2c asic [--pdk vlib\|sky130] [--def D] [--gds G] FILE...` | standard cells, placement, routing, timing, power, DRC (SKY130), GDSII |
| `v2c fpga --arch ecp5 [--lpf L] [--bit B] FILE...` | ECP5: LUT4 / CCU2C mapping, nextpnr-ecp5 + ecppack |
| `v2c gatesim opt\|ice40\|ecp5\|asic\|sky130 FILE...` | the testbenches on the synthesized netlist |
| `v2c cc PROG.c [-o PROG.bin] [--run]` | C (or assembly) for the RISC-V SoC; `--run` on the instruction-set simulator |
| `v2c pdk [DIR]` | check a full SKY130 PDK directory |

```sh
v2c sim --vcd wave.vcd tutorial/src/blinky.veryl
v2c fpga --pnr veryl --pcf tutorial/icebreaker.pcf --bin blinky.bin tutorial/src/blinky.veryl
v2c asic --pdk sky130 --gds alu.gds examples/src/rv32i.veryl --top Alu
```

`v2c` comes with `veryl2chip-eda` (`cargo install veryl2chip-eda`, or `./build.sh`: `veryl-eda/target/release/v2c`);
the older commands `veryl-sim` and `veryl-eda` (`veryl-eda --ice40`, `--asic`, `--cc` ...) still work the same.

See [AGENTS.md](AGENTS.md) for commands and architecture, and the READMEs in each crate ([veryl-sim](veryl-sim/README.md), [veryl-eda](veryl-eda/README.md); English, 繁體中文, 简体中文) for details.
