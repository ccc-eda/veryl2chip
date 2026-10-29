# 16. 示例总表

这一章列出所有示例：做什么、用到哪些文件、命令行怎么跑、网页 IDE 怎么开。

- **IDE**：表格里的示例 ID 都是链接，点了就在在线 IDE 开成一个新项目
  （`https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=ID`；本机用 `web/dist/index.html#ex=ID`）。
  网址后面加 `&board=1` 直接烧进虚拟板，`&run=1` 跑测试，其他参数见第 11 章〈网址参数〉。
  IDE 第一次打开时的欢迎页有四个起点（学 Veryl、做电路放上开发板、开一台电脑写程序、看电路变成芯片），示例库上方可以筛选成其中一类；
  侧栏示例旁的 🧪 ⚡ 🖥 是它能做的事，框起来的是建议的第一步；打开后标题列的主按钮（蓝色）与编辑器上方的「建议步骤」也是，主按钮旁的 ▾ 列出其他做法。
- **命令行**：在项目根目录下打，`v2c` 的安装见第 2 章。一个示例要好几个文件时，要全部列出来。

## 共通的跑法

每个 Veryl 示例都有 `#[test]` 测试模块（`Test…`、`tb_…`），所以同一组指令可以用在任何示例上：

| 想做的事 | 指令 | 章 |
|---|---|---|
| 看有哪些模块 | `v2c list FILE.veryl` | 5 |
| 跑测试（RTL 仿真） | `v2c sim FILE.veryl`（全部的 `#[test]`；`--top TestX` 只跑一个；`--vcd w.vcd` 写波形） | 5 |
| 综合看统计 | `v2c synth --top MODULE FILE.veryl` | 6 |
| 综合后再跑一次测试 | `v2c gatesim ice40 FILE.veryl`（或 `opt`、`ecp5`、`asic`、`sky130`） | 8 |
| FPGA 比特流 | `v2c fpga --pnr veryl --pcf PINS.pcf --bin out.bin FILE.veryl`，再 `iceprog out.bin` 烧进 iCEBreaker | 7 |
| ASIC 版图 | `v2c asic --pdk sky130 --gds out.gds FILE.veryl` | 9 |

`v2c synth` / `fpga` / `asic` 不指定 `--top` 时用最后一个不是测试的模块，下面表格的「顶层」栏就是 IDE 默认综合的那一个。
表格里有 `.pcf` 的示例才有引脚，可以做成 FPGA 比特流、放上虚拟板。

## 教学与实验课

给第一次写硬件的人，讲义是 [`tutorial/README.tw.md`](../tutorial/README.tw.md)（教学）与
[`tutorial/labs.tw.md`](../tutorial/labs.tw.md)（虚拟实验课）。引脚都是 iCEBreaker 板上的 LED / 按钮或 PMOD 模块。

| ID | 做什么 | 文件（顶层） | 命令行 |
|---|---|---|---|
| [tut_blinky](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=tut_blinky&board=1) | 第 1 课：计数器让 LED 闪烁 | `tutorial/src/blinky.veryl`（`Blinky`）、`tutorial/icebreaker.pcf` | `v2c sim tutorial/src/blinky.veryl`<br>`v2c fpga --pnr veryl --pcf tutorial/icebreaker.pcf --bin blinky.bin tutorial/src/blinky.veryl` |
| [tut_knight](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=tut_knight&board=1) | 第 2 课：跑马灯；分频 tick、按钮同步器，按住 BTN1 暂停 | `tutorial/src/knight.veryl`（`KnightRider`）、`tutorial/icebreaker.pcf` | 同上，换文件名 |
| [tut_uart](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=tut_uart&board=1) | 第 3 课：USB 串口（115200 鲍）先说 Hi!，收到的字大小写互换送回 | `tutorial/src/uart.veryl`（`UartEcho`）、`tutorial/icebreaker.pcf` | 同上，换文件名 |
| [lab_gates](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=lab_gates&board=1) | 面包板：两个开关 → AND、OR、XOR、NOT 四颗 LED（电阻、接线都画好了） | `examples/src/gates.veryl`（`Gates`）、`examples/gates.pcf` | `v2c sim examples/src/gates.veryl`<br>`v2c fpga --pnr veryl --pcf examples/gates.pcf --bin gates.bin examples/src/gates.veryl` |
| [lab_counter](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=lab_counter&board=1) | BTN1 每按一下加一（同步器 + 上升缘），8 位显示在 PMOD1A 的 LED；BTN2 归零 | `examples/src/button_counter.veryl`（`ButtonCounter`）、`examples/button_counter.pcf` | 同上，换文件名 |
| [lab_traffic](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=lab_traffic&board=1) | 红绿灯状态机：绿 5 秒 → 黄 1 秒 → 红 4 秒，绿灯时按 BTN1 提早结束；LED 在面包板上 | `examples/src/traffic.veryl`（`TrafficLight`）、`examples/traffic.pcf` | 同上，换文件名 |

`tutorial/check.sh` 一次跑完教学的整条流程（仿真、综合、FPGA）。

## 基础（组合逻辑与语法）

| ID | 做什么 | 文件（顶层） | 命令行 |
|---|---|---|---|
| [adder](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=adder) | 加法器（最小的例子） | `examples/src/adder.veryl`（`Adder`） | `v2c sim examples/src/adder.veryl` |
| [max3](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=max3) | 三个数取最大，示范 `function` | `examples/src/max3.veryl`（`Max3`） | `v2c sim examples/src/max3.veryl` |
| [alu_pkg](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=alu_pkg) | ALU，运算码放在 `package` 的 `enum` | `examples/src/alu_pkg.veryl`（`AluUnit`） | `v2c sim examples/src/alu_pkg.veryl` |
| [gen_rev](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=gen_rev) | 位反转与格雷码，示范 generate `for` | `examples/src/gen_rev.veryl`（`GrayConv`；另有 `BitRev`） | `v2c sim examples/src/gen_rev.veryl` |
| [alu_fail](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=alu_fail&run=1) | 一个故意失败的断言：看测试失败长什么样子（结束码 1） | `veryl-sim/examples/alu.veryl`（`Alu`） | `v2c sim veryl-sim/examples/alu.veryl` |

## 时序电路与存储器

| ID | 做什么 | 文件（顶层） | 命令行 |
|---|---|---|---|
| [counter](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=counter) | 计数器，veryl-sim 自己的测试示例 | `veryl-sim/examples/counter.veryl`（`Counter`） | `v2c sim veryl-sim/examples/counter.veryl` |
| [seq101](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=seq101) | 检测输入序列 101 的状态机 | `examples/src/seq101.veryl`（`Seq101`） | `v2c sim examples/src/seq101.veryl` |
| [pkt_reg](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=pkt_reg) | 以 `struct` 为单位的寄存器（第一个字段在最高位） | `examples/src/pkt_reg.veryl`（`PktReg`） | `v2c sim examples/src/pkt_reg.veryl` |
| [ram](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=ram) | 16 × 8 的 RAM，异步读取（留在逻辑里） | `examples/src/ram.veryl`（`Ram`） | `v2c sim examples/src/ram.veryl` |
| [sync_ram](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=sync_ram) | 同步读取的 RAM：综合成 block RAM（iCE40 `SB_RAM40_4K`） | `examples/src/sync_ram.veryl`（`SyncRam`） | `v2c sim examples/src/sync_ram.veryl` |
| [fifo](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=fifo) | 256 × 8 FIFO，存储器是一块 block RAM / ASIC 的一个 SRAM 宏 | `examples/src/fifo.veryl`（`Fifo`） | `v2c sim examples/src/fifo.veryl`<br>`v2c asic --pdk sky130 examples/src/fifo.veryl` |
| [sevenseg](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=sevenseg&board=1) | 七段显示器 00–99 计数，两位数动态扫描；BTN1 归零 | `examples/src/sevenseg.veryl`（`SevenSeg`）、`examples/sevenseg.pcf` | `v2c sim examples/src/sevenseg.veryl`<br>`v2c fpga --pnr veryl --pcf examples/sevenseg.pcf --bin seg.bin examples/src/sevenseg.veryl` |

## 周边

| ID | 做什么 | 文件（顶层） | 命令行 |
|---|---|---|---|
| [uart](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=uart) | UART 发送器 → 接收器回路（8N1，每位 8 个时钟） | `examples/src/uart.veryl`（`UartLoop`；另有 `UartTx`、`UartRx`） | `v2c sim examples/src/uart.veryl` |
| [vga](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=vga&board=1) | VGA 640 × 480 时序与色条；测试用缩小的画面，虚拟板接 PMOD 的 VGA 屏幕 | `examples/src/vga.veryl`（`VgaDemo`）、`examples/vga.pcf` | `v2c sim examples/src/vga.veryl`<br>`v2c fpga --pnr veryl --pcf examples/vga.pcf --bin vga.bin examples/src/vga.veryl` |

## 综合测试设计

veryl-eda 自己的综合测试用的设计，也是看综合结果的好例子。

| ID | 做什么 | 文件（顶层） | 命令行 |
|---|---|---|---|
| [features](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=features) | 移位器、函数、位范围、计数器 | `veryl-eda/examples/features.veryl`（`Top`） | `v2c sim veryl-eda/examples/features.veryl` |
| [bram](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=bram) | 四种形状的 block RAM 加上逻辑 | `examples/src/sync_ram.veryl` + `veryl-eda/examples/bram_tests.veryl`（`BramMix`） | `v2c sim --top TestBramMix examples/src/sync_ram.veryl veryl-eda/examples/bram_tests.veryl` |
| [lang](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=lang) | 除法、`interface` 握手、200 位的值、两个时钟 | `veryl-eda/examples/lang.veryl`（`HsTop`） | `v2c sim veryl-eda/examples/lang.veryl` |
| [acc](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=acc) | 32 位累加器：看 FPGA 的进位链（`SB_CARRY`） | `veryl-eda/examples/pnr_tests.veryl`（`AccTest`） | `v2c sim veryl-eda/examples/pnr_tests.veryl` |

## RISC-V 处理器（Veryl）

| ID | 做什么 | 文件（顶层） | 命令行 |
|---|---|---|---|
| [rv32i](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=rv32i) | 单周期 RV32I CPU；测试跑 `examples/sw/rv32i_test.S`，41 个结果和 spike 交叉比对过 | `examples/src/rv32i.veryl` + `rv32i_rom.veryl`（`RiscvCore`） | `v2c sim examples/src/rv32i.veryl examples/src/rv32i_rom.veryl` |
| [soc](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=soc&board=1) | 上面的 CPU 加 ROM / RAM 做成 SoC：算 Fibonacci(10) = 55 显示在 LED | `examples/src/rv32i.veryl` + `rv32i_rom.veryl` + `veryl-eda/examples/soc.veryl`（`RiscvSoc`）、`veryl-eda/examples/icebreaker.pcf` | `v2c sim --top TestRiscvSoc examples/src/rv32i.veryl examples/src/rv32i_rom.veryl veryl-eda/examples/soc.veryl`<br>`veryl-eda/fpga/flow.sh`（比特流 + 布线后仿真） |
| [rv64_linux](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=rv64_linux) | RV64 开发板（像树莓派）：Linux、MicroPython、C、GPIO、屏幕。见下面〈RV64 开发板〉；另外 6 个开发板示例也在那里 | `examples/rv64/src/`（`Rv64Soc`）、`examples/rv64/board/` | 见下面 |

多周期 RV32IMA 的 SoC（`examples/src/rvsoc.veryl`，`RvBoard`）在下一节和 C 程序一起用。改了 `examples/sw/*.S` 之后要跑
`examples/sw/build.sh`（需要 riscv64-unknown-elf 工具链与 spike）重新产生 ROM。

## C 程序在自己做的 RISC-V SoC 上（`examples/c/`）

硬件都是 `examples/src/rvsoc.veryl` 的 `RvBoard`（RV32IMA + Zicsr，12 MHz，UART、LED、按钮、PMOD），C 程序用 veryl-eda 的
C 编译器编译（第 10 章）。IDE 里 ⚡ 虚拟板默认用 **CPU 模式**（指令集仿真器即时运行），也可以切到「比特流」模式跑真正综合出来的电路。

| ID | 做什么 | 文件 |
|---|---|---|
| [c_hello](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=c_hello&board=1) | 在 USB 终端机打招呼、LED 计数、把收到的字转成大写送回 | `examples/c/hello.c` |
| [c_knight](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=c_knight&board=1) | 软件跑马灯，BTN1 加快、BTN2 变慢（在 C 里检测上升缘） | `examples/c/knight.c` |
| [c_guess](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=c_guess&board=1) | 终端机猜数字游戏（`read_line`、`atoi`） | `examples/c/guess.c` |
| [c_sevenseg](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=c_sevenseg&board=1) | 七段显示器 00–99，软件动态扫描；BTN1 归零 | `examples/c/sevenseg.c` |
| [c_music](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=c_music&board=1) | 蜂鸣器播放〈小星星〉 | `examples/c/music.c` |
| [c_switches](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=c_switches&board=1) | PMOD1B 的 8 个开关显示在 PMOD1A 的 LED，终端机打印二进位 / 十六进位 | `examples/c/switches.c` |
| [c_threads](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=c_threads&board=1) | 抢占式多线程小内核：计时器中断每 10 ms 切换、`ecall` 做 yield / sleep、`amoswap` 互斥锁 | `examples/c/threads.c` |
| [c_vga](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=c_vga&board=1) | VGA 文本模式（40 × 30 字符）：开机时间、按钮、终端机打的字。硬件是 `RvVgaBoard`（`examples/src/rvvga.veryl`、`examples/rvvga.pcf`） | `examples/c/vga.c` |

命令行：

```sh
v2c cc --run examples/c/hello.c                  # 在指令集模擬器上跑，UART 輸出印在終端機
v2c cc -o hello.bin examples/c/hello.c           # 編成映像檔
v2c fpga --top RvBoard --pnr veryl --pcf examples/rvsoc.pcf --program hello.bin --bin soc.bin \
  examples/src/rvsoc.veryl examples/src/rv32i.veryl examples/src/sync_ram.veryl examples/src/uart.veryl
iceprog soc.bin                                  # 燒進 iCEBreaker
```

`c_vga` 的比特流用 `--top RvVgaBoard --pcf examples/rvvga.pcf`，文件再加上 `examples/src/rvvga.veryl examples/src/vga.veryl`。
SoC 本身的 RTL 测试：

```sh
cd examples/src
v2c sim --top TestRvSoc rvsoc.veryl rv32i.veryl sync_ram.veryl uart.veryl rvsoc_rom.veryl rv32i_rom.veryl
v2c sim --top TestVgaText rvsoc.veryl rv32i.veryl sync_ram.veryl uart.veryl rvsoc_rom.veryl rv32i_rom.veryl rvvga.veryl vga.veryl
```

## RV64 开发板（`examples/rv64/`）

`Rv64Soc`：RV64IMAC 的 `Rv64Core`、256 MB RAM、UART、16 支 GPIO（ACT / USER LED 是 GPIO 0、1，按钮是 GPIO 2，排针与面包板上是
GPIO 3–15，和树莓派一样的 BCM 编号）、320 × 240 屏幕。开的是 OpenSBI + Linux 6.12 + busybox，里面有 MicroPython。

**IDE**：开 [rv64_linux](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=rv64_linux)，按 🖥 仿真机开机（或从标题列的目标菜单选
riscv-emu / veryl-emu，第 15 章）。打开下面任何一个文件按「▶ 运行」（Ctrl+Enter）：项目的文件送进板子的 `/root` 再运行它；
`.c` 会先在浏览器里编译。在板子的 shell 打 `savefiles` 把 `/root` 送回项目。

| 文件 | 做什么 | 在板子上的指令 |
|---|---|---|
| `main.py` | 面包板 GPIO 5 的红灯与 USER 灯轮流亮 | `micropython main.py` |
| `button.py` | 数按钮（GPIO 2）按了几次，GPIO 5 的 LED 显示最低位 | `micropython button.py` |
| `traffic.py` | 面包板上的红绿灯（GPIO 5 / 12 / 13）；GPIO 6 的按钮让绿灯提早结束 | `micropython traffic.py` |
| `clock.py` | 屏幕上的指针时钟（开机后的时间） | `micropython clock.py` |
| `blink.c` | 同 `main.py`，用 C | `./blink` |
| `count.c` | 同 `button.py`，用 C | `./count` |
| `lights.c` | 同 `traffic.py`，用 C | `./lights` |
| `shapes.c` | 屏幕上画色条、图形、文本、一颗弹跳的球 | `./shapes` |
| `blink.sh` | 用 `/sys/class/gpio` 闪 GPIO 5 的 LED 五次 | `sh blink.sh` |
| `button.sh` | 数按钮次数，USER 灯显示最低位 | `sh button.sh` |

### 开发板的其他示例（v2.29）

同一块板子、同一份开机快照，各自带自己的程序（`examples/rv64/apps/`）与接好的面包板。打开后按主按钮「🖥 仿真机」开机，
打开程序档按「▶ 运行」。

| ID | 做什么 | 文件 | 在板子上的指令 |
|---|---|---|---|
| [pi_chaser](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=pi_chaser) | 8 颗 LED 跑马灯（GPIO 3、4、5、7–11）；GPIO 6 的按钮换速度、GPIO 13 换方向 | `chaser.py`、`chaser.c`（同一个程序两种语言） | `micropython chaser.py`、`./chaser` |
| [pi_reaction](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=pi_reaction) | 反应时间游戏：绿灯亮就按按钮，量毫秒；最佳成绩存在 `best.txt`，`savefiles` 送回项目 | `reaction.py` | `micropython reaction.py` |
| [pi_breathe](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=pi_breathe) | 呼吸灯：软件 PWM，工作周期决定亮度，三颗 LED 轮流变亮变暗 | `breathe.c` | `./breathe` |
| [pi_snake](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=pi_snake) | 贪食蛇：屏幕游戏，两个按钮左转 / 右转（点一下屏幕后也可以用 ← →，空白键开始） | `snake.c` | `./snake` |
| [pi_tetris](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=pi_tetris) | 俄罗斯方块（v2.32）：四个按钮左移、右移、旋转、加速落下；点一下屏幕后也可以用 ← → ↑ ↓，空白键开始 | `tetris.c` | `./tetris` |
| [pi_sysmon](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=pi_sysmon) | 系统监视器：读 `/proc`，屏幕上显示 CPU（含历史图）、存储器、负载、开机时间、行程数 | `sysmon.py` | `micropython sysmon.py` |
| [pi_linux](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=pi_linux) | Linux 指令入门：文件、文本处理、管线、背景行程、`/proc`；照 `exercises.txt` 练习 | `exercises.txt`、`hello.sh`、`count.sh`、`fruits.txt` | `sh hello.sh`、`cat exercises.txt` |

命令行一样用 `linux/mkarea.py` 打包，例如 `python3 linux/mkarea.py -o area.img apps/chaser/chaser.py`（面包板只在 IDE 里）。

Ctrl-C 停止程序；打 `micropython` 进 REPL。MicroPython 的 `pi` 模块有 `LED`、`Button`、`Pin`、`Screen`，
C 的函数库有 `gpio_write`、`gpio_read`、`delay_ms`、`fb_*`（第 10、11 章）。

**命令行**（在 `examples/rv64` 下；映像档由 `linux/build.sh` 产生，仿真器 `rvemu` 由 `riscv-emu` 的 `cargo build --release` 产生）。
`linux/mkarea.py` 把文件打包成交换区，开机时 `/init` 会把它们放进 `/root`：

```sh
v2c cc --linux -o blink board/blink.c
python3 linux/mkarea.py -o area.img board/*.py board/*.sh blink
../../riscv-emu/target/release/rvemu -l 0x8F000000:area.img linux/build/opensbi/platform/generic/firmware/fw_payload.bin
```

开到 `rv64:~$` 约 1.5 秒，然后就像上面的表格直接打指令（GPIO 的变化印成 `[gpio] out=…`）。
把 `rvemu` 换成 `emu/rv64emu`（veryl-emu）或 `sim/obj/rv64sim`（Verilator）就是在 Veryl 写的硬件上跑同样的东西，慢几十倍。

`examples/rv64` 还有不在 IDE 里的测试与大程序，说明在 [`examples/rv64/README.md`](../examples/rv64/README.md)：

| 指令 | 做什么 |
|---|---|
| `sim/riscv_tests.sh` | 官方 riscv-tests（196 支） |
| `verify/random.sh 1 30` | 随机程序，和 spike 逐指令比对 |
| `linux/test.sh` | 开 Linux、打几个指令（GPIO、文件、MicroPython、C、屏幕）、关机 |
| `xv6/test.sh` | 开 xv6（MIT 的教学操作系统）；`xv6/test.sh usertests` 跑它全部的测试 |
| `sim/build_fpga.sh`、`fpga/ecp5.sh` | `Rv64Fpga`：放进 ECP5 FPGA（ULX3S）的版本 |

这些指令前面加 `SIM=../../riscv-emu/target/release/rvemu` 或 `SIM=emu/rv64emu` 就换成另一个仿真器。
