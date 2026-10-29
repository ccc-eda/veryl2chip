# 3. Quickstart in Five Minutes

Walk the whole flow with a 4-bit counter. Create a directory and put two files in it.

`counter.veryl`: the design and its testbench

```veryl
module Counter (
    i_clk  : input  clock   ,
    i_rst  : input  reset   ,
    i_en   : input  logic   ,
    o_count: output logic<4>,
) {
    var count: logic<4>;

    always_ff {
        if_reset {
            count = 0;
        } else if i_en {
            count += 1;
        }
    }

    assign o_count = count;
}

#[test(test_counter)]
module TestCounter {
    inst clk: $tb::clock_gen;
    inst rst: $tb::reset_gen(clk);

    var en   : logic   ;
    var count: logic<4>;

    inst dut: Counter (
        i_clk  : clk  ,
        i_rst  : rst  ,
        i_en   : en   ,
        o_count: count,
    );

    initial {
        en = 1;
        rst.assert();
        clk.next(5);
        $assert(count == 4'd5);
        en = 0;
        clk.next(3);
        $assert(count == 4'd5);
        $finish();
    }
}
```

`counter.pcf`: the pins (iCEBreaker: 12 MHz clock, the on-board button as reset, the PMOD board's BTN1 as enable, LED1–4 showing the count)

```
set_io i_clk 35
set_io i_rst 10
set_io i_en 20
set_io o_count[0] 26
set_io o_count[1] 27
set_io o_count[2] 25
set_io o_count[3] 23
```

## 1. Simulate

```sh
$ v2c sim counter.veryl
=== simulating TestCounter ===
$finish called at time 95
TestCounter: PASS
```

`v2c sim --vcd wave.vcd counter.veryl` additionally writes a waveform, which you can open with GTKWave.

## 2. Synthesize

```sh
$ v2c synth -o counter.json --verilog counter.v counter.veryl
=== Counter ===
  port input    1 i_clk
  port input    1 i_rst
  port input    1 i_en
  port output   4 o_count
  cells: 14
    $_AND_         2
    $_DFF_PN0_     4
    $_MUX_         4
    $_NOT_         1
    $_XOR_         3
```

The synthesizer automatically picked the last module that is not a testbench (`Counter`).

## 3. FPGA Bitstream

```sh
$ v2c fpga --pnr veryl --pcf counter.pcf --bin counter.bin counter.veryl
  cells: 10
    SB_DFFR        4
    SB_LUT4        6
  veryl pnr: 6 LCs, 52 routing pips, 0.2s
  timing: critical path 8.19 ns, Fmax 122.10 MHz
wrote counter.bin
$ iceprog counter.bin          # only needed with an iCEBreaker plugged in
```

An Fmax of 122 MHz is far above the board's 12 MHz, so you can flash it with confidence. Without a board, use the web IDE's virtual board (Chapter 12).

## 4. Simulate Again after Synthesis

```sh
$ v2c gatesim ice40 counter.veryl
TestCounter: PASS
gate-level simulation: Counter as 10 cells (ice40)
```

The same testbench run on the synthesized iCE40 netlist gives the same result, showing that synthesis did not change the behavior.

## 5. ASIC

```sh
$ v2c asic counter.veryl                         # the teaching vlib cell library
$ v2c asic --pdk sky130 --def counter.def --gds counter.gds counter.veryl
...
asic: DRC 1999 shapes: 0 shorts, 0 spacing, 0 min-area, 0 opens; 11 taps (0 sites too far)
timing: critical path 1.339 ns, Fmax 747.0 MHz
wrote counter.gds (83834 bytes: 62 cell instances, 555 shapes, 7 labels)
wrote counter.def
```

The second line uses the real open-source process SkyWater SKY130: `counter.gds` is a DRC-clean chip layout you can open and inspect in KLayout (Chapter 9).

## Doing the Same in the Browser

Open the IDE and press "＋ New Project" on the welcome page (or "＋ New File" in the file panel), then paste in `counter.veryl`:

- ▶ **Test**: runs the testbench; the panel below shows the results and the waveform.
- Pick **FPGA** or **ASIC · vlib / ASIC · SKY130** in the title bar's target menu, then pick the stage to view in the stage menu (③ optimization, ⑤ placement, ⑥ routing…).
- ⚡ **Virtual Board**: flash it onto the drawn iCEBreaker and hold BTN1 to watch the LEDs count up.
