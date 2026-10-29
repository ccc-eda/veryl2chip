# 14. Reference

## `v2c` command summary

```
v2c <subcommand> [options] FILE.veryl...
```

`v2c help <subcommand>` or `v2c <subcommand> -h` shows help. The exit code is 0 on success, 1 on failure (assertions, syntax, synthesis errors), 2 on bad options.

| Subcommand | What it does | Ch. |
|---|---|---|
| `sim` (alias `test`) | run the testbench | 5 |
| `list` | list modules, marking `#[test]` | 5 |
| `synth` | synthesize to a gate-level netlist | 6 |
| `fpga` | iCE40UP5K (default) or ECP5 (`--arch ecp5`): mapping, place & route, bitstream | 7 |
| `gatesim` | run the testbench on the synthesized netlist | 8 |
| `asic` | standard-cell flow (vlib / SKY130) | 9 |
| `cc` | compile C (or assemble `.s`) for the RISC-V SoC, and run it directly | 10 |
| `pdk` | check a full SKY130 installation | 9 |
| `version` | version | |
| `help` | help | |

### Common

| Option | Subcommands | Meaning |
|---|---|---|
| `--top M`, `-s M` | sim, synth, fpga, gatesim, asic | top module. sim defaults to all `#[test]`; the others default to the last module that is not a testbench |
| `FILE.veryl...` | all | multiple files may be given, order doesn't matter |

### `v2c sim`

| Option | Meaning |
|---|---|
| `--vcd F.vcd` | waveform (with multiple testbenches, one file each: `F_<top>.vcd`) |
| `--max-time N` | simulation time limit (default 1000000) |

Exit codes: 0 pass; 1 a `$assert` failed, or a source error; 2 bad options.

### `v2c synth`

| Option | Meaning |
|---|---|
| `-o F.json`, `--json F.json` | yosys JSON |
| `--verilog F.v` | structural Verilog |

### `v2c fpga`

| Option | Meaning |
|---|---|
| `--pcf F.pcf` | pin file |
| `--asc F.asc` | routed configuration (IceStorm text format) |
| `--bin F.bin` | bitstream |
| `--pnr veryl\|nextpnr` | place & route tool (default nextpnr) |
| `--seed N` | placement seed |
| `--no-timing-driven` | wirelength only (our own place & route) |
| `--program P.bin` | put a program into block RAM |
| `-o F.json`, `--verilog F.v` | the mapped netlist |
| `-v` | critical-path details |
| `--device up5k --package sg48` | the defaults (the only iCE40 device currently supported) |
| `--arch ice40\|ecp5` | target FPGA (default ice40) |
| `--lpf F.lpf`, `--config F.config`, `--bit F.bit` | ECP5 pin file, routed configuration, bitstream (nextpnr-ecp5 + ecppack) |
| `--device 12k\|25k\|45k\|85k --package CABGA381` | the ECP5 device (default 85k, CABGA381) |

### `v2c gatesim opt|ice40|ecp5|asic|sky130`

Only `--top`.

### `v2c asic`

| Option | Meaning |
|---|---|
| `--pdk vlib\|sky130\|sky130:DIR` | cell library (default vlib) |
| `--seed N` | placement seed |
| `--verilog F.v` | standard-cell netlist (with cell models) |
| `--def F.def` | DEF |
| `--gds F.gds` | GDSII (SKY130) |
| `--spice F.sp` | SPICE netlist (SKY130): for KLayout's LVS (`tools/lvs_check.py`), ngspice |
| `--sdc F.sdc` | timing constraints (SDC subset): reports slack WNS / TNS (chapter 9) |
| `--clock MHZ` | one target clock applied to everything (shorthand for `--sdc`); also passed to nextpnr for FPGA |
| `--map-only` | cell mapping only |
| `-v` | critical path, examples of DRC violations |

### `v2c cc PROG.c|PROG.s`

| Option | Meaning |
|---|---|
| `-o P.bin` | binary image |
| `-S P.s` | assembly |
| `-L P.lst` | listing |
| `--run [N]` | run on the instruction-set simulator (default up to 10 million instructions) |
| `--mem BYTES` | RAM size (default 8192) |
| `--linux` | a static executable for the RV64 board's Linux (`-o` defaults to the filename without `.c`) |

### `v2c pdk [check] [DIR]`

DIR defaults to looking for `$VERYL_EDA_SKY130`, then `~/sky130hd`.

## The old commands

The two commands `veryl-sim` and `veryl-eda` still exist; the `v2c` subcommands just add the corresponding flags for them:

| `v2c` | old command |
|---|---|
| `v2c sim ...` | `veryl-sim ...` |
| `v2c synth ...` | `veryl-eda ...` |
| `v2c fpga ...` | `veryl-eda --ice40 ...` |
| `v2c fpga --arch ecp5 ...` | `veryl-eda --ecp5 ...` |
| `v2c asic ...` | `veryl-eda --asic ...` |
| `v2c gatesim K ...` | `veryl-eda --gatesim K ...` |
| `v2c cc P.c ...` | `veryl-eda --cc P.c ...` |
| `v2c pdk` | `veryl-eda --pdk-check` |

## Environment variables

| Variable | Purpose |
|---|---|
| `VERYL_EDA_CHIPDB` | IceStorm `chipdb-5k.txt` (for `--pnr veryl`); if unset, OSS CAD Suite's `share/icebox/` is searched |
| `VERYL_EDA_SKY130` | directory of the full SKY130 hd files (`v2c pdk`) |
| `VERYL_EDA_PROFILE` | print the time of each ASIC step and the conflict counts of each detailed-routing round |
| `YOSYS_SLANG`, `YOSYS`, `GDS_PY`, `OUT` | used by `veryl-eda/test.sh` (chapter 13) |

## File formats

| Extension | What it is | Who writes / reads |
|---|---|---|
| `.veryl` | Veryl source | you |
| `.pcf` | pins: `set_io [-nowarn] port pin` | you; `fpga --pcf`, the virtual board |
| `.vcd` | waveform | `sim --vcd`; GTKWave, the IDE |
| `.json` | yosys JSON netlist | `synth -o`, `fpga -o`; yosys |
| `.v` | structural Verilog | `--verilog`; iverilog, yosys |
| `.asc` | iCE40 configuration (text) | `fpga --asc`; IceStorm tools |
| `.bin` | iCE40 bitstream | `fpga --bin`; iceprog, the virtual board |
| `.lpf` | ECP5 pins | you; `fpga --arch ecp5 --lpf` |
| `.config`, `.bit` | ECP5 routed configuration, bitstream | `fpga --arch ecp5`; ecppack, openFPGALoader |
| `.def` | place & route | `asic --def`; OpenROAD, KLayout |
| `.gds` | chip layout | `asic --gds`; KLayout, Magic |
| `.c`, `.s` | RISC-V programs | you; `cc` |
| `.bin` (program) | a memory image starting at address 0 | `cc -o`; `fpga --program`, the virtual board |
| `.lab.json` | a shared lab | the IDE |

## RvSoc memory map

| Address | Name | Description |
|---|---|---|
| `0x0000_0000`–`0x0000_1FFF` | RAM | 8 KB |
| `0x1000_0000` | `LED` | 8-bit output |
| `0x1000_0004` | `BUTTONS` / `SWITCHES` | bits 2..0 buttons, bits 15..8 switches |
| `0x1000_0008` | `UART_DATA` | the byte sent / received |
| `0x1000_000C` | `UART_STATUS` | bit 0 transmitting, bit 1 received |
| `0x1000_0010` | `TIMER` / `MTIME` | clock counter (12 MHz) |
| `0x1000_0018` | `MTIMECMP` | timer-interrupt compare value |
| `0x1000_0020` | `MSIP` | software interrupt |
| `0x1000_2000` / `4000` / `6000` | `VGA_TEXT` / `VGA_FONT` / `VGA_COLOR` | VGA text mode (`RvVgaBoard`) |

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `not supported` | syntax this project doesn't support (chapter 4), not necessarily a syntax error; confirm with the official `veryl check` |
| parse errors like `expected …` around `<` / `>` in a function | a known Veryl 0.22 issue: use `<=`, `>=`, `<:`, `>:` inside functions |
| the test doesn't run | the module has no `#[test(name)]` in front of it; `v2c list` shows which ones are testbenches |
| simulation never ends | the testbench has no end point; control it with `clk.next(n)`, or use `--max-time` |
| `combinational loop` | some signal in an `always_comb` is not assigned on every path, or there really is a loop |
| a lot of circuitry is missing after synthesis | the optimizer removed logic that cannot affect the outputs, or registers that are always 0; check the output ports actually use them |
| gatesim and sim disagree | the design depends on uninitialized values, or there is a synthesizer bug (please report) |
| `no chipdb` / cannot find `chipdb-5k.txt` | set `VERYL_EDA_CHIPDB`, or install OSS CAD Suite; or switch to `--pnr nextpnr` |
| nextpnr fails on timing | the design is too slow (chapter 7); `--pnr veryl` also produces and prints Fmax |
| ASIC is very slow | large memories become flip-flops in SKY130; use `--map-only` to get just the netlist, or switch to vlib |
| `v2c` not found | `cargo install veryl2chip-eda`, or add `veryl-eda/target/release` to `PATH` |
| the design works better on the virtual board than on a real one | the virtual board doesn't simulate timing violations or button bounce (chapter 12) |
