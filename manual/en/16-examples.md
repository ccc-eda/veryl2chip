# 16. Example catalogue

This chapter lists every example: what it does, which files it uses, how to run it from the command line, and how to open it in the web IDE.

- **IDE**: the example IDs in the tables are links that open the example as a new project in the online IDE
  (`https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=ID`; locally use `web/dist/index.html#ex=ID`).
  Adding `&board=1` flashes straight to the virtual board, `&run=1` runs the test; other parameters are in chapter 11, "URL parameters".
  The welcome page shown when the IDE first opens has four starting points (learn Veryl, build a circuit for a board, boot a computer and write programs, see the circuit become a chip), and the filter above the example library can select one of those categories;
  the 🧪 ⚡ 🖥 next to an example in the sidebar are what it can do, and the framed one is the suggested first step; once open, the title bar's main button (blue) and the "suggested steps" above the editor say the same, and the ▾ next to the main button lists the other ways.
- **Command line**: run from the project root; installing `v2c` is in chapter 2. When an example takes several files, all of them must be listed.

## Common runs

Every Veryl example has `#[test]` test modules (`Test…`, `tb_…`), so the same commands work on any example:

| Goal | Command | Ch. |
|---|---|---|
| see the modules | `v2c list FILE.veryl` | 5 |
| run the test (RTL simulation) | `v2c sim FILE.veryl` (all `#[test]`; `--top TestX` runs one; `--vcd w.vcd` writes a waveform) | 5 |
| synthesize and see the statistics | `v2c synth --top MODULE FILE.veryl` | 6 |
| run the test again after synthesis | `v2c gatesim ice40 FILE.veryl` (or `opt`, `ecp5`, `asic`, `sky130`) | 8 |
| FPGA bitstream | `v2c fpga --pnr veryl --pcf PINS.pcf --bin out.bin FILE.veryl`, then `iceprog out.bin` to flash an iCEBreaker | 7 |
| ASIC layout | `v2c asic --pdk sky130 --gds out.gds FILE.veryl` | 9 |

Without `--top`, `v2c synth` / `fpga` / `asic` use the last non-test module; the "Top" column in the tables below is the one the IDE synthesizes by default.
Only examples with a `.pcf` in the table have pins, so they can become an FPGA bitstream and go on the virtual board.

## Tutorial and lab course

For people writing hardware for the first time; the course material is [`tutorial/README.tw.md`](../tutorial/README.tw.md) (tutorial) and
[`tutorial/labs.tw.md`](../tutorial/labs.tw.md) (virtual lab course). The pins are all the iCEBreaker board's own LEDs / buttons or PMOD modules.

| ID | What it does | Files (top) | Command line |
|---|---|---|---|
| [tut_blinky](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=tut_blinky&board=1) | Lesson 1: a counter blinks the LED | `tutorial/src/blinky.veryl` (`Blinky`), `tutorial/icebreaker.pcf` | `v2c sim tutorial/src/blinky.veryl`<br>`v2c fpga --pnr veryl --pcf tutorial/icebreaker.pcf --bin blinky.bin tutorial/src/blinky.veryl` |
| [tut_knight](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=tut_knight&board=1) | Lesson 2: knight rider; a divided clock tick, a button synchronizer, hold BTN1 to pause | `tutorial/src/knight.veryl` (`KnightRider`), `tutorial/icebreaker.pcf` | same, with the names changed |
| [tut_uart](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=tut_uart&board=1) | Lesson 3: the USB serial port (115200 baud) says Hi! first, then swaps the case of what it receives | `tutorial/src/uart.veryl` (`UartEcho`), `tutorial/icebreaker.pcf` | same, with the names changed |
| [lab_gates](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=lab_gates&board=1) | Breadboard: two switches → AND, OR, XOR, NOT on four LEDs (resistors and wiring drawn for you) | `examples/src/gates.veryl` (`Gates`), `examples/gates.pcf` | `v2c sim examples/src/gates.veryl`<br>`v2c fpga --pnr veryl --pcf examples/gates.pcf --bin gates.bin examples/src/gates.veryl` |
| [lab_counter](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=lab_counter&board=1) | Counts up on each BTN1 press (synchronizer + rising edge), shown in binary on PMOD1A's 8 LEDs; BTN2 clears | `examples/src/button_counter.veryl` (`ButtonCounter`), `examples/button_counter.pcf` | same, with the names changed |
| [lab_traffic](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=lab_traffic&board=1) | Traffic-light state machine: green 5 s → yellow 1 s → red 4 s, pressing BTN1 while green ends it early; LEDs on the breadboard | `examples/src/traffic.veryl` (`TrafficLight`), `examples/traffic.pcf` | same, with the names changed |

`tutorial/check.sh` runs the tutorial's whole flow in one go (simulation, synthesis, FPGA).

## Basics (combinational logic and syntax)

| ID | What it does | Files (top) | Command line |
|---|---|---|---|
| [adder](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=adder) | an adder (the smallest example) | `examples/src/adder.veryl` (`Adder`) | `v2c sim examples/src/adder.veryl` |
| [max3](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=max3) | the maximum of three numbers, demonstrating `function` | `examples/src/max3.veryl` (`Max3`) | `v2c sim examples/src/max3.veryl` |
| [alu_pkg](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=alu_pkg) | an ALU with opcodes in a `package`'s `enum` | `examples/src/alu_pkg.veryl` (`AluUnit`) | `v2c sim examples/src/alu_pkg.veryl` |
| [gen_rev](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=gen_rev) | bit reversal and Gray code, demonstrating generate `for` | `examples/src/gen_rev.veryl` (`GrayConv`; plus `BitRev`) | `v2c sim examples/src/gen_rev.veryl` |
| [alu_fail](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=alu_fail&run=1) | a deliberately failing assertion: what a test failure looks like (exit code 1) | `veryl-sim/examples/alu.veryl` (`Alu`) | `v2c sim veryl-sim/examples/alu.veryl` |

## Sequential circuits and memory

| ID | What it does | Files (top) | Command line |
|---|---|---|---|
| [counter](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=counter) | a counter, veryl-sim's own test example | `veryl-sim/examples/counter.veryl` (`Counter`) | `v2c sim veryl-sim/examples/counter.veryl` |
| [seq101](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=seq101) | a state machine detecting the input sequence 101 | `examples/src/seq101.veryl` (`Seq101`) | `v2c sim examples/src/seq101.veryl` |
| [pkt_reg](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=pkt_reg) | a register as a `struct` (the first field is the MSB) | `examples/src/pkt_reg.veryl` (`PktReg`) | `v2c sim examples/src/pkt_reg.veryl` |
| [ram](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=ram) | a 16 × 8 RAM with asynchronous reads (stays in logic) | `examples/src/ram.veryl` (`Ram`) | `v2c sim examples/src/ram.veryl` |
| [sync_ram](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=sync_ram) | a RAM with synchronous reads: synthesized as block RAM (iCE40 `SB_RAM40_4K`) | `examples/src/sync_ram.veryl` (`SyncRam`) | `v2c sim examples/src/sync_ram.veryl` |
| [fifo](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=fifo) | a 256 × 8 FIFO whose memory is one block RAM / one SRAM macro in ASIC | `examples/src/fifo.veryl` (`Fifo`) | `v2c sim examples/src/fifo.veryl`<br>`v2c asic --pdk sky130 examples/src/fifo.veryl` |
| [sevenseg](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=sevenseg&board=1) | a two-digit multiplexed seven-segment display counting 00–99; BTN1 clears | `examples/src/sevenseg.veryl` (`SevenSeg`), `examples/sevenseg.pcf` | `v2c sim examples/src/sevenseg.veryl`<br>`v2c fpga --pnr veryl --pcf examples/sevenseg.pcf --bin seg.bin examples/src/sevenseg.veryl` |

## Peripherals

| ID | What it does | Files (top) | Command line |
|---|---|---|---|
| [uart](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=uart) | a UART transmitter → receiver loop (8N1, 8 clocks per bit) | `examples/src/uart.veryl` (`UartLoop`; plus `UartTx`, `UartRx`) | `v2c sim examples/src/uart.veryl` |
| [vga](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=vga&board=1) | VGA 640 × 480 timing with color bars; a reduced picture for the test, the PMOD VGA monitor on the virtual board | `examples/src/vga.veryl` (`VgaDemo`), `examples/vga.pcf` | `v2c sim examples/src/vga.veryl`<br>`v2c fpga --pnr veryl --pcf examples/vga.pcf --bin vga.bin examples/src/vga.veryl` |

## Synthesis test designs

The designs veryl-eda's own synthesis tests use — also good examples of what synthesis produces.

| ID | What it does | Files (top) | Command line |
|---|---|---|---|
| [features](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=features) | shifters, functions, bit ranges, a counter | `veryl-eda/examples/features.veryl` (`Top`) | `v2c sim veryl-eda/examples/features.veryl` |
| [bram](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=bram) | block RAMs of four shapes plus logic | `examples/src/sync_ram.veryl` + `veryl-eda/examples/bram_tests.veryl` (`BramMix`) | `v2c sim --top TestBramMix examples/src/sync_ram.veryl veryl-eda/examples/bram_tests.veryl` |
| [lang](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=lang) | division, an `interface` handshake, 200-bit values, two clocks | `veryl-eda/examples/lang.veryl` (`HsTop`) | `v2c sim veryl-eda/examples/lang.veryl` |
| [acc](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=acc) | a 32-bit accumulator: see the FPGA's carry chain (`SB_CARRY`) | `veryl-eda/examples/pnr_tests.veryl` (`AccTest`) | `v2c sim veryl-eda/examples/pnr_tests.veryl` |

## RISC-V processors (Veryl)

| ID | What it does | Files (top) | Command line |
|---|---|---|---|
| [rv32i](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=rv32i) | a single-cycle RV32I CPU; the test runs `examples/sw/rv32i_test.S`, with 41 results cross-checked against spike | `examples/src/rv32i.veryl` + `rv32i_rom.veryl` (`RiscvCore`) | `v2c sim examples/src/rv32i.veryl examples/src/rv32i_rom.veryl` |
| [soc](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=soc&board=1) | the CPU above with ROM / RAM as a SoC: computes Fibonacci(10) = 55 and shows it on the LEDs | `examples/src/rv32i.veryl` + `rv32i_rom.veryl` + `veryl-eda/examples/soc.veryl` (`RiscvSoc`), `veryl-eda/examples/icebreaker.pcf` | `v2c sim --top TestRiscvSoc examples/src/rv32i.veryl examples/src/rv32i_rom.veryl veryl-eda/examples/soc.veryl`<br>`veryl-eda/fpga/flow.sh` (bitstream + post-route simulation) |
| [rv64_linux](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=rv64_linux) | the RV64 board (like a Raspberry Pi): Linux, MicroPython, C, GPIO, screen. See "The RV64 board" below; the other 6 board examples are there too | `examples/rv64/src/` (`Rv64Soc`), `examples/rv64/board/` | see below |

The multi-cycle RV32IMA SoC (`examples/src/rvsoc.veryl`, `RvBoard`) is used with the C programs in the next section. After editing `examples/sw/*.S`, run
`examples/sw/build.sh` (needs the riscv64-unknown-elf toolchain and spike) to regenerate the ROM.

## C programs on our own RISC-V SoC (`examples/c/`)

The hardware is always `RvBoard` from `examples/src/rvsoc.veryl` (RV32IMA + Zicsr, 12 MHz, UART, LEDs, buttons, PMOD); the C programs are compiled with veryl-eda's
C compiler (chapter 10). In the IDE, ⚡ Virtual board defaults to **CPU mode** (an instruction-set simulator running in real time), but you can switch to the "bitstream" mode to run the actually synthesized circuit.

| ID | What it does | Files |
|---|---|---|
| [c_hello](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=c_hello&board=1) | greets on the USB terminal, counts LEDs, echoes received characters uppercased | `examples/c/hello.c` |
| [c_knight](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=c_knight&board=1) | a software knight rider; BTN1 speeds up, BTN2 slows down (rising edges detected in C) | `examples/c/knight.c` |
| [c_guess](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=c_guess&board=1) | a terminal number-guessing game (`read_line`, `atoi`) | `examples/c/guess.c` |
| [c_sevenseg](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=c_sevenseg&board=1) | seven-segment 00–99, multiplexed scan in software; BTN1 clears | `examples/c/sevenseg.c` |
| [c_music](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=c_music&board=1) | plays "Twinkle Twinkle Little Star" on the buzzer | `examples/c/music.c` |
| [c_switches](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=c_switches&board=1) | PMOD1B's 8 switches shown on PMOD1A's LEDs, printed in binary / hex on the terminal | `examples/c/switches.c` |
| [c_threads](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=c_threads&board=1) | a tiny preemptive multithreading kernel: a timer interrupt switches every 10 ms, `ecall` does yield / sleep, an `amoswap` mutex | `examples/c/threads.c` |
| [c_vga](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=c_vga&board=1) | VGA text mode (40 × 30 characters): uptime, buttons, what you type in the terminal. The hardware is `RvVgaBoard` (`examples/src/rvvga.veryl`, `examples/rvvga.pcf`) | `examples/c/vga.c` |

Command line:

```sh
v2c cc --run examples/c/hello.c                  # run on the instruction-set simulator, UART output printed to the terminal
v2c cc -o hello.bin examples/c/hello.c           # compile to an image
v2c fpga --top RvBoard --pnr veryl --pcf examples/rvsoc.pcf --program hello.bin --bin soc.bin \
  examples/src/rvsoc.veryl examples/src/rv32i.veryl examples/src/sync_ram.veryl examples/src/uart.veryl
iceprog soc.bin                                  # flash to the iCEBreaker
```

The `c_vga` bitstream uses `--top RvVgaBoard --pcf examples/rvvga.pcf`, with `examples/src/rvvga.veryl examples/src/vga.veryl` added to the files.
The SoC's own RTL tests:

```sh
cd examples/src
v2c sim --top TestRvSoc rvsoc.veryl rv32i.veryl sync_ram.veryl uart.veryl rvsoc_rom.veryl rv32i_rom.veryl
v2c sim --top TestVgaText rvsoc.veryl rv32i.veryl sync_ram.veryl uart.veryl rvsoc_rom.veryl rv32i_rom.veryl rvvga.veryl vga.veryl
```

## The RV64 board (`examples/rv64/`)

`Rv64Soc`: an RV64IMAC `Rv64Core`, 256 MB of RAM, UART, 16 GPIO pins (the ACT / USER LEDs are GPIO 0, 1, the button is GPIO 2, and GPIO 3–15 are on the header and breadboard
with the same BCM numbering as a Raspberry Pi), a 320 × 240 screen. It boots OpenSBI + Linux 6.12 + busybox, with MicroPython inside.

**IDE**: open [rv64_linux](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=rv64_linux) and press 🖥 Machine to boot (or pick riscv-emu / veryl-emu from the title bar's target menu,
chapter 15). Open any of the files below and press "▶ Run" (Ctrl+Enter): the project's files are sent into the board's `/root` and then run;
`.c` files are compiled in the browser first. On the board's shell, `savefiles` sends `/root` back to the project.

| File | What it does | Command on the board |
|---|---|---|
| `main.py` | the red LED on breadboard GPIO 5 and the USER LED take turns | `micropython main.py` |
| `button.py` | counts presses of the button (GPIO 2), the LED on GPIO 5 shows the lowest bit | `micropython button.py` |
| `traffic.py` | traffic lights on the breadboard (GPIO 5 / 12 / 13); a button on GPIO 6 ends green early | `micropython traffic.py` |
| `clock.py` | an analog clock on the screen (time since boot) | `micropython clock.py` |
| `blink.c` | the same as `main.py`, in C | `./blink` |
| `count.c` | the same as `button.py`, in C | `./count` |
| `lights.c` | the same as `traffic.py`, in C | `./lights` |
| `shapes.c` | draws color bars, shapes, text, and a bouncing ball on the screen | `./shapes` |
| `blink.sh` | blinks the LED on GPIO 5 five times via `/sys/class/gpio` | `sh blink.sh` |
| `button.sh` | counts button presses, the USER LED shows the lowest bit | `sh button.sh` |

### More board examples (v2.29)

The same board and the same boot snapshot, each with its own programs (`examples/rv64/apps/`) and pre-wired breadboard. Open one, press the main button "🖥 Machine" to boot,
open a program file and press "▶ Run".

| ID | What it does | Files | Command on the board |
|---|---|---|---|
| [pi_chaser](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=pi_chaser) | a knight rider on 8 LEDs (GPIO 3, 4, 5, 7–11); the button on GPIO 6 changes speed, GPIO 13 changes direction | `chaser.py`, `chaser.c` (the same program in two languages) | `micropython chaser.py`, `./chaser` |
| [pi_reaction](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=pi_reaction) | a reaction-time game: press the button when the green LED lights, measured in milliseconds; the best score is saved in `best.txt` and sent back with `savefiles` | `reaction.py` | `micropython reaction.py` |
| [pi_breathe](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=pi_breathe) | breathing LEDs: software PWM, the duty cycle sets the brightness, three LEDs brighten and dim in turn | `breathe.c` | `./breathe` |
| [pi_snake](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=pi_snake) | Snake: a screen game, two buttons turn left / right (after clicking the screen, ← → also work, Space starts) | `snake.c` | `./snake` |
| [pi_tetris](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=pi_tetris) | Tetris (v2.32): four buttons move left, right, rotate, drop faster; after clicking the screen, ← → ↑ ↓ also work, Space starts | `tetris.c` | `./tetris` |
| [pi_sysmon](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=pi_sysmon) | a system monitor: reads `/proc`, shows CPU (with a history graph), memory, load, uptime, and the process count on the screen | `sysmon.py` | `micropython sysmon.py` |
| [pi_linux](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=pi_linux) | Linux command intro: files, text processing, pipes, background jobs, `/proc`; follow `exercises.txt` | `exercises.txt`, `hello.sh`, `count.sh`, `fruits.txt` | `sh hello.sh`, `cat exercises.txt` |

The command line packs them the same way with `linux/mkarea.py`, e.g. `python3 linux/mkarea.py -o area.img apps/chaser/chaser.py` (the breadboard is only in the IDE).

Ctrl-C stops a program; type `micropython` for the REPL. MicroPython's `pi` module has `LED`, `Button`, `Pin`, `Screen`,
and the C library has `gpio_write`, `gpio_read`, `delay_ms`, `fb_*` (chapters 10, 11).

**Command line** (under `examples/rv64`; the image is produced by `linux/build.sh`, and the emulator `rvemu` by `cargo build --release` in `riscv-emu`).
`linux/mkarea.py` packs files into the exchange area, which `/init` puts into `/root` at boot:

```sh
v2c cc --linux -o blink board/blink.c
python3 linux/mkarea.py -o area.img board/*.py board/*.sh blink
../../riscv-emu/target/release/rvemu -l 0x8F000000:area.img linux/build/opensbi/platform/generic/firmware/fw_payload.bin
```

It reaches `rv64:~$` in about 1.5 s, then you just type the commands from the table above (GPIO changes are printed as `[gpio] out=…`).
Swapping `rvemu` for `emu/rv64emu` (veryl-emu) or `sim/obj/rv64sim` (Verilator) runs the same thing on the Veryl hardware, tens of times slower.

`examples/rv64` also has tests and large programs that are not in the IDE, described in [`examples/rv64/README.md`](../examples/rv64/README.md):

| Command | What it does |
|---|---|
| `sim/riscv_tests.sh` | the official riscv-tests (196 tests) |
| `verify/random.sh 1 30` | random programs, compared instruction by instruction against spike |
| `linux/test.sh` | boots Linux, types a few commands (GPIO, files, MicroPython, C, screen), powers off |
| `xv6/test.sh` | boots xv6 (MIT's teaching operating system); `xv6/test.sh usertests` runs all its tests |
| `sim/build_fpga.sh`, `fpga/ecp5.sh` | `Rv64Fpga`: the version placed into an ECP5 FPGA (ULX3S) |

Prefix any of these with `SIM=../../riscv-emu/target/release/rvemu` or `SIM=emu/rv64emu` to switch emulator.
