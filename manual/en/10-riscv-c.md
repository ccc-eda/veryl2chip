# 10. RISC-V and C: `v2c cc`

This project has a RISC-V CPU written in Veryl, plus a compiler that turns C into its machine code.
So you can "design your own CPU, then run your own C programs on it" — on the virtual dev board, or programmed onto a real iCEBreaker.

## Hardware: `examples/src/rvsoc.veryl`

| Module | Contents |
|---|---|
| `RvCore` | Multi-cycle **RV32IMA + Zicsr**: ordinary instructions 2 cycles, loads 3 cycles, multiply/divide 35 cycles; machine-mode interrupts and exceptions (timer, software, external = the serial port received a byte; ecall, ebreak, illegal instruction, misaligned address), `mret`, `wfi`; the register file lives in block RAM |
| `RvSoc` | CPU + 8 KB of memory (block RAM) + memory-mapped peripherals + a loader port for the testbench |
| `RvBoard` | The iCEBreaker top (pins in `examples/rvsoc.pcf`): BTN1–3, the 8 outputs of PMOD1A (LED modules…), the 8 switches of PMOD1B, the USB serial port |
| `RvVgaBoard` (`examples/src/rvvga.veryl`) | Adds a 40 × 30 character VGA text screen |

Separately, `examples/src/rv32i.veryl` is a single-cycle RV32I (`RiscvCore`), easier to read and good for teaching.

### Memory map

| Address | Name (macro in C) | Description |
|---|---|---|
| `0x0000_0000` | — | 8 KB RAM: program and data, the stack grows down from the top |
| `0x1000_0000` | `LED` | 8 outputs (read/write) |
| `0x1000_0004` | `BUTTONS`, `SWITCHES` | bit 2..0 = BTN3..BTN1 (1 = pressed), bit 15..8 = the 8 switches |
| `0x1000_0008` | `UART_DATA` | Write: send a byte; read: the received byte |
| `0x1000_000C` | `UART_STATUS` | bit 0 = transmitting, bit 1 = a byte was received |
| `0x1000_0010` | `TIMER`, `MTIME` | Clock cycles since boot (12 MHz) |
| `0x1000_0018` | `MTIMECMP` | Timer interrupt when `MTIME ≥ MTIMECMP` |
| `0x1000_0020` | `MSIP` | 1 = software interrupt |
| From `0x1000_2000` | `VGA_TEXT`, `VGA_FONT`, `VGA_COLOR` | VGA text mode (`RvVgaBoard` only) |

## Compiling and running

```
v2c cc PROG.c [-o PROG.bin] [-S PROG.s] [-L PROG.lst] [--run [N]] [--mem BYTES]
```

```sh
$ v2c cc --run examples/c/hello.c
hello.c: 2488 bytes of code and data, 2492 with bss (RAM 8192 bytes)
Hello from C on a RISC-V you built in Veryl!
...
```

| Option | Contents |
|---|---|
| `-o PROG.bin` | Binary image starting at address 0 (for `v2c fpga --program`, the virtual board) |
| `-S PROG.s` | Generated assembly: each statement is preceded by a line of C source as a comment |
| `-L PROG.lst` | Listing: address, machine code, assembly and C source side by side |
| `--run [N]` | Run for up to N instructions on the instruction-set simulator (default 10 million). Serial output is printed to the screen; at the end it prints the instruction count, clock cycles and LEDs |
| `--mem BYTES` | RAM size (default 8192, the same as RvSoc) |
| `--linux` | Instead build a static executable for the Linux on the RV64 dev board (see "On the dev board's Linux" below) |

When the program reaches the end of `main` it stops at `_halt` (showing `halted`); a program that never ends stops after N instructions (showing `stopped`).
`--run` does not feed keyboard input to the program; for interaction (`getchar`, `read_line`) use the virtual dev board's USB terminal.

`.s` / `.S` files are assembled directly (RV32IMA, Zicsr, pseudo-instructions, `%hi` / `%lo`, `.data` / `.rodata` / `.bss` supported).

## Supported C

- Types: `char` (unsigned, like the RISC-V ABI), `signed char`, `short`, `int`, `long` (= `int`) and their `unsigned` variants, `void`,
  pointers, arrays of any dimension; accepts `const` / `volatile` / `static` / `extern`.
- Statements: blocks, `if`, `while`, `do`, `for`, `switch`, `break`, `continue`, `return`; declarations may appear anywhere; all C operators.
- Functions: up to 8 parameters, `...` varargs; function names can be used as addresses (e.g. passed to `set_mtvec`).
- Preprocessor: `#define` (with parameters), `#undef`, `#ifdef` / `#ifndef`, `#if constant`, `#else`, `#endif`, `#error`; `#include` and `#pragma` are ignored (the runtime library is always there).
- `asm("...")`: insert assembly inside a function; functions containing only `asm` get no prologue/epilogue (naked); a file-level `asm(...)` can define a whole block of assembly.
- **Not supported**: struct, union, enum, typedef, floating point, calling through function pointers.

### Runtime library

| Category | Functions / macros |
|---|---|
| Serial | `putchar`, `getchar`, `kbhit`, `puts`, `printf` (`%d %i %u %x %X %c %s`, widths, zero padding), `sprintf`, `read_line` |
| Time | `millis`, `delay_ms`, `delay_us`, `TIMER`, `CLOCK_HZ` |
| String and memory | `strlen`, `strcmp`, `strcpy`, `memset`, `memcpy`, `atoi` |
| Misc | `rand`, `srand`, `abs` |
| Peripherals | `LED`, `BUTTONS`, `SWITCHES`, `UART_DATA`, `UART_STATUS` |
| VGA text (`RvVgaBoard`) | `vga_init` (loads the font), `vga_clear`, `vga_color(fg, bg)` (0xRGB), `vga_goto(col, row)`, `vga_putc`, `vga_puts`, `vga_printf` |
| Interrupts and CSRs | `interrupts_on` / `off`, `irq_save` / `irq_restore`, `wfi`, `set_mtvec`, `set_mie` (`MIE_MTIE` timer, `MIE_MSIE` software, `MIE_MEIE` serial), `read_mcause`, `read_mepc` / `write_mepc`, `read_mstatus`, `read_mip`, `read_minstret`, `read_mscratch` / `write_mscratch`, `MTIME`, `MTIMECMP`, `MSIP` |
| Atomic operations | `atomic_swap`, `atomic_add`, `atomic_and`, `atomic_or`, `atomic_xor`, `atomic_cas`, `spin_lock`, `spin_unlock` |

Only functions the program actually uses are put into the image.

## Examples (`examples/c/`)

| File | Demonstrates |
|---|---|
| `hello.c` | Serial greeting, LED counting, echoing received characters upper-cased |
| `knight.c` | Knight rider, button changes speed (software rising-edge detection) |
| `guess.c` | Number guessing game over the terminal |
| `sevenseg.c` | Software scanning of a 7-segment display |
| `music.c` | Playing a melody on a buzzer |
| `switches.c` | Switches shown on the LEDs, binary / hex printed to the terminal |
| `vga.c` | VGA text mode (`RvVgaBoard`) |
| `threads.c` | A small preemptive multithreading kernel: timer interrupt switches threads, `ecall` for yield / sleep, `amoswap` mutex |

## On the dev board's Linux (v2.20)

`v2c cc PROG.c --linux -o PROG` compiles the same C into a static ELF executable for the Linux on the RV64 dev board (`examples/rv64`, the simulator of chapter 11):

- The data model is unchanged: `int`, `long` and pointers are all 4 bytes (like x32). The program is RV64 instructions, computing 32-bit integers with the *W instructions (`addw`, `mulw`, …),
  so registers always hold "32-bit, sign-extended" values; the program is loaded at 0x10000, its own stack (256 KB) is placed in the bss, the heap grows up via `brk`,
  every address the program touches stays below 2 GB, and 32-bit pointers suffice.
- The runtime library (the `__linux__` part of `prelude.c`) uses system calls: `open` / `read` / `write` / `close` / `lseek` / `unlink`,
  `printf` (line-buffered stdout), `getchar`, `read_line`, `malloc`, `exit`, `sleep` / `usleep` / `delay_ms` / `millis`;
  `write_file`, `read_int`; GPIO: `gpio_write(pin, v)`, `gpio_read(pin)`, `pin_mode(pin, INPUT|OUTPUT)` (0 / 1 are the ACT / USER LEDs,
  2 is the button, the rest go through `/sys/class/gpio`); screen (v2.21, 320 × 240 RGB565): `fb_init`, `fb_clear`, `fb_pixel`, `fb_rect`, `fb_line`,
  `fb_circle`, `fb_text`, `RGB(r, g, b)` and a few color names (`/dev/fb0` mapped fixed at 0x40000000 with `mmap`, because pointers are only 32 bits).
  `#include <gpio.h>` and other `#include`s are ignored as usual (the library is always there).
- Testing: `cargo test cc_linux` compiles `src/rv/tests/*.c` and `tests/linux/*.c` into Linux executables and runs them with spike + pk (the proxy kernel,
  same system call numbers as Linux); the output must match the host-compiled results (`.out`); `linux/test.sh` runs one on the Verilator / veryl-emu Linux.
- IDE: with a `.c` file open in a dev-board project, press "▶ Run" to compile in the browser and run the executable (named after the file without `.c`) together with the project's files in `/root`.

## Putting it on an FPGA

The virtual dev board (most convenient): the web IDE's "C 程式" (C programs) examples; the ⚡ virtual board defaults to **CPU mode** — the instruction-set simulator runs at real-time speed,
with the same memory map, peripherals and cycle counts per instruction as `RvSoc` (chapter 12). Switching to bitstream or netlist mode runs the circuit actually synthesized from `rvsoc.veryl` (much slower).

Physical board:

```sh
v2c cc -o hello.bin examples/c/hello.c
v2c fpga --top RvBoard --pnr veryl --pcf examples/rvsoc.pcf --program hello.bin --bin soc.bin \
    examples/src/rv32i.veryl examples/src/sync_ram.veryl examples/src/uart.veryl examples/src/rvsoc.veryl
iceprog soc.bin
```

Place & route of the whole SoC (about 4200 logic cells, 20 block RAMs) takes about a minute, with an Fmax around 13–14 MHz.

Attach a serial terminal (115200 baud, e.g. `screen /dev/tty.usbserial-xxx 115200`) to see the output.
