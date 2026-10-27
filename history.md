# veryl2chip 版本歷史

veryl2chip 是一套以 Rust 寫成、給 Veryl HDL 用的 EDA 工具：模擬、邏輯合成、FPGA 流程（iCE40UP5K，一路做到位元流）、
ASIC 流程（標準元件、佈局、繞線、時序；從 v2.0 起可接 SkyWater SKY130 開源 PDK，做到通過 DRC 的 GDSII），
以及一個純前端、在瀏覽器裡就能用的 IDE 與虛擬 iCEBreaker 開發板。

這份文件依時間順序記錄每個版本做了什麼、為什麼這樣做，以及當時怎麼驗證。專案內部用「M 編號」記里程碑
（`web/PLAN.md` 有完整表格），對外發布到 crates.io 的是 `veryl2chip-sim` 與 `veryl2chip-eda` 兩個套件，
版本號兩者一致；git tag 的格式是 `vX.Y`（1.1.0 → `v1.1`）。

| 版本 | 日期 | 最後一個 commit | 主題 | git tag |
|---|---|---|---|---|
| v1.0 | 2026-10-26 | `64b6c7d` | 模擬、合成、FPGA 與 ASIC 流程、網頁環境與 IDE | `v1.0` |
| v1.1 | 2026-10-26 | `afab038` | 第一次發布到 crates.io（1.1.0、1.1.1） | `v1.1` |
| v1.2 | 2026-10-26 | `4733629` | 虛擬 iCEBreaker 開發板、周邊、麵包板、虛擬實驗課 | `v1.2` |
| v1.3 | 2026-10-26 | `15e65c6` | 跑在 block RAM 的 RISC-V SoC、C 編譯器、C 程式 | `v1.3` |
| v1.4 | 2026-10-26 | `df8007e` | RV32IMA + Zicsr、中斷、C 寫的多執行緒核心 | `v1.4` |
| v1.5 | 2026-10-26 | `b2c91aa` | SKY130 起步：Liberty / LEF / DEF、Tech 抽象 | `v1.5` |
| v1.6 | 2026-10-27 | `ad27b6d` | SKY130 設計規則：版圖幾何、DRC、遵守規則的繞線 | `v1.6` |
| v1.7 | 2026-10-27 | `faa5e45` | GDSII 輸出，用 KLayout 檢查 | `v1.7` |
| v1.8 | 2026-10-27 | `54be6be` | 對應用更多 SKY130 元件，速度與面積改善 | `v1.8` |
| v1.9 | 2026-10-27 | `285be7f` | IDE 裡可選 SKY130 | `v1.9` |
| v2.0 | 2026-10-27 | `85fe18e` | 2.0.0：接上 SkyWater SKY130 | `v2.0`（= `d70d279`） |
| v2.1 | 2026-10-27 | `c864946` 起 | 2.1.0：`v2c` 單一指令、使用手冊、手機版 IDE | （發布時由 `publish.sh` 打） |
| v2.2 | 2026-10-27 | （本版） | 2.2.0：Lattice ECP5 對應 + nextpnr-ecp5 | |

---

## v1.0 之前：起點（2026-10-25）

- `eedf3b6` Initial commit、`da9a08d` 加入 veryl-sim、`e7fbaa1` 加入 `examples/` 並讓測試通過：
  專案的起點是一個能跑 Veryl testbench（`$tb::clock_gen`、`$assert`、VCD）的事件驅動模擬器。

## v1.0：完整的流程與網頁環境（2026-10-25 ～ 10-26，tag `v1.0` = `64b6c7d`）

這一版把「Veryl → 晶片」的整條路一次鋪好，並且全部搬進瀏覽器。

**邏輯合成（veryl-eda）**
- `8bd064b` Veryl 合成成 yosys 內部元件的扁平閘級網表，輸出 yosys JSON 與結構化 Verilog。合成器用「符號執行」
  的方式把 if/case 變成多工器、展開迴圈、內聯函式，刻意與 veryl-sim 的 elaboration 分開。`test.sh` 會用 yosys
  讀回網表，並與官方 `veryl build` 的輸出做形式等價證明。
- `ad41759` iCE40 對應（進位鏈 SB_CARRY、cut-based 的 SB_LUT4、SB_DFF*）、FPGA 流程（nextpnr-ice40、icepack），
  RISC-V SoC 從位元流跑起來；最佳化器會證明常數節點、移除卡在 0 的正反器。
- `c8371f7` 單週期 RV32I 核心補齊整個指令集，測試程式的結果與 spike 比對。
- `10467cc` veryl-sim 支援 package、struct、陣列、函式、generate，所有範例都能跑。

**自己的 iCE40 佈局繞線（`--pnr veryl`）**
- `91196f5` M1：讀 IceStorm 的 chipdb、打包、模擬退火佈局、PathFinder + A* 繞線、寫 `.asc`；
  用 `icebox_vlog` 把繞好的位元流轉回 Verilog，與網表逐週期比對。
- `28a7f73` M2：進位鏈、負緣時脈、set/reset 正反器。
- `7bf45db` M3：整顆 RISC-V SoC 用自己的佈局繞線，15.6 MHz，LED 亮出 55。

**網頁環境（純前端，Rust 核心編成 WebAssembly）**
- `558e47a` web M1：wasm 用 C ABI 呼叫、TypeScript 介面，`file://` 開也能用。
- `d473c04` / `623a616` / `54c660d` web M2–M4：瀏覽器裡的合成、佈局、繞線、時序、位元流（與 icepack
  逐位元組相同）、波形檢視器。
- `b996358` web M5：ASIC 流程（教學用的 vlib 標準元件庫）：元件對應、列式佈局、全域繞線、STA、DEF。
- `3cc4c30` web M6：README。

**ASIC 與 FPGA 的深化**
- `cb157ba` Block RAM 推論：iCE40 用 SB_RAM40_4K，ASIC 用 SRAM macro。
- `f29b8fc` 時序導向的佈局與繞線（FPGA 與 ASIC）。
- `6dd40b4` ASIC 時脈樹合成、傳遞時脈的 STA、hold 修正。
- `f196a4d` ASIC 四層軌道格點上的細部繞線。
- `80a440d` 電源網格與填充元件；`a1aaf52` 功耗估計（切換活動、IR drop）；`479158f` 佈局密度懲罰。
- `cd28593` 語言支援：除法、interface、generate 的 step/rev、超過 128 bit 的寬度、多個時脈域。
- `92b4ab7` 合成後閘級模擬：設計自己的 RTL testbench 直接跑在合成後的網表上（通用閘、iCE40、標準元件）。

**IDE**
- `5d57c9e` 檔案管理、專案 `.zip`、UART / FIFO / VGA 範例、FPGA vs ASIC 比較。
- `64b6c7d` M11：VS Code 風格的 IDE（當時是 `ide.html`）：專案、即時語法檢查、測試矩陣、各階段檢視。

## v1.1：第一次發布到 crates.io（tag `v1.1` = `065ed17`）

- `6ae6ea4` IDE 介面有繁體中文、簡體中文、英文；README 也分三種語言。
- `d23f5e0` 從零開始的教學（`tutorial/`）：第 1 課 Blinky、第 2 課跑馬燈，從寫 Veryl 到燒進 iCEBreaker。
- `f020503` CI：建置並測試全部，再把 `web/dist` 部署到 GitHub Pages。
- `2ea383d` 套件改名為 `veryl2chip-sim` / `veryl2chip-eda`（避開官方 Veryl 的 `veryl-*` 前綴），加入 `publish.sh`。
- `065ed17` 1.1.0；`26cf62c` 套件 README 三種語言；`7b5d3e6` 1.1.1（crates.io 頁面用英文 README）；
  `afab038` `publish.sh` 能撐過 crates.io 索引延遲。

## v1.2：虛擬開發板與虛擬實驗課（`4733629`）

目標是「沒有實體板子也能上 FPGA 實驗課」。
- `f581243` M12：虛擬 iCEBreaker。活動驅動的逐週期引擎（LUT 真值表、正反器、block RAM），腳位依 pcf；
  IDE 畫出開發板，LED 依工作週期發亮、按鈕可按。
- `a81272e` 根目錄的 `build.sh` / `test.sh` 一次建置與測試整個專案。
- `2824516` M13：虛擬板跑的是真正的位元流——把 `.bin` 解碼回電路（任何 iCE40UP5K 的 `.bin` 都行）。
- `9f19611` M14：周邊：USB 序列終端機、七段顯示器、VGA 螢幕、蜂鳴器、每個 PMOD 一個模組；教學第 3 課 UART。
- `adc1df5` M15：麵包板（LED、電阻、按鈕、開關、導線，短路與浮接警告）、腳位表、可分享的實驗連結。
- `c6e5019` M16：虛擬實驗課講義 `tutorial/labs.tw.md`（8 個實驗，每個都能一鍵燒進虛擬板）。
- `8cd7567` IDE 的合成控制改成 VS Code 風格（標題列的後端與階段選單）。

## v1.3：在自己做的 RISC-V 上跑 C（tag `v1.3` = `15e65c6`）

- `6a14bba` M17–M20：
  - 多週期 RISC-V SoC `RvSoc`：暫存器檔與 8 KB 記憶體都在 block RAM，記憶體映射的 LED、按鈕、開關、UART、計時器。
  - 程式放進 block RAM：只換程式時不必重新合成與佈局繞線（直接改寫位元流的 `.ram_data`）。
  - veryl-eda 自己的 C 編譯器（C 子集 → RV32I）、組譯器、指令集模擬器、執行期函式庫（`printf` 等）。
  - C 範例：Hello、跑馬燈、猜數字、七段、蜂鳴器、開關；虛擬板的「CPU 模式」以即時速度執行。
- `537d307` M20：VGA 文字模式（40 × 30 字元，字型由程式載入）；block RAM 推論接受有未讀資料位元的記憶體。

## v1.4：中斷與多執行緒（tag `v1.4` = `df8007e`）

- `8e71f77` M21–M22：
  - `RvCore` 擴充成 RV32IMA + Zicsr：反覆式乘除法、LR/SC 與 AMO、CSR、machine mode 的陷阱
    （計時器 / 軟體 / 外部中斷、ecall、ebreak、非法指令、位址沒對齊）、`mret`、`wfi`；SoC 加上 CLINT。
    測試程式 `rv32ima_test.S` 的結果與 spike 相同。
  - 合成改進：case 的 one-hot 把同值分支合併、LUT 映射加上面積回收，讓擴充後的核心放得進 iCE40UP5K。
  - C 編譯器產生乘除法指令，支援 `asm(...)`、naked 函式、函式位址。順便修掉一個真實的 bug：函式結尾原本會
    讀 sp 以下的位置，中斷一來就被暫存器框蓋掉。
  - 範例 `threads.c`：一個小小的搶佔式核心（計時器中斷切換執行緒、ecall 做 yield / sleep、amoswap 做互斥鎖）；
    `threads_on_rvsoc` 測試讓它在閘級 RvBoard 與指令集模擬器上逐週期得到相同結果。
- 版本之後的 `adc577e`：網頁的入口改成 IDE（`index.html`），原本的展示頁改名 `demo.html`，舊的 `ide.html` 會轉址。

---

## 往 v2.0：接上 SkyWater SKY130 開源 PDK

v1.4 之前的 ASIC 流程用的是自己設計的教學元件庫 vlib：尺寸、延遲都是「大約 130 nm」的假設值。
v1.5 到 v2.0 的目標是讓同一套流程能用**真實、公開**的 PDK——SkyWater 的 SKY130（`sky130_fd_sc_hd` 標準元件庫，
典型角落 `tt_025C_1v80`），產出其他工具（OpenROAD、Magic、KLayout）看得懂的 Verilog、DEF 與 GDSII。
做法是保留流程內部的「邏輯元件」（INV、NAND2、AOI21、DFFR…），另外加一層 `Tech`，把每個邏輯元件綁到元件庫裡的
實體元件，並提供列高、site、軌距、腳位位置與時序。vlib 也變成一種內建的 `Tech`，所以原本的結果不變。

### v1.5：SKY130 起步（`b2c91aa`）

- `src/pdk/liberty.rs` 讀 Liberty：群組語法、單位、可內插的 NLDM 查表、腳位的 `function` 與 `ff`。
- `src/pdk/lef.rs` 讀 LEF：site、各層的軌距 / 寬度 / 間距 / RC、via、元件尺寸與腳位形狀；`src/pdk/def.rs` 讀 DEF。
- `Tech` 抽象與綁定表 `SKY130_HD`：每個綁定都拿 Liberty 函式比對真值表（正反器比對時脈邊緣、下一狀態、clear / preset），
  不一致就拒絕。
- PDK 子集放進倉庫（`veryl-eda/pdk/sky130hd/`，附 Apache-2.0 授權）；`tools/sky130.sh` 下載完整檔案，
  `tools/sky130_subset.py` 切出用到的元件；`--pdk-check` 檢查一個完整的 PDK 目錄。
- `--asic --pdk sky130`：記憶體維持正反器（這裡沒有 SRAM macro）、沒有 reset 的負緣正反器加時脈反相器；
  `unithd` 列（0.46 × 2.72 µm）、IO 腳在格點上、well tap 與填充元件；腳位從 li1 經接點上 met1；
  用 NLDM 查表算時序（斜率傳遞、腳位與導線電容、setup / hold 表）。
- 驗證：每個設計的 SKY130 網表用 yosys `read_liberty`（PDK 自己的 Liberty 模型）證明與 `veryl build` 等價；
  testbench 跑在 SKY130 網表上；DEF 讀回來對照 LEF 檢查。

### v1.6：設計規則（`ad27b6d`）

- `asic/layout.rs` 把結果變成矩形（導線、tech LEF 的 via、腳位短線、電源），`asic/drc.rs` 連同元件自己的腳位與
  內部形狀一起檢查：短路、間距、cut 間距、單獨 via 墊片的最小面積、斷路。
- 細部繞線改成遵守 SKY130 的規則：met3 / met4 隔一條軌道、電源軌下不走 met1、met1–met2 via 擺成棋盤格且不緊鄰
  別人的腳位 via、線端與 via 墊片保留一格距離、避開正反器內部的 met1、via 只放在路徑真的換層的地方。
- 繞不乾淨時自動換更大的晶粒再試。Ram 與 RiscvSoc 都做到 0 個違規。

### v1.7：GDSII，用 KLayout 檢查（`faa5e45`）

- `asic/gds.rs`：`--gds` 輸出 PDK 自己的元件版圖加上頂層的放置、繞線、via、電源與 IO 腳標籤（SKY130 的層號）；
  同一網路靠太近的 via 墊片之間補上金屬，避免缺口（notch）。
- `tools/gds_check.py`：用 KLayout 的 Python 模組讀回 GDS，檢查頂層、元件數、元件不重疊，並跑 KLayout 自己的
  寬度與間距檢查；`test.sh` 對每個 SKY130 設計都跑。
- 這個獨立檢查抓到的問題都修掉了：IO 腳太小（met4 最小面積）、太靠近角落、晶粒邊上放不下所有腳、
  輸入直接接輸出的網路沒有被繞（vlib 也有這個問題，一併修好）等。26 個設計在兩種檢查下都乾淨。

### v1.8：更好的結果（`54be6be`）

- 對應多用幾種 SKY130 元件：3 輸入的 NAND / NOR / AND / OR、AOI22 / OAI22，以及 AO21 / OA21
  （`a21o_1` / `o21a_1`：加法器的進位只要一個元件）。
- Alu：68 → 114 MHz、面積少 16 %；RiscvSoc：53 → 63 MHz、面積少 7 %。所有設計仍然 DRC 乾淨、形式等價。
- 繞線不乾淨時最多重試四次，每次換更大的晶粒與新的佈局種子。

### v1.9：IDE 裡的 SKY130（`285be7f`）

- 標題列的後端選單：FPGA、ASIC · vlib、ASIC · SKY130（網址可用 `#…&pdk=sky130`）。同樣的階段換成 SKY130 的
  元件與層，細部繞線階段與狀態列顯示 DRC 摘要，可下載 `.v` / `.def` / `.gds`。
- npm test 在瀏覽器核心上跑三個 SKY130 範例，GDS 與命令列產生的逐位元組相同。

### v2.0：2.0.0（`85fe18e`，tag `v2.0` = `d70d279`）

- 文件：根目錄與 veryl-eda 的 README 說明 SKY130，列出限制；路線圖標記完成。
- `./test.sh --full` 全部通過（約 47 分鐘）：veryl-sim、cargo test、教學流程、npm test，以及 veryl-eda 的
  形式等價（含每個設計的 SKY130 網表）、FPGA 流程、自己佈局繞線的共同模擬、26 個 SKY130 設計的 DRC 與 KLayout 檢查。

**現在的限制**：SKY130 沒有 SRAM macro（記憶體是正反器，大記憶體的設計流程很慢）；只有典型一個角落；
沒有寬金屬間距表、天線規則與 LVS；GDS 檢查用的是 KLayout 的寬度 / 間距規則，不是完整的 SKY130 規則檔。

## v2.1：`v2c` 與使用手冊

- `d70d279` 這份 `history.md`。
- `858de36` `v2c`：像 git 一樣的單一指令（`v2c sim`、`list`、`synth`、`fpga`、`asic`、`gatesim`、`cc`、`pdk`、`version`、`help`），
  隨 `veryl2chip-eda` 安裝。兩個 crate 的命令列移到函式庫的 `cli` 模組，舊的 `veryl-sim` / `veryl-eda` 指令只是包裝，照樣可用；
  不認得的選項改為錯誤（結束碼 2），提示 `v2c help <子指令>`。`veryl-eda/tests/v2c.rs` 測每個子指令。
- `3fa558a` 使用手冊 `manual/`（繁體中文，14 章）：命令列一律用 `v2c`，手冊裡的指令都實際跑過。
- 2.1.0：兩個 crate 升版，讓 `cargo install veryl2chip-eda` 裝到 `v2c`。
- 網頁 IDE 在手機上可以用（responsive）：窄螢幕時側欄變成抽屜、標題列的選單收進 ⋯、編輯器字放大，合成流程與虛擬板改成直向排列；桌面版不變。

---

## 往 v3.0：RV64 + SV39 與 ECP5（規劃在 `web/PLAN.md`）

目標是一顆用 Veryl 寫、有 SV39 虛擬記憶體的 RV64 CPU，放進 ECP5（ULX3S）跑 xv6。iCE40UP5K 放不下
（RV32IMA 的 `RvCore` 已經用掉 3817 / 5280 個 LUT4），所以先接上更大的 FPGA。

### v2.2：ECP5 對應（M29）

- `veryl-eda/src/ecp5.rs`：`LUT4`（和 iCE40 共用切割式 LUT 覆蓋，iCE40 的輸出逐位元組不變）、`CCU2C` 進位鏈
  （兩個位元一顆；進位要離開進位鏈或分岔時，後半只傳遞進位，或經過緩衝 LUT——nextpnr-ecp5 不接受分岔的進位鏈）、
  `TRELLIS_FF`（時脈與 reset 極性、同步 / 非同步、reset 值都是 slice 的多工器）。
- `v2c fpga --arch ecp5 [--lpf] [--config] [--bit]`：呼叫 nextpnr-ecp5 與 ecppack，印出最後的用量與 Fmax；`v2c gatesim ecp5`。
- netsim 與 veryl-sim 的閘級模型加上三種 ECP5 元件（依 yosys 的 `cells_sim.v`）。
- 驗證：`cargo test` 的所有情境在 ECP5 網表上通過；`test.sh` 對每個設計做 ECP5 閘級模擬、nextpnr-ecp5 + ecppack，
  並用 yosys 的 ECP5 模型證明與 `veryl build` 等價。ECP5 的正反器上電值是 `REGSET`（reset 值為 1 的上電就是 1），
  所以這項證明拿掉初值，只比邏輯。
- `fpga/ecp5_routed.sh`：nextpnr 繞好的網表（`--write`）與對應出的網表做形式等價，15 個設計通過。途中發現 yosys 的
  `TRELLIS_COMB` 模型在 generate 區塊裡寫 `wire FCO = ...`，真正的 `FCO` 沒被驅動（改用 `fpga/ecp5_comb.v`）；
  nextpnr 把常數輸入併進真值表，靠的是沒接的 LUT 輸入讀成 1。
- 之後的方向調整：先做 RV64 處理器（用官方 `veryl build` + Verilator 驗證，跑 xv6、Linux），ECP5 的 block RAM 等等之後再做。

---

## 附註

- v1.2 與 v1.5–v1.9 的 git tag 是後來（2.1 時）才在上表的 commit 補上的。
- 每個 M 的細節見 `web/PLAN.md`，各工具的用法見 `README.md`、`veryl-sim/README.md`、`veryl-eda/README.md`。
