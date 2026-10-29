# 4. Veryl for veryl2chip

veryl2chip reads ordinary Veryl (parsed with `veryl-parser` 0.22); the files need no special format.
The official `veryl check` is the ground truth for syntax and semantics; veryl2chip's simulator is deliberately smaller, and what it reports as "not supported" is not necessarily a syntax error.

## Files of a design

- You can pass several `.veryl` files at once: `v2c sim a.veryl b.veryl`. Modules may reference each other, in any order.
- Packages, enums (members written as `Pkg::EnumName::Member`), structs (the first field is at the MSB, as in SystemVerilog),
  const, function, interface and modport, generate for / if are all supported.
- A Veryl project with a `Veryl.toml` works directly too: just hand the `src/*.veryl` files to `v2c`.

## Testbench

A testbench is a module with a `#[test(name)]` attribute. The canonical form:

```veryl
#[test(test_x)]
module TestX {
    inst clk: $tb::clock_gen;          // this inst IS the clock
    inst rst: $tb::reset_gen(clk);     // remembers which clock it uses

    // ... inst dut: X (i_clk: clk, i_rst: rst, ...);

    initial {
        rst.assert();                  // assert reset, wait one cycle
        clk.next(10);                  // advance 10 clock cycles
        $assert(dut_output == 8'd42);  // records a failure if not true
        $finish();
    }
}
```

- Do not declare your own `var clk: clock` and toggle it by hand; use `$tb::clock_gen`.
- After every `initial` statement the simulator settles the combinational logic, so purely combinational, clock-less circuits can be tested the same way:
  set the inputs, then `$assert` the outputs on the next line.
- Available system functions: `$display $write $info $warning $error $fatal $assert $finish $time $clog2 $signed $unsigned $bits $random`.
- To make a testbench faster, use parameters to shrink the design (e.g. a counter's width); the tutorial's Blinky does exactly this.

## Supported syntax

| Simulation (`v2c sim`) | Synthesis (`v2c synth / fpga / asic`) |
|---|---|
| module, parameters, const, port, `var`, `let`, `assign`, `always_comb`, `always_ff` (`if_reset`, sync / async reset, rising / falling edge), `if`, `case`, `switch`, `for`, `inst`, `initial`, `final` | same as left (`initial` / `final` and `$display`-like calls are ignored) |
| package, enum, struct, 1-D arrays, function (no recursion), generate, `import Pkg::*`, interface / modport | same as left; arrays read/written with a variable index become multiplexers / decoders |
| 4-state values (0 / 1 / x), up to 256 bit | constants up to 256 bit |
| | Operators: `+ - *`, bitwise / logical / reduction, comparison, shifts (constant or variable), concatenation, `repeat`, ternary; `/ %` synthesize to a divider; `**` constant only |

**Not yet supported**: generic interface ports (name the modport instead), recursion, `inout`, widths over 256 bit, latches
(an `always_comb` without a full assignment is reported as a combinational loop during synthesis).

## Writing for synthesis

- **Memories**: an array is recognized as a memory if it is written as whole elements in **one** `always_ff` and also read as whole elements.
  If the read data goes through a register (**synchronous read**), it becomes a block RAM (`SB_RAM40_4K`) on FPGA and an SRAM macro on the vlib ASIC;
  asynchronous-read memories stay in logic. Example: `examples/src/sync_ram.veryl`.
- **Initial values**: the optimizer assumes flip-flops power up at 0 (true on iCE40); registers that are never written are removed as constant 0.
- **Top level**: synthesis defaults to the **last non-testbench** module; add `--top` to synthesize something else.

## Veryl 0.22 pitfalls (verified with `veryl check`)

- A bare `<` / `>` inside a `function` body makes the parser think it is a generic: use `<=` / `>=` or `<:` / `>:` instead.
- Enum members must be fully qualified: `Pkg::EnumName::Member`, not `Pkg::Member`.
- `bit` is a reserved keyword and cannot be used as a name.
- Array writes without a reset make `veryl check` warn `missing_reset_statement`; put `#[allow(missing_reset_statement)]` before that `always_ff`.
- Veryl 0.22's built-in simulator (`veryl test`) mis-simulates interface designs; veryl2chip and iverilog agree.
