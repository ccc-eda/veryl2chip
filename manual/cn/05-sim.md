# 5. 仿真：`v2c sim`

```
v2c sim [--top MODULE] [--vcd FILE.vcd] [--max-time N] FILE.veryl...
v2c list FILE.veryl...
```

`v2c sim` 是事件驱动的仿真器（类似 Icarus Verilog）：4 态值（0 / 1 / x）、delta cycle、非阻塞赋值、时钟产生器、VCD。

## 跑哪个 module

| 情况 | 仿真的顶层 |
|---|---|
| 没给 `--top` | **所有**带 `#[test(...)]` 的 module，一个接一个 |
| 没有任何 testbench | 最后声明的 module |
| `--top M`（或 `-s M`） | 只有 `M` |

不确定文件里有哪些 module，用 `v2c list`：

```sh
$ v2c list counter.veryl
Counter
TestCounter  (#[test])
```

## 结果与结束码

```sh
$ v2c sim counter.veryl
=== simulating TestCounter ===
$finish called at time 95
TestCounter: PASS
```

`$assert` 不成立时打印时间并计一次失败：

```
ASSERTION FAILED at time 65
TestCounter: 1 failure(s)
```

| 结束码 | 意思 |
|---|---|
| 0 | 全部通过 |
| 1 | 有断言失败，或文件 / 语法 / 展开错误（例如 `err.veryl:2:1: parse error: ...`） |
| 2 | 命令行参数错误（提示 `v2c help sim`） |

所以可以直接放进引脚本或 CI：`v2c sim *.veryl || exit 1`。

## 时间

`$tb::clock_gen` 的时钟周期是 10 个时间单位（`clk.next()` 前进一个周期）。
仿真在 `$finish`、或到 `--max-time`（默认 1000000）时停止；超时会打印 `simulation stopped: reached max time N`。
大设计（例如 RISC-V 跑完整个程序）若跑不完，把 `--max-time` 加大。

## 波形

```sh
v2c sim --vcd wave.vcd counter.veryl
gtkwave wave.vcd
```

有好几个 testbench 时，每个写一个档：`wave_TestA.vcd`、`wave_TestB.vcd`…
波形里有 testbench 与它底下每一层的信号（名称如 `dut.count`）。网页 IDE 的波形分页看的是同一份数据。

## 调试技巧

- `$display("count=%d", count);` 在 `initial` 里随时印值。
- 先用 `--top` 单独跑一个 testbench。
- 结果和预期不同时，先用官方 `veryl test` 跑一次对照：两边都错通常是设计的问题，只有一边错就回报给我们。
