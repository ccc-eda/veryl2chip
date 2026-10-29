# 14. 参考

## `v2c` 指令总表

```
v2c <子指令> [選項] FILE.veryl...
```

`v2c help <子指令>` 或 `v2c <子指令> -h` 显示说明。成功的结束码是 0，失败（断言、语法、综合错误）是 1，选项错误是 2。

| 子指令 | 作用 | 章 |
|---|---|---|
| `sim`（别名 `test`） | 运行 testbench | 5 |
| `list` | 列出模块，标出 `#[test]` | 5 |
| `synth` | 综合成门级网表 | 6 |
| `fpga` | iCE40UP5K（默认）或 ECP5（`--arch ecp5`）：对应、布局布线、比特流 | 7 |
| `gatesim` | 在综合后的网表上跑 testbench | 8 |
| `asic` | 标准单元流程（vlib / SKY130） | 9 |
| `cc` | 编译 C（或汇编 `.s`）给 RISC-V SoC，可直接运行 | 10 |
| `pdk` | 检查完整的 SKY130 文件 | 9 |
| `version` | 版本 | |
| `help` | 说明 | |

### 共通

| 选项 | 子指令 | 内容 |
|---|---|---|
| `--top M`、`-s M` | sim、synth、fpga、gatesim、asic | 顶层模块。sim 默认全部 `#[test]`；其他默认最后一个不是 testbench 的 module |
| `FILE.veryl...` | 全部 | 可以给多个文件，顺序不重要 |

### `v2c sim`

| 选项 | 内容 |
|---|---|
| `--vcd F.vcd` | 波形（有多个 testbench 时每个一个档：`F_<top>.vcd`） |
| `--max-time N` | 仿真时间上限（默认 1000000） |

结束码：0 通过；1 有 `$assert` 失败，或源代码错误；2 选项错误。

### `v2c synth`

| 选项 | 内容 |
|---|---|
| `-o F.json`、`--json F.json` | yosys JSON |
| `--verilog F.v` | 结构化 Verilog |

### `v2c fpga`

| 选项 | 内容 |
|---|---|
| `--pcf F.pcf` | 引脚档 |
| `--asc F.asc` | 布好的设置（IceStorm 文本格式） |
| `--bin F.bin` | 比特流 |
| `--pnr veryl\|nextpnr` | 布局布线工具（默认 nextpnr） |
| `--seed N` | 布局种子 |
| `--no-timing-driven` | 只看线长（自研布局布线） |
| `--program P.bin` | 把程序放进 block RAM |
| `-o F.json`、`--verilog F.v` | 对应后的网表 |
| `-v` | 关键路径细节 |
| `--device up5k --package sg48` | 默认值（iCE40 目前只支持这个） |
| `--arch ice40\|ecp5` | 目标 FPGA（默认 ice40） |
| `--lpf F.lpf`、`--config F.config`、`--bit F.bit` | ECP5 的引脚档、布好的设置、比特流（nextpnr-ecp5 + ecppack） |
| `--device 12k\|25k\|45k\|85k --package CABGA381` | ECP5 的型号（默认 85k、CABGA381） |

### `v2c gatesim opt|ice40|ecp5|asic|sky130`

只有 `--top`。

### `v2c asic`

| 选项 | 内容 |
|---|---|
| `--pdk vlib\|sky130\|sky130:DIR` | 单元库（默认 vlib） |
| `--seed N` | 布局种子 |
| `--verilog F.v` | 标准单元网表（含单元模型） |
| `--def F.def` | DEF |
| `--gds F.gds` | GDSII（SKY130） |
| `--spice F.sp` | SPICE 网表（SKY130）：给 KLayout 的 LVS（`tools/lvs_check.py`）、ngspice |
| `--sdc F.sdc` | 时序约束（SDC 子集）：报告余裕 WNS / TNS（第 9 章） |
| `--clock MHZ` | 一个目标时钟套用到全部（`--sdc` 的简写）；FPGA 也交给 nextpnr |
| `--map-only` | 只做单元对应 |
| `-v` | 关键路径、DRC 违规例子 |

### `v2c cc PROG.c|PROG.s`

| 选项 | 内容 |
|---|---|
| `-o P.bin` | 二进位映像档 |
| `-S P.s` | 汇编语言 |
| `-L P.lst` | 列表 |
| `--run [N]` | 在指令集仿真器上运行（默认最多 1000 万个指令） |
| `--mem BYTES` | RAM 大小（默认 8192） |
| `--linux` | RV64 开发板 Linux 的静态运行档（`-o` 默认是去掉 `.c` 的文件名） |

### `v2c pdk [check] [DIR]`

DIR 默认依序找 `$VERYL_EDA_SKY130`、`~/sky130hd`。

## 旧指令

`veryl-sim` 与 `veryl-eda` 两个指令仍然存在，`v2c` 的子指令只是帮它们加上对应的旗标：

| `v2c` | 旧指令 |
|---|---|
| `v2c sim ...` | `veryl-sim ...` |
| `v2c synth ...` | `veryl-eda ...` |
| `v2c fpga ...` | `veryl-eda --ice40 ...` |
| `v2c fpga --arch ecp5 ...` | `veryl-eda --ecp5 ...` |
| `v2c asic ...` | `veryl-eda --asic ...` |
| `v2c gatesim K ...` | `veryl-eda --gatesim K ...` |
| `v2c cc P.c ...` | `veryl-eda --cc P.c ...` |
| `v2c pdk` | `veryl-eda --pdk-check` |

## 环境变量

| 变量 | 用途 |
|---|---|
| `VERYL_EDA_CHIPDB` | IceStorm `chipdb-5k.txt`（`--pnr veryl`）；没设置时找 OSS CAD Suite 的 `share/icebox/` |
| `VERYL_EDA_SKY130` | 完整 SKY130 hd 文件的目录（`v2c pdk`） |
| `VERYL_EDA_PROFILE` | 打印 ASIC 各步骤耗时与详细布线每轮的冲突数 |
| `YOSYS_SLANG`、`YOSYS`、`GDS_PY`、`OUT` | `veryl-eda/test.sh` 用（第 13 章） |

## 文件格式

| 扩展名 | 是什么 | 谁产生 / 谁读 |
|---|---|---|
| `.veryl` | Veryl 源代码 | 你 |
| `.pcf` | 引脚：`set_io [-nowarn] 埠 腳號` | 你；`fpga --pcf`、虚拟板 |
| `.vcd` | 波形 | `sim --vcd`；GTKWave、IDE |
| `.json` | yosys JSON 网表 | `synth -o`、`fpga -o`；yosys |
| `.v` | 结构化 Verilog | `--verilog`；iverilog、yosys |
| `.asc` | iCE40 设置（文本） | `fpga --asc`；IceStorm 工具 |
| `.bin` | iCE40 比特流 | `fpga --bin`；iceprog、虚拟板 |
| `.lpf` | ECP5 引脚 | 你；`fpga --arch ecp5 --lpf` |
| `.config`、`.bit` | ECP5 布好的设置、比特流 | `fpga --arch ecp5`；ecppack、openFPGALoader |
| `.def` | 布局布线 | `asic --def`；OpenROAD、KLayout |
| `.gds` | 芯片版图 | `asic --gds`；KLayout、Magic |
| `.c`、`.s` | RISC-V 程序 | 你；`cc` |
| `.bin`（程序） | 从地址 0 开始的存储器映像 | `cc -o`；`fpga --program`、虚拟板 |
| `.lab.json` | 分享的实验 | IDE |

## RvSoc 存储器映射

| 地址 | 名称 | 说明 |
|---|---|---|
| `0x0000_0000`–`0x0000_1FFF` | RAM | 8 KB |
| `0x1000_0000` | `LED` | 8 位输出 |
| `0x1000_0004` | `BUTTONS` / `SWITCHES` | bit 2..0 按钮，bit 15..8 开关 |
| `0x1000_0008` | `UART_DATA` | 送出 / 收到的字节 |
| `0x1000_000C` | `UART_STATUS` | bit 0 发送中，bit 1 收到 |
| `0x1000_0010` | `TIMER` / `MTIME` | 时钟计数（12 MHz） |
| `0x1000_0018` | `MTIMECMP` | 计时器中断比较值 |
| `0x1000_0020` | `MSIP` | 软件中断 |
| `0x1000_2000` / `4000` / `6000` | `VGA_TEXT` / `VGA_FONT` / `VGA_COLOR` | VGA 文本模式（`RvVgaBoard`） |

## 疑难排解

| 现象 | 原因与解法 |
|---|---|
| `not supported` | 本项目没支持的语法（第 4 章），不一定是语法错误；用官方 `veryl check` 确认 |
| `expected …` 之类的解析错误出现在 function 里的 `<` / `>` | Veryl 0.22 的已知问题：function 内用 `<=`、`>=`、`<:`、`>:` |
| 测试没有跑 | module 前面没有 `#[test(名稱)]`；`v2c list` 看哪些是 testbench |
| 仿真永远不结束 | testbench 没有结束点；用 `clk.next(n)` 控制，或 `--max-time` |
| `combinational loop` | `always_comb` 里某个信号没有在每条路径都赋值，或真的有回路 |
| 综合后少了一大堆电路 | 优化器移除了不影响输出的逻辑，或永远是 0 的寄存器；确认输出端口真的用到它们 |
| gatesim 与 sim 结果不同 | 设计依赖未初始化的值，或综合器的错误（请回报） |
| `no chipdb` / 找不到 `chipdb-5k.txt` | 设置 `VERYL_EDA_CHIPDB`，或装 OSS CAD Suite；或改用 `--pnr nextpnr` |
| nextpnr 因时序失败 | 设计太慢（第 7 章）；`--pnr veryl` 一样会产生并打印 Fmax |
| ASIC 很慢 | 大存储器在 SKY130 变成触发器；用 `--map-only` 只拿网表，或改用 vlib |
| `v2c` 找不到 | `cargo install veryl2chip-eda`，或把 `veryl-eda/target/release` 加进 `PATH` |
| 虚拟板的设计跑得比真板子好 | 虚拟板不仿真时序违规与按钮弹跳（第 12 章） |
