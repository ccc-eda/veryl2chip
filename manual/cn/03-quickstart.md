# 3. 五分钟上手

用一个 4 位计数器把整条流程走一遍。建一个目录，放两个文件。

`counter.veryl`：设计与它的 testbench

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

`counter.pcf`：引脚（iCEBreaker：12 MHz 时钟、板上按钮当 reset、扩展板的 BTN1 当 enable、LED1–4 显示计数）

```
set_io i_clk 35
set_io i_rst 10
set_io i_en 20
set_io o_count[0] 26
set_io o_count[1] 27
set_io o_count[2] 25
set_io o_count[3] 23
```

## 1. 仿真

```sh
$ v2c sim counter.veryl
=== simulating TestCounter ===
$finish called at time 95
TestCounter: PASS
```

`v2c sim --vcd wave.vcd counter.veryl` 另外写出波形，可用 GTKWave 开。

## 2. 综合

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

综合器自动挑了最后一个不是 testbench 的 module（`Counter`）。

## 3. FPGA 比特流

```sh
$ v2c fpga --pnr veryl --pcf counter.pcf --bin counter.bin counter.veryl
  cells: 10
    SB_DFFR        4
    SB_LUT4        6
  veryl pnr: 6 LCs, 52 routing pips, 0.2s
  timing: critical path 8.19 ns, Fmax 122.10 MHz
wrote counter.bin
$ iceprog counter.bin          # 插上 iCEBreaker 才需要
```

Fmax 122 MHz 远高于板子的 12 MHz，可以放心烧。没有板子的话，用网页 IDE 的虚拟开发板（第 12 章）。

## 4. 综合后再仿真一次

```sh
$ v2c gatesim ice40 counter.veryl
TestCounter: PASS
gate-level simulation: Counter as 10 cells (ice40)
```

同一个 testbench 跑在综合后的 iCE40 网表上，结果一样，表示综合没有改变行为。

## 5. ASIC

```sh
$ v2c asic counter.veryl                         # 教學用的 vlib 元件庫
$ v2c asic --pdk sky130 --def counter.def --gds counter.gds counter.veryl
...
asic: DRC 1999 shapes: 0 shorts, 0 spacing, 0 min-area, 0 opens; 11 taps (0 sites too far)
timing: critical path 1.339 ns, Fmax 747.0 MHz
wrote counter.gds (83834 bytes: 62 cell instances, 555 shapes, 7 labels)
wrote counter.def
```

第二行用的是真实的开源制程 SkyWater SKY130：`counter.gds` 是通过设计规则检查的芯片版图，可以用 KLayout 打开来看（第 9 章）。

## 在网页上做同样的事

打开 IDE，在欢迎页按「＋ 新项目」（或文件区的 ＋ 添加文件），粘贴 `counter.veryl`：

- ▶ **测试**：跑 testbench，下方面板显示结果与波形。
- 标题列的后端菜单选 **FPGA** 或 **ASIC · vlib / ASIC · SKY130**，阶段菜单选要看的阶段（③ 优化、⑤ 布局、⑥ 布线…）。
- ⚡ **虚拟板**：烧进画出来的 iCEBreaker，按住 BTN1 看 LED 数上去。
