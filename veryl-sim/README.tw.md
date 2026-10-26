# veryl-sim（crate：`veryl2chip-sim`）
[English](https://github.com/ccc-eda/veryl2chip/blob/main/veryl-sim/README.md) | **繁體中文** | [简体中文](https://github.com/ccc-eda/veryl2chip/blob/main/veryl-sim/README.cn.md)

以 [`veryl-parser`](https://docs.rs/veryl-parser/latest/veryl_parser/) 為前端、類似 Icarus Verilog (`iverilog` + `vvp`) 的 Veryl 事件驅動模擬器。

[veryl2chip](https://github.com/ccc-eda/veryl2chip) 的一部分（線上 IDE：<https://ccc-eda.github.io/veryl2chip/web/dist/ide.html>）。

    cargo install veryl2chip-sim        # 安裝 `veryl-sim` 指令
    veryl-sim [--top MODULE] [--vcd out.vcd] [--max-time N] [--list] a.veryl b.veryl ...

在原始碼目錄裡也可以用 `cargo run --release -- ...`。

- 預設執行所有帶 `#[test(...)]` 屬性的 module；沒有的話執行最後宣告的 module。`--top` 可指定。
- `--vcd` 輸出波形（GTKWave 可開）；有斷言失敗時 exit code 為 1。

## 架構
| 檔案 | 內容 |
|---|---|
| `value.rs` | 4 態 (0/1/x) 位元向量，最多 256 bit（`LIMBS` × 64，可調） |
| `iface.rs` | interface：收集宣告、展開內容、解析 modport（與 veryl-eda 共用） |
| `gates.rs` | 閘級模型：模擬時把某個 module 換成合成後的網表（通用閘、iCE40、vlib 標準元件、RAM），testbench 不用改 |
| `gen.rs`   | generate-for 的索引序列（`rev`、`step +=` 等；與 veryl-eda 共用） |
| `expr.rs`  | 運算式 IR + 優先權解析器（吃 veryl-parser 的 token 串） |
| `elab.rs`  | 走訪 veryl-parser 語法樹、展開階層、轉成模擬 IR |
| `sim.rs`   | 求值、delta-cycle 排程、非阻塞賦值 (NBA)、clock 產生器、VCD |

## 支援
module / 參數 (`#(param ..)`, `const`) / port / `var` / `let` / `assign` / `always_comb` / `always_ff`
(含 `if_reset`、同步/非同步 reset、posedge/negedge) / `if` / `case` / `switch` / `for` / `inst`（含參數覆寫、階層）/
`initial`（`clk.next(n)`、`rst.assert(clk)`）/ `$tb::clock_gen`、`$tb::reset_gen` /
package / enum（`Pkg::Enum::Member`）/ package const / struct（欄位存取、整體賦值；第一個欄位在最高位，與 SystemVerilog 相同）/ 一維陣列 /
使用者 function（不可遞迴）/ generate for（含 `rev`、`step += k` 等）、generate if / `import Pkg::*` /
interface（`inst b: Bus;`、`port: modport Bus::master`、modport 的 `..input` / `..output` / `..same(m)` / `..converse(m)`；成員以 `b.valid` 存取）/
最多 256 bit 的寬度 / 時脈域註記（`'a clock`）/
`$display $write $info $warning $error $fatal $assert $finish $time $clog2 $signed $unsigned $bits $random`。

## 尚未支援
泛型 interface 埠（`port: interface`，需指名 modport）、遞迴、`inout`（三態需要 z 平面與多驅動者決議）、寬度 > 256 bit。

注意：Veryl 0.22 內建模擬器（`veryl test`）在 interface 設計上會算錯（例如 `veryl-eda/examples/lang.veryl` 的 TestHs 它得 0），
iverilog 與 veryl-sim 都是 145。
