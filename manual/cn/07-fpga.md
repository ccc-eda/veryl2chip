# 7. FPGA：`v2c fpga`

```
v2c fpga [--top MODULE] [--pcf PINS.pcf] [--asc OUT.asc] [--bin OUT.bin]
         [--pnr veryl|nextpnr] [--seed N] [--no-timing-driven] [--program PROG.bin]
         [-o OUT.json] [--verilog OUT.v] [-v] FILE.veryl...
```

目标芯片是 Lattice **iCE40UP5K-SG48**（iCEBreaker 开发板上的那颗：5280 个逻辑单元、30 块 4 Kbit block RAM、12 MHz 时钟）。

## 步骤

1. **对应**（一定做）：全加器的进位变成 `SB_CARRY` 进位链，其他逻辑以 4 输入查表 `SB_LUT4` 覆盖，
   触发器变成 `SB_DFF*`，同步读取的存储器变成 `SB_RAM40_4K`。打印单元统计；`-o` / `--verilog` 写出对应后的网表。
2. **布局布线**（给了 `--asc` 或 `--bin` 才做）：把单元放到芯片上的位置并连接。
3. **比特流**：`--bin` 写出可以烧的文件。

## 两种布局布线工具

| | `--pnr nextpnr`（默认） | `--pnr veryl` |
|---|---|---|
| 是谁 | 外部的 nextpnr-ice40 + icepack | 本项目自研布局布线与比特流 |
| 需要 | OSS CAD Suite | IceStorm 的 `chipdb-5k.txt`（`VERYL_EDA_CHIPDB`） |
| 时序不够 12 MHz | 失败（nextpnr 的行为） | 照样产生，打印 Fmax，由你判断 |
| 其他 | | 时序导向（`--no-timing-driven` 关闭）、`--seed`、`-v` 打印关键路径、粗估功耗 |

自研布局布线产生的 `.bin` 与 icepack 逐字节相同，并且用 IceStorm 的 `icebox_vlog` 把布好的比特流转回电路、
和网表逐周期比对过（第 13 章）。

```sh
$ v2c fpga --pnr veryl --pcf counter.pcf --bin counter.bin counter.veryl
  veryl pnr: 6 LCs, 52 routing pips, 0.2s
  power: 0.199 mW at 122.1 MHz = ...
  timing: critical path 8.19 ns, Fmax 122.10 MHz (wirelength-only pass 122.10 MHz)
wrote counter.bin
```

`--asc OUT.asc` 写出 IceStorm 的文本格式（自研布局布线会在旁边一起写 `.pcf`）；只给 `--bin` 时 `.asc` 放在暂存目录。

## 引脚档（`.pcf`）

每一行 `set_io 埠名 腳號`，矢量端口写 `o_led[0]`。`-nowarn` 表示设计没用到这支引脚也没关系。
iCEBreaker 常用的引脚（`tutorial/icebreaker.pcf` 有完整清单）：

| 引脚 | 用途 |
|---|---|
| 35 | 12 MHz 时钟 |
| 10 | 板上按钮 BTN_N（按下 = 0，拿来当 reset 刚好） |
| 11、37 | 板上红 / 绿 LED（低电位亮） |
| 26、27、25、23、21 | 扩展板 LED1–LED5（高电位亮） |
| 20、19、18 | 扩展板 BTN1–BTN3（按下 = 1） |
| 6、9 | 串口 RX（进 FPGA）、TX（出 FPGA） |
| PMOD1A：4 2 47 45 3 48 46 44；PMOD1B：43 38 34 31 42 36 32 28 | 外置模块 |

没有给 `--pcf` 时引脚由工具自己决定，比特流仍然可以做，但烧进板子不会接到你要的地方。

## 时序

`Fmax` 是电路能跑的最高频率，要**高于 12 MHz** 才能在 iCEBreaker 上正常工作。加上 `--clock 12`（或 `--sdc`，见第 9 章）
会再报告对这个目标的余裕，例如教学的 Blinky：`timing: target 83.333 ns (12.00 MHz): slack +53.656 ns, met`；用 nextpnr 时也会把目标频率
（`--freq`）交给它。不够时：

- 把长的组合逻辑切成两拍（加寄存器）；
- 试试不同的 `--seed`，或另一个布局布线工具；
- `-v` 看关键路径经过哪些单元与连接。

## 刻录

```sh
iceprog counter.bin
```

没有板子：网页 IDE 的 ⚡ 虚拟板跑的就是这个比特流解码回来的电路（第 12 章），也可以把任何 iCE40UP5K 的 `.bin` 拖到虚拟板上。

## 把程序放进 block RAM（`--program`）

对于程序存在 block RAM 的 CPU（例如本项目的 `RvBoard`，第 10 章），`--program PROG.bin` 从地址 0 把二进位档填进存储器：

```sh
v2c cc -o hello.bin examples/c/hello.c
v2c fpga --top RvBoard --pnr veryl --pcf examples/rvsoc.pcf --program hello.bin --bin soc.bin \
    examples/src/rv32i.veryl examples/src/sync_ram.veryl examples/src/uart.veryl examples/src/rvsoc.veryl
iceprog soc.bin
```

整颗 SoC（约 4200 个逻辑单元、20 块 block RAM）的布局布线约需一分钟，Fmax 约 13–14 MHz。

只换程序的话不需要重新综合与布局布线（网页 IDE 换 C 程序时就是直接改写比特流里的存储器内容）。

## Lattice ECP5（`--arch ecp5`）

```
v2c fpga --arch ecp5 [--device 12k|25k|45k|85k] [--package CABGA381] [--lpf PINS.lpf]
         [--config OUT.config] [--bit OUT.bit] [--seed N] [-o OUT.json] [-v] FILE.veryl...
```

ECP5 是比 iCE40 大得多的 FPGA（25F 约 2.4 万、85F 约 8.4 万个 LUT，还有 SDRAM 接口的开发板，例如开源的 **ULX3S**）。
对应由 `v2c` 做（`LUT4`、进位链 `CCU2C`、触发器 `TRELLIS_FF`），布局布线与比特流交给 OSS CAD Suite 的 **nextpnr-ecp5** 与 **ecppack**：

```sh
$ v2c fpga --arch ecp5 --bit counter.bit counter.veryl
=== Counter ===
  ...
  cells: 9
    LUT4           5
    TRELLIS_FF     4
  TRELLIS_IO:       7/    365     1%
  TRELLIS_FF:       4/  83640     0%
  TRELLIS_COMB:       6/  83640     0%
  Max frequency for clock 'i_clk$TRELLIS_IO_IN': 371.89 MHz (PASS at 12.00 MHz)
wrote counter.bit
```

`TRELLIS_COMB` 是 LUT 加上进位链的用量；`PASS at 12.00 MHz` 是 nextpnr 默认的时钟目标，要指定别的频率，在 `.lpf` 里写
`FREQUENCY PORT "i_clk" 25 MHZ;`。

- 默认 `--device 85k --package CABGA381`（ULX3S 85F）；其他型号用 `--device 12k|25k|45k`。
- 引脚档是 Lattice 的 `.lpf`：`LOCATE COMP "o_led[0]" SITE "B2";`、`IOBUF PORT "o_led[0]" IO_TYPE=LVCMOS33;`。
  没给 `--lpf` 时 nextpnr 自己放 IO。
- `--config` 是布好的文本设置（Project Trellis 格式），`--bit` 是比特流，用 `openFPGALoader -b ulx3s counter.bit` 刻录。
- `v2c gatesim ecp5` 用原本的 testbench 跑 ECP5 网表（第 8 章）。
- 和 iCE40 不同：reset 值是 1 的触发器，上电时就是 1（iCE40 全部上电为 0）。
- 同步读取的存储器（例如 `SyncRam`）变成 block RAM `DP16KD`（v2.9；每颗 2048 × 9 位，85F 有 208 颗）。
- 目前还没有：乘法器、自己的 ECP5 布局布线、虚拟板。

## 限制

iCE40 只支持 UP5K；没有 SPRAM（`SB_SPRAM256KA`）、PLL、`inout`；异步读取的存储器不会变成 block RAM；
自研布局布线不做 LUT 输入引脚交换。
