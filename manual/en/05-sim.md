# 5. Simulation: `v2c sim`

```
v2c sim [--top MODULE] [--vcd FILE.vcd] [--max-time N] FILE.veryl...
v2c list FILE.veryl...
```

`v2c sim` is an event-driven simulator (like Icarus Verilog): 4-state values (0 / 1 / x), delta cycles, non-blocking assignments, a clock generator, VCD.

## Which module runs

| Situation | Simulated top |
|---|---|
| No `--top` | **all** modules with `#[test(...)]`, one after another |
| No testbench at all | the last declared module |
| `--top M` (or `-s M`) | only `M` |

Not sure which modules a file contains? Use `v2c list`:

```sh
$ v2c list counter.veryl
Counter
TestCounter  (#[test])
```

## Results and exit code

```sh
$ v2c sim counter.veryl
=== simulating TestCounter ===
$finish called at time 95
TestCounter: PASS
```

A failing `$assert` prints the time and counts one failure:

```
ASSERTION FAILED at time 65
TestCounter: 1 failure(s)
```

| Exit code | Meaning |
|---|---|
| 0 | everything passed |
| 1 | an assertion failed, or a file / syntax / elaboration error (e.g. `err.veryl:2:1: parse error: ...`) |
| 2 | bad command-line arguments (hints `v2c help sim`) |

So it drops straight into scripts or CI: `v2c sim *.veryl || exit 1`.

## Time

The `$tb::clock_gen` clock period is 10 time units (`clk.next()` advances one period).
Simulation stops at `$finish`, or at `--max-time` (default 1000000); a timeout prints `simulation stopped: reached max time N`.
If a large design (e.g. a RISC-V core running a whole program) does not finish, raise `--max-time`.

## Waveforms

```sh
v2c sim --vcd wave.vcd counter.veryl
gtkwave wave.vcd
```

With several testbenches, each writes its own file: `wave_TestA.vcd`, `wave_TestB.vcd`…
The waveform contains the testbench and the signals of every level beneath it (names like `dut.count`). The web IDE's waveform tab reads the same data.

## Debugging tips

- `$display("count=%d", count);` prints values at any time inside `initial`.
- Run a single testbench in isolation with `--top` first.
- When the result differs from what you expect, run the official `veryl test` once for comparison: if both are wrong it is usually a design problem; if only one is wrong, report it to us.
