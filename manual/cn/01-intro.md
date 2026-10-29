# 1. 认识 veryl2chip

## 它能做什么

把一个用 Veryl 写的数字电路设计，一路带到「可以烧的 FPGA」或「可以送去做的芯片版图」：

```
Veryl 原始碼
   │  v2c sim        模擬：跑 #[test] testbench，看波形
   ▼
閘級網表          v2c synth      合成：展開、最佳化成 AND / OR / XOR / MUX / 正反器
   │
   ├─► FPGA   v2c fpga       iCE40UP5K：LUT 對應 → 佈局 → 繞線 → 時序 → 位元流（iceprog 燒進 iCEBreaker）
   │
   └─► ASIC   v2c asic       標準元件對應 → 列式佈局 → 時脈樹 → 繞線 → 時序 → 功耗
                              （vlib 教學元件庫，或 SkyWater SKY130：再加 DRC 與 GDSII 版圖）

合成後的網表 → v2c gatesim   用同一個 testbench 再模擬一次，確認合成沒有改變行為
C 程式       → v2c cc        編譯給專案裡的 RISC-V SoC（也是用 Veryl 寫的）執行
```

全部工具都是这个项目自己写的（仿真器、综合器、FPGA 布局布线与比特流、ASIC 后端、C 编译器），
需要外部工具的地方只有：刻录实体板子（`iceprog`）、选用的 nextpnr 布局布线，以及给开发者用的验证工具。

## 两种用法

| | 网页 IDE | 命令行 `v2c` |
|---|---|---|
| 安装 | 不用，打开网页即可（[在线版](https://ccc-eda.github.io/veryl2chip/web/dist/index.html)） | `cargo install veryl2chip-eda` |
| 适合 | 上课、实验、看每个阶段的图、虚拟开发板 | 自动化、大设计、集成到其他流程 |
| 能力 | 仿真、波形、综合各阶段的图、FPGA / ASIC（含 SKY130）、虚拟开发板、C 程序 | 同样的流程，输出文件（JSON、Verilog、`.asc`、`.bin`、DEF、GDS、VCD） |

两者用的是**同一份程序**（网页里跑的是编成 WebAssembly 的同一套 Rust 代码），结果相同。

## 名词

| 名词 | 意思 |
|---|---|
| 顶层（top） | 要仿真或综合的那个 module |
| testbench | 带 `#[test(...)]` 属性、用来测试设计的 module；仿真时默认跑全部 testbench，综合时默认不碰它们 |
| 网表（netlist） | 综合后由逻辑门与触发器组成的电路 |
| LUT / LC | iCE40 FPGA 的 4 输入查表 / 逻辑单元（LUT + 进位 + 触发器） |
| 比特流（bitstream） | 烧进 FPGA 的设置档（`.bin`） |
| 标准单元（standard cell） | ASIC 用的现成逻辑门版图（NAND2、DFF…） |
| PDK | 制程设计套件：单元库、各层金属规则、版图（本项目支持 SkyWater SKY130） |
| Fmax | 电路能跑的最高时钟频率；iCEBreaker 的时钟是 12 MHz |
| DRC | 设计规则检查：金属宽度、间距、短路、断路 |
| GDSII | 芯片版图的标准文件格式（`.gds`） |

## 这个项目里有什么

| 目录 | 内容 |
|---|---|
| `veryl-sim/` | 仿真器（crate `veryl2chip-sim`） |
| `veryl-eda/` | 综合、FPGA、ASIC、C 编译器、虚拟板引擎，以及 `v2c` 指令（crate `veryl2chip-eda`） |
| `veryl-wasm/` | 上面两者编成 WebAssembly |
| `web/` | 网页 IDE（`web/dist/index.html`） |
| `examples/` | 示例设计（加法器、状态机、UART、VGA、RISC-V…）与 C 程序（`examples/c/`） |
| `tutorial/` | 从零开始的教学与虚拟实验课 |
| `tools/` | 下载 SKY130、检查 GDS 等小工具 |
| `manual/` | 本手册 |
