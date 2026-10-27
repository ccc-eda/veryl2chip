[English](README.md) | [繁體中文](README.tw.md)

# veryl-emu

Compiles a Veryl design into a **WebAssembly** module for fast, cycle-based, two-state
simulation, in the spirit of Verilator. The module runs wherever WebAssembly runs: in
Node on the command line, or in a browser (the browser's engine compiles it to machine
code). A small JavaScript harness drives the ports.

veryl-emu is a separate crate: [veryl-sim](../veryl-sim/) is not changed. veryl-emu uses
veryl-sim's IR (expressions, statements, values) and helpers as a library and has its own
copy of the elaboration (`src/elab.rs`), whose only difference is that an array is one
signal (a block of memory) instead of one signal per element, so a 256 MB RAM is fine.

```sh
cargo build --release
target/release/veryl-emu --top Rv64Soc --stop o_tx_valid,o_finish -o soc.wasm core.veryl soc.veryl
# -> soc.wasm and soc.json (the byte offset, width and size of every signal)
tests/check.sh            # differential test against veryl-sim (needs Node)
```

```js
import { loadFiles } from './js/emu.mjs';
const emu = await loadFiles('soc.wasm');
const rst = emu.sig('i_rst'), tx = emu.sig('o_tx_valid');
rst.set(0); emu.settle(); emu.posedge(); rst.set(1); emu.settle();
const n = emu.run(1_000_000);   // cycles until a --stop signal is set (checked before each edge)
```

## How it works

| Step | |
|---|---|
| elaborate | `src/elab.rs`: the module hierarchy flattened into veryl-sim's IR (`Proc::Comb`, `Proc::Ff`, signals) |
| type | `src/ir.rs`: every expression gets its width and signedness at compile time, by the rules veryl-sim's `Sim::eval` applies at run time (context-determined widths for arithmetic, comparisons at the wider operand, shifts at the left operand's width, sign extension of signed values); `case` / `switch` become `if` chains; two-state (x / z are 0, an x result such as division by zero is 0) |
| schedule | `src/gen.rs`: combinational processes in dependency order (Tarjan); a group that depends on itself repeats until its outputs stop changing; clocks that reach instances through port connections are followed to one clock |
| non-blocking | a register that an `always_ff` also reads is written to a shadow copy and copied back after the edge; an array element that an `always_ff` reads goes through a write queue; everything else is written in place |
| code | `src/gen.rs` + `src/wasm.rs` (a minimal WebAssembly writer, no dependencies): every value is 64-bit limbs in i64 locals (one limb up to 64 bits, up to four for 256 bits), carries, multi-limb shifts and comparisons inline; signals live in linear memory |

Exports: `settle()` (combinational logic), `posedge()` (the `always_ff` processes, then
`settle()`), `run(n)` (up to `n` cycles, stopping before an edge when a `--stop` signal is
non-zero; `emu.mute(name, true)` turns one off), and the memory `mem`.

## Verification and speed

- `tests/check.sh`: `tests/check.veryl` (128-bit arithmetic, variable shifts and part
  selects, signed division and `>>>`, functions, case ranges, loops, a register and an
  array that `always_ff` reads) runs 300 cycles on veryl-sim and on veryl-emu; all 21
  outputs must match every cycle.
- `examples/rv64/emu/`: the RV64 SoC (Rv64Core + Rv64Soc, 256 MB RAM) passes the 196
  riscv-tests, random programs compared with spike instruction by instruction, the
  interrupt tests, and boots Linux to a busybox shell.

| Linux boot to the shell (230 M cycles) | cycles / s |
|---|---|
| Verilator (C++, `-O3`) | 7.2 M |
| veryl-emu (WebAssembly in Node 24) | 2.2 M |
| veryl-sim (interpreter, four-state) | a few thousand |

## Limits

- One clock (rising edge); asynchronous resets act at the clock edge.
- No testbench constructs (`initial`, `clk.next()`, `$display`, `$assert`): the harness drives the ports.
- Multiplication and division of more than 64 bits; `[hi:lo]` with a variable width (use `[lo +: w]`).
- No x: two-state like Verilator.
