# 8. Post-synthesis simulation: `v2c gatesim`

```
v2c gatesim opt|ice40|ecp5|asic|sky130 [--top MODULE] FILE.veryl...
```

Did the synthesizer get the circuit right? The most direct check: **with the same testbench**, replace the module under test with its synthesized netlist and simulate again.

```sh
$ v2c gatesim ice40 counter.veryl
=== simulating TestCounter ===
TestCounter: PASS
gate-level simulation: Counter as 10 cells (ice40)
```

| Netlist | Contents |
|---|---|
| `opt` | Optimized generic gates (the result of `v2c synth`) |
| `ice40` | iCE40 mapped: `SB_LUT4`, `SB_CARRY`, `SB_DFF*`, `SB_RAM40_4K` |
| `ecp5` | ECP5 mapped: `LUT4`, `CCU2C`, `TRELLIS_FF` |
| `asic` | vlib standard cells (including SRAM macros) |
| `sky130` | SkyWater SKY130 standard cells |

- What gets replaced is `--top` (default: the last module that is not a testbench); all testbenches in the file run as usual.
- If a testbench instantiates the design with different parameters, one netlist is synthesized per parameter set.
- The gate-level models keep x-propagation (LUTs are represented as mux trees), so uninitialized values are x just like in the RTL.
- If the result differs from `v2c sim`, synthesis is wrong (or the design relies on an assumption the synthesizer does not make, e.g. an uninitialized register — the optimizer assumes power-up at 0).

The web IDE's "simulation target" menu (RTL / gate-level: generic gates / iCE40 / standard cells) does the same thing; ✔ Full verification runs the RTL and all three netlists once and compares them.
