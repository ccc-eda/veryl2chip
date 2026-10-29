# 15. 选哪一种：FPGA、ASIC、veryl-emu、riscv-emu

同一个项目可以在四个地方「跑」。标题列的目标菜单（v2.25）把它们放在一起：上面两个是**综合**（看电路变成什么），
下面两个是**仿真机**（让一台机器开机、跑软件）。

| 目标 | 跑的是什么 | 看得到什么 | 速度（浏览器） | 什么时候用 |
|---|---|---|---|---|
| **FPGA**（iCE40） | 你的 Veryl 设计综合、布局布线成 iCEBreaker 的比特流 | LUT、进位链、block RAM、布线、时序；⚡ 虚拟板上的 LED、按钮、七段显示器、VGA、UART | 虚拟板即时（12 MHz 的设计） | 小到中型的数字电路：计数器、状态机、UART、自己的 RV32 CPU（像 Arduino） |
| **ASIC**（vlib / SKY130） | 同一个设计对应到标准单元、摆放、布线、DRC、GDSII | 芯片版图、面积、时序、功耗 | 综合几秒到几分钟 | 想知道电路做成芯片长什么样子 |
| **veryl-emu**（仿真机·硬件） | 你的 Veryl 设计本身编成 WebAssembly，一拍一拍地跑（像 Verilator） | 每一拍、每个信号都是你写的电路算出来的；改了 Veryl 就是新的硬件 | 约 370 万拍 / 秒（RV64 约 120 万个指令 / 秒）；RV64 开到 shell 从快照约 10 秒 | 放不进 FPGA / ASIC 流程的大设计（256 MB RAM 的 RV64 SoC），要看「硬件本身」对不对 |
| **riscv-emu**（仿真机·指令集） | RV64 开发板的指令集仿真器（像 QEMU），常跑的程序翻成 WebAssembly | 软件的行为：Linux、MicroPython、C、GPIO、屏幕；不看 Veryl 源代码 | 约 5000 万–1.7 亿个指令 / 秒；冷开机几秒 | 在 RV64 板子上写程序（像树莓派），要快、要即时 |

## 硬件还是软件

veryl-emu 和 riscv-emu 跑的是**同一块板子**（`examples/rv64` 的 Rv64Soc）、**同一份** OpenSBI + Linux 映像、
同样的 GPIO、面包板、文件交换与屏幕，差别在「谁算出结果」：

- veryl-emu：你用 Veryl 写的 Rv64Core 与周边。改了 `rv64core.veryl`，下一次开机就是你改过的 CPU；
  慢，但是每个信号都是真的。
- riscv-emu：照 Rv64Soc 写的仿真器（[riscv-emu](../riscv-emu/README.tw.md)）。它和硬件的一致性靠测试：
  riscv-tests、随机程序与 spike 逐指令比对、开 Linux 时和 RTL 的 commit log 逐指令比对（第一个差别是读 `cycle`：
  硬件数时钟、仿真器数指令）、xv6 的 usertests。快几十倍，适合写软件；改了 Veryl 不会有任何影响。

所以常见的做法是：写程序、做实验用 riscv-emu；改了硬件以后切到 veryl-emu 开一次机，确认你的电路跑同样的软件也对；
要知道它做成芯片多大、多快，就切到 FPGA / ASIC。

## 速度从哪里来

| | 一个指令要做的事 | Linux 开到 shell |
|---|---|---|
| Verilator（RTL，原生） | 算整颗 CPU 的每个信号，一个指令约 3 拍 | 约 45 秒 |
| veryl-emu（RTL，wasm） | 同上，在浏览器里 | 约 70 秒（快照：约 10 秒） |
| riscv-emu 直译（wasm） | 解码一个指令、做它的效果 | 约 1.7 秒 |
| riscv-emu 翻译（wasm） | 一段程序翻成 wasm 函数后由浏览器编成机器码，直接运行 | 约 1.6 秒（开机多半是只跑一次的码）；之后的程序快约 4 倍 |

命令行也有对应的工具：`examples/rv64` 的 `sim/obj/rv64sim`（Verilator）、`emu/rv64emu`（veryl-emu）与
`riscv-emu/target/release/rvemu`（riscv-emu），选项都一样，测试引脚本用 `SIM=` 换。
