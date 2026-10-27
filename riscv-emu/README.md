[English](README.md) | [繁體中文](README.tw.md)

# riscv-emu

An **instruction-set emulator** of veryl2chip's RV64 board (`Rv64Soc` in [`examples/rv64`](../examples/rv64/)), like QEMU:
it does not simulate the circuit, only what each instruction does, so it is tens of times faster than
[veryl-emu](../veryl-emu/) and Verilator, which simulate the hardware, while running the same programs (riscv-tests,
OpenSBI + Linux, xv6, the board's MicroPython and C). The Veryl design itself is still verified with Verilator and
veryl-emu; riscv-emu is checked with riscv-tests, spike and instruction-by-instruction against the RTL.

```sh
cargo build --release
cargo test --release          # its own small tests; riscv-tests and Linux too when they are built
target/release/rvemu ../examples/rv64/linux/build/opensbi/platform/generic/firmware/fw_payload.bin   # boots Linux; type in the terminal
```

| | Verilator (RTL) | veryl-emu (RTL, Node) | riscv-emu |
|---|---|---|---|
| `linux/test.sh` (boot + commands, about 100 M instructions) | 50 s | 107 s | 1.6 s |
| xv6 `usertests` (28.5 G instructions) | impractical | impractical | 5.6 min |

## The machine

- **The hart** (`src/cpu.rs`): RV64IMAC + Zicsr + Zicntr + Zifencei + Sstc + Svadu, M / S / U, Sv39, behaving like
  Rv64Core: misaligned loads / stores trap, PMP registers without checks, the A / D bits set by the hardware only when
  `menvcfg.ADUE` is on, no debug triggers (`tdata1` reads 0), `mcountinhibit` fixed at 0, `mtval` holds the faulting
  address or instruction. Compressed instructions are expanded to their 32-bit forms. A small TLB caches Sv39 leaves per
  4 KB page; permissions are checked on every access from the cached PTE bits, so caching never changes behavior.
- **The devices** (`src/bus.rs`), register for register as in `rv64soc.veryl`: the finisher (0x10_0000), CLINT, PLIC
  (31 sources, M and S contexts), a 16550 UART subset (THR always empty, a one-byte receive buffer), 16 SiFive GPIO
  pins, 256 MB of RAM.
- **Time**: by default `mtime` counts instructions (the device tree says 10 MHz, so a second is ten million instructions
  and runs are reproducible); `wfi` with nothing to do jumps to the next timer interrupt. `-r` (the default when typing at
  a terminal) follows the real clock instead.

## In the browser

`cargo build --release --lib --target wasm32-unknown-unknown` gives a wasm of about 60 KB without imports (`src/wasm.rs`:
`rv_init`, `rv_run`, `rv_input`, `rv_output`, `rv_set_gpio`, `rv_gpio`, `rv_save` / `rv_restore` …, bytes through `rv_buf`,
the RAM read and written directly at `rv_ram`). `web/build.mjs` puts it into `web/dist/rvemu.js`; the IDE's emulator drives
it with `web/src/rv_machine.ts`, its time following the real clock (`rv_set_time`). About 50 MIPS in Node (65–85 natively).

## Translation to WebAssembly (like QEMU's TCG)

Running in WebAssembly (a browser, Node), a basic block executed more than 1000 times (in one 4 KB page, at most 64
instructions, up to a jump or branch, or up to an instruction it does not translate: SYSTEM, AMO, FENCE) becomes a function
`(m) -> instructions` of a small wasm module made by `src/jit.rs`; the host (`web/src/rv_machine.ts` or `tests/jit.mjs`)
compiles it, instantiates it with the core's memory and `jit_ld` / `jit_st` / `jit_ar` as imports and puts it into the
function table the core exports, which then `call_indirect`s it (on wasm32 a function pointer is a table index). The
registers a block uses live in locals and are written back at its exits; loads and stores look in the translated code's own
TLB first (one per privilege, holding where a RAM page is in the core's memory), else call the helper (which translates the
address and may trap). Blocks are keyed by physical and virtual address; a write to a page with translated code drops its
blocks.

| Node 24 (wasm) | interpreted | translated |
|---|---|---|
| Linux to the shell (83 M instructions) | 1.7 s (48 MIPS) | 1.6 s (52 MIPS) |
| commands after it (`ls`, MicroPython summing 100 000 squares; 61 M instructions) | 1.4 s (44 MIPS) | 0.35 s (176 MIPS) |

Booting is mostly code that runs once, so it gains little; code that keeps running is four times as fast.
`node tests/jit.mjs` (after `cargo build --release --lib --target wasm32-unknown-unknown`): riscv-tests all pass at threshold 2
(nearly every block translated), and Linux gives the same output interpreted, at threshold 2 and at the default.

## rvemu

```
rvemu [-t] [-r] [-m N] [-l ADDR:FILE]... [-d ADDR:LEN:FILE]... [-s SCRIPT] PROG
```

The options are those of `sim/obj/rv64sim` (Verilator) and `emu/rv64emu` (veryl-emu) in `examples/rv64`, so its
scripts take it as well:

```sh
cd ../examples/rv64
SIM=../../riscv-emu/target/release/rvemu sim/riscv_tests.sh
SIM=../../riscv-emu/target/release/rvemu linux/test.sh
SIM=../../riscv-emu/target/release/rvemu xv6/test.sh usertests
```

`-t` prints a line per instruction in the format of `spike -l --log-commits` (diff it with the RTL's `rv64sim -t`: booting
Linux, the first 580 thousand instructions are identical; the first difference is a read of `cycle`, which counts clock
cycles in the hardware and instructions here).
