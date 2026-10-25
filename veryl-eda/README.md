# veryl-eda

Veryl 的邏輯合成、FPGA 與 ASIC 流程（類似 yosys `synth` / `synth_ice40` 加上 nextpnr，以及 OpenROAD 式的標準元件後端）：以
[`veryl-parser`](https://docs.rs/veryl-parser/latest/veryl_parser/) 為前端，把 Veryl 設計展開成**扁平的閘級 netlist**，
可再映射成 iCE40 的 `SB_LUT4` / `SB_CARRY` / `SB_DFF*`，再用**自己的佈局繞線**（`--pnr veryl`）或 nextpnr-ice40 產生 `.asc`，icepack 產生位元流；
或用 `--asic` 映射到自製的 **vlib 標準元件庫**，做列式佈局、全域繞線與靜態時序分析。

    cargo run --release -- [--top MODULE] [-o out.json] [--verilog out.v] [--list]
                           [--ice40 [--device up5k] [--package sg48] [--pcf pins.pcf] [--asc out.asc] [--bin out.bin]
                                    [--pnr nextpnr|veryl] [--seed N] [-v]]
                           [--asic [--seed N] [-v]]
                           a.veryl b.veryl ...

- 預設合成最後一個**非** `#[test]` 的 module；`--top` 可指定。會印出 port 與 cell 統計（類似 yosys `stat`）。
- `-o` 輸出 yosys JSON（`read_json` 可讀）；`--verilog` 輸出閘級 Verilog（iverilog 可模擬）。
- `--ice40` 做 iCE40 技術映射；加 `--asc` / `--bin` 會再做佈局繞線（預設 `nextpnr-ice40`，時序不過會失敗；`--pnr veryl` 用自己的）與 `icepack`。
- `--asic` 做 ASIC 後端（見下）；`--verilog` 此時輸出標準元件 netlist（附 vlib 元件的 Verilog 模型），`-v` 印出關鍵路徑。
- `./test.sh`：單元測試 + 合成全部範例 + yosys `read_json; check -assert` + FPGA 流程 +
  對 `veryl build` 產生的 SystemVerilog 做**形式等價驗證**（需要有 slang 前端的 yosys，例如 oss-cad-suite，路徑用 `YOSYS_SLANG` 指定）。

## RV32I CPU
`examples/src/rv32i.veryl` 的 `RiscvCore` 是單週期 RV32I（不含 fence/ecall/ebreak/CSR）：
`lui auipc jal jalr`、六種分支、`lb lh lw lbu lhu sb sh sw`、全部 R/I 型運算（含移位、`xor`、`sltu`）。
資料記憶體介面以 `o_dmem_wstrb` 表示要寫的位元組，讀取由 CPU 從整個字取出 byte/halfword 並做符號擴展。

測試程式 `examples/sw/rv32i_test.S` 用真正的組譯器產生 ROM（`examples/sw/build.sh` → `examples/src/rv32i_rom.veryl`），
把 41 個結果寫進記憶體，`TestRiscvCore` 逐字 `$assert`。期望值同時以 RISC-V 官方參考模擬器 **spike** 交叉比對（`build.sh` 自動做）。
通過的地方：spike、官方 `veryl test`、veryl-sim、veryl-eda 合成後的閘級 netlist、以及 iCE40 映射後的 netlist（`cargo test`）。

完整（未被常數 ROM 修剪）的 RiscvCore 映射後需要 5401 個 LUT，超過 UP5K 的 5280 LC——主因是用正反器做的 32×32 暫存器檔；
要把整套 ISA 測試搬上 FPGA，需要先做 Block RAM（`SB_RAM40_4K`）推論。

## RISC-V CPU 上 FPGA
`examples/soc.veryl` 的 `RiscvSoc` = `examples/src/rv32i.veryl` 的 `RiscvCore` + 程式 ROM + 16 字資料 RAM + LED 暫存器（位址 0x100）。
程式以 `beq`/`jal` 迴圈算 Fibonacci(10)，把 55 寫到 RAM[0] 與 LED。頂層只有 clock、reset、8 顆 LED。
程式 ROM 是常數，合成時會把這個程式用不到的硬體（未用的暫存器、移位器、byte 載入等）整個消掉，所以位元流只驗證了這個程式用到的指令。

    ./fpga/flow.sh          # 合成 → 映射 → nextpnr → icepack → 兩種閘級模擬
    iceprog fpga/build/soc.bin

| 項目 | 結果（iCE40UP5K-SG48，iCEBreaker 腳位 `examples/icebreaker.pcf`） |
|---|---|
| cells | 1168 SB_LUT4、85 SB_CARRY、232 DFF |
| 佈局 | 1279 / 5280 LC（24%） |
| 時序 | 約 17 MHz（板上時脈 12 MHz，通過） |
| 映射後 netlist 模擬（yosys iCE40 cell 模型） | 第 70 個 cycle LED = 55 |
| **繞線後位元流**模擬（`icebox_vlog` 轉回 Verilog） | 第 70 個 cycle LED = 55 |

## 自己的佈局繞線（`--pnr veryl`，`src/pnr/`）
只針對 iCE40UP5K，架構資料來自 IceStorm 的 `chipdb-5k.txt`（找不到時用 `VERYL_EDA_CHIPDB` 指定）。
| 檔案 | 內容 |
|---|---|
| `chipdb.rs` | 讀晶片資料庫：tile 與設定位元表、繞線圖（10 萬條線、120 萬個 pip，每個 pip = 目的線輸入 mux 的位元樣式）、腳位、全域緩衝、IE/REN、column buffer |
| `pack.rs` | LUT/進位/正反器 → 邏輯單元（LC）；進位鏈完整保留：訊號當 carry-in 時加 feed-in LC，carry-out 被一般邏輯使用時由下一個 LC 的 LUT 讀出 |
| `place.rs` | 模擬退火（線長 HPWL，可依 net 加權）；同一 tile 的正反器必須同 clock / reset / 邊緣；進位鏈放在整欄邏輯 tile、從 LC 0 開始 |
| `route.rs` | PathFinder 協商擁塞 + A*；clock 與 reset 走全域網路（來源 → `fabout` → `glb_netwk_N` → 各 tile 的 clk / s_r mux）；時序導向時關鍵度 c 的 net 每條線的成本 = c × 線延遲 + (1 − c) × 擁塞 |
| `mod.rs` | 產生 `.asc`：LC 位元（LUT 位元排列、carry、DFF、set/reset）、進位鏈連接、IO、column buffer、DSP 預設值 |

驗證：
- `fpga/cosim.py`：把**我們繞好的位元流**用 `icebox_vlog` 轉回 Verilog，和映射後的 netlist 用相同隨機輸入逐 cycle 比對輸出；改壞一個 LUT 位元會被抓到。
- `fpga/pnr_test.sh`：14 個設計全部 1000 cycle 輸出相同，並用 `icetime`（IceStorm 時序分析）量 Fmax。
- 非邏輯 tile（IO 設定、column buffer、DSP/IPCON 預設）與 nextpnr 對同一 pcf 的輸出逐位元相同。
- `PNR=veryl fpga/flow.sh`：RISC-V SoC 用自己的佈局繞線，繞線後位元流模擬 LED = 55。

| 設計 | LC | Fmax（icetime） |
|---|---|---|
| RiscvSoc（自己的 P&R） | 1252 / 5280 | 17.0 MHz（只看線長 15.6 MHz；板上 12 MHz，通過） |
| RiscvSoc（nextpnr） | 1279 / 5280 | 17.3 MHz |

### 時序導向（預設開，`--no-timing-driven` 關閉）
第一輪只看線長；STA 除了前向的到達時間，再做一次反向傳遞求「每個點之後最長還要多久」，
得到每條 net 的**關鍵度** = 經過它的最長路徑 / 關鍵路徑（0..1）。第二輪：
- 佈局成本裡 net 的權重 = 1 + 6 × 關鍵度⁸ / √負載數（只有接近關鍵的 net 變重；高扇出的 net 不能把整片拉在一起）；
- 繞線時關鍵 net 優先走快的線（見 `route.rs`）。
繞不通或沒有快 3% 以上（STA 的誤差範圍）就保留第一輪。ASIC 流程同樣做：以第一輪佈局為起點低溫微調，
小設計（< 4000 元件）另外重新退火一次，只取繞得通的最快結果。

| 設計 | FPGA，icetime（只看線長 → 時序導向） | ASIC，自己的 STA |
|---|---|---|
| Ram | 39.0 → 45.0 MHz | 974 → 1006 MHz |
| BramMix | 42.5 → 48.0 MHz | 394 → 410 MHz |
| RiscvSoc | 15.6 → 17.0 MHz | 107 → 115 MHz |
| RiscvCore | （放不下 UP5K） | 71.1 → 75.6 MHz |

## ASIC 後端（`--asic`，`src/asic/`）
教學用的標準元件庫 **vlib**（列高 4.0 µm、site 0.5 µm，延遲約 130 nm 慢速角）：
`INV BUF NAND2 NOR2 AND2 OR2 XOR2 XNOR2 AOI21 OAI21 MUX2 TIEL TIEH DFF DFFN DFFR DFFS DFFNR DFFNS`（R/S 腳低態有效）。
| 檔案 | 內容 |
|---|---|
| `lib.rs` | 元件庫：寬度、面積、本徵延遲 + 每扇出負載、setup、Verilog 行為模型；**SRAM 巨集**（記憶體編譯器的角色：依字數×字寬算出面積與形狀） |
| `map.rs` | 技術映射：在多扇出點把網表切成樹，以動態規劃做最小面積 **tree covering**（反相器併入 NAND/NOR/XNOR/AOI/OAI）；同步 set/reset 變成 D 前邏輯，非同步用 DFFR/DFFS（高態有效加 INV）；扇出 > 12 的資料線插入 **BUF 樹**（clock / 非同步 reset 留給時脈樹）；同步讀取的記憶體（與 FPGA 的 block RAM 推論相同條件）變成 **SRAM 巨集**，每個讀取埠一個 |
| `place.rs` | 依利用率 65% 決定晶粒（加上巨集面積），SRAM 巨集先由左下角起成排固定擺放，IO 腳放在四周；標準元件依各列空位比例蛇形初始擺放，再以**合法的模擬退火**（移到空位或兩元件交換）最小化 HPWL |
| `route.rs` | gcell（4 µm）**全域繞線**：水平 M2/M4、垂直 M3/M5，每邊 16 軌；端點依 Prim 順序以 A* 連到已建好的樹，PathFinder（現況 + 歷史成本）消除溢出；統計線長與 via |
| `sta.rs` | 靜態時序：元件延遲 = 本徵 + 負載 × 扇出；線延遲 = 驅動整條繞線 + 到該負載的分佈 RC；起點輸入腳 / DFF clk→Q，終點 DFF D（+setup）/ 輸出腳；另算每條 net 的關鍵度（給時序導向佈局） |
| `mod.rs` | `flow()` 串起來；`def()` 輸出 DEF 佈局 |

| 設計 | 標準元件 | 面積 | 晶粒 | 線長 | Fmax |
|---|---|---|---|---|---|
| RiscvSoc | 2553 | 31360 µm² | 220 × 220 µm | 117 mm | 109 MHz |
| RiscvCore（整顆 RV32I，暫存器檔 1024 個 DFF） | 9795 | 0.132 mm² | 449 × 452 µm | 1088 mm | 67.5 MHz |

驗證：`cargo test` 在標準元件 netlist 上也跑每個範例的 testbench（含 RV32I 測試程式），並檢查佈局合法、每條 net 繞成連通的樹、沒有溢出；
`./test.sh` 用 yosys 對 `veryl build` 的輸出做標準元件 netlist 的形式等價驗證。

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
- iCE40（`--ice40`）：`SB_LUT4`、`SB_CARRY`、`SB_DFF`、`SB_DFFN`、`SB_DFF[N]{R,S}`、`SB_DFF[N]S{R,S}`、`SB_RAM40_4K`。

## Block RAM 推論（iCE40，`src/bram.rs`）
陣列若只在**一個** always_ff 中以整個元素寫入（每拍最多一次）、只以整個元素讀取，elab 會把它記成記憶體
（寫入埠 we / waddr / wdata、各讀取埠的位址與資料，存成具名 net `$mem:名稱:...`，其餘照常展開成 DFF）。
映射 iCE40 時，若每個讀取埠是**同步讀取**（讀出的資料直接進同一時脈的暫存器，可帶致能）就換成 `SB_RAM40_4K`：
元素 DFF、讀取暫存器與位址解碼 / 讀取多工器都消失。模式 256×16、512×8、1024×4、2048×2，字寬超過一塊就並排多塊，
每個讀取埠一份拷貝。非同步讀取（例如 RV32I 暫存器檔、`Ram`）保留為邏輯，因為 block RAM 只有暫存式讀取埠。

| 設計 | 不用 BRAM | 用 BRAM |
|---|---|---|
| SyncRam 512×8（`examples/src/sync_ram.veryl`） | 12832 個 cell | 1 個 `SB_RAM40_4K` |
| BramMix（256×32、兩個讀取埠 + 邏輯） | 29059 個 cell，放不進 UP5K | 4 個 BRAM + 86 LC，自己的 P&R 49 MHz（icetime 46 MHz） |

自己的佈局繞線支援 BRAM：30 個 RAM 位置一起退火、RAM 腳位繞線（時脈走全域網路）、`RamConfig` 位元與 `.ram_data`、STA（RCLK→RDATA 與各輸入 setup）。
驗證：netsim 依 yosys `cells_sim.v` 模擬 `SB_RAM40_4K`（各模式的隨機讀寫測試）；`fpga/pnr_test.sh` 對繞好的位元流做共模擬；
`test.sh` 用 yosys 的 `SB_RAM40_4K` 模型對 `veryl build` 做 iCE40 netlist 的形式等價（BMC）。

## 支援
module / 參數（`#(param ..)`、`const`、inst 參數覆寫）/ port / `var` / `let` / `assign` / `always_comb` /
`always_ff`（posedge/negedge、`if_reset` 同步/非同步、高/低有效）/ `if` / `case`（含範圍）/ `switch` / `for`（常數範圍，展開，含 `rev`）/
`inst` 階層（攤平，名稱如 `u_rf.rf`）/ package（enum、struct、const）/ `import` / struct 欄位 / 一維陣列（變數索引讀寫 → mux/解碼器）/
使用者 function（inline，可巢狀、`return` 可在分支中）/ generate for、generate if /
運算子：`+ - *`、位元/邏輯/化簡、比較（`$signed` 時為有號）、`<< >> >>>`（常數或變數）、串接與 `repeat`、三元運算、
`$signed $unsigned $clog2 $bits`；`/ % **` 僅限常數。`initial`/`final` 與 `$display` 類呼叫會被忽略。

## 尚未支援
interface/modport、`inout`、遞迴、非常數的除法、latch（不完整賦值的 always_comb 會報組合迴路）、
寬度 > 128 bit 的常數、非同步讀取的記憶體放進 BRAM、SPRAM（`SB_SPRAM256KA`）、PLL、多時脈域的 netsim；
自己的佈局繞線：只支援 UP5K、沒有 LUT 輸入腳交換。

## 驗證結果（`./test.sh`）
| 設計 | 對 `veryl build` 的等價驗證 |
|---|---|
| Adder / Max3 / AluUnit / BitRev / GrayConv / rv32i Alu / ProgRom | SAT 完整證明 |
| Seq101 / PktReg | k-induction 證明 |
| Ram / RegFile / RiscvCore | 有界模型檢查 8 / 2 / 2 cycles |
| RiscvSoc | 有界模型檢查 80 cycles（整個程式跑完） |
| RiscvTestRom（rv32i 測試程式 ROM） | SAT 完整證明 |
| `examples/features.veryl`：Shifter / Funcs / Ranges / Counter / Top | SAT / SAT / SAT / k-induction / BMC 20 |

上表每個設計都驗證兩次：閘級 netlist（`gate`）與 vlib 標準元件 netlist（`asic`）。
另外 `cargo test` 在閘級 netlist、iCE40 映射後與標準元件映射後的 netlist 上都跑各範例的 testbench 情境（RiscvCore 跑完整的 RV32I 測試程式並比對 41 個結果、ALU 每種運算對 Rust 參考值、RiscvSoc 在 LED 顯示 55）。
