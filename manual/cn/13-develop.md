# 13. 验证与开发

这一章给想确认工具可信度、或想修改 veryl2chip 本身的人。

## 怎么知道工具是对的

| 检查 | 证明什么 | 在哪里 |
|---|---|---|
| RTL 仿真 vs 官方 | `v2c sim` 的语意与官方 `veryl test` / iverilog 一致 | 示例的 testbench |
| 门级仿真 | 同一个 testbench 在通用门、iCE40、vlib、SKY130 网表上都通过 | `cargo test`、`v2c gatesim` |
| **形式等价** | 综合后的网表与官方 `veryl build` 产生的 SystemVerilog **数学上等价**（组合电路完整证明；循序电路 k-induction 或有界检查） | `veryl-eda/test.sh`（yosys + slang） |
| SKY130 网表 | yosys 用 PDK 的 Liberty 函数读单元，与 RTL 等价 | `veryl-eda/test.sh` |
| 比特流 | 自研布局布线产生的 `.asc`，用 IceStorm 的 `icebox_vlog` 转回电路，与网表随机输入逐周期比对；`.bin` 与 icepack 逐字节相同 | `fpga/pnr_test.sh`、`fpga/cosim.py` |
| FPGA 流程 | RISC-V SoC 从对应后的网表、从布好的比特流各仿真一次 | `fpga/flow.sh` |
| 版图 | DRC 0 违规；KLayout 读回 GDS，检查单元数、不重叠、宽度与间距 | `asic` 流程、`tools/gds_check.py` |
| C 编译器 | `src/rv/tests/*.c` 的输出与主机的 `cc` 相同；RISC-V 程序的结果与 spike 相同 | `cargo test` |
| 虚拟板 | 板子引擎与 netsim 一致；比特流解码与 nextpnr 的结果一致 | `cargo test board`、`cargo test bitstream` |
| 网页 | 每个示例都用和网页相同的 wasm + TypeScript API 跑过一遍 | `npm test` |

## 跑测试

```sh
./test.sh            # CI 跑的：veryl-sim、veryl-eda 的 cargo test、tutorial/check.sh、npm test
./test.sh --full     # 再加上 veryl-eda/test.sh（需要 OSS CAD Suite，數十分鐘）
```

每一步失败也会继续跑，最后打印摘要。个别运行：

```sh
cd veryl-eda && cargo test --release          # 合成所有範例、在網表上跑 testbench、C 編譯器、v2c 指令
cd veryl-eda && cargo test --release --test v2c  # 只測 v2c 的各個子指令
cd veryl-eda && ./test.sh                     # 形式等價 + FPGA 流程 + SKY130（含 GDS 檢查）
cd veryl-eda && ./fpga/pnr_test.sh            # 自己的佈局繞線：每個設計的位元流 vs 網表 + icetime
cd web && npm test                            # 網頁（要先 npm run build）
```

`veryl-eda/test.sh` 用到的环境变量：

| 变量 | 用途 |
|---|---|
| `YOSYS_SLANG` | 有 slang 前端的 yosys（OSS CAD Suite 的）。Homebrew 的 yosys 读不了 `veryl build` 输出的 enum 转型与 function |
| `GDS_PY` | 有 KLayout 模块的 Python（`pip install klayout`），用来检查 SKY130 的 GDS；没设置时若 `python3` 有就用它 |
| `OUT` | 输出目录（默认暂存目录） |
| `VERYL_EDA_CHIPDB` | IceStorm 芯片数据库；`./test.sh` 找不到时从 `web/dist/chipdb.js` 取出 |

等价检查使用 `-set-init-zero`，因为优化器假设触发器上电为 0（iCE40 是这样）。

## 添加测试设计

- 综合用的测试设计放在 `veryl-eda/examples/`，并加进 `veryl-eda/test.sh` 的 `DESIGNS`（格式 `檔名:模組:模式`，
  模式 `comb` / `ind` / `bmcN`）。这些文件会被拷贝进官方 Veryl 项目产生标准答案，所以 module 名称不能和 `examples/src` 重复。
- 用 `veryl check`（在 `examples/` 里运行）确认语法；`v2c` 的「not supported」不是语法错误，只是本项目没支持。

## 源代码地图

| 目录 | 内容 |
|---|---|
| `veryl-sim/` | 仿真器（crate `veryl2chip-sim`）：`elab.rs` 展开、`sim.rs` 事件驱动仿真、`value.rs` 4 值位矢量、`cli.rs` |
| `veryl-eda/src/` | 综合器（crate `veryl2chip-eda`）：`elab.rs` 符号执行成门、`netlist.rs` 优化、`ice40.rs`、`bram.rs`、`output.rs`、`netsim.rs`、`cli.rs`、`bin/v2c.rs` |
| `veryl-eda/src/pnr/` | iCE40 自研布局布线与比特流 |
| `veryl-eda/src/asic/` | 标准单元流程：`map` `place` `route` `detail` `sta` `layout` `drc` `gds` |
| `veryl-eda/src/pdk/` | 技术抽象、Liberty / LEF / DEF 读取、SKY130 绑定；`veryl-eda/pdk/sky130hd/` 内附的子集 |
| `veryl-eda/src/board/` | 虚拟板：引擎、iCEBreaker、比特流解码、周边 |
| `veryl-eda/src/rv/` | C 编译器、汇编器、指令集仿真器 |
| `veryl-emu/` | 编译式仿真器：把设计编成 WebAssembly（`ir.rs` 定宽度、`gen.rs` 调度与产生码、`wasm.rs` 编码器），`js/emu.mjs`；IDE 的仿真机用它 |
| `veryl-wasm/` | 给网页的 WebAssembly（C ABI，JSON 进出） |
| `web/` | IDE 与展示页（TypeScript）；`web/dist/` 是建好的、直接可用的网页（有进 git） |
| `examples/` | Veryl 示例（官方 Veryl 项目）、`examples/rv64/` RV64 处理器与 xv6 / Linux、`examples/c/` C 示例、`examples/sw/` RISC-V 汇编语言测试 |
| `tutorial/` | 教学与虚拟实验课 |
| `tools/` | SKY130 下载与子集、GDS 检查、字体、简体转换 |

更细的说明在 `AGENTS.md`、`web/PLAN.md` 与两个 crate 的 README。

## 建置与发行

```sh
./build.sh                 # Rust 工具 + web/dist；改了 Rust 或 TypeScript 都要重建 web/dist
./publish.sh               # 發行到 crates.io 的預演（不上傳）
./publish.sh --yes         # 真的發行 veryl2chip-sim、veryl2chip-eda，並打 tag vX.Y
```

发行新版前，两个 `Cargo.toml` 的版本（以及 eda 对 sim 的相依版本）都要升。

文档有三种语言：`README.md`（英文）、`README.tw.md`（繁体）、`README.cn.md`（简体，由 `tools/tocn.py` 从繁体转换）。
网页接口的文本写成 `tr('繁體', 'English')`，简体由对照表自动产生。

CI（`.github/workflows/static.yml`）跑 `./test.sh` 的内容，推到 main 时把新建的 `web/dist` 部署到 GitHub Pages。
