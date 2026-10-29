# 6. Synthesis: `v2c synth`

```
v2c synth [--top MODULE] [-o OUT.json] [--verilog OUT.v] FILE.veryl...
```

Elaborates the Veryl design into a **flat gate-level netlist**: all submodules are flattened (signal names like `u_alu.sum`), if / case become multiplexers,
for loops are unrolled, functions are inlined, `always_ff` becomes flip-flops.

## Output

```sh
$ v2c synth -o counter.json --verilog counter.v counter.veryl
=== Counter ===
  port input    1 i_clk
  ...
  cells: 14
    $_AND_         2
    $_DFF_PN0_     4
    $_MUX_         4
    ...
```

| Option | Content |
|---|---|
| (default) | port and cell statistics (like yosys' `stat`) |
| `-o OUT.json` (`--json`) | yosys JSON: readable with `yosys -p "read_json OUT.json"` |
| `--verilog OUT.v` | structural Verilog: simulatable with iverilog |
| `--top M` (`-s M`) | synthesize `M`; the default is the last module that is not a testbench |

The netlist uses yosys' internal cells: `$_NOT_ $_AND_ $_OR_ $_XOR_ $_MUX_` (Y = S ? B : A),
flip-flops `$_DFF_P_` / `$_DFF_N_`, asynchronous reset `$_DFF_{P,N}{P,N}{0,1}_`, synchronous reset `$_SDFF_…`.

## What the optimizer does

- Constant folding, structural hashing (identical gates are kept once), simplifications like `x & !x`, balanced reduction trees.
- Proving constant nodes: random simulation finds candidates, then an exhaustive proof over supports of up to 16 inputs.
- Removing registers that are always 0 (power up at 0, never written to 1). When a program ROM is constant, hardware the CPU never uses disappears entirely.
- Detecting combinational loops (e.g. an `always_comb` without a full assignment), reported as errors.

## Memories

Arrays recognized as memories during synthesis (the conditions from chapter 4) remain flip-flops in the generic netlist; at the FPGA / ASIC mapping stage,
those with synchronous reads become block RAM / SRAM macros. For example, a 512×8 `SyncRam`: 12832 cells in the generic netlist, a single `SB_RAM40_4K` on iCE40.

## Checking that synthesis is correct

- `v2c gatesim opt FILE...`: run the synthesized netlist with the original testbench (chapter 8).
- With yosys (including the slang front end), you can formally prove equivalence against the SystemVerilog produced by the official `veryl build` (the project's `veryl-eda/test.sh` does exactly this, chapter 13).
