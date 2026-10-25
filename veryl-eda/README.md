# veryl-eda

Veryl 的邏輯合成器（類似 yosys 的 `synth`）：以 [`veryl-parser`](https://docs.rs/veryl-parser/latest/veryl_parser/) 為前端，
把 Veryl 設計展開成**扁平的閘級 netlist**，輸出 yosys JSON（可直接給 yosys / nextpnr 使用）與結構化 Verilog。

    cargo run --release -- [--top MODULE] [-o out.json] [--verilog out.v] [--list] a.veryl b.veryl ...

- 預設合成最後一個**非** `#[test]` 的 module；`--top` 可指定。會印出 port 與 cell 統計（類似 yosys `stat`）。
- `-o` 輸出 yosys JSON（`read_json` 可讀）；`--verilog` 輸出閘級 Verilog（可用 iverilog 做 gate-level 模擬）。
- `./test.sh`：單元測試 + 合成全部範例 + yosys `read_json; check -assert` +
  對 `veryl build` 產生的 SystemVerilog 做**形式等價驗證**（需要有 slang 前端的 yosys，例如 oss-cad-suite，路徑用 `YOSYS_SLANG` 指定）。

## 輸出的 cell（yosys 內部閘級 cell）
`$_NOT_ $_AND_ $_OR_ $_XOR_ $_MUX_`（Y = S ? B : A）、
`$_DFF_P_ / $_DFF_N_`、非同步 reset `$_DFF_{P,N}{P,N}{0,1}_`、同步 reset `$_SDFF_{P,N}{P,N}{0,1}_`。

## 流程
| 檔案 | 內容 |
|---|---|
| `value.rs`   | 常數值（與 veryl-sim 相同） |
| `expr.rs`    | 運算式 IR（以名稱表示訊號）+ 優先權解析器，struct 欄位直接轉成常數 slice |
| `elab.rs`    | 走訪語法樹 → 名稱式敘述 IR → **符號執行**成閘：if/case 變 mux、for 展開、function inline、always_ff 對應 DFF/reset、階層攤平 |
| `netlist.rs` | 位元級 Builder（常數摺疊、structural hashing、`x & !x` 等化簡）、加減乘/比較/桶形移位/動態索引；`optimize` 解析別名、偵測組合迴路、重建並清除無用邏輯 |
| `output.rs`  | yosys JSON、結構化 Verilog 輸出 |
| `netsim.rs`  | 2 態閘級模擬器（給測試用） |

每個宣告的訊號一開始就配置「佔位」wire，驅動者以別名 (佔位 bit → 驅動 bit) 記錄，最後在 `optimize` 統一解析；
因此 module 內各項目的順序不影響結果，子模組的 port 連接也只是別名。
與 veryl-sim 的 elab 需求根本不同（符號執行 vs. 模擬 IR），所以兩者不共用 elab 程式碼。

## 支援
module / 參數（`#(param ..)`、`const`、inst 參數覆寫）/ port / `var` / `let` / `assign` / `always_comb` /
`always_ff`（posedge/negedge、`if_reset` 同步/非同步、高/低有效）/ `if` / `case`（含範圍）/ `switch` / `for`（常數範圍，展開，含 `rev`）/
`inst` 階層（攤平，名稱如 `u_rf.rf`）/ package（enum、struct、const）/ `import` / struct 欄位 / 一維陣列（變數索引讀寫 → mux/解碼器）/
使用者 function（inline，可巢狀、`return` 可在分支中）/ generate for、generate if /
運算子：`+ - *`、位元/邏輯/化簡、比較（`$signed` 時為有號）、`<< >> >>>`（常數或變數）、串接與 `repeat`、三元運算、
`$signed $unsigned $clog2 $bits`；`/ % **` 僅限常數。`initial`/`final` 與 `$display` 類呼叫會被忽略。

## 尚未支援
interface/modport、`inout`、遞迴、非常數的除法、latch（不完整賦值的 always_comb 會報組合迴路）、
寬度 > 128 bit 的常數、多時脈域的 netsim、技術映射（LUT4 / iCE40 等）與 place & route（下一階段：接 nextpnr）。

## 驗證結果（`./test.sh`）
| 設計 | cells | 對 `veryl build` 的等價驗證 |
|---|---|---|
| Adder / Max3 / AluUnit / BitRev / GrayConv / rv32i Alu | 34 / 96 / 125 / 0 / 3 / 591 | SAT 完整證明 |
| Seq101 / PktReg | 14 / 9 | k-induction 證明 |
| Ram / RegFile / RiscvCore | 665 / 6232 / 7342 | 有界模型檢查 8 / 2 / 2 cycles |
| `examples/features.veryl`：Shifter / Funcs / Ranges / Counter / Top | 88 / 403 / 37 / 14 / 29 | SAT / SAT / SAT / k-induction / BMC 20 |

另外 `cargo test` 在閘級 netlist 上跑各範例的 testbench 情境（RiscvCore 執行 `addi/addi/add/sw` 程式並寫入 30）。

## 接到 nextpnr
輸出的 JSON 可直接進入既有的 FPGA 流程，例如 iCE40：

    yosys -p "read_json seq.json; synth_ice40 -top Seq101 -json seq_ice40.json"
    nextpnr-ice40 --up5k --package sg48 --json seq_ice40.json --asc seq.asc --pcf-allow-unconstrained

Seq101 實測：6 個 LC、232 MHz。RiscvCore 的邏輯可放入 UP5K（3369/5280 LC），但頂層 I/O 超過封裝腳位，需要外包一層。
