# 11. 网页 IDE

<https://ccc-eda.github.io/veryl2chip/web/dist/index.html>

整套工具（仿真器、综合器、FPGA 与 ASIC 流程、C 编译器）编成 WebAssembly 放在网页里，
**不需要服务器、不上传代码**：所有计算都在你的浏览器里做。`web/dist/` 整个目录下载下来，用 `file://` 打开也能脱机用。

## 画面

```
┌ 標題列：[主按鈕 ▾]（進階：驗證 │ 看電路 │ 跑起來）     ⌘ 命令  進階 ▸  語言 ┐
├────────┬──────────────────────────────────────────────────┤
│ 活動列 │ 編輯器分頁：檔案、⚙ 合成流程、⚡ 虛擬 iCEBreaker、組合語言 │
│ 側欄   │                                                    │
│ 檔案   ├──────────────────────────────────────────────────┤
│ 模組   │ 面板：問題 │ 輸出 │ 測試結果 │ 波形                     │
│ 測試   │                                                    │
│ 範例   │                                                    │
├────────┴──────────────────────────────────────────────────┤
│ 狀態列：WebAssembly、檢查結果、測試、合成統計                    │
└───────────────────────────────────────────────────────────┘
```

| 区域 | 内容 |
|---|---|
| 侧栏 · 文件 | 项目的文件（`.veryl`、`pins.pcf`、最多一个 `.c`）；＋ 添加，滑过文件名出现 ✎ 重命名、🗑 删除 |
| 侧栏 · 模块 | 每个 module，哪些是 `#[test]`；点一下跳到定义 |
| 侧栏 · 测试 | 每个 testbench 的 ▶ 与通过 / 失败状态，「全部运行」 |
| 侧栏 · 示例 | 示例库（下面），点一下开成新项目 |
| 面板 | 问题（语法错误会一边打字一边出现，点一下跳到那一行）、输出、测试结果、波形。拖曳面板上缘调整高度（收合时往上拖就会展开），双击上缘回到默认高度；高度与收合状态会记住 |

接口有繁体中文、English、简体中文三种语言（标题列右侧的菜单）。

### 主按钮与菜单（v2.27）

标题列最左边的蓝色按钮是**主按钮**：这个项目建议的下一步。它跟着项目走：

| 项目 | 主按钮 |
|---|---|
| 一台仿真机（有 `machine.json`，例如 RV64 开发板） | 🖥 仿真机（开机） |
| 开发板项目、打开了 `.py` / `.c` / `.sh` | ▶ 运行 `main.py`（在板子上运行打开的程序） |
| 有引脚档（`.pcf`） | ⚡ 虚拟板 |
| 其他（有 testbench） | ▶ 测试 |

旁边的 **▾** 列出所有动作，照「想做什么」分成三组，每项附一行说明：

| 组 | 动作 |
|---|---|
| 验证 | ▶ 测试、✔ 全面验证 |
| 看电路 | ⚙ 综合：FPGA（iCE40）、ASIC · vlib、ASIC · SKY130，⇄ FPGA 与 ASIC 比较 |
| 跑起来 | ⚡ 虚拟板、🖥 仿真机（RV64 开发板可选 riscv-emu 或 veryl-emu） |

建议的那一项标着「建议」。这个项目用不到的动作是淡色的，说明写的是原因；点了会跳出原因与能做的事，例如「添加 pins.pcf」
「仍要刻录（默认引脚）」「打开 main.py」「🖥 开机」。

**简易与高端**：默认是简易，标题列只有主按钮和 ▾；在综合流程分页时才出现综合的菜单（目标、阶段、顶层）。按标题列右边的
「高端 ▸」（或 ▾ 菜单最下面、命令菜单）切到高端：所有控制都在标题列上，分成「验证」（▶ 测试、测试的顶层、RTL / 门级仿真、
✔ 全面验证）、「看电路」（目标、阶段、顶层）、「跑起来」（⚡ 虚拟板、🖥 仿真机）三组，窗口窄时排成两列。项目用不到的按钮
一样是淡色虚线框，点了说明原因。选择记在浏览器里。

编辑器上方的**建议步骤**列出这个项目的 ①②③（例如 ① ⚡ 虚拟板 → ② ▶ 测试 → ③ ⚙ 综合），点一下就做；
× 关掉，命令菜单的「显示建议步骤」再打开。

### 在手机上

屏幕宽度在 760 px 以下时（手机直放），版面自动改成：

- **标题列**：只有主按钮和 ▾、⌘ 命令和 **⋯**；按 ⋯ 展开「验证」「看电路」「跑起来」三组的所有控制和语言。
  点综合流程分页的面包屑也会自动展开。
- **侧栏**：平常收起；点左边活动列的图标，从左侧滑出、盖在编辑器上；点击文件或示例、或点编辑器就收回。
- **编辑器**：16 px 字（避免手机在输入时自动放大画面）；面板分页可以左右滑动，面板高度可以拖曳。
- **综合流程**：芯片图在上、说明在下；**虚拟板**：控制列可以左右滑动，板子占满宽度。

功能和桌面版完全相同（同一个网页），网址参数与分享的实验链接照常可用。

## 项目

- 项目存在浏览器的 localStorage 里（每次修改自动保存；换电脑或清除网站数据就不见了，重要的请下载）。
- 欢迎页（第一次打开 IDE 时出现；命令菜单的「欢迎页」再打开）先问**你想做什么？**（v2.28），四张卡片各有一个起点示例：

  | 卡片 | 起点示例 | 按「从这里开始」 |
  |---|---|---|
  | 🧪 学 Veryl | 第 1 课 Blinky | 打开并跑测试（看结果和波形） |
  | ⚡ 做电路，放上开发板（像 Arduino） | 实验：红绿灯状态机 | 打开并烧进虚拟板（面包板已接好） |
  | 🖥 开一台电脑，写程序（像树莓派） | RV64 开发板 | 打开并开机 |
  | ⚙ 看电路变成芯片 | FIFO 256×8 | 打开并综合 |

  「看这一类的示例」打开示例库并筛选成那一类。下面是＋ 新项目、📚 打开示例、⇪ 导入 `.veryl` 档、最近的项目。
  选了卡片只决定从哪里开始，接口不会被锁住：主按钮与 ▾ 照样跟着项目走。
- 从示例开的项目改了也不会影响示例；「还原成示例源代码」可以回到原样，改过的文件在分页上有标记。
- 下载项目 `.zip`：`Veryl.toml` + `src/`，就是一个官方 `veryl` 能用的项目；`v2c` 直接读 `src/*.veryl` 即可。
- C 程序：添加文件时取名 `xxx.c`（一个项目一个），设计要用 `RvBoard`（从「C 程序」示例开始最简单）。

## 测试与验证

| 动作 | 对应的命令行 |
|---|---|
| ▶ 测试（Ctrl/⌘+Enter） | `v2c sim` |
| 仿真对象：RTL / 门级：通用门 / iCE40 / 标准单元 | `v2c gatesim opt / ice40 / asic` |
| ✔ 全面验证 | RTL 和三种网表各跑一次，比较结果 |
| 仿真顶层菜单 | `--top`（默认：全部 `#[test]`） |

✔ 全面验证的结果：

- 全部通过，就是综合正确。
- 「有测试失败（各实现结果一致）」：设计本身有错。
- 「综合前后结果不一致」：综合出问题，或设计依赖了上电为 0 之外的初始值。

波形分页显示 testbench 的全部信号（等于 `--vcd` 用 GTKWave 看），可以缩放、拖曳。

## 综合流程分页

标题列的三个菜单：

| 菜单 | 选项 |
|---|---|
| **后端** | FPGA、ASIC · vlib、ASIC · SKY130 |
| **阶段** | 要看哪一步（Ctrl/⌘+Shift+B 综合并显示目前的阶段） |

综合流程分页上方右边的小方框可以输入**时序目标（MHz）**（v2.35），存在项目里：FPGA 与 ASIC 的时序（STA）阶段会多一行
对这个目标的余裕（ASIC：WNS、TNS、几个端点没达成）。项目里有 `.sdc` 档（时序约束档，写法见第 9 章）时改用它，方框会变灰并显示文件名。
| **顶层** | 综合哪个 module（等于 `--top`） |

| 阶段 | FPGA | ASIC |
|---|---|---|
| ① RTL→Logic | 共用：Veryl 源代码对应到的逻辑 | |
| ② Logic Netlist | 共用：优化前的门级网表 | |
| ③ Tech-indep Syn | 共用：优化后（`v2c synth`） | |
| ④ | LUT4 对应（`SB_LUT4` / `SB_CARRY`…） | 标准单元对应 |
| ⑤ | 布局（退火动画） | 行式布局（退火动画） |
| ⑥ | 全局与详细布线 | 时钟树 + 全局布线 |
| ⑦ | 时序（STA） | 详细布线（SKY130 显示每一层金属与 DRC） |
| ⑧ | | 时序（STA） |
| ⑨ | | 功耗 + IR drop |

- 面包屑列：切换阶段，放大 / 缩小 / 符合窗口，开关连接。
- ⓘ：这个阶段在做什么，以及它的数字。
- 下载按钮依阶段而定：

  | 后端 | 可下载 |
  |---|---|
  | FPGA | `.asc`、`.bin`（可以直接 `iceprog`）、`.pcf` |
  | ASIC | 标准单元 Verilog、DEF |
  | SKY130 | 另外还有 GDSII |

- 「⇄ FPGA vs ASIC 比较」把两个后端的面积、时序、功耗并排。

## 仿真机（🖥）

有些设计放不进 FPGA，也不适合走 ASIC，例如有 256 MB RAM 的 RV64 SoC。这种设计用第三种方式「实体化」：
标题列的「🖥 仿真机」用 veryl-emu（`veryl-emu/`，见第 13 章的源代码地图）把设计编译成 WebAssembly，在浏览器的背景 worker 里当成一台机器开机，
UART 接到分页里的终端机。

- 项目要有 `machine.json`，说明顶层模块和引脚的用途：

  ```json
  {
    "top": "Rv64Soc",
    "reset": { "port": "i_rst", "active": 0, "cycles": 2 },
    "uart": { "tx_valid": "o_tx_valid", "tx_data": "o_tx_data", "rx_valid": "i_rx_valid", "rx_data": "i_rx_data", "rx_ready": "o_rx_ready" },
    "finish": { "valid": "o_finish", "code": "o_finish_code", "pass": 21845 },
    "ram": { "array": "mem", "base": "0x80000000" },
    "load": [{ "image": "linux" }]
  }
  ```

  UART 是交握式的端口（一拍一个字节：`tx_valid` 那一拍送出 `tx_data`，`rx_valid` 送进 `rx_data`）；
  写入关机设备（`finish`）时结束；`load` 是开机前放进 RAM 的程序（内置的映像，ELF 依它的程序段）。
- 工具列：🖥 开机（重新编译、加载、开机）、⏸ / ▶、⟲ 冷开机、💾 存状态、📂 程序（加载自己的 ELF 或二进位档再开机），以及拍数与速度。
- 快照（v2.17）：开机时，先找这个项目在浏览器里存下的状态（💾），再找内附的快照（`machine.json` 的 `"snapshot"`，建置网页时
  由 `web/snapshot.mjs` 开到 `"prompt"` 做成 `img_snap_*.js`），都没有才冷开机；状态只适用于同一个编译结果（改过 Veryl 就会冷开机）。
  RV64 开发板从快照约 10 秒就有 shell（冷开机约 1 分钟）。
- 文件（v2.18）：`machine.json` 有 `"files": { "addr": "0x8F000000", "size": 16777216 }` 时，项目的文件（Veryl、`machine.json`、
  `.pcf` 以外）开机时放进板子的 `/root`（冷开机时 `/init` 运行 `getfiles`；从快照开机时 IDE 自动打 `getfiles`）；⇅ 文件随时再送一次。
  板子上打 `savefiles` 把 `/root`（隐藏档以外）送回项目：文件总管里就出现在板子上创建或改过的文件。
  RV64 示例附 `blink.sh`（闪 GPIO 5 的 LED）与 `button.sh`（数按钮次数）：在板子上 `sh blink.sh`。
- **MicroPython**（v2.19）：板子上有 MicroPython 1.24（`micropython`，也叫 `python`；打 `micropython` 进 REPL，Ctrl-D 离开）与 `pi` 模块：
  `LED(n)`（`on()`、`off()`、`toggle()`、`value`、`blink()`；n = 0 / 1 是板上的 ACT / USER）、`Button(n)`（`is_pressed`、
  `wait_for_press()`、`wait_for_release()`；板上的按钮是 2）、`Pin(n, Pin.OUT)`、`sleep`。打开 `.py` 或 `.sh` 档时，标题列的 ▶ 变成
  「▶ 运行」（Ctrl/⌘+Enter）：先停掉板子上正在跑的程序（Ctrl-C，在 REPL 里再 Ctrl-D），把项目的文件送进 `/root`，再运行
  `micropython 檔名`（`.sh` 是 `sh 檔名`）；板子没开时先开机。仿真机工具列的「▶ 运行 main.py」做同样的事。
  示例：`main.py`（GPIO 5 的红灯与 USER 灯轮流亮）、`button.py`（数按钮次数）、`traffic.py`（面包板上的红黄绿灯 GPIO 5 / 12 / 13，
  GPIO 6 的按钮让绿灯提早结束）。
- **C**（v2.20）：开发板项目可以有好几个 `.c` 档；打开一个按「▶ 运行」，IDE 用 veryl-eda 的 C 编译器（`--linux`，见第 10 章）在浏览器里
  编成 RV64 Linux 运行档，放进 `/root`（文件名去掉 `.c`）再运行 `./檔名`；编译错误在「问题」面板。汇编语言分页显示打开的那个 `.c`。
  函数库：`printf`、`delay_ms`、`gpio_write`、`gpio_read`、`pin_mode`、文件的 `open` / `read` / `write` 等。示例 `blink.c`、`count.c`、
  `lights.c` 对应三个 MicroPython 示例。`savefiles` 不会把编译出来的运行档送回项目（只收文本档）。
- **目标菜单**（v2.25）：标题列的目标菜单有两组：综合（FPGA、ASIC · vlib、ASIC · SKY130）与仿真机（veryl-emu、riscv-emu）。
  选仿真机就打开仿真机分页、用那个引擎开机；选综合就回到综合流程。菜单跟着分页走（在仿真机分页显示它的引擎），项目用不到的仿真机
  是灰的（没有 `machine.json`，或不是 Rv64Soc 时的 riscv-emu）。四种目标怎么选见[第 15 章](15-targets.md)。
- **引擎**（v2.23）：`machine.json` 有 `"riscv": true`（设计是 Rv64Soc）时，仿真机工具列可以选引擎：**riscv-emu**（默认）只仿真指令集，
  像 QEMU，冷开机几秒就有 shell，`sleep(1)` 就是真的一秒（时间跟着时钟走），状态栏显示 MIPS；**veryl-emu** 仿真 Veryl 写的硬件本身
  （每一拍、每个信号，从快照开机），要看自己改过的 Veryl 设计就选它。GPIO、面包板、文件、▶ 运行、屏幕、💾 两种引擎都一样
  （存下的状态属于存它的引擎）。riscv-emu 不看项目的 Veryl 源代码：它的 SoC 是 [riscv-emu](../riscv-emu/README.tw.md) 照 Rv64Soc 写的。
  v2.24 起 riscv-emu 把常跑的程序片段翻成 WebAssembly（像 QEMU），一直在跑的程序约快四倍。
- **屏幕**（v2.21）：`machine.json` 有 `"fb": { "addr": "0x8EF00000", "width": 320, "height": 240 }` 时，板子和面包板之间多一个
  320 × 240 的屏幕：Linux 的 `simple-framebuffer`（`/dev/fb0`，RGB565）放在 RAM 里，worker 每 0.1 秒看一次，有变化才画到 canvas。
  开机时 fbcon（tty1）显示问候语；`echo hi > /dev/tty1` 写字到屏幕上。MicroPython：`from pi import Screen` 是 320 × 240 的
  `framebuf`（`fill`、`line`、`rect`、`ellipse`、`text`…，再 `show()`），`big_text` 放大字、`rgb(r, g, b)` 算颜色；
  C：`fb_clear`、`fb_pixel`、`fb_rect`、`fb_line`、`fb_circle`、`fb_text`、`RGB()`（`/dev/fb0` 映射在 0x40000000，直接写就看得到）。
  示例 `clock.py`（指针时钟）、`shapes.c`（色条、图形、文本、弹跳的球）。
- 示例「RV64 + Linux（仿真机）」开 OpenSBI + Linux 6.12 + busybox：浏览器里每秒约 370 万拍，开到 `rv64:~$` 约 1 分钟，
  之后就可以在终端机打指令。Linux 映像（`img_linux.js`，约 2.4 MB）第一次开机时才加载。
- 这种项目的顶层太大，▶ 测试与综合会改成提示用仿真机（里面的 `Rv64Core` 仍然可以综合）。
- **开发板**（v2.16）：`machine.json` 有 `"gpio": { "out": "o_gpio", "oe": "o_gpio_oe", "in": "i_gpio" }` 与 `"board": "pi"` 时，
  终端机旁边画一块像树莓派的板子：40 针排针（GPIO 3–15 放在树莓派相同 BCM 编号的位置）、PWR 灯、ACT（GPIO 0，Linux 的心跳）
  与 USER（GPIO 1）LED、按钮（GPIO 2，按住 = 1），下面是和虚拟 iCEBreaker 相同的面包板（接排针的 GPIO 3–15、3V3、GND）。
  面包板的配置存在项目里。
  **键盘**（v2.30）：点一下板子或屏幕（周围出现蓝框），就能用键盘按按钮：← 或空白键 = 面包板上最左边的按钮、→ = 第二个、
  ↑ ↓ = 第三、四个，1–9 照顺序，B = 板上的 BTN（GPIO 2）；板子下方那行会列出每个键对应哪支 GPIO。点终端机就回到打字。
  每次按键至少按住 0.12 秒，每几十毫秒才读一次按钮的程序也不会漏掉。试试看：

  ```sh
  echo 1 > /sys/class/leds/user/brightness          # USER LED
  B=$(cat /sys/class/gpio/gpiochip*/base)
  echo $((B+5)) > /sys/class/gpio/export; echo out > /sys/class/gpio/gpio$((B+5))/direction
  echo 1 > /sys/class/gpio/gpio$((B+5))/value       # 麵包板上的 LED（接在 GPIO 5）
  echo $((B+2)) > /sys/class/gpio/export; cat /sys/class/gpio/gpio$((B+2))/value   # 按住板上的按鈕再讀
  ```
- 手机上 256 MB 的存储器可能配置不到；仿真机的按钮在手机版收在 ⋯ 里。

## C 程序

项目有 `.c` 档时：

- 命令菜单的「C：查看汇编语言」打开汇编语言分页（与 `v2c cc -S` 相同）。
- 「C：在指令集仿真器上运行」把串口输出印到输出面板（等于 `v2c cc --run`，可以先输入要送给程序的文本）。
- ⚡ 虚拟板会自动编译 C 并加载（第 12 章）。

## 键盘

| 键 | 作用 |
|---|---|
| Ctrl/⌘+Enter | 运行测试 |
| Ctrl/⌘+Shift+B | 综合并显示目前阶段 |
| Ctrl/⌘+Shift+P | 命令菜单（所有动作都在这里） |
| Ctrl/⌘+P | 快速打开：项目、示例、文件 |
| Ctrl/⌘+S | 保存（其实一直都在自动保存） |
| Ctrl/⌘+J | 收合 / 展开面板 |
| Tab / Shift+Tab | 缩进 / 取消缩进 |

## 示例库

| 分类 | 示例 |
|---|---|
| 教学 | Blinky、跑马灯、UART 回声（`tutorial/`） |
| 实验 | 按一下加一、红绿灯状态机、面包板逻辑门（`tutorial/labs.tw.md` 用） |
| 基础 | 加法器、package + enum、generate、function |
| 时序 | 计数器、状态机、RAM、block RAM、FIFO、struct、七段显示器 |
| 周边 | UART、VGA |
| RV64 开发板 | Linux + MicroPython + C + 屏幕（仿真机）；跑马灯、反应时间游戏、呼吸灯、贪食蛇、俄罗斯方块、系统监视器、Linux 指令入门 |
| RISC-V | 单周期 RV32I、RISC-V SoC |
| C 程序 | `examples/c/` 的 8 个程序在 `RvBoard` 上 |
| 综合 | 进位链、多块 block RAM、语言功能大杂烩 |

示例库上方的筛选钮（全部、🧪、⚡、🖥、⚙，旁边是个数）只显示能做那件事的示例，选择记在浏览器里；欢迎页的卡片也会设置它。
示例旁的图标说明它能做什么：🧪 有测试、⚡ 能放上虚拟板、🖥 是一台仿真机；框起来的是建议的第一步。
每个示例的说明、文件与命令行的跑法见第 16 章〈[示例总表](16-examples.md)〉。

## 网址参数

网址 `#` 后面可以带参数，用 `&` 连接，适合放在讲义里：

| 参数 | 作用 |
|---|---|
| `ex=ID` | 打开示例（例如 `ex=tut_blinky`；已经开过就切到那个项目） |
| `run=1` | 开好后运行测试 |
| `verify=1` | 运行全面验证 |
| `stage=KEY` | 综合并显示某阶段：`rtl raw opt map place route sta`（FPGA）、`amap aplace aroute adetail asta apower`（ASIC） |
| `pdk=sky130` | ASIC 用 SKY130 |
| `board=1` | 刻录到虚拟板 |
| `lab=…` | 导入分享的实验（第 12 章） |

例：`index.html#ex=tut_knight&board=1`、`index.html#ex=fifo&stage=adetail&pdk=sky130`。
示例的 ID 在 `web/build.mjs`。

## 展示页

`demo.html` 是最早的单页展示（繁体中文）：选示例、仿真、综合流程以全屏幕覆盖显示。功能是 IDE 的子集。
