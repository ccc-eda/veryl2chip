# veryl-eda (crate: `veryl2chip-eda`)
**English** | [繁體中文](https://github.com/ccc-eda/veryl2chip/blob/main/veryl-eda/README.tw.md) | [简体中文](https://github.com/ccc-eda/veryl2chip/blob/main/veryl-eda/README.cn.md)

Logic synthesis, an FPGA flow and an ASIC flow for [Veryl](https://veryl-lang.org/) (think yosys `synth` / `synth_ice40` plus nextpnr,
and an OpenROAD-style standard-cell back end). With [`veryl-parser`](https://docs.rs/veryl-parser/latest/veryl_parser/) as the front end it
elaborates a Veryl design into a **flat gate-level netlist**, which can be mapped to iCE40 `SB_LUT4` / `SB_CARRY` / `SB_DFF*` cells and placed and
routed into an `.asc` by **its own place & route** (`--pnr veryl`) or nextpnr-ice40, then packed into a bitstream; or, with `--asic`, mapped to the
home-made **vlib standard-cell library**, placed in rows, routed and timed.

Part of [veryl2chip](https://github.com/ccc-eda/veryl2chip) (online IDE: <https://ccc-eda.github.io/veryl2chip/web/dist/ide.html>).

    cargo install veryl2chip-eda        # installs the `veryl-eda` command
    veryl-eda [--top MODULE] [-o out.json] [--verilog out.v] [--list]
              [--ice40 [--device up5k] [--package sg48] [--pcf pins.pcf] [--asc out.asc] [--bin out.bin]
                       [--pnr nextpnr|veryl] [--seed N] [--no-timing-driven] [-v]]
              [--asic [--seed N] [-v]] [--gatesim opt|ice40|asic] [--program PROG.bin]
              a.veryl b.veryl ...
    veryl-eda --cc PROG.c [-o PROG.bin] [-S PROG.s] [--run [N]] [--mem BYTES]

In the source tree, `cargo run --release -- ...` works too. The own place & route needs IceStorm's `chipdb-5k.txt` (included in OSS CAD Suite, or point to it with `VERYL_EDA_CHIPDB`).

- By default the last **non**-`#[test]` module is synthesized; `--top` picks one. Ports and cell statistics are printed (like yosys `stat`).
- `-o` writes yosys JSON (readable by `read_json`); `--verilog` writes gate-level Verilog (simulates in iverilog).
- `--ice40` maps to iCE40 cells; with `--asc` / `--bin` it also places, routes (`nextpnr-ice40` by default, failing if timing does not close; `--pnr veryl` for the own one) and packs (`icepack`).
- `--gatesim opt|ice40|asic`: **post-synthesis simulation**. The `--top` module is replaced by its generic-gate / iCE40 / standard-cell netlist (`src/gatesim.rs` → veryl-sim's gate models)
  and the original `#[test]` testbenches run on it (`test.sh` runs 15 designs × 3 netlists; the results must equal the RTL's).
- `--asic` runs the ASIC back end (below); `--verilog` then writes the standard-cell netlist (with the vlib cells' Verilog models), `-v` prints the critical path.
- `./test.sh`: unit tests + synthesis of every example + yosys `read_json; check -assert` + the FPGA flow +
  **formal equivalence checking** against the SystemVerilog from `veryl build` (needs a yosys with the slang front end, e.g. oss-cad-suite, given by `YOSYS_SLANG`).

## RV32I CPU
`RiscvCore` in `examples/src/rv32i.veryl` is a single-cycle RV32I (without fence/ecall/ebreak/CSR):
`lui auipc jal jalr`, the six branches, `lb lh lw lbu lhu sb sh sw`, and every R/I-type operation (shifts, `xor`, `sltu`, ...).
The data memory interface marks the bytes to write with `o_dmem_wstrb`; on reads the CPU extracts the byte / halfword from the whole word and sign-extends it.

The test program `examples/sw/rv32i_test.S` is assembled into a ROM by a real assembler (`examples/sw/build.sh` → `examples/src/rv32i_rom.veryl`)
and writes 41 results to memory, which `TestRiscvCore` checks word by word with `$assert`. The expected values are cross-checked with the official
RISC-V reference simulator **spike** (done by `build.sh`). It passes on spike, the official `veryl test`, veryl-sim, veryl-eda's synthesized
gate-level netlist, and the iCE40-mapped netlist (`cargo test`).

The complete RiscvCore (not trimmed by a constant ROM) needs 5401 LUTs after mapping, more than the UP5K's 5280 LCs, mostly because of the
32×32 register file in flip-flops; the multi-cycle `RvSoc` below keeps its registers and memory in block RAM and fits with room to spare.

## A RISC-V CPU on the FPGA
`RiscvSoc` in `examples/soc.veryl` = `RiscvCore` from `examples/src/rv32i.veryl` + a program ROM + a 16-word data RAM + an LED register (address 0x100).
The program computes Fibonacci(10) with a `beq`/`jal` loop and writes 55 to RAM[0] and the LEDs. The top only has a clock, a reset and 8 LEDs.
The program ROM is constant, so synthesis removes all hardware this program does not use (unused registers, the shifter, byte loads, ...);
the bitstream therefore only proves the instructions this program uses.

    ./fpga/flow.sh          # synthesis → mapping → nextpnr → icepack → two gate-level simulations
    iceprog fpga/build/soc.bin

| Item | Result (iCE40UP5K-SG48, iCEBreaker pins `examples/icebreaker.pcf`) |
|---|---|
| cells | 1168 SB_LUT4, 85 SB_CARRY, 232 DFF |
| placement | 1279 / 5280 LCs (24%) |
| timing | about 17 MHz (the board clock is 12 MHz: passes) |
| simulation of the mapped netlist (yosys iCE40 cell models) | LED = 55 at cycle 70 |
| simulation of the **routed bitstream** (converted back to Verilog by `icebox_vlog`) | LED = 55 at cycle 70 |

## A RISC-V SoC with C programs (`examples/src/rvsoc.veryl`, `src/rv/`)
`RvCore` is a **multi-cycle** RV32IMA + Zicsr (Decode → Exec, plus Mem for loads / LR / AMOs; 2 cycles per instruction, 3 per load, 35 per
multiply / divide (iterative), machine-mode traps: timer / software / external interrupts, ecall, ebreak, illegal instructions, misaligned
addresses, `mret`, `wfi`; enough for a preemptive multithreaded kernel) whose register file
(two `SyncRam` copies for two read ports) and memory are synchronous-read RAMs, so they become `SB_RAM40_4K`. `RvSoc` adds an 8 KB
memory of four byte lanes (`RvMem`), memory-mapped peripherals (LEDs 0x1000_0000, buttons + switches 0x…04, UART data / status 0x…08 / 0x…0C, a CLINT: `mtime` 0x…10, `mtimecmp` 0x…18, `msip` 0x…20)
and a loader port for testbenches; `RvBoard` is the iCEBreaker top (`examples/rvsoc.pcf`): 3960 LUTs + 20 block RAMs, Fmax about 12.8 MHz (nextpnr; the clock is 12 MHz).
`VgaText` (`examples/src/rvvga.veryl`) adds a 40 × 30 character VGA screen on the SoC's external write bus (characters and font in block RAM, a two-cycle pipeline);
`RvVgaBoard` = 4072 LUTs + 26 block RAMs, about 13 MHz. Block RAM inference accepts memories whose unused data bits were already removed.
`TestRvSoc` loads `rv32i_test.S` (data at 0x300, `examples/src/rvsoc_rom.veryl` from `examples/sw/build.sh`), runs it and checks its 41 results;
`TestRvSocIma` (`examples/src/rvsoc_ima_test.veryl`, also from `build.sh`) runs `rv32ima_test.S` (M, A, Zicsr, traps) and checks it against spike;
`veryl-eda/examples/rvsoc_small.veryl` (a 64-byte memory) is proven equivalent to `veryl build` by `test.sh`.
The C compiler emits `mul` / `div` / `rem`, takes `asm("...")` statements and top-level `asm(...)` (a function whose body is only `asm` is emitted
without prologue: a naked function), and a function's name is its address; the runtime has `interrupts_on/off`, `irq_save/restore`, `set_mtvec`,
`set_mie`, CSR reads, `wfi`, `atomic_swap/add/and/or/xor/cas` (AMOs, LR/SC) and spinlocks. `examples/c/threads.c` is a small preemptive kernel:
a 10 ms timer interrupt saves the registers on the thread's stack and switches threads round robin, `ecall` gives yield / sleep / exit, a mutex
uses `amoswap`; `cargo test threads_on_rvsoc` runs it (with a shorter time slice) on the gate-level RvBoard and on the ISS: the same output and LEDs.

**Programs in block RAM.** Each `SB_RAM40_4K` that holds a memory carries `MEM_SLOT` = `NAME:BLOCK` (a yosys attribute in the JSON);
`bram::set_mem_init` gives a memory initial contents after mapping, `--program PROG.bin` fills the byte lanes `*.b0.mem … *.b3.mem` from address 0,
and `pnr::patch_ram` rewrites just those blocks' `.ram_data` in a placed-and-routed `.asc`: a new program without synthesis or place and route
(`cargo test rvsoc_program_on_board`: the patched bitstream equals placing and routing with the program, and runs the ISA test on the virtual board).
The optimizer keeps a memory that is never written (a ROM to be filled) instead of treating it as constant 0.

**C compiler** (`src/rv/`): `cc.rs` compiles a subset of C — `char` (unsigned) / `short` / `int` / `unsigned`, pointers, arrays of any dimension,
every C operator, `if` / `while` / `do` / `for` / `switch`, globals with initializers, `...` arguments, a small preprocessor (`#define` with parameters, `#ifdef`) —
to RV32I assembly: plain stack-based code with immediate forms, compare-and-branch and C source lines as comments. `prelude.c` is the runtime library
(software multiply / divide, `putchar` / `getchar` / `printf` / `puts` / `read_line`, `delay_ms` / `millis`, `rand`, `strlen` / `strcmp` / `memcpy` …, the
peripheral registers `LED`, `BUTTONS`, `SWITCHES`, `TIMER`, `UART_DATA`, `UART_STATUS`); only what `main` reaches is kept. `asm.rs` is a two-pass assembler
(pseudo-instructions, `%hi` / `%lo`, `.data` / `.rodata` / `.bss`, a listing), `iss.rs` an instruction-set simulator with RvSoc's memory map and cycle counts.

    veryl-eda --cc hello.c -o hello.bin -S hello.s --run       # compile, write the image and the assembly, run on the ISS
    veryl-eda --top RvBoard --ice40 --pnr veryl --pcf ../examples/rvsoc.pcf --program hello.bin --bin soc.bin ../examples/src/{rv32i,sync_ram,uart,rvsoc}.veryl

Tests: `src/rv/tests/*.c` print exactly what the host C compiler's build prints (`cc -funsigned-char -fwrapv`); `cc_on_rvsoc` runs a compiled program
on the gate-level `RvBoard` (program in its block RAMs) on the virtual board: the same serial output as the ISS. The virtual board's **CPU mode**
(`Board::cpu`) runs a program on the ISS with RvSoc's pins and peripherals, about 5× faster than real time; the gate-level SoC runs at about 1% of real time.

## Own place & route (`--pnr veryl`, `src/pnr/`)
iCE40UP5K only; the architecture comes from IceStorm's `chipdb-5k.txt` (set `VERYL_EDA_CHIPDB` if it is not found).
| File | Contents |
|---|---|
| `chipdb.rs` | reads the chip database: tiles and configuration bit tables, the routing graph (100k wires, 1.2M pips; each pip is a bit pattern of the destination wire's input mux), pins, global buffers, IE/REN, column buffers |
| `pack.rs` | LUT / carry / flip-flop → logic cells (LCs); carry chains are kept whole: a feed-in LC when a signal is a carry-in, and the next LC's LUT reads a carry-out that ordinary logic uses |
| `place.rs` | simulated annealing (HPWL wirelength, nets can be weighted); flip-flops in one tile must share clock / reset / edge; carry chains take a column of logic tiles starting at LC 0 |
| `route.rs` | PathFinder congestion negotiation + A*; clock and reset use the global networks (source → `fabout` → `glb_netwk_N` → each tile's clk / s_r mux); timing driven, a net of criticality c pays c × wire delay + (1 − c) × congestion per wire |
| `mod.rs` | writes the `.asc`: LC bits (LUT bit order, carry, DFF, set/reset), carry chain links, IO, column buffers, DSP defaults |

Verification:
- `fpga/cosim.py`: **our routed bitstream** is converted back to Verilog with `icebox_vlog` and compared cycle by cycle with the mapped netlist under the same random inputs; flipping one LUT bit is caught.
- `fpga/pnr_test.sh`: all 20 designs give identical outputs for 1000 cycles; Fmax measured with `icetime` (IceStorm's timing analyzer).
- Non-logic tiles (IO settings, column buffers, DSP/IPCON defaults) are bit-identical to nextpnr's output for the same pcf.
- `PNR=veryl fpga/flow.sh`: the RISC-V SoC with the own place & route; the routed bitstream simulates to LED = 55.

| Design | LCs | Fmax (icetime) |
|---|---|---|
| RiscvSoc (own P&R) | 1252 / 5280 | 17.0 MHz (wirelength-only 15.6 MHz; the board runs at 12 MHz: passes) |
| RiscvSoc (nextpnr) | 1279 / 5280 | 17.3 MHz |

The own place & route also prints a rough power estimate (`src/pnr/power.rs`: net capacitance ≈ 5 fF × loads + 8 fF × routing segments, the global clock network every cycle, ≈ 24 pJ per block RAM access, static ≈ 75 µA).

### Timing driven (on by default, `--no-timing-driven` turns it off)
The first pass only looks at wirelength. Besides the forward arrival times, STA makes a backward pass for "the longest time still to go after each point",
giving each net a **criticality** = the longest path through it / the critical path (0..1). The second pass:
- weights a net in the placement cost by 1 + 6 × criticality⁸ / √loads (only nets close to critical get heavy; high-fanout nets cannot pull everything together);
- routes critical nets on fast wires first (see `route.rs`).
If it does not route, or is not at least 3% faster (the STA's margin of error), the first pass is kept. The ASIC flow does the same: a low-temperature
refinement from the first placement, plus, for small designs (< 4000 cells), a fresh anneal; the fastest routable result wins.

| Design | FPGA, icetime (wirelength only → timing driven) | ASIC, own STA |
|---|---|---|
| Ram | 39.0 → 45.0 MHz | 974 → 1006 MHz |
| BramMix | 42.5 → 48.0 MHz | 394 → 410 MHz |
| RiscvSoc | 15.6 → 17.0 MHz | 107 → 115 MHz |
| RiscvCore | (does not fit the UP5K) | 71.1 → 75.6 MHz |

## ASIC back end (`--asic`, `src/asic/`)
**vlib** is a standard-cell library for teaching (row height 4.0 µm, site 0.5 µm, delays like a ~130 nm slow corner):
`INV BUF NAND2 NOR2 AND2 OR2 XOR2 XNOR2 AOI21 OAI21 MUX2 TIEL TIEH DFF DFFN DFFR DFFS DFFNR DFFNS` (R/S pins active low).
| File | Contents |
|---|---|
| `lib.rs` | the library: width, area, intrinsic delay + load per fanout, setup, Verilog behavioral models; **SRAM macros** (in the role of a memory compiler: area and shape from words × width) |
| `map.rs` | technology mapping: the netlist is cut into trees at multi-fanout points and each tree is covered by dynamic programming for minimum area (**tree covering**; inverters merge into NAND/NOR/XNOR/AOI/OAI); synchronous set/reset becomes logic before D, asynchronous ones use DFFR/DFFS (INV added for active high); data nets with fanout > 12 get **BUF trees** (clock / asynchronous reset are left to the clock tree); memories with synchronous reads (the same condition as FPGA block RAM inference) become **SRAM macros**, one per read port |
| `place.rs` | the die follows a 65% utilization (plus macro area); SRAM macros are placed first in rows from the lower left, IO pins around the edge; standard cells start in a snake order filling each row by its free space, then **legal simulated annealing** (move to a free spot or swap two cells) minimizes HPWL + a **density penalty** (in 16 × 16 µm bins, what exceeds the target density = utilization + 15%, each site counted as 1 µm of wire). Without the density term RiscvSoc left a hot spot of full M2/M3 next to the pins and detail routing ended with 1 conflict; with it, wirelength −5% (160 → 152 mm) and 0 conflicts in every design |
| `route.rs` | **global routing** on 4 µm gcells: horizontal M2/M4, vertical M3/M5, 12 tracks per edge (of 16; 4 left for pins and vias); pins join the tree in Prim order with A* (macros by the pins on their edge), PathFinder (present + history cost) removes overflow |
| `pdn.rs` | **power grid and filler cells**: an M1 rail on every row boundary (VSS / VDD alternating, matching the flipped rows), M5 vertical strap pairs every 40 µm (VDD and VSS 2 tracks wide each, avoiding IO pins), via stacks (M1→M5) to the rails of the same net; detail routing treats straps and via stacks as obstacles; free sites are filled with FILL8/4/2/1; the DEF has `SPECIALNETS` and the fillers |
| `power.rs` | **power and IR drop**: random-input simulation of the final netlist (`src/power.rs`, the reset polarity found by a trial run) gives each net's toggle rate; switching energy ½·C·V² (C = load pins + 0.2 fF/µm of actual wire), the clock tree charges every cycle, cell internal energy and leakage by size, SRAM per access; converted to mW at Fmax. IR drop: each cell's average current goes through its row's VDD / VSS rails; a rail between two straps is a resistive line fed from both ends |
| `detail.rs` | **detail routing**: a 0.5 µm track grid × 4 layers (M2/M4 horizontal, M3/M5 vertical); every grid point belongs to one net at most (no shorts); each net is routed with A* only inside its global-routing gcell corridor (plus one ring), vias cost extra, overlaps are renegotiated with PathFinder and a stuck net's corridor widens; cell pins come up from M1 through vias, SRAM macros block M2/M3 above them, IO pins are on M5; writes each layer's segments and vias (DEF `NETS`); the detailed wire lengths feed the STA |
| `cts.rs` | **clock tree synthesis** (after placement): the loads of the clock and asynchronous resets are split in halves by position recursively (median along the longer side, an H-tree-like balanced binary tree), one CLKBUF per group of ≤ 16 loads, placed at the free spot nearest the centroid of what it drives; plus hold fixing (delay BUFs inserted before violating D pins) |
| `sta.rs` | static timing: cell delay = intrinsic + load × fanout; wire delay = driving the whole routed net + the distributed RC to that load; after CTS the clock is propagated: every flip-flop has its own clock arrival, setup is checked between launching and capturing clocks, then a shortest-path **hold check** (IO is treated as a virtual clock at the average insertion delay); also each net's criticality (for timing-driven placement) |
| `mod.rs` | `flow()` puts it together; `def()` writes the DEF layout |

Flow: mapping → placement (wirelength; if a trial global routing overflows or the average demand is > 50%, the die grows: utilization × 0.8, again) → timing-driven placement → CTS → global routing → STA (propagated clock, hold) → on hold violations, delay BUFs, rerouting, STA again → power grid and fillers → detail routing → a final STA with the detailed wire lengths.
RiscvCore (the register file is 1056 DFFs plus a read crossbar of 5000 MUX2) does not route at 65% and drops to 42% automatically: detail routing with 0 conflicts and 0 opens, 80 MHz.
Example: RiscvSoc's i_clk has 232 loads → 31 CLKBUFs, 5 levels, insertion delay 0.74 ns, skew 104 ps; RiscvCore 1056 loads → 194 CLKBUFs, 8 levels, skew 170 ps.

| Design | Standard cells | Area | Die | Wirelength | Fmax |
|---|---|---|---|---|---|
| RiscvSoc | 2553 | 31360 µm² | 220 × 220 µm | 117 mm | 109 MHz |
| RiscvCore (the whole RV32I, a register file of 1024 DFFs) | 9795 | 0.132 mm² | 449 × 452 µm | 1088 mm | 67.5 MHz |

Verification: `cargo test` also runs every example's testbench on the standard-cell netlist (including the RV32I test program) and checks that the placement is legal, every net routes into a connected tree and nothing overflows;
detail routing is rechecked from its segments and vias alone: no grid point shared by two nets, every net connected and reaching all its pins, signal wires clear of straps and via stacks,
and cells plus fillers covering every site exactly once;
`./test.sh` proves the standard-cell netlist equivalent to the output of `veryl build` with yosys.

## Virtual board (`src/board/`)
The web IDE's virtual iCEBreaker: a fast cycle-based simulator of the iCE40-mapped netlist wired to the board's pins
(`board/icebreaker.rs`: 12 MHz clock on pin 35, BTN_N, the red / green LEDs, the break-off section's LED1–5 and BTN1–3, PMOD1A/1B, the FTDI UART; pins from the design's pcf, or the tutorial's).
The engine works on a generic `Design` (4-input truth tables — carries are 3-input majorities — flip-flops, block RAMs, named IO) and is **activity driven**:
a changed net queues only the tables it feeds, evaluated in level order (no glitches); clock edges are detected on any clock net, so divided clocks and negative edges work.
`cargo test` checks it against netsim on 15 designs with random inputs every cycle.
**Bitstream decoding** (`board/bitstream.rs`, M13): a `.bin` (`pnr::bitstream::bin_to_asc`, the reverse of the own icepack port) or `.asc` is decoded back into a `Design`: enabled pips (a mux's bits equal to a pip's pattern) are joined by union-find into nets; logic cells (LUT bits un-permuted, carry, flip-flop with the tile's clock / enable / set-reset and `NegClk`), IO (`PINTYPE`), global networks (`fabout` or a pad through the `padin_glb_netwk` extra bits) and block RAMs (`CBIT` modes, `.ram_data`) become drivers. Peripherals (`board/periph.rs`, M14) are sampled every clock inside the run loop: the FTDI UART both ways (fractional clocks per bit), multiplexed seven-segment displays (lit time per digit and segment), a VGA monitor (a line per HSYNC, a frame per VSYNC, run-length encoded) and per-pin edge counts (a buzzer's pitch).
Tests: `bin → asc → bin` is identity; the decoded bitstreams of 11 designs (own P&R) and 3 designs (nextpnr, when installed) behave like their netlists cycle by cycle. Speed (one core): Blinky 6.8 M cycles/s (57% of 12 MHz), RiscvSoc 1.5 M cycles/s; in WebAssembly about 75% of that.

## The flow
| File | Contents |
|---|---|
| `value.rs`   | constant values |
| `expr.rs`    | expression IR (signals by name) + precedence parser; struct fields become constant slices |
| `elab.rs`    | syntax tree → name-based statement IR → **symbolic execution** into gates: if becomes a mux chain, case with constant labels a parallel one-hot, for loops unrolled, functions inlined, always_ff to DFF/reset, hierarchy flattened |
| `netlist.rs` | bit-level builder (constant folding, structural hashing, simplifications like `x & !x`, balanced reduction trees), add/sub/mul, compare, barrel shifts, dynamic indexing; `optimize` resolves aliases, detects combinational loops, rebuilds, sweeps dead logic, and repeats: **proving constant nodes** (candidates from random simulation, exhaustive proof over supports of ≤ 16 inputs) and **removing registers stuck at 0** |
| `ice40.rs`   | iCE40 mapping: full-adder carries → `SB_CARRY` chains; the rest covered by cut-based 4-LUTs (depth first, then area flow); DFF → `SB_DFF[N][S]{R,S}`, active-low resets get an inverting LUT |
| `output.rs`  | yosys JSON, structural Verilog (with iCE40 primitive instances) |
| `netsim.rs`  | a 2-state gate-level simulator (for the tests; generic gates and iCE40 cells) |

Every declared signal gets placeholder wires up front, and drivers are recorded as aliases (placeholder bit → driving bit) resolved at the end in `optimize`;
so the order of items in a module does not matter, and connecting a submodule's ports is just aliasing.
Its needs are fundamentally different from veryl-sim's elaboration (symbolic execution vs. a simulation IR), so the two share no elaboration code.

Registers start at 0 (iCE40 flip-flops power up at 0): for example, with a constant program ROM, the CPU registers that are never written (x6..x31) and their read multiplexers disappear.

## Output cells
- generic (`-o`): `$_NOT_ $_AND_ $_OR_ $_XOR_ $_MUX_` (Y = S ? B : A), `$_DFF_P_ / $_DFF_N_`,
  asynchronous reset `$_DFF_{P,N}{P,N}{0,1}_`, synchronous reset `$_SDFF_{P,N}{P,N}{0,1}_`.
- iCE40 (`--ice40`): `SB_LUT4`, `SB_CARRY`, `SB_DFF`, `SB_DFFN`, `SB_DFF[N]{R,S}`, `SB_DFF[N]S{R,S}`, `SB_RAM40_4K`.

## Block RAM inference (iCE40, `src/bram.rs`)
An array written as whole elements from **one** always_ff (at most once per cycle) and read only as whole elements is recorded by elab as a memory
(write port we / waddr / wdata, each read port's address and data, as named nets `$mem:name:...`; everything else is still expanded into DFFs).
When mapping to iCE40, if every read port is a **synchronous read** (the data goes straight into a register of the same clock, possibly with an enable), it becomes `SB_RAM40_4K`:
the element DFFs, the read registers and the address decoding / read multiplexers all disappear. Modes 256×16, 512×8, 1024×4, 2048×2; wider words use several blocks side by side,
one copy per read port. Asynchronous reads (e.g. the RV32I register file, `Ram`) stay logic, since block RAMs only have registered read ports.

| Design | Without BRAM | With BRAM |
|---|---|---|
| SyncRam 512×8 (`examples/src/sync_ram.veryl`) | 12832 cells | 1 `SB_RAM40_4K` |
| BramMix (256×32, two read ports + logic) | 29059 cells, does not fit the UP5K | 4 BRAMs + 86 LCs, own P&R 49 MHz (icetime 46 MHz) |

The own place & route supports BRAMs: the 30 RAM sites are annealed together, RAM pins routed (clocks on global networks), `RamConfig` bits and `.ram_data` written, STA covers RCLK→RDATA and the input setups.
Verification: netsim models `SB_RAM40_4K` after yosys `cells_sim.v` (random read/write tests in every mode); `fpga/pnr_test.sh` co-simulates the routed bitstreams;
`test.sh` proves the iCE40 netlist equivalent to `veryl build` with yosys's `SB_RAM40_4K` model (BMC).

## Supported
module / parameters (`#(param ..)`, `const`, inst parameter overrides) / ports / `var` / `let` / `assign` / `always_comb` /
`always_ff` (posedge/negedge, `if_reset` synchronous/asynchronous, active high/low) / `if` / `case` (with ranges) / `switch` / `for` (constant ranges, unrolled, with `rev`) /
`inst` hierarchy (flattened, names like `u_rf.rf`) / packages (enum, struct, const) / `import` / struct fields / 1-D arrays (variable-index reads and writes → mux / decoder) /
user functions (inlined, nested, `return` inside branches) / generate for, generate if /
operators: `+ - *`, bitwise / logical / reduction, comparisons (signed with `$signed`), `<< >> >>>` (constant or variable), concatenation and `repeat`, the ternary operator,
`$signed $unsigned $clog2 $bits`; `/ %` (a restoring divider when not constant; signed division truncates toward zero as in SystemVerilog); `**` only for constants.
Interfaces and modports (members flattened into `inst.member` signals, modport ports into `port.member` ports), `rev` / `step` in generate for,
any width (constants up to 256 bits), clock domain annotations. `initial` / `final` and `$display`-like calls are ignored.

## Not supported yet
generic interface ports, `inout`, recursion, latches (an incompletely assigned always_comb is reported as a combinational loop),
constants wider than 256 bits, asynchronous-read memories in BRAM, SPRAM (`SB_SPRAM256KA`), PLLs;
(netsim simulates several clock domains and negative-edge flip-flops with `tick(clk)`; `step()` clocks every flip-flop at once)
own place & route: UP5K only, no LUT input pin swapping.

## Verification results (`./test.sh`)
| Design | Equivalence with `veryl build` |
|---|---|
| Adder / Max3 / AluUnit / BitRev / GrayConv / rv32i Alu / ProgRom | complete SAT proof |
| Seq101 / PktReg | k-induction proof |
| Ram / RegFile / RiscvCore | bounded model checking, 8 / 2 / 2 cycles |
| RiscvSoc | bounded model checking, 80 cycles (the whole program) |
| RiscvTestRom (the rv32i test program ROM) | complete SAT proof |
| `examples/features.veryl`: Shifter / Funcs / Ranges / Counter / Top | SAT / SAT / SAT / k-induction / BMC 20 |
| Div / Wide (`examples/lang.veryl`) | complete SAT proof |
| HsTop (interface handshake) | bounded model checking, 24 cycles |
| SyncRam / Bram2048x2 / BramMix / Fifo (block RAM) | bounded model checking, 4 / 4 / 12 / 6 cycles |
| UartLoop / VgaTiming | bounded model checking, 24 / 8 cycles |

Every design above is proven twice: the gate-level netlist (`gate`) and the vlib standard-cell netlist (`asic`); the designs with block RAM also the iCE40 netlist (`fpga`, with yosys's `SB_RAM40_4K` model).
In addition, `cargo test` runs each example's testbench scenarios on the gate-level, iCE40-mapped and standard-cell netlists (RiscvCore runs the complete RV32I test program and compares 41 results, the ALU every operation against a Rust reference, RiscvSoc shows 55 on the LEDs).
