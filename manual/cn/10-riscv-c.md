# 10. RISC-V 与 C：`v2c cc`

这个项目用 Veryl 写了一颗 RISC-V CPU，也附了一个能把 C 编成它的机器码的编译器。
所以可以「自己设计 CPU，再在上面跑自己写的 C 程序」——在虚拟开发板上，或烧进真的 iCEBreaker。

## 硬件：`examples/src/rvsoc.veryl`

| 模块 | 内容 |
|---|---|
| `RvCore` | 多周期 **RV32IMA + Zicsr**：一般指令 2 拍、load 3 拍、乘除法 35 拍；machine mode 的中断与例外（计时器、软件、外部 = 串口收到字节；ecall、ebreak、非法指令、地址没对齐）、`mret`、`wfi`；寄存器堆放在 block RAM |
| `RvSoc` | CPU + 8 KB 存储器（block RAM）+ 存储器映射的周边 + 给 testbench 用的加载端口 |
| `RvBoard` | iCEBreaker 的顶层（引脚 `examples/rvsoc.pcf`）：BTN1–3、PMOD1A 的 8 个输出（LED 模块…）、PMOD1B 的 8 个开关、USB 串口 |
| `RvVgaBoard`（`examples/src/rvvga.veryl`） | 再加上 40 × 30 字符的 VGA 文本画面 |

另外 `examples/src/rv32i.veryl` 是单周期的 RV32I（`RiscvCore`），比较好读，适合教学。

### 存储器映射

| 地址 | 名称（C 里的宏） | 说明 |
|---|---|---|
| `0x0000_0000` | — | 8 KB RAM：程序与数据，堆栈从顶端往下长 |
| `0x1000_0000` | `LED` | 8 个输出（读写） |
| `0x1000_0004` | `BUTTONS`、`SWITCHES` | bit 2..0 = BTN3..BTN1（1 = 按下），bit 15..8 = 8 个开关 |
| `0x1000_0008` | `UART_DATA` | 写：送出一个字节；读：收到的字节 |
| `0x1000_000C` | `UART_STATUS` | bit 0 = 发送中，bit 1 = 收到一个字节 |
| `0x1000_0010` | `TIMER`、`MTIME` | 开机后经过的时钟数（12 MHz） |
| `0x1000_0018` | `MTIMECMP` | `MTIME ≥ MTIMECMP` 时计时器中断 |
| `0x1000_0020` | `MSIP` | 1 = 软件中断 |
| `0x1000_2000` 起 | `VGA_TEXT`、`VGA_FONT`、`VGA_COLOR` | VGA 文本模式（只有 `RvVgaBoard`） |

## 编译与运行

```
v2c cc PROG.c [-o PROG.bin] [-S PROG.s] [-L PROG.lst] [--run [N]] [--mem BYTES]
```

```sh
$ v2c cc --run examples/c/hello.c
hello.c: 2488 bytes of code and data, 2492 with bss (RAM 8192 bytes)
Hello from C on a RISC-V you built in Veryl!
...
```

| 选项 | 内容 |
|---|---|
| `-o PROG.bin` | 从地址 0 开始的二进位映像档（给 `v2c fpga --program`、虚拟板） |
| `-S PROG.s` | 产生的汇编语言：每个语句前面有一行 C 源代码当注解 |
| `-L PROG.lst` | 列表：地址、机器码、汇编语言与 C 源代码对照 |
| `--run [N]` | 在指令集仿真器上运行最多 N 个指令（默认 1000 万）。串口的输出印到屏幕；结束时打印指令数、时钟数与 LED |
| `--mem BYTES` | RAM 大小（默认 8192，与 RvSoc 相同） |
| `--linux` | 改成给 RV64 开发板的 Linux 的静态运行档（见下面的「在开发板的 Linux 上」） |

程序跑到 `main` 结束会停在 `_halt`（显示 `halted`）；永远不结束的程序在 N 个指令后停下（显示 `stopped`）。
`--run` 不会把键盘输入送给程序；要交互（`getchar`、`read_line`）请用虚拟开发板的 USB 终端机。

`.s` / `.S` 档会直接汇编（支持 RV32IMA、Zicsr、虚拟指令、`%hi` / `%lo`、`.data` / `.rodata` / `.bss`）。

## 支持的 C

- 类型：`char`（无号，和 RISC-V ABI 一样）、`signed char`、`short`、`int`、`long`（= `int`）与它们的 `unsigned`，`void`，
  指针，任意维的数组；接受 `const` / `volatile` / `static` / `extern`。
- 语句：区块、`if`、`while`、`do`、`for`、`switch`、`break`、`continue`、`return`，声明可以放在任何地方；所有 C 操作符。
- 函数：最多 8 个参数、`...` 可变参数；函数名称可以当地址用（例如交给 `set_mtvec`）。
- 前置处理器：`#define`（含参数）、`#undef`、`#ifdef` / `#ifndef`、`#if 常數`、`#else`、`#endif`、`#error`；`#include` 与 `#pragma` 会被忽略（运行期函数库一律在）。
- `asm("...")`：在函数里插入汇编语言；只有 `asm` 的函数不加进出代码（naked）；文件最外层的 `asm(...)` 可以定义整段汇编语言。
- **没有**：struct、union、enum、typedef、浮点数、函数指针的调用。

### 运行期函数库

| 类别 | 函数 / 宏 |
|---|---|
| 串口 | `putchar`、`getchar`、`kbhit`、`puts`、`printf`（`%d %i %u %x %X %c %s`、宽度、补零）、`sprintf`、`read_line` |
| 时间 | `millis`、`delay_ms`、`delay_us`、`TIMER`、`CLOCK_HZ` |
| 字符串与存储器 | `strlen`、`strcmp`、`strcpy`、`memset`、`memcpy`、`atoi` |
| 其他 | `rand`、`srand`、`abs` |
| 周边 | `LED`、`BUTTONS`、`SWITCHES`、`UART_DATA`、`UART_STATUS` |
| VGA 文本（`RvVgaBoard`） | `vga_init`（加载字体）、`vga_clear`、`vga_color(fg, bg)`（0xRGB）、`vga_goto(欄, 列)`、`vga_putc`、`vga_puts`、`vga_printf` |
| 中断与 CSR | `interrupts_on` / `off`、`irq_save` / `irq_restore`、`wfi`、`set_mtvec`、`set_mie`（`MIE_MTIE` 计时器、`MIE_MSIE` 软件、`MIE_MEIE` 串口）、`read_mcause`、`read_mepc` / `write_mepc`、`read_mstatus`、`read_mip`、`read_minstret`、`read_mscratch` / `write_mscratch`、`MTIME`、`MTIMECMP`、`MSIP` |
| 原子操作 | `atomic_swap`、`atomic_add`、`atomic_and`、`atomic_or`、`atomic_xor`、`atomic_cas`、`spin_lock`、`spin_unlock` |

只有程序真正用到的函数会放进映像档。

## 示例（`examples/c/`）

| 文件 | 示范 |
|---|---|
| `hello.c` | 串口问候、LED 计数、把收到的字转大写送回 |
| `knight.c` | 跑马灯，按钮调速（软件的上升缘检测） |
| `guess.c` | 终端机猜数字游戏 |
| `sevenseg.c` | 七段显示器的软件扫描 |
| `music.c` | 蜂鸣器播放旋律 |
| `switches.c` | 开关显示在 LED，终端机打印二进位 / 十六进位 |
| `vga.c` | VGA 文本模式（`RvVgaBoard`） |
| `threads.c` | 小小的抢占式多线程内核：计时器中断切换线程、`ecall` 做 yield / sleep、`amoswap` 互斥锁 |

## 在开发板的 Linux 上（v2.20）

`v2c cc PROG.c --linux -o PROG` 把同样的 C 编成 RV64 开发板（`examples/rv64`，第 11 章的仿真机）上 Linux 的静态 ELF 运行档：

- 数据模型不变：`int`、`long`、指针都是 4 个字节（像 x32）。程序是 RV64 指令，算 32 位整数用 `addw`、`mulw` 等 *W 指令，
  所以寄存器里永远是「32 位、符号延伸」的值；程序加载在 0x10000，自己的堆栈（256 KB）放在 bss，堆积用 `brk` 往上长，
  程序碰到的地址都在 2 GB 以下，指针存 32 位就够。
- 运行期函数库（`prelude.c` 的 `__linux__` 部分）用系统调用：`open` / `read` / `write` / `close` / `lseek` / `unlink`、
  `printf`（标准输出一行一行缓冲）、`getchar`、`read_line`、`malloc`、`exit`、`sleep` / `usleep` / `delay_ms` / `millis`；
  `write_file`、`read_int`；GPIO：`gpio_write(pin, v)`、`gpio_read(pin)`、`pin_mode(pin, INPUT|OUTPUT)`（0 / 1 是 ACT / USER LED，
  2 是按钮，其余经 `/sys/class/gpio`）；屏幕（v2.21，320 × 240 RGB565）：`fb_init`、`fb_clear`、`fb_pixel`、`fb_rect`、`fb_line`、
  `fb_circle`、`fb_text`、`RGB(r, g, b)` 与几个颜色名（`/dev/fb0` 用 `mmap` 固定映射在 0x40000000，因为指针只有 32 位）。
  `#include <gpio.h>` 之类的 `#include` 一样会被忽略（函数库一直都在）。
- 测试：`cargo test cc_linux` 把 `src/rv/tests/*.c` 与 `tests/linux/*.c` 编成 Linux 运行档，用 spike + pk（proxy kernel，
  系统调用号码与 Linux 相同）运行，输出要和主机的编译结果（`.out`）相同；`linux/test.sh` 在 Verilator / veryl-emu 上的 Linux 跑一个。
- IDE：开发板项目里打开 `.c` 档按「▶ 运行」，在浏览器里编译，运行档（文件名去掉 `.c`）和项目文件一起送进 `/root` 运行。

## 放到 FPGA 上

虚拟开发板（最方便）：网页 IDE 的「C 程序」示例，⚡ 虚拟板默认用 **CPU 模式**——指令集仿真器以即时速度运行，
存储器映射、周边与每个指令花的时钟数都和 `RvSoc` 相同（第 12 章）。切到比特流或网表模式，就是真的跑 `rvsoc.veryl` 综合出来的电路（慢很多）。

实体板子：

```sh
v2c cc -o hello.bin examples/c/hello.c
v2c fpga --top RvBoard --pnr veryl --pcf examples/rvsoc.pcf --program hello.bin --bin soc.bin \
    examples/src/rv32i.veryl examples/src/sync_ram.veryl examples/src/uart.veryl examples/src/rvsoc.veryl
iceprog soc.bin
```

整颗 SoC（约 4200 个逻辑单元、20 块 block RAM）的布局布线约需一分钟，Fmax 约 13–14 MHz。

接上串口终端机（115200 baud，例如 `screen /dev/tty.usbserial-xxx 115200`）就能看到输出。
