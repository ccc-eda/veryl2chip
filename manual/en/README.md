# veryl2chip User Manual

veryl2chip is a complete set of EDA tools for the [Veryl](https://veryl-lang.org/) hardware description language:
starting from a Veryl program you can **simulate** it, **synthesize** it, turn it into an **FPGA bitstream** to flash onto an iCEBreaker board,
or run the full **ASIC flow** all the way to a DRC-clean **GDSII chip layout** (SkyWater SKY130 open-source process).
Everything is written in Rust, usable from the command line or directly in the browser (no installation required).

This manual covers "how to use it". All command-line examples use the `v2c` command.

## Table of Contents

| Ch | Content |
|---|---|
| [1. Meet veryl2chip](01-intro.md) | What it can do, the two ways to use it, the whole flow at a glance |
| [2. Installation](02-install.md) | Online version, `cargo install`, building from source, external tools, environment variables |
| [3. Quickstart in Five Minutes](03-quickstart.md) | A counter: simulate → synthesize → FPGA → ASIC |
| [4. Veryl for veryl2chip](04-veryl.md) | How to write testbenches, supported syntax, common pitfalls |
| [5. Simulation: `v2c sim`](05-sim.md) | Top selection, assertions, waveforms, exit codes |
| [6. Synthesis: `v2c synth`](06-synth.md) | Gate-level netlist, statistics, yosys JSON / Verilog, optimization and block RAM |
| [7. FPGA: `v2c fpga`](07-fpga.md) | iCE40 mapping, pin files, place & route, timing, bitstream, flashing |
| [8. Post-Synthesis Simulation: `v2c gatesim`](08-gatesim.md) | Check the synthesis result with the same testbench |
| [9. ASIC: `v2c asic`](09-asic.md) | vlib and SkyWater SKY130, DEF, DRC, GDSII, viewing the layout in KLayout |
| [10. RISC-V and C: `v2c cc`](10-riscv-c.md) | The built-in RISC-V SoC, the C compiler, the runtime library, interrupts and multithreading |
| [11. Web IDE](11-ide.md) | Projects, editor, tests, synthesis stages, URL parameters |
| [12. Virtual Board](12-board.md) | Three modes, peripherals, breadboard, shared labs |
| [13. Verification and Development](13-develop.md) | The project's tests, formal verification, for those who want to modify the code |
| [14. Reference](14-reference.md) | Complete `v2c` command reference, environment variables, memory map, troubleshooting |
| [15. Choosing a Target](15-targets.md) | FPGA, ASIC, veryl-emu, riscv-emu: viewing the circuit or running software, speed |
| [16. Example Catalogue](16-examples.md) | What each example does, which files it uses, how to run it on the command line and in the IDE |

## Other Documents

- From-zero tutorial (for first-time hardware writers): [`tutorial/README.tw.md`](../tutorial/README.tw.md)
- Virtual lab course handouts (no board purchase needed): [`tutorial/labs.tw.md`](../tutorial/labs.tw.md)
- Version history: [`history.md`](../history.md)
- Implementation details: [`veryl-sim/README.tw.md`](../veryl-sim/README.tw.md), [`veryl-eda/README.tw.md`](../veryl-eda/README.tw.md)

This manual applies to veryl2chip 2.1 and later (versions with the `v2c` command).
