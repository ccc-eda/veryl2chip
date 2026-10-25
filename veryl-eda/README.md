# veryl-eda

Veryl 的邏輯合成與 FPGA 流程（類似 yosys `synth` / `synth_ice40`，再接 nextpnr）：以
[`veryl-parser`](https://docs.rs/veryl-parser/latest/veryl_parser/) 為前端，把 Veryl 設計展開成**扁平的閘級 netlist**，
可再映射成 iCE40 的 `SB_LUT4` / `SB_CARRY` / `SB_DFF*`，交給 nextpnr-ice40 佈局繞線、icepack 產生位元流。

    cargo run --release -- [--top MODULE] [-o out.json] [--verilog out.v] [--list]
                           [--ice40 [--device up5k] [--package sg48] [--pcf pins.pcf] [--asc out.asc] [--bin out.bin]]
                           a.veryl b.veryl ...

- 預設合成最後一個**非** `#[test]` 的 module；`--top` 可指定。會印出 port 與 cell 統計（類似 yosys `stat`）。
- `-o` 輸出 yosys JSON（`read_json` 可讀）；`--verilog` 輸出閘級 Verilog（iverilog 可模擬）。
- `--ice40` 做 iCE40 技術映射；加 `--asc` / `--bin` 會再呼叫 `nextpnr-ice40`（時序不過會失敗）與 `icepack`。
- `./test.sh`：單元測試 + 合成全部範例 + yosys `read_json; check -assert` + FPGA 流程 +
  對 `veryl build` 產生的 SystemVerilog 做**形式等價驗證**（需要有 slang 前端的 yosys，例如 oss-cad-suite，路徑用 `YOSYS_SLANG` 指定）。

## RISC-V CPU 上 FPGA
`examples/soc.veryl` 的 `RiscvSoc` = `examples/src/rv32i.veryl` 的 `RiscvCore` + 程式 ROM + 16 字資料 RAM + LED 暫存器（位址 0x100）。
程式以 `beq`/`jal` 迴圈算 Fibonacci(10)，把 55 寫到 RAM[0] 與 LED。頂層只有 clock、reset、8 顆 LED。

    ./fpga/flow.sh          # 合成 → 映射 → nextpnr → icepack → 兩種閘級模擬
    iceprog fpga/build/soc.bin

| 項目 | 結果（iCE40UP5K-SG48，iCEBreaker 腳位 `examples/icebreaker.pcf`） |
|---|---|
| cells | 1156 SB_LUT4、84 SB_CARRY、232 DFF |
| 佈局 | 1289 / 5280 LC（24%） |
| 時序 | 約 13.7 MHz（板上時脈 12 MHz，通過） |
| 映射後 netlist 模擬（yosys iCE40 cell 模型） | 第 70 個 cycle LED = 55 |
| **繞線後位元流**模擬（`icebox_vlog` 轉回 Verilog） | 第 70 個 cycle LED = 55 |

## 流程
| 檔案 | 內容 |
|---|---|
| `value.rs`   | 常數值 |
| `expr.rs`    | 運算式 IR（以名稱表示訊號）+ 優先權解析器，struct 欄位直接轉成常數 slice |
| `elab.rs`    | 走訪語法樹 → 名稱式敘述 IR → **符號執行**成閘：if 變 mux 鏈、常數標籤的 case 變平行 one-hot、for 展開、function inline、always_ff 對應 DFF/reset、階層攤平 |
| `netlist.rs` | 位元級 Builder（常數摺疊、structural hashing、`x & !x` 等化簡、平衡的化簡樹）、加減乘/比較/桶形移位/動態索引；`optimize` 解析別名、偵測組合迴路、重建、清除無用邏輯，並反覆做：**證明常數節點**（隨機模擬找候選、對 ≤16 個輸入的支撐集窮舉證明）與**移除卡在 0 的暫存器** |
| `ice40.rs`   | iCE40 映射：全加器進位 → `SB_CARRY` 鏈；其餘以 cut-based 4-LUT 覆蓋（深度優先、再看 area flow）；DFF → `SB_DFF[N][S]{R,S}`，低有效 reset 加反相 LUT |
| `output.rs`  | yosys JSON、結構化 Verilog（含 iCE40 primitive 實例） |
| `netsim.rs`  | 2 態閘級模擬器（給測試用，支援通用閘與 iCE40 cell） |

每個宣告的訊號一開始就配置「佔位」wire，驅動者以別名 (佔位 bit → 驅動 bit) 記錄，最後在 `optimize` 統一解析；
因此 module 內各項目的順序不影響結果，子模組的 port 連接也只是別名。
與 veryl-sim 的 elab 需求根本不同（符號執行 vs. 模擬 IR），所以兩者不共用 elab 程式碼。

暫存器初值視為 0（iCE40 上電即為 0）：例如程式 ROM 為常數時，CPU 從未寫入的暫存器（x6..x31）與其讀取多工器會被整個消掉。

## 輸出的 cell
- 通用（`-o`）：`$_NOT_ $_AND_ $_OR_ $_XOR_ $_MUX_`（Y = S ? B : A）、`$_DFF_P_ / $_DFF_N_`、
  非同步 reset `$_DFF_{P,N}{P,N}{0,1}_`、同步 reset `$_SDFF_{P,N}{P,N}{0,1}_`。
- iCE40（`--ice40`）：`SB_LUT4`、`SB_CARRY`、`SB_DFF`、`SB_DFFN`、`SB_DFF[N]{R,S}`、`SB_DFF[N]S{R,S}`。

## 支援
module / 參數（`#(param ..)`、`const`、inst 參數覆寫）/ port / `var` / `let` / `assign` / `always_comb` /
`always_ff`（posedge/negedge、`if_reset` 同步/非同步、高/低有效）/ `if` / `case`（含範圍）/ `switch` / `for`（常數範圍，展開，含 `rev`）/
`inst` 階層（攤平，名稱如 `u_rf.rf`）/ package（enum、struct、const）/ `import` / struct 欄位 / 一維陣列（變數索引讀寫 → mux/解碼器）/
使用者 function（inline，可巢狀、`return` 可在分支中）/ generate for、generate if /
運算子：`+ - *`、位元/邏輯/化簡、比較（`$signed` 時為有號）、`<< >> >>>`（常數或變數）、串接與 `repeat`、三元運算、
`$signed $unsigned $clog2 $bits`；`/ % **` 僅限常數。`initial`/`final` 與 `$display` 類呼叫會被忽略。

## 尚未支援
interface/modport、`inout`、遞迴、非常數的除法、latch（不完整賦值的 always_comb 會報組合迴路）、
寬度 > 128 bit 的常數、Block RAM（`SB_RAM40_4K`）推論、PLL、多時脈域的 netsim；佈局繞線使用 nextpnr（不是自己實作）。

## 驗證結果（`./test.sh`）
| 設計 | 對 `veryl build` 的等價驗證 |
|---|---|
| Adder / Max3 / AluUnit / BitRev / GrayConv / rv32i Alu / ProgRom | SAT 完整證明 |
| Seq101 / PktReg | k-induction 證明 |
| Ram / RegFile / RiscvCore | 有界模型檢查 8 / 2 / 2 cycles |
| RiscvSoc | 有界模型檢查 80 cycles（整個程式跑完） |
| `examples/features.veryl`：Shifter / Funcs / Ranges / Counter / Top | SAT / SAT / SAT / k-induction / BMC 20 |

另外 `cargo test` 在閘級 netlist **與** iCE40 映射後的 netlist 上都跑各範例的 testbench 情境（RiscvCore 執行 `addi/addi/add/sw` 並寫入 30、RiscvSoc 在 LED 顯示 55）。
