# 15. Which one: FPGA, ASIC, veryl-emu, riscv-emu

The same project can "run" in four places. The title bar's target menu (v2.25) puts them together: the top two are **synthesis** (see what the circuit becomes),
the bottom two are **machines** (boot a machine and run software).

| Target | What runs | What you see | Speed (browser) | When to use |
|---|---|---|---|---|
| **FPGA** (iCE40) | your Veryl design synthesized and placed/routed into an iCEBreaker bitstream | LUTs, carry chains, block RAM, routing, timing; LEDs, buttons, seven-segment display, VGA, UART on the ⚡ virtual board | the virtual board runs in real time (12 MHz designs) | small to medium digital circuits: counters, state machines, UART, your own RV32 CPU (like Arduino) |
| **ASIC** (vlib / SKY130) | the same design mapped to standard cells, placed, routed, DRC, GDSII | the chip layout, area, timing, power | seconds to minutes of synthesis | seeing what the circuit would look like as a chip |
| **veryl-emu** (machine · hardware) | your Veryl design itself compiled to WebAssembly, run cycle by cycle (like Verilator) | every cycle and every signal computed by the circuit you wrote; change the Veryl and the hardware changes | about 3.7 million cycles/s (RV64 about 1.2 million instructions/s); the RV64 board reaches a shell from a snapshot in about 10 s | big designs that don't fit the FPGA / ASIC flows (the RV64 SoC with 256 MB of RAM), when you want to check the "hardware itself" |
| **riscv-emu** (machine · instruction set) | an instruction-set simulator of the RV64 board (like QEMU), with hot programs translated to WebAssembly | the software's behaviour: Linux, MicroPython, C, GPIO, screen; it doesn't read the Veryl source | about 50–170 million instructions/s; a cold boot takes seconds | writing programs for the RV64 board (like a Raspberry Pi), fast and in real time |

## Hardware or software

veryl-emu and riscv-emu run **the same board** (Rv64Soc from `examples/rv64`), **the same** OpenSBI + Linux image,
the same GPIO, breadboard, file exchange, and screen. The difference is "who computes the result":

- veryl-emu: the Rv64Core and peripherals you wrote in Veryl. Change `rv64core.veryl`, and the next boot runs your changed CPU;
  slow, but every signal is real.
- riscv-emu: a simulator written after Rv64Soc ([riscv-emu](../riscv-emu/README.tw.md)). Its agreement with the hardware rests on tests:
  riscv-tests, random programs compared instruction by instruction against spike, the Linux boot compared instruction by instruction against the RTL's commit log (the first difference is reading `cycle`:
  the hardware counts clocks, the simulator counts instructions), and xv6's usertests. Tens of times faster — good for writing software; changing the Veryl has no effect at all.

So the usual workflow is: write and experiment with riscv-emu; after changing the hardware, switch to veryl-emu and boot once to confirm your circuit runs the same software correctly;
to know how big and how fast it would be as a chip, switch to FPGA / ASIC.

## Where the speed comes from

| | what one instruction takes | Linux boot to shell |
|---|---|---|
| Verilator (RTL, native) | computes every signal of the whole CPU, about 3 cycles per instruction | about 45 s |
| veryl-emu (RTL, wasm) | the same, in the browser | about 70 s (from a snapshot: about 10 s) |
| riscv-emu interpreter (wasm) | decodes one instruction and applies its effect | about 1.7 s |
| riscv-emu translator (wasm) | a block of code is translated to a wasm function, compiled to machine code by the browser, and executed directly | about 1.6 s (most of the boot is run-once code); later programs are about 4× faster |

The command line has the same tools: `sim/obj/rv64sim` (Verilator), `emu/rv64emu` (veryl-emu), and
`riscv-emu/target/release/rvemu` (riscv-emu) under `examples/rv64`, all with the same options; test scripts swap them with `SIM=`.
