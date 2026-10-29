# 7. FPGA: `v2c fpga`

```
v2c fpga [--top MODULE] [--pcf PINS.pcf] [--asc OUT.asc] [--bin OUT.bin]
         [--pnr veryl|nextpnr] [--seed N] [--no-timing-driven] [--program PROG.bin]
         [-o OUT.json] [--verilog OUT.v] [-v] FILE.veryl...
```

The target chip is the Lattice **iCE40UP5K-SG48** (the one on the iCEBreaker board: 5280 logic cells, 30 blocks of 4 Kbit block RAM, 12 MHz clock).

## Steps

1. **Mapping** (always done): full-adder carries become `SB_CARRY` carry chains, other logic is covered by 4-input lookup tables `SB_LUT4`,
   flip-flops become `SB_DFF*`, and memories with synchronous reads become `SB_RAM40_4K`. Prints a cell statistics report; `-o` / `--verilog` write out the mapped netlist.
2. **Place & route** (only with `--asc` or `--bin`): places the cells on the chip and wires them up.
3. **Bitstream**: `--bin` writes a file you can program the board with.

## Two place & route tools

| | `--pnr nextpnr` (default) | `--pnr veryl` |
|---|---|---|
| What it is | External nextpnr-ice40 + icepack | This project's own place & route and bitstream |
| Needs | OSS CAD Suite | IceStorm's `chipdb-5k.txt` (`VERYL_EDA_CHIPDB`) |
| Timing short of 12 MHz | Fails (nextpnr's behaviour) | Still produces output, prints Fmax, and leaves the judgement to you |
| Other | | Timing-driven (`--no-timing-driven` to disable), `--seed`, `-v` prints the critical path, rough power estimate |

The `.bin` produced by our own place & route is byte-for-byte identical to icepack's, and it has been verified by converting the routed bitstream back into a circuit with IceStorm's `icebox_vlog`
and comparing it cycle by cycle against the netlist (chapter 13).

```sh
$ v2c fpga --pnr veryl --pcf counter.pcf --bin counter.bin counter.veryl
  veryl pnr: 6 LCs, 52 routing pips, 0.2s
  power: 0.199 mW at 122.1 MHz = ...
  timing: critical path 8.19 ns, Fmax 122.10 MHz (wirelength-only pass 122.10 MHz)
wrote counter.bin
```

`--asc OUT.asc` writes IceStorm's text format (our own place & route writes the `.pcf` alongside it); with only `--bin` the `.asc` goes to a temporary directory.

## Pin file (`.pcf`)

Each line is `set_io port pin`, vector ports written as `o_led[0]`. `-nowarn` means it is fine if the design does not use that pin.
Commonly used iCEBreaker pins (`tutorial/icebreaker.pcf` has the full list):

| Pin | Purpose |
|---|---|
| 35 | 12 MHz clock |
| 10 | Board button BTN_N (0 when pressed, ideal as a reset) |
| 11, 37 | Board red / green LED (active low) |
| 26, 27, 25, 23, 21 | Ext-board LED1–LED5 (active high) |
| 20, 19, 18 | Ext-board BTN1–BTN3 (1 when pressed) |
| 6, 9 | Serial RX (into the FPGA), TX (out of the FPGA) |
| PMOD1A: 4 2 47 45 3 48 46 44; PMOD1B: 43 38 34 31 42 36 32 28 | External modules |

Without `--pcf` the tool picks the pins itself; the bitstream can still be built, but programming it onto the board will not connect anything where you want it.

## Timing

`Fmax` is the highest frequency the circuit can run at; it must be **above 12 MHz** to work properly on the iCEBreaker. Adding `--clock 12` (or `--sdc`, see chapter 9)
also reports the slack against that target, e.g. the tutorial's Blinky: `timing: target 83.333 ns (12.00 MHz): slack +53.656 ns, met`; with nextpnr the target frequency
(`--freq`) is passed to it too. If it is not fast enough:

- Cut long combinational logic into two clocked stages (add a register);
- Try a different `--seed`, or the other place & route tool;
- Use `-v` to see which cells and nets the critical path goes through.

## Programming

```sh
iceprog counter.bin
```

No board? The web IDE's ⚡ virtual board runs exactly the circuit decoded back from this bitstream (chapter 12); you can also drag any iCE40UP5K `.bin` onto the virtual board.

## Putting a program into block RAM (`--program`)

For CPUs whose program lives in block RAM (such as this project's `RvBoard`, chapter 10), `--program PROG.bin` fills memory from address 0 with a binary file:

```sh
v2c cc -o hello.bin examples/c/hello.c
v2c fpga --top RvBoard --pnr veryl --pcf examples/rvsoc.pcf --program hello.bin --bin soc.bin \
    examples/src/rv32i.veryl examples/src/sync_ram.veryl examples/src/uart.veryl examples/src/rvsoc.veryl
iceprog soc.bin
```

Place & route of the whole SoC (about 4200 logic cells, 20 block RAMs) takes about a minute, with an Fmax around 13–14 MHz.

Changing only the program does not require re-running synthesis and place & route (when you change the C program in the web IDE, it rewrites the memory contents inside the bitstream directly).

## Lattice ECP5 (`--arch ecp5`)

```
v2c fpga --arch ecp5 [--device 12k|25k|45k|85k] [--package CABGA381] [--lpf PINS.lpf]
         [--config OUT.config] [--bit OUT.bit] [--seed N] [-o OUT.json] [-v] FILE.veryl...
```

ECP5 is a much larger FPGA than the iCE40 (25F about 24k, 85F about 84k LUTs; there are dev boards with SDRAM interfaces, such as the open-source **ULX3S**).
Mapping is done by `v2c` (`LUT4`, carry chain `CCU2C`, flip-flops `TRELLIS_FF`); place & route and bitstream are handed to OSS CAD Suite's **nextpnr-ecp5** and **ecppack**:

```sh
$ v2c fpga --arch ecp5 --bit counter.bit counter.veryl
=== Counter ===
  ...
  cells: 9
    LUT4           5
    TRELLIS_FF     4
  TRELLIS_IO:       7/    365     1%
  TRELLIS_FF:       4/  83640     0%
  TRELLIS_COMB:       6/  83640     0%
  Max frequency for clock 'i_clk$TRELLIS_IO_IN': 371.89 MHz (PASS at 12.00 MHz)
wrote counter.bit
```

`TRELLIS_COMB` is the usage of LUTs plus carry chains; `PASS at 12.00 MHz` is nextpnr's default clock target. To specify another frequency, put
`FREQUENCY PORT "i_clk" 25 MHZ;` in the `.lpf`.

- Defaults are `--device 85k --package CABGA381` (ULX3S 85F); other sizes use `--device 12k|25k|45k`.
- The pin file is Lattice's `.lpf`: `LOCATE COMP "o_led[0]" SITE "B2";`, `IOBUF PORT "o_led[0]" IO_TYPE=LVCMOS33;`.
  Without `--lpf`, nextpnr places the IO itself.
- `--config` is the routed text configuration (Project Trellis format), `--bit` is the bitstream, programmed with `openFPGALoader -b ulx3s counter.bit`.
- `v2c gatesim ecp5` runs the ECP5 netlist with the original testbench (chapter 8).
- Unlike the iCE40: a flip-flop with a reset value of 1 powers up as 1 (on the iCE40 everything powers up as 0).
- Memories with synchronous reads (such as `SyncRam`) become block RAM `DP16KD` (v2.9; each one is 2048 × 9 bits, the 85F has 208 of them).
- Not yet: multipliers, our own ECP5 place & route, the virtual board.

## Limits

The iCE40 support covers only the UP5K; no SPRAM (`SB_SPRAM256KA`), no PLL, no `inout`; memories with asynchronous reads do not become block RAM;
our own place & route does not swap LUT input pins.
