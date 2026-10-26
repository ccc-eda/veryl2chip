# veryl2chip
[English](README.md) | [繁體中文](README.tw.md) | **简体中文**

**在线直接使用**（免安装）：[展示页](https://ccc-eda.github.io/veryl2chip/web/dist/index.html) · [IDE](https://ccc-eda.github.io/veryl2chip/web/dist/ide.html)

**从零开始的教程**（课程教材，繁体中文）：[写 Veryl → 仿真 → 看波形 → 综合 → 烧进 iCEBreaker](tutorial/README.tw.md)

Veryl HDL 的 EDA 工具：仿真、逻辑综合、FPGA 流程（iCE40UP5K，一直到比特流）与 ASIC 流程
（标准单元、布局、布线、时序分析），全部用 Rust 编写。

| | |
|---|---|
| [`veryl-sim/`](veryl-sim/) | Veryl testbench 的事件驱动仿真器（`$tb::clock_gen`、`$assert`、VCD） |
| [`veryl-eda/`](veryl-eda/) | 综合成门级网表、iCE40 映射、自研布局布线 + 比特流、ASIC 后端（`--asic`） |
| [`veryl-wasm/`](veryl-wasm/) | 两个 crate 编译成 WebAssembly，通过 JSON API 调用 |
| [`web/`](web/) | 纯前端的网页环境（TypeScript） |
| [`examples/`](examples/) | 示例设计的 Veryl 项目，包含一颗单周期 RV32I CPU |

## 网页环境
用浏览器打开 `web/dist/index.html` 即可，不需要服务器、不需要安装，从 `file://` 打开也能用。

- **源代码**：示例项目（每个可有多个文件，包含 UART、FIFO、VGA）放在编辑器里；修改保存在浏览器（localStorage）。
  可以新建文件（附模块 + testbench 模板）、删除、导入，也能把项目下载成 `.zip`（`Veryl.toml` + `src/`），
  官方的 `veryl build` / `veryl test` 可以直接使用。
- **▶ 模擬**（仿真）：在 WebAssembly 里运行所有 `#[test]` testbench，有输出日志、可点击的错误位置与波形查看。
  旁边的菜单可切换到**综合后仿真**：把示例的设计模块换成综合出来的网表（通用门、iCE40 LUT / block RAM、
  或标准单元），用同一个 testbench 运行。
- **⚙ 合成**（综合）：综合视图。每个阶段都有报告、可缩放的图和细节侧栏：
  - 共用：① RTL→Logic → ② Logic Netlist → ③ Tech-indep Syn
  - FPGA：④ LUT4 Techmap → ⑤ Placement（退火动画）→ ⑥ Global+Detail Routing → ⑦ Timing (STA)。
    可下载 `.asc`、`.pcf` 和 `.bin`；`.bin` 与 icepack 的输出逐字节相同，可用 `iceprog` 烧录。
  - ASIC：④ Standard Cell Map → ⑤ Row Placement（动画）→ ⑥ CTS + Global Routing → ⑦ Detail Routing →
    ⑧ Timing (STA) → ⑨ Power + IR Drop。可下载标准单元 Verilog 和 DEF。
  - ⇄ FPGA vs ASIC：两种布局并排，加上对比表（单元、面积、布线、Fmax、能量、功耗）。

（展示页的界面是繁体中文；需要简体中文或英文界面请用下面的 IDE。）

网址的 hash 可以指定示例与阶段，例如 `index.html#ex=soc&synth=1&target=asic`。

### IDE
`web/dist/ide.html` 是建立在同一个内核上、功能更完整的 VS Code 风格 IDE（上面的展示页保持不变）：

- 活动栏与侧栏：项目文件与模块大纲、示例库、综合流程各阶段、测试、帮助
- 标签页编辑器：Veryl 语法高亮、实时语法检查（问题面板、行号旁标记、波浪下划线）
- 项目保存在浏览器：可有多个项目，新建 / 重命名 / 删除 / 导入文件，导出 `.zip`
- ▶ 测试（RTL 或门级）；✔ 全面验证：每个 testbench 都在 RTL 与三种综合后网表上运行一遍
- ⚙ 综合流程是一个编辑器标签页：共用 ① RTL→Logic → ② Logic Netlist → ③ Tech-indep Syn，然后 FPGA ④–⑦
  或 ASIC ④–⑨，以及 FPGA vs ASIC
- 下方面板（问题、输出、测试结果、波形）、状态栏、命令面板（Ctrl/⌘+Shift+P）、快速打开文件（Ctrl/⌘+P）
- 界面可用繁体中文、简体中文或英文（标题栏的菜单切换；默认跟随浏览器语言）

`ide.html#ex=fifo&stage=place` 会打开某个示例并跳到某个阶段；加上 `&run=1` / `&verify=1` 会直接开始测试。

从 crates.io 安装命令行工具（`veryl-sim`、`veryl-eda`）：

```sh
cargo install veryl2chip-sim veryl2chip-eda
```

重新构建（需要 Rust + wasm32 target、Node.js）：

```sh
cd web
npm install
npm run build
npm test
```

`npm run build` 重建 `web/dist`。`npm test` 用构建好的 `dist/` 把每个示例运行一遍：仿真、综合、FPGA 布局布线
（`.asc` 与 CLI 相同，`.bin` 与 icepack 相同）、ASIC 流程（结果与 CLI 相同）、每个示例的门级仿真、
解开导出的项目 `.zip` 并用 `veryl test` 检查，以及界面翻译。

命令与架构见 [AGENTS.md](AGENTS.md)；各 crate 的 README（[veryl-sim](veryl-sim/README.cn.md)、[veryl-eda](veryl-eda/README.cn.md)）有更多细节。
