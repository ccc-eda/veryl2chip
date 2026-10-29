# veryl2chip 使用手册

veryl2chip 是给 [Veryl](https://veryl-lang.org/) 硬件描述语言用的一整套 EDA 工具：
从写好的 Veryl 程序开始，可以**仿真**、**综合**、做成 **FPGA 比特流**烧进 iCEBreaker 开发板，
也可以走 **ASIC 流程**一路做到通过设计规则检查的 **GDSII 芯片版图**（SkyWater SKY130 开源制程）。
全部用 Rust 写成，可以在命令行用，也可以直接在浏览器里用（不用安装）。

这本手册讲「怎么用」。命令行一律使用 `v2c` 指令。

## 目录

| 章 | 内容 |
|---|---|
| [1. 认识 veryl2chip](01-intro.md) | 能做什么、两种用法、整条流程一览 |
| [2. 安装](02-install.md) | 在线版、`cargo install`、从源代码建置、外部工具、环境变量 |
| [3. 五分钟上手](03-quickstart.md) | 一个计数器：仿真 → 综合 → FPGA → ASIC |
| [4. 写给 veryl2chip 的 Veryl](04-veryl.md) | testbench 的写法、支持的语法、常见陷阱 |
| [5. 仿真：`v2c sim`](05-sim.md) | 顶层选择、断言、波形、结束码 |
| [6. 综合：`v2c synth`](06-synth.md) | 门级网表、统计、yosys JSON / Verilog、优化与 block RAM |
| [7. FPGA：`v2c fpga`](07-fpga.md) | iCE40 对应、引脚档、布局布线、时序、比特流、刻录 |
| [8. 综合后仿真：`v2c gatesim`](08-gatesim.md) | 用同一个 testbench 检查综合结果 |
| [9. ASIC：`v2c asic`](09-asic.md) | vlib 与 SkyWater SKY130、DEF、DRC、GDSII、用 KLayout 看版图 |
| [10. RISC-V 与 C：`v2c cc`](10-riscv-c.md) | 自己的 RISC-V SoC、C 编译器、运行期函数库、中断与多线程 |
| [11. 网页 IDE](11-ide.md) | 项目、编辑器、测试、综合各阶段、网址参数 |
| [12. 虚拟开发板](12-board.md) | 三种模式、周边、面包板、分享实验 |
| [13. 验证与开发](13-develop.md) | 项目的测试、形式验证、给想改程序的人 |
| [14. 参考](14-reference.md) | `v2c` 指令总表、环境变量、存储器映射、疑难排解 |
| [15. 选哪一种](15-targets.md) | FPGA、ASIC、veryl-emu、riscv-emu：看电路还是跑软件、速度 |
| [16. 示例总表](16-examples.md) | 每个示例做什么、用到哪些文件、命令行与 IDE 怎么跑 |

## 其他文档

- 从零开始的教学（给第一次写硬件的人）：[`tutorial/README.tw.md`](../tutorial/README.tw.md)
- 虚拟实验课讲义（不用买板子）：[`tutorial/labs.tw.md`](../tutorial/labs.tw.md)
- 各版本的历史：[`history.md`](../history.md)
- 实现细节：[`veryl-sim/README.tw.md`](../veryl-sim/README.tw.md)、[`veryl-eda/README.tw.md`](../veryl-eda/README.tw.md)

本手册对应 veryl2chip 2.1 起（有 `v2c` 指令的版本）。
