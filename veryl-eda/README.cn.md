# veryl-eda（crate：`veryl2chip-eda`）
[English](https://github.com/ccc-eda/veryl2chip/blob/main/veryl-eda/README.md) | [繁體中文](https://github.com/ccc-eda/veryl2chip/blob/main/veryl-eda/README.tw.md) | **简体中文**

Veryl 的逻辑综合、FPGA 与 ASIC 流程（类似 yosys `synth` / `synth_ice40` 加上 nextpnr，以及 OpenROAD 式的标准单元后端）：以
[`veryl-parser`](https://docs.rs/veryl-parser/latest/veryl_parser/) 为前端，把 Veryl 设计展开成**扁平的门级 netlist**，
可再映射成 iCE40 的 `SB_LUT4` / `SB_CARRY` / `SB_DFF*`，再用**自研布局布线**（`--pnr veryl`）或 nextpnr-ice40 产生 `.asc`，icepack 产生比特流；
或用 `--asic` 映射到自制的 **vlib 标准单元库**，做行式布局、全局布线与静态时序分析。

[veryl2chip](https://github.com/ccc-eda/veryl2chip) 的一部分（在线 IDE：<https://ccc-eda.github.io/veryl2chip/web/dist/ide.html>）。

    cargo install veryl2chip-eda        # 安装 `veryl-eda` 命令
    veryl-eda [--top MODULE] [-o out.json] [--verilog out.v] [--list]
              [--ice40 [--device up5k] [--package sg48] [--pcf pins.pcf] [--asc out.asc] [--bin out.bin]
                       [--pnr nextpnr|veryl] [--seed N] [--no-timing-driven] [-v]]
              [--asic [--seed N] [-v]] [--gatesim opt|ice40|asic] [--program PROG.bin]
              a.veryl b.veryl ...
    veryl-eda --cc PROG.c [-o PROG.bin] [-S PROG.s] [--run [N]] [--mem BYTES]

在源代码目录里也可以用 `cargo run --release -- ...`。自研布局布线需要 IceStorm 的 `chipdb-5k.txt`（OSS CAD Suite 内附，或以 `VERYL_EDA_CHIPDB` 指定）。

- 默认综合最后一个**非** `#[test]` 的 module；`--top` 可指定。会打印 port 与 cell 统计（类似 yosys `stat`）。
- `-o` 输出 yosys JSON（`read_json` 可读）；`--verilog` 输出门级 Verilog（iverilog 可仿真）。
- `--ice40` 做 iCE40 技术映射；加 `--asc` / `--bin` 会再做布局布线（默认 `nextpnr-ice40`，时序不过会失败；`--pnr veryl` 用自己的）与 `icepack`。
- `--gatesim opt|ice40|asic`：**综合后仿真**，把 `--top` 的 module 换成它的通用门 / iCE40 / 标准单元网表（`src/gatesim.rs` → veryl-sim 的门级模型），
  直接跑原本的 `#[test]` testbench（`test.sh` 对 15 个设计 × 3 种网表都跑，结果必须和 RTL 一样）。
- `--asic` 做 ASIC 后端（见下）；`--verilog` 此时输出标准单元 netlist（附 vlib 单元的 Verilog 模型），`-v` 打印关键路径。
- `./test.sh`：单元测试 + 综合全部示例 + yosys `read_json; check -assert` + FPGA 流程 +
  对 `veryl build` 产生的 SystemVerilog 做**形式等价验证**（需要有 slang 前端的 yosys，例如 oss-cad-suite，路径用 `YOSYS_SLANG` 指定）。

## RV32I CPU
`examples/src/rv32i.veryl` 的 `RiscvCore` 是单周期 RV32I（不含 fence/ecall/ebreak/CSR）：
`lui auipc jal jalr`、六种分支、`lb lh lw lbu lhu sb sh sw`、全部 R/I 型运算（含移位、`xor`、`sltu`）。
数据存储器接口以 `o_dmem_wstrb` 表示要写的字节，读取由 CPU 从整个字取出 byte/halfword 并做符号扩展。

测试程序 `examples/sw/rv32i_test.S` 用真正的汇编器产生 ROM（`examples/sw/build.sh` → `examples/src/rv32i_rom.veryl`），
把 41 个结果写进存储器，`TestRiscvCore` 逐字 `$assert`。期望值同时以 RISC-V 官方参考仿真器 **spike** 交叉比对（`build.sh` 自动做）。
通过的地方：spike、官方 `veryl test`、veryl-sim、veryl-eda 综合后的门级 netlist、以及 iCE40 映射后的 netlist（`cargo test`）。

完整（未被常数 ROM 修剪）的 RiscvCore 映射后需要 5401 个 LUT，超过 UP5K 的 5280 LC——主因是用触发器做的 32×32 寄存器堆；
下面的多周期 `RvSoc` 把寄存器堆与存储器放在 block RAM，放得进去而且还很宽裕。

## RISC-V CPU 上 FPGA
`examples/soc.veryl` 的 `RiscvSoc` = `examples/src/rv32i.veryl` 的 `RiscvCore` + 程序 ROM + 16 字数据 RAM + LED 寄存器（地址 0x100）。
程序以 `beq`/`jal` 循环算 Fibonacci(10)，把 55 写到 RAM[0] 与 LED。顶层只有 clock、reset、8 颗 LED。
程序 ROM 是常数，综合时会把这个程序用不到的硬件（未用的寄存器、移位器、byte 加载等）整个消掉，所以比特流只验证了这个程序用到的指令。

    ./fpga/flow.sh          # 综合 → 映射 → nextpnr → icepack → 两种门级仿真
    iceprog fpga/build/soc.bin

| 项目 | 结果（iCE40UP5K-SG48，iCEBreaker 引脚 `examples/icebreaker.pcf`） |
|---|---|
| cells | 1168 SB_LUT4、85 SB_CARRY、232 DFF |
| 布局 | 1279 / 5280 LC（24%） |
| 时序 | 约 17 MHz（板上时钟 12 MHz，通过） |
| 映射后 netlist 仿真（yosys iCE40 cell 模型） | 第 70 个 cycle LED = 55 |
| **布线后比特流**仿真（`icebox_vlog` 转回 Verilog） | 第 70 个 cycle LED = 55 |

## RISC-V SoC 与 C 程序（`examples/src/rvsoc.veryl`、`src/rv/`）
`RvCore` 是**多周期**的 RV32I（Decode → Exec，load 多一个 Mem；一般指令 2 拍、load 3 拍），寄存器堆（两份 `SyncRam` 当两个读取端口）
与存储器都是同步读取的 RAM，所以会变成 `SB_RAM40_4K`。`RvSoc` 加上 8 KB、四个字节通道的存储器（`RvMem`）、存储器映射的周边
（LED 0x1000_0000、按钮 + 开关 0x…04、UART 数据 / 状态 0x…08 / 0x…0C、时钟计数器 0x…10）和给 testbench 用的加载端口；
`RvBoard` 是 iCEBreaker 的顶层（`examples/rvsoc.pcf`）：1844 LUT + 20 个 block RAM，Fmax 13.3 MHz。
`TestRvSoc` 加载 `rv32i_test.S`（数据在 0x300，`examples/sw/build.sh` 产生的 `examples/src/rvsoc_rom.veryl`），运行后检查 41 个结果；
`veryl-eda/examples/rvsoc_small.veryl`（64 字节存储器）由 `test.sh` 证明与 `veryl build` 等价。

**程序放在 block RAM。** 每个存放存储器的 `SB_RAM40_4K` 带有 `MEM_SLOT` = `名称:区块`（JSON 里是 yosys attribute）；
`bram::set_mem_init` 在映射后给存储器初值，`--program PROG.bin` 从地址 0 填入字节通道 `*.b0.mem … *.b3.mem`，
`pnr::patch_ram` 只改写已布局布线的 `.asc` 里那几块的 `.ram_data`：换程序不用重新综合、布局布线
（`cargo test rvsoc_program_on_board`：改写后的比特流等于带着程序布局布线的结果，并在虚拟板上跑完 ISA 测试）。
优化时，从来不写入的存储器（等着被填入的 ROM）会保留，不当成常数 0。

**C 编译器**（`src/rv/`）：`cc.rs` 编译 C 的子集——`char`（无符号）/ `short` / `int` / `unsigned`、指针、任意维数组、
所有 C 操作符、`if` / `while` / `do` / `for` / `switch`、有初值的全局变量、`...` 参数、小型预处理器（有参数的 `#define`、`#ifdef`）——
成 RV32I 汇编语言：单纯的堆栈式代码，加上立即数指令、比较直接分支，并以 C 源代码行当注释。`prelude.c` 是运行时库
（软件乘除法、`putchar` / `getchar` / `printf` / `puts` / `read_line`、`delay_ms` / `millis`、`rand`、`strlen` / `strcmp` / `memcpy` …，
周边寄存器 `LED`、`BUTTONS`、`SWITCHES`、`TIMER`、`UART_DATA`、`UART_STATUS`）；只保留 `main` 用得到的部分。`asm.rs` 是两遍汇编器
（虚拟指令、`%hi` / `%lo`、`.data` / `.rodata` / `.bss`、列表），`iss.rs` 是指令集仿真器，存储器映射与时钟数都和 RvSoc 相同。

    veryl-eda --cc hello.c -o hello.bin -S hello.s --run       # 编译、写出映像文件与汇编语言、在 ISS 上运行
    veryl-eda --top RvBoard --ice40 --pnr veryl --pcf ../examples/rvsoc.pcf --program hello.bin --bin soc.bin ../examples/src/{rv32i,sync_ram,uart,rvsoc}.veryl

测试：`src/rv/tests/*.c` 打印的内容和主机 C 编译器（`cc -funsigned-char -fwrapv`）编出来的完全相同；`cc_on_rvsoc` 把编译好的程序
放进门级 `RvBoard` 的 block RAM，在虚拟板上运行：串口输出与 ISS 相同。虚拟板的 **CPU 模式**（`Board::cpu`）用 ISS 跑程序，
引脚与周边和 RvSoc 一样，约为真实速度的 5 倍；门级的 SoC 约为真实速度的 1%。

## 自研布局布线（`--pnr veryl`，`src/pnr/`）
只针对 iCE40UP5K，架构数据来自 IceStorm 的 `chipdb-5k.txt`（找不到时用 `VERYL_EDA_CHIPDB` 指定）。
| 文件 | 内容 |
|---|---|
| `chipdb.rs` | 读芯片数据库：tile 与设置位表、布线图（10 万条线、120 万个 pip，每个 pip = 目的线输入 mux 的位样式）、引脚、全局缓冲、IE/REN、column buffer |
| `pack.rs` | LUT/进位/触发器 → 逻辑单元（LC）；进位链完整保留：信号当 carry-in 时加 feed-in LC，carry-out 被一般逻辑使用时由下一个 LC 的 LUT 读出 |
| `place.rs` | 模拟退火（线长 HPWL，可依 net 加权）；同一 tile 的触发器必须同 clock / reset / 边缘；进位链放在整列逻辑 tile、从 LC 0 开始 |
| `route.rs` | PathFinder 协商拥塞 + A*；clock 与 reset 走全局网络（来源 → `fabout` → `glb_netwk_N` → 各 tile 的 clk / s_r mux）；时序导向时关键度 c 的 net 每条线的成本 = c × 线延迟 + (1 − c) × 拥塞 |
| `mod.rs` | 产生 `.asc`：LC 位（LUT 位排列、carry、DFF、set/reset）、进位链连接、IO、column buffer、DSP 默认值 |

验证：
- `fpga/cosim.py`：把**我们布好的比特流**用 `icebox_vlog` 转回 Verilog，和映射后的 netlist 用相同随机输入逐 cycle 比对输出；改坏一个 LUT 位会被抓到。
- `fpga/pnr_test.sh`：20 个设计全部 1000 cycle 输出相同，并用 `icetime`（IceStorm 时序分析）量 Fmax。
- 非逻辑 tile（IO 设置、column buffer、DSP/IPCON 默认）与 nextpnr 对同一 pcf 的输出逐位相同。
- `PNR=veryl fpga/flow.sh`：RISC-V SoC 用自研布局布线，布线后比特流仿真 LED = 55。

| 设计 | LC | Fmax（icetime） |
|---|---|---|
| RiscvSoc（自己的 P&R） | 1252 / 5280 | 17.0 MHz（只看线长 15.6 MHz；板上 12 MHz，通过） |
| RiscvSoc（nextpnr） | 1279 / 5280 | 17.3 MHz |

自研布局布线也打印粗估的功耗（`src/pnr/power.rs`：net 电容 ≈ 5 fF × 负载 + 8 fF × 布线段，全局时钟网络每拍，block RAM 每次访问 ≈ 24 pJ，静态 ≈ 75 µA）。

### 时序导向（默认开，`--no-timing-driven` 关闭）
第一轮只看线长；STA 除了前向的到达时间，再做一次反向传递求「每个点之后最长还要多久」，
得到每条 net 的**关键度** = 经过它的最长路径 / 关键路径（0..1）。第二轮：
- 布局成本里 net 的权重 = 1 + 6 × 关键度⁸ / √负载数（只有接近关键的 net 变重；高扇出的 net 不能把整片拉在一起）；
- 布线时关键 net 优先走快的线（见 `route.rs`）。
布不通或没有快 3% 以上（STA 的误差范围）就保留第一轮。ASIC 流程同样做：以第一轮布局为起点低温微调，
小设计（< 4000 单元）另外重新退火一次，只取布得通的最快结果。

| 设计 | FPGA，icetime（只看线长 → 时序导向） | ASIC，自己的 STA |
|---|---|---|
| Ram | 39.0 → 45.0 MHz | 974 → 1006 MHz |
| BramMix | 42.5 → 48.0 MHz | 394 → 410 MHz |
| RiscvSoc | 15.6 → 17.0 MHz | 107 → 115 MHz |
| RiscvCore | （放不下 UP5K） | 71.1 → 75.6 MHz |

## ASIC 后端（`--asic`，`src/asic/`）
教学用的标准单元库 **vlib**（行高 4.0 µm、site 0.5 µm，延迟约 130 nm 慢速角）：
`INV BUF NAND2 NOR2 AND2 OR2 XOR2 XNOR2 AOI21 OAI21 MUX2 TIEL TIEH DFF DFFN DFFR DFFS DFFNR DFFNS`（R/S 引脚低电平有效）。
| 文件 | 内容 |
|---|---|
| `lib.rs` | 单元库：宽度、面积、本征延迟 + 每扇出负载、setup、Verilog 行为模型；**SRAM 宏**（存储器编译器的角色：依字数×字宽算出面积与形状） |
| `map.rs` | 技术映射：在多扇出点把网表切成树，以动态规划做最小面积 **tree covering**（反相器并入 NAND/NOR/XNOR/AOI/OAI）；同步 set/reset 变成 D 前逻辑，异步用 DFFR/DFFS（高电平有效加 INV）；扇出 > 12 的数据线插入 **BUF 树**（clock / 异步 reset 留给时钟树）；同步读取的存储器（与 FPGA 的 block RAM 推断相同条件）变成 **SRAM 宏**，每个读取端口一个 |
| `place.rs` | 依利用率 65% 决定裸片（加上宏面积），SRAM 宏先由左下角起成排固定摆放，IO 引脚放在四周；标准单元依各行空位比例蛇形初始摆放，再以**合法的模拟退火**（移到空位或两单元交换）最小化 HPWL + **密度惩罚**（16 × 16 µm 的格子超过目标密度 = 利用率 + 15% 的部分，每个 site 算 1 µm 线长）。没有密度项时 RiscvSoc 会在引脚旁留下 M2/M3 全满的热点，详细布线剩 1 个冲突；加了之后线长 −5%（160 → 152 mm）、全部设计 0 冲突 |
| `route.rs` | gcell（4 µm）**全局布线**：水平 M2/M4、垂直 M3/M5，每边规划 12 轨（16 轨留 4 轨给引脚与 via）；端点依 Prim 顺序以 A* 连到已建好的树（宏以其边上的引脚为端点），PathFinder（现况 + 历史成本）消除溢出 |
| `pdn.rs` | **电源网络与填充单元**：每条行边界一条 M1 电源轨（VSS / VDD 交替，配合行的翻转），M5 垂直电源带每 40 µm 一对（VDD、VSS 各 2 轨宽，避开 IO 引脚），via 叠（M1→M5）接到同名的轨；详细布线把带子与 via 叠当障碍物；空位填满 FILL8/4/2/1；DEF 输出 `SPECIALNETS` 与填充单元 |
| `power.rs` | **功耗与 IR drop**：用随机输入仿真最后的网表（`src/power.rs`，reset 极性由试跑决定）得到每条 net 的翻转率；切换能量 ½·C·V²（C = 负载引脚 + 0.2 fF/µm 实际线长），时钟树每拍充放电，单元内部能量与漏电依大小，SRAM 每次访问；在 Fmax 下换算 mW。IR drop：每个单元的平均电流经所在行的 VDD / VSS 轨，两条电源带之间的轨当成两端供电的电阻线 |
| `detail.rs` | **详细布线**：0.5 µm 轨道格点 × 4 层（M2/M4 水平、M3/M5 垂直），每个格点只属于一条 net（不会短路）；每条 net 只在全局布线的 gcell 走廊（外加一圈）里以 A* 找路，换层算 via 成本，重叠以 PathFinder 协商、卡住的 net 走廊加宽；单元引脚从 M1 经 via 上来，SRAM 宏上方挡 M2/M3，IO 引脚在 M5；输出每层线段与 via（DEF `NETS`），详细线长反馈给 STA |
| `cts.rs` | **时钟树综合**（布局之后）：clock 与异步 reset 的负载依位置递归对半切（沿较长方向取中位数，H-tree 式平衡二元树），每群 ≤ 16 个负载一个 CLKBUF，缓冲器放在所驱动者重心的最近空位；另有 hold 修正（在违规的 D 前插延迟 BUF） |
| `sta.rs` | 静态时序：单元延迟 = 本征 + 负载 × 扇出；线延迟 = 驱动整条布线 + 到该负载的分布 RC；CTS 之后时钟是 propagated：每个触发器有自己的时钟到达时间，setup 以发送端 / 接收端时钟计算，再用最短路径做 **hold 检查**（IO 视为同步于平均延迟的虚拟时钟）；另算每条 net 的关键度（给时序导向布局） |
| `mod.rs` | `flow()` 串起来；`def()` 输出 DEF 布局 |

流程：映射 → 布局（线长；全局布线的试布若溢出或平均需求 > 50% 就放大裸片、利用率 ×0.8 重来）→ 时序导向布局 → CTS → 全局布线 → STA（propagated clock、hold）→ 有 hold 违规就插延迟 BUF、重新布线、重算 → 电源网络与填充单元 → 详细布线 → 以详细线长做最后的 STA。
RiscvCore（寄存器堆是 1056 个 DFF 加 5000 个 MUX2 的读取交叉开关）在 65% 时布不通，自动降到 42%：详细布线 0 冲突、0 未接通，80 MHz。
例：RiscvSoc 的 i_clk 有 232 个负载 → 31 个 CLKBUF、5 级，插入延迟 0.74 ns、skew 104 ps；RiscvCore 1056 个负载 → 194 个 CLKBUF、8 级、skew 170 ps。

| 设计 | 标准单元 | 面积 | 裸片 | 线长 | Fmax |
|---|---|---|---|---|---|
| RiscvSoc | 2553 | 31360 µm² | 220 × 220 µm | 117 mm | 109 MHz |
| RiscvCore（整颗 RV32I，寄存器堆 1024 个 DFF） | 9795 | 0.132 mm² | 449 × 452 µm | 1088 mm | 67.5 MHz |

验证：`cargo test` 在标准单元 netlist 上也跑每个示例的 testbench（含 RV32I 测试程序），并检查布局合法、每条 net 布成连通的树、没有溢出，
详细布线只看线段与 via 重新检查：没有格点同属两条 net、每条 net 连通且接到所有引脚、信号线不碰电源带与 via 叠，
单元加填充单元恰好铺满每个 site；
`./test.sh` 用 yosys 对 `veryl build` 的输出做标准单元 netlist 的形式等价验证。

## 虚拟开发板（`src/board/`）
网页 IDE 的虚拟 iCEBreaker：iCE40 映射后网表的快速逐周期仿真器，接到板子的引脚
（`board/icebreaker.rs`：引脚 35 的 12 MHz 时钟、BTN_N、红绿 LED、扩展板的 LED1–5 与 BTN1–3、PMOD1A/1B、FTDI 串口；引脚来自设计的 pcf，没有的话用教学的）。
引擎跑在通用的 `Design` 上（4 输入真值表——进位是 3 输入多数表决——触发器、block RAM、具名 IO），采**活动驱动**：
某条 net 改变时只把它驱动的真值表排入队列，依层级顺序求值（不会有毛刺）；任何时钟 net 上的边缘都会被检测，所以分频时钟与下降沿都能用。
`cargo test` 在 15 个设计上用每拍随机输入和 netsim 比对。
**比特流解码**（`board/bitstream.rs`，M13）：把 `.bin`（`pnr::bitstream::bin_to_asc`，自制 icepack 的反向）或 `.asc` 解回 `Design`：激活的 pip（mux 的位等于某个 pip 的样式）以 union-find 并成 net；逻辑单元（LUT 位还原排列、进位、触发器与 tile 的时钟 / 使能 / set-reset 和 `NegClk`）、IO（`PINTYPE`）、全局网络（`fabout`，或经 `padin_glb_netwk` 额外位直接由引脚驱动）与 block RAM（`CBIT` 模式、`.ram_data`）成为驱动者。周边（`board/periph.rs`，M14）在仿真循环里每个时钟采样：FTDI 串口双向（每位时钟数可以是小数）、动态扫描的七段显示器（每一位、每一段亮的时间）、VGA 屏幕（每个 HSYNC 一行、每个 VSYNC 一张画面，以游程编码传出）与每支引脚的变化次数（蜂鸣器的音高）。
测试：`bin → asc → bin` 不变；11 个设计（自己的 P&R）与 3 个设计（nextpnr，有安装时）解码后的比特流都与网表逐周期一致。速度（单核）：Blinky 每秒 680 万周期（12 MHz 的 57%），RiscvSoc 每秒 150 万周期；WebAssembly 约为其 75%。

## 流程
| 文件 | 内容 |
|---|---|
| `value.rs`   | 常数值 |
| `expr.rs`    | 表达式 IR（以名称表示信号）+ 优先级解析器，struct 字段直接转成常数 slice |
| `elab.rs`    | 遍历语法树 → 名称式语句 IR → **符号执行**成门：if 变 mux 链、常数标签的 case 变并行 one-hot、for 展开、function inline、always_ff 对应 DFF/reset、层次摊平 |
| `netlist.rs` | 位级 Builder（常数折叠、structural hashing、`x & !x` 等化简、平衡的化简树）、加减乘/比较/桶形移位/动态索引；`optimize` 解析别名、检测组合环路、重建、清除无用逻辑，并反复做：**证明常数节点**（随机仿真找候选、对 ≤16 个输入的支撑集穷举证明）与**移除卡在 0 的寄存器** |
| `ice40.rs`   | iCE40 映射：全加器进位 → `SB_CARRY` 链；其余以 cut-based 4-LUT 覆盖（深度优先、再看 area flow）；DFF → `SB_DFF[N][S]{R,S}`，低有效 reset 加反相 LUT |
| `output.rs`  | yosys JSON、结构化 Verilog（含 iCE40 primitive 实例） |
| `netsim.rs`  | 2 态门级仿真器（给测试用，支持通用门与 iCE40 cell） |

每个声明的信号一开始就配置「占位」wire，驱动者以别名 (占位 bit → 驱动 bit) 记录，最后在 `optimize` 统一解析；
因此 module 内各项目的顺序不影响结果，子模块的 port 连接也只是别名。
与 veryl-sim 的 elab 需求根本不同（符号执行 vs. 仿真 IR），所以两者不共用 elab 代码。

寄存器初值视为 0（iCE40 上电即为 0）：例如程序 ROM 为常数时，CPU 从未写入的寄存器（x6..x31）与其读取多路选择器会被整个消掉。

## 输出的 cell
- 通用（`-o`）：`$_NOT_ $_AND_ $_OR_ $_XOR_ $_MUX_`（Y = S ? B : A）、`$_DFF_P_ / $_DFF_N_`、
  异步 reset `$_DFF_{P,N}{P,N}{0,1}_`、同步 reset `$_SDFF_{P,N}{P,N}{0,1}_`。
- iCE40（`--ice40`）：`SB_LUT4`、`SB_CARRY`、`SB_DFF`、`SB_DFFN`、`SB_DFF[N]{R,S}`、`SB_DFF[N]S{R,S}`、`SB_RAM40_4K`。

## Block RAM 推断（iCE40，`src/bram.rs`）
数组若只在**一个** always_ff 中以整个元素写入（每拍最多一次）、只以整个元素读取，elab 会把它记成存储器
（写入端口 we / waddr / wdata、各读取端口的地址与数据，存成具名 net `$mem:名称:...`，其余照常展开成 DFF）。
映射 iCE40 时，若每个读取端口是**同步读取**（读出的数据直接进同一时钟的寄存器，可带使能）就换成 `SB_RAM40_4K`：
元素 DFF、读取寄存器与地址解码 / 读取多路选择器都消失。模式 256×16、512×8、1024×4、2048×2，字宽超过一块就并排多块，
每个读取端口一份拷贝。异步读取（例如 RV32I 寄存器堆、`Ram`）保留为逻辑，因为 block RAM 只有暂存式读取端口。

| 设计 | 不用 BRAM | 用 BRAM |
|---|---|---|
| SyncRam 512×8（`examples/src/sync_ram.veryl`） | 12832 个 cell | 1 个 `SB_RAM40_4K` |
| BramMix（256×32、两个读取端口 + 逻辑） | 29059 个 cell，放不进 UP5K | 4 个 BRAM + 86 LC，自己的 P&R 49 MHz（icetime 46 MHz） |

自研布局布线支持 BRAM：30 个 RAM 位置一起退火、RAM 引脚布线（时钟走全局网络）、`RamConfig` 位与 `.ram_data`、STA（RCLK→RDATA 与各输入 setup）。
验证：netsim 依 yosys `cells_sim.v` 仿真 `SB_RAM40_4K`（各模式的随机读写测试）；`fpga/pnr_test.sh` 对布好的比特流做共仿真；
`test.sh` 用 yosys 的 `SB_RAM40_4K` 模型对 `veryl build` 做 iCE40 netlist 的形式等价（BMC）。

## 支持
module / 参数（`#(param ..)`、`const`、inst 参数覆写）/ port / `var` / `let` / `assign` / `always_comb` /
`always_ff`（posedge/negedge、`if_reset` 同步/异步、高/低有效）/ `if` / `case`（含范围）/ `switch` / `for`（常数范围，展开，含 `rev`）/
`inst` 层次（摊平，名称如 `u_rf.rf`）/ package（enum、struct、const）/ `import` / struct 字段 / 一维数组（变量索引读写 → mux/译码器）/
用户 function（inline，可嵌套、`return` 可在分支中）/ generate for、generate if /
操作符：`+ - *`、位/逻辑/化简、比较（`$signed` 时为有符号）、`<< >> >>>`（常数或变量）、串接与 `repeat`、三元运算、
`$signed $unsigned $clog2 $bits`；`/ %`（非常数时为还原式除法器，有符号依 SystemVerilog 向零截断）；`**` 仅限常数。
interface 与 modport（成员摊平成 `inst.member` 信号，modport 端口变成 `port.member` 端口）、generate for 的 `rev` / `step`、
任意宽度（常数最多 256 bit）、时钟域注记。`initial`/`final` 与 `$display` 类调用会被忽略。

## 尚未支持
泛型 interface 端口、`inout`、递归、latch（不完整赋值的 always_comb 会报组合环路）、
宽度 > 256 bit 的常数、异步读取的存储器放进 BRAM、SPRAM（`SB_SPRAM256KA`）、PLL；
（netsim 用 `tick(clk)` 仿真多个时钟域与下降沿触发器，`step()` 则是所有触发器同时一拍）
自研布局布线：只支持 UP5K、没有 LUT 输入引脚交换。

## 验证结果（`./test.sh`）
| 设计 | 对 `veryl build` 的等价验证 |
|---|---|
| Adder / Max3 / AluUnit / BitRev / GrayConv / rv32i Alu / ProgRom | SAT 完整证明 |
| Seq101 / PktReg | k-induction 证明 |
| Ram / RegFile / RiscvCore | 有界模型检查 8 / 2 / 2 cycles |
| RiscvSoc | 有界模型检查 80 cycles（整个程序跑完） |
| RiscvTestRom（rv32i 测试程序 ROM） | SAT 完整证明 |
| `examples/features.veryl`：Shifter / Funcs / Ranges / Counter / Top | SAT / SAT / SAT / k-induction / BMC 20 |
| Div / Wide（`examples/lang.veryl`） | SAT 完整证明 |
| HsTop（interface 交握） | 有界模型检查 24 cycles |
| SyncRam / Bram2048x2 / BramMix / Fifo（block RAM） | 有界模型检查 4 / 4 / 12 / 6 cycles |
| UartLoop / VgaTiming | 有界模型检查 24 / 8 cycles |

上表每个设计都验证两次：门级 netlist（`gate`）与 vlib 标准单元 netlist（`asic`）；有 block RAM 的设计再验证 iCE40 netlist（`fpga`，用 yosys 的 `SB_RAM40_4K` 模型）。
另外 `cargo test` 在门级 netlist、iCE40 映射后与标准单元映射后的 netlist 上都跑各示例的 testbench 情境（RiscvCore 跑完整的 RV32I 测试程序并比对 41 个结果、ALU 每种运算对 Rust 参考值、RiscvSoc 在 LED 显示 55）。
