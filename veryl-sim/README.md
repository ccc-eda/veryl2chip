# veryl-sim

以 [`veryl-parser`](https://docs.rs/veryl-parser/latest/veryl_parser/) 為前端、類似 Icarus Verilog (`iverilog` + `vvp`) 的 Veryl 事件驅動模擬器。

    cargo run --release -- [--top MODULE] [--vcd out.vcd] [--max-time N] [--list] a.veryl b.veryl ...

- 預設執行所有帶 `#[test(...)]` 屬性的 module；沒有的話執行最後宣告的 module。`--top` 可指定。
- `--vcd` 輸出波形（GTKWave 可開）；有斷言失敗時 exit code 為 1。

## 架構
| 檔案 | 內容 |
|---|---|
| `value.rs` | 4 態 (0/1/x) 位元向量，最多 128 bit |
| `expr.rs`  | 運算式 IR + 優先權解析器（吃 veryl-parser 的 token 串） |
| `elab.rs`  | 走訪 veryl-parser 語法樹、展開階層、轉成模擬 IR |
| `sim.rs`   | 求值、delta-cycle 排程、非阻塞賦值 (NBA)、clock 產生器、VCD |

## 支援
module / 參數 (`#(param ..)`, `const`) / port / `var` / `let` / `assign` / `always_comb` / `always_ff`
(含 `if_reset`、同步/非同步 reset、posedge/negedge) / `if` / `case` / `switch` / `for` / `inst`（含參數覆寫、階層）/
`initial`（`clk.next(n)`、`rst.assert(clk)`）/ `$tb::clock_gen`、`$tb::reset_gen` /
`$display $write $info $warning $error $fatal $assert $finish $time $clog2 $signed $unsigned $bits $random`。

## 尚未支援
interface/modport、package、struct/enum、陣列、使用者 function、generate、`case`/`switch` 運算式、`inout`、寬度 > 128 bit。
