# veryl-sim（crate：`veryl2chip-sim`）
[English](https://github.com/ccc-eda/veryl2chip/blob/main/veryl-sim/README.md) | [繁體中文](https://github.com/ccc-eda/veryl2chip/blob/main/veryl-sim/README.tw.md) | **简体中文**

以 [`veryl-parser`](https://docs.rs/veryl-parser/latest/veryl_parser/) 为前端、类似 Icarus Verilog (`iverilog` + `vvp`) 的 Veryl 事件驱动仿真器。

[veryl2chip](https://github.com/ccc-eda/veryl2chip) 的一部分（在线 IDE：<https://ccc-eda.github.io/veryl2chip/web/dist/ide.html>）。

    cargo install veryl2chip-sim        # 安装 `veryl-sim` 命令
    veryl-sim [--top MODULE] [--vcd out.vcd] [--max-time N] [--list] a.veryl b.veryl ...

在源代码目录里也可以用 `cargo run --release -- ...`。

- 默认运行所有带 `#[test(...)]` 属性的 module；没有的话运行最后声明的 module。`--top` 可指定。
- `--vcd` 输出波形（GTKWave 可开）；有断言失败时 exit code 为 1。

## 架构
| 文件 | 内容 |
|---|---|
| `value.rs` | 4 态 (0/1/x) 位矢量，最多 256 bit（`LIMBS` × 64，可调） |
| `iface.rs` | interface：收集声明、展开内容、解析 modport（与 veryl-eda 共用） |
| `gates.rs` | 门级模型：仿真时把某个 module 换成综合后的网表（通用门、iCE40、vlib 标准单元、RAM），testbench 不用改 |
| `gen.rs`   | generate-for 的索引序列（`rev`、`step +=` 等；与 veryl-eda 共用） |
| `expr.rs`  | 表达式 IR + 优先级解析器（吃 veryl-parser 的 token 串） |
| `elab.rs`  | 遍历 veryl-parser 语法树、展开层次、转成仿真 IR |
| `sim.rs`   | 求值、delta-cycle 调度、非阻塞赋值 (NBA)、clock 产生器、VCD |

## 支持
module / 参数 (`#(param ..)`, `const`) / port / `var` / `let` / `assign` / `always_comb` / `always_ff`
(含 `if_reset`、同步/异步 reset、posedge/negedge) / `if` / `case` / `switch` / `for` / `inst`（含参数覆写、层次）/
`initial`（`clk.next(n)`、`rst.assert(clk)`）/ `$tb::clock_gen`、`$tb::reset_gen` /
package / enum（`Pkg::Enum::Member`）/ package const / struct（字段访问、整体赋值；第一个字段在最高位，与 SystemVerilog 相同）/ 一维数组 /
用户 function（不可递归）/ generate for（含 `rev`、`step += k` 等）、generate if / `import Pkg::*` /
interface（`inst b: Bus;`、`port: modport Bus::master`、modport 的 `..input` / `..output` / `..same(m)` / `..converse(m)`；成员以 `b.valid` 访问）/
最多 256 bit 的宽度 / 时钟域注记（`'a clock`）/
`$display $write $info $warning $error $fatal $assert $finish $time $clog2 $signed $unsigned $bits $random`。

## 尚未支持
泛型 interface 端口（`port: interface`，需指名 modport）、递归、`inout`（三态需要 z 平面与多驱动解析）、宽度 > 256 bit。

注意：Veryl 0.22 内置仿真器（`veryl test`）在 interface 设计上会算错（例如 `veryl-eda/examples/lang.veryl` 的 TestHs 它得 0），
iverilog 与 veryl-sim 都是 145。
