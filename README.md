# veryl2chip
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

The URL hash selects an example and stage, e.g. `index.html#ex=soc&synth=1&target=asic`.

Rebuild (Rust + wasm32 target, Node.js):

```sh
cd web
npm install
npm run build
npm test
```

`npm run build` rebuilds `web/dist`. `npm test` runs every example through the built `dist/`: simulation, synthesis, FPGA P&R (`.asc` equals the CLI's, `.bin` equals icepack's) and the ASIC flow (results equal the CLI's), gate-level simulation of every example, and a project `.zip` unpacked and checked with `veryl test`.

See [AGENTS.md](AGENTS.md) for commands and architecture, and the READMEs in each crate (Traditional Chinese) for details.
