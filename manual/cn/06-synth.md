# 6. 综合：`v2c synth`

```
v2c synth [--top MODULE] [-o OUT.json] [--verilog OUT.v] FILE.veryl...
```

把 Veryl 设计展开成一张**扁平的门级网表**：所有子模块摊平（信号名称如 `u_alu.sum`），if / case 变成多路选择器，
for 循环展开，function 内联，`always_ff` 变成触发器。

## 输出

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

| 选项 | 内容 |
|---|---|
| （默认） | 端口与单元统计（类似 yosys 的 `stat`） |
| `-o OUT.json`（`--json`） | yosys JSON：`yosys -p "read_json OUT.json"` 可以读 |
| `--verilog OUT.v` | 结构化 Verilog：iverilog 可以仿真 |
| `--top M`（`-s M`） | 综合 `M`；默认是最后一个不是 testbench 的 module |

网表用的是 yosys 的内部单元：`$_NOT_ $_AND_ $_OR_ $_XOR_ $_MUX_`（Y = S ? B : A），
触发器 `$_DFF_P_` / `$_DFF_N_`，异步 reset `$_DFF_{P,N}{P,N}{0,1}_`，同步 reset `$_SDFF_…`。

## 优化做了什么

- 常数折叠、结构哈希（相同的门只留一个）、`x & !x` 之类的化简、平衡的化简树。
- 证明常数节点：随机仿真找候选，再对 16 个输入以内的支撑集穷举证明。
- 移除永远是 0 的寄存器（上电为 0、从不被写成 1）。程序 ROM 是常数时，CPU 用不到的硬件会整个消失。
- 检测组合环路（例如没有完整赋值的 `always_comb`），以错误回报。

## 存储器

综合时被认成存储器的数组（第 4 章的条件）在通用网表里仍是触发器；到了 FPGA / ASIC 对应时，
同步读取的会换成 block RAM / SRAM 宏。例如 512×8 的 `SyncRam`：通用网表 12832 个单元，iCE40 上只要 1 个 `SB_RAM40_4K`。

## 确认综合是对的

- `v2c gatesim opt FILE...`：用原本的 testbench 跑综合后的网表（第 8 章）。
- 有 yosys（含 slang 前端）的话，可以对官方 `veryl build` 产生的 SystemVerilog 做形式等价证明（项目的 `veryl-eda/test.sh` 就是这样做，第 13 章）。
