# 1. Meet veryl2chip

## What It Can Do

Take a digital circuit design written in Veryl all the way to "a flashable FPGA" or "a chip layout ready for fabrication":

```
Veryl source
   │  v2c sim        simulate: run #[test] testbenches, view waveforms
   ▼
gate netlist      v2c synth      synthesize: elaborate and optimize to AND / OR / XOR / MUX / flip-flops
   │
   ├─► FPGA   v2c fpga       iCE40UP5K: LUT mapping → place → route → timing → bitstream (flash to iCEBreaker with iceprog)
   │
   └─► ASIC   v2c asic       standard-cell mapping → row-based placement → clock tree → routing → timing → power
                              (vlib teaching cell library, or SkyWater SKY130: adds DRC and GDSII layout)

synthesized netlist → v2c gatesim   re-simulate with the same testbench to confirm synthesis did not change behavior
C program           → v2c cc        compile for the project's RISC-V SoC (itself written in Veryl)
```

All the tools are written in this project itself (the simulator, synthesizer, FPGA place & route and bitstream, ASIC back end, C compiler);
the only places external tools are needed are: flashing a physical board (`iceprog`), optional nextpnr place & route, and developer verification tools.

## Two Ways to Use It

| | Web IDE | Command line `v2c` |
|---|---|---|
| Install | None, just open the page ([online version](https://ccc-eda.github.io/veryl2chip/web/dist/index.html)) | `cargo install veryl2chip-eda` |
| Good for | Classes, experiments, seeing each stage's diagram, the virtual board | Automation, large designs, integration into other flows |
| Capability | Simulation, waveforms, diagrams of every synthesis stage, FPGA / ASIC (incl. SKY130), virtual board, C programs | The same flows, with file output (JSON, Verilog, `.asc`, `.bin`, DEF, GDS, VCD) |

Both use the **same program** (the web page runs the same Rust code compiled to WebAssembly) and produce identical results.

## Glossary

| Term | Meaning |
|---|---|
| Top | The module to simulate or synthesize |
| testbench | A module with the `#[test(...)]` attribute used to test a design; simulation runs all testbenches by default, synthesis ignores them by default |
| Netlist | The circuit of logic gates and flip-flops produced by synthesis |
| LUT / LC | The iCE40 FPGA's 4-input lookup table / logic cell (LUT + carry + flip-flop) |
| Bitstream | The configuration file flashed into the FPGA (`.bin`) |
| Standard cell | A ready-made logic gate layout used in ASICs (NAND2, DFF…) |
| PDK | Process design kit: the cell library, rules for each metal layer, the layout (this project supports SkyWater SKY130) |
| Fmax | The highest clock frequency the circuit can run at; the iCEBreaker's clock is 12 MHz |
| DRC | Design rule check: metal width, spacing, shorts, opens |
| GDSII | The standard file format for chip layouts (`.gds`) |

## What Is in This Project

| Directory | Content |
|---|---|
| `veryl-sim/` | The simulator (crate `veryl2chip-sim`) |
| `veryl-eda/` | Synthesis, FPGA, ASIC, C compiler, virtual board engine, and the `v2c` command (crate `veryl2chip-eda`) |
| `veryl-wasm/` | The above two compiled to WebAssembly |
| `web/` | The web IDE (`web/dist/index.html`) |
| `examples/` | Example designs (adders, state machines, UART, VGA, RISC-V…) and C programs (`examples/c/`) |
| `tutorial/` | The from-zero tutorial and the virtual lab course |
| `tools/` | Small utilities: downloading SKY130, checking GDS, etc. |
| `manual/` | This manual |
