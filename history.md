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
| v2.2 | 2026-10-27 | `1b57624` | 2.2.0：Lattice ECP5 對應 + nextpnr-ecp5 | |
| v2.3 | 2026-10-27 | `225f9b3` | 2.3.0：RV64 處理器 `Rv64Core`（Veryl），通過 riscv-tests | |
| v2.4 | 2026-10-27 | `0527a57` | 2.4.0：xv6 在 `Rv64Core` 上開到 shell | |
| v2.5 | 2026-10-27 | `02a22ef` | 2.5.0：C 擴充（壓縮指令）、每個指令 2 拍 | |
| v2.6 | 2026-10-27 | `c5a1723` | 2.6.0：Linux 在 `Rv64Core` 上開機 | |
| v2.7 | 2026-10-27 | `6149049` | 2.7.0：隨機指令測試與中斷測試 | |
| v2.8 | 2026-10-27 | `70cf899` | 2.8.0：veryl-eda 合成 `Rv64Core`，閘級網表在 Verilator 上通過測試 | |
| v2.9 | 2026-10-27 | `fcfa73b` | 2.9.0：ECP5 block RAM，`Rv64Fpga` 經 nextpnr-ecp5 佈局繞線，繞線後的網表通過測試 | |
| v2.10 | 2026-10-27 | `8dbe56c` | 2.10.0：大設計的全域佈局，`Rv64Core` 在 vlib 上自己佈局繞線，繞線後的網表通過測試 | |
| v2.11 | 2026-10-27 | `f0ce858` | 2.11.0：Linux 跑 busybox，有 shell 可以互動 | |
| v2.12 | 2026-10-27 | `7b0b7ff` | 2.12.0：veryl-emu，把設計編譯成 WebAssembly 的模擬器 | |
| v2.13 | 2026-10-27 | `4b63bc1` | 2.13.0：IDE 的模擬機，瀏覽器裡開 Linux | |
| v2.14 | 2026-10-27 | `e4b757c` | 2.14.0：veryl-emu 加速約 1.9 倍 | |
| v2.15 | 2026-10-27 | `2283ee7` | 2.15.0：開發板 1：GPIO（Veryl 控制器 + Linux 驅動） | |
| v2.16 | 2026-10-27 | `9bb24bb` | 2.16.0：開發板 2：IDE 裡的虛擬開發板 | |
| v2.17 | 2026-10-27 | `ac29810` | 2.17.0：開發板 3：快照開機、存狀態 | |
| v2.18 | 2026-10-27 | `b428cc3` | 2.18.0：開發板 4：檔案進出板子 | |
| v2.19 | 2026-10-27 | `c239ae3` | 2.19.0：開發板 5：MicroPython | |
| v2.20 | 2026-10-27 | `8bd9404` | 2.20.0：開發板 6：C 程式 | |
| v2.21 | 2026-10-27 | `dfdddd2` | 2.21.0：開發板 7：螢幕 | |
| v2.22 | 2026-10-27 | `9ded8c5` | 2.22.0：riscv-emu 1：指令集模擬器 | |
| v2.23 | 2026-10-27 | `0d52ded` | 2.23.0：riscv-emu 2：IDE 的引擎 | |
| v2.24 | 2026-10-27 | `cfa72ae` | 2.24.0：riscv-emu 3：翻譯成 WebAssembly | |
| v2.25 | 2026-10-27 | `f7e2daf` | 2.25.0：四種目標：FPGA / ASIC / veryl-emu / riscv-emu | |
| v2.26 | 2026-10-28 | （本版） | 2.26.0：IDE 依專案啟用按鈕、建議步驟、範例標記；手冊第 16 章範例總表 | |

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

### v2.3：`Rv64Core`，通過 riscv-tests

- 方向：先做出跑得起 xv6、之後 Linux 的 RV64 處理器，HDL 先用官方工具鏈驗證（`veryl build` + Verilator），
  v2c 等 CPU 做對了再跟上。周邊一開始就用 Veryl 寫（之後上 FPGA 用得到）。
- `examples/rv64/`（獨立的 Veryl 專案）：
  - `Rv64Core`：多週期 RV64IMA + Zicsr + Zicntr + Zifencei + Sstc，M / S / U 模式、陷阱委派、
    SV39（三層走訪、大頁、SUM / MXR / MPRV、A / D 由硬體寫回）。
  - `Rv64Soc`：RAM 128 MB、CLINT、PLIC、UART 16550，記憶體映射和 QEMU `virt` 相同。
  - Verilator 測試平台：載入 ELF、`tohost`、UART ↔ 終端機、spike 格式的指令紀錄。
- 驗證：官方 riscv-tests 的 rv64ui / um / ua / si / mi，`-p` 與 `-v`（虛擬記憶體）共 194 支全部通過
  （第一次跑就過了 192 支；補上除錯觸發器 CSR 與可讀寫的 PMP 暫存器之後全過）；`ma_data` 要硬體支援沒對齊存取，不在清單內。
  `-p` 的測試和 spike 逐指令比對，除了 spike 有觸發器、`marchid`、A / D 用 page fault、SC 偶爾失敗這四個已知差異外完全相同。
- 版本 2.3.0（兩個 crate 本身沒有變動，版本跟著專案走）。

### v2.4：xv6 開到 shell

- 官方 xv6-riscv 只改三處（`examples/rv64/xv6/build.sh`）：`-march=rv64ima_zicsr_zifencei -mabi=lp64`；
  `virtio_disk.c` 換成 RAM 磁碟 `xv6/ramdisk.c`（同樣三個函式，fs.img 放在 0x8800_0000，SoC 的 RAM 改成 256 MB）；
  `vm.c` 把它對應進 kernel 分頁表。UART、PLIC、CLINT、Sstc 都照 QEMU `virt` 做，xv6 的驅動不用改。
- 第一次開機就到 `$`，`ls` 正確。`xv6/test.sh` 用測試平台的腳本功能（每看到提示「$ 」送一行）自動打
  `echo`、`cat`、`mkdir`、`ls`、`wc` 並檢查輸出。
- 核心：Svadu（`menvcfg.ADUE = 1` 才由硬體寫回 A / D，否則 page fault，xv6 會打開）；16 筆全關聯 TLB
  （只存成功的葉節點，命中但權限或 A / D 不夠時照樣走訪，所以行為不變），虛擬記憶體下每個指令從約 10 拍降到約 4.8 拍；
  `mstatus.FS` 改成可寫（沒有 F 擴充但有 S 模式時規格允許，和 spike 一樣）。
- 改完之後 riscv-tests 的 `-p` 與 `-v` 共 194 支都和 spike 逐指令相同，只剩三個已知差異（觸發器、`marchid`、spike 偶爾讓 SC 失敗）。
- 開機到 `$` 約 4.5 億個指令、21 億拍，Verilator 上約 5–6 分鐘；九成花在 `kinit` 逐位元組填滿 128 MB。

### v2.5：加速與 C 擴充

- 加速（行為不變）：RAM 在請求的同一拍回應（模擬用的 SoC；匯流排本來就等 ack，上 FPGA 時換成有延遲的記憶體）；
  一個指令完成的那一拍就開始取下一個指令，有中斷、位址不合法或系統指令時才回到 Fetch。一般指令從 4 拍變 2 拍。
- C 擴充：16 位元指令展開成 32 位元再解碼；4 位元組對齊時取 4 位元組，否則取 2 位元組，跨邊界的 32 位元指令用 Fetch2 取後半
  （另外轉換位址，可能在下一頁）；沒有取指令沒對齊的例外；`mepc` / `sepc` 只清 bit 0；`misa` 加上 C。
- riscv-tests 加上 rv64uc，196 支全過；和 spike 逐指令比對多一個已知差異（spike 的 `misa` 可以寫入關掉 C，
  ma_fetch 測試因此走另一條路）。
- xv6 改用 `rv64imac` 編譯（kernel 有 5000 多個壓縮指令），開機加 `xv6/test.sh` 的指令從 6 分 33 秒變 3 分 19 秒。

### v2.6：Linux

- OpenSBI（官方，`fw_payload`：韌體 + 裝置樹 + kernel 一個檔案）在 `Rv64Core` 上偵測到 RV64IMAC、Sstc、Zicntr、Svadu、16 組 PMP，
  切到 S 模式；Linux 6.12（官方，tinyconfig 加上 `examples/rv64/linux/rv64soc.config`：沒有 FPU、單一 hart、只有 initramfs）
  第一次就開到 `/init`。`linux/init.c` 不用 C 函式庫，印出 `/proc/version`、`/proc/cpuinfo` 後關機。
- SoC 加上 QEMU 的關機裝置（0x0010_0000，寫 0x5555 結束模擬），OpenSBI 的 shutdown 與 Linux 的 poweroff 都經過它。
- 建置：kernel 用 sparse checkout（只取 Kconfig / Makefile 與用得到的驅動，約 300 MB，這台機器磁碟只剩幾 GB）；
  要用 LLVM（GNU 的 riscv64-unknown-elf-ld 做不出 vDSO 的共享物件與 OpenSBI 的 PIE）；在 macOS 上編 kernel 的主機工具
  要補 `<elf.h>`（RISC-V 工具鏈附的 musl 版）、`<byteswap.h>` 與 `-D_UUID_T`。`linux/build.sh` 從頭建完約 1.5 分鐘。
- 開機到關機約 4200 萬個指令、1.2 億拍，Verilator 上約 20 秒；`linux/test.sh` 檢查輸出。

### v2.7：驗證處理器的正確性

- 方向：最重要的是 Rv64 處理器的正確性，以及它能在我們的 EDA 上正確合成與佈局繞線；模擬一律用 Verilator
  （v2c / veryl-sim 的改進先擱著，做到一半的修補檔另外存著）。
- `examples/rv64/verify/randgen.py`：隨機程式（RV64IMAC + Zicsr 全部指令、邊界值、沒對齊、非法編碼、不存在的 CSR、
  ecall / ebreak），M 模式，或在 S / U 模式跑在 Sv39 上（資料頁的權限、A / D、ADUE、SUM、MXR 都隨機）。
  `verify/random.sh` 和 spike 逐指令比對：300 個種子 × 三種模式共 900 支、每支 2000 個指令，全部相同。
  過程中修了產生器自己的問題（分支跳過 `la`）、spike 停不下來時把磁碟寫滿（加上時間與行數上限），
  以及三個和 spike 不同的地方（計數器致能位元、`mcountinhibit`、陷阱清掉 LR 保留）。
- `verify/irq.S`：中斷的定向測試 10 項（M / S 計時器、軟體中斷、wfi、U 模式下的 M 中斷、PLIC 兩個 context、優先順序）。
- `examples/rv64/test.sh`：建置、riscv-tests、隨機測試、中斷測試、Linux（`--xv6` 加上 xv6）。

### v2.8：在我們的 EDA 上合成 Rv64

- 乘除法從組合邏輯（64 位元乘法器與除法器）改成 `S_MULDIV` 狀態裡 64 拍的反覆式（移位相加、恢復式除法，
  有號數先取絕對值、最後補號；除以 0 與溢位照規格）。`v2c synth` 的網表從約 13.2 萬個元件降到 60,912 個。
- `examples/rv64/sim/build_gates.sh KIND`：veryl-eda 合成 `Rv64Core`，網表改名成 `rv64_Rv64Core` 換掉 SoC 裡的 RTL，
  周邊與測試平台不變，所以每個測試都能直接拿網表跑：`gate`（通用閘）、`ecp5`（29,123 LUT4 + 455 CCU2C + 6,251 FF，
  用 yosys 的 ECP5 元件模型）、`vlib`（64,988 個標準元件）、`sky130`（59,243 個 sky130_fd_sc_hd 元件）。
- 結果：四種網表都通過 196 支 riscv-tests；通用閘網表另外跑 300 支隨機程式（和 spike 相同）、中斷測試 10 項、Linux 開機（1.2 億拍和 RTL 完全相同，Verilator 上 23 分鐘，RTL 是 50 秒）。
  RTL 版的整套回歸（含 xv6）也重跑通過。

### v2.9：Rv64 在 FPGA 上佈局繞線

- `examples/rv64/src/rv64fpga.veryl`：`Rv64Fpga`，放得進 LFE5U-85F 的系統。RAM 128 KB（8 個位元組通道的同步讀取記憶體，
  下一拍回應）、序列 UART、CLINT、LED、關機裝置；程式與 tohost 位址從載入埠一拍一個位元組送進來。
  `sim/fpga.cpp` 是只用腳位的測試平台（解 UART 的序列資料、看 `o_halt` / `o_code`）。
- veryl-eda 的 ECP5 對應加上 block RAM：同步讀取的記憶體（和 iCE40 同一套 `bram::find_mems`）變成 `DP16KD`
  （2048 × 9，A 埠寫、B 埠讀；更深的記憶體分列，寫入致能由高位址解碼、讀出由暫存的高位址選擇）。netsim 與 veryl-sim 的
  `gates.rs` 都有它的模型；yosys 的 `cells_sim.v` 只宣告 DP16KD，Verilator 用 `veryl-eda/fpga/ecp5_dp16kd.v`。
- `fpga/ecp5.sh`：v2c → nextpnr-ecp5（ULX3S 腳位 `fpga/ulx3s.lpf`）→ ecppack。用量 32,469 TRELLIS_COMB（38 %）、6,653 FF、
  64 DP16KD（30 %）；Fmax 12.7 MHz（板子的 25 MHz 不夠，關鍵路徑是 64 位元加法的進位鏈加上繞線）。
- 繞線後的網表：nextpnr 把 DP16KD 的常數腳位拿掉改成 `*MUX` 參數，`ecp5_unio.py` 把它們接回來（沒接的腳讀 1、`INV` 反相），
  yosys 寫成 Verilog 給 Verilator。RTL、ECP5 網表、繞線後的網表都通過 110 支 `-p` riscv-tests
  （`-v` 的測試要 512 KB，比 85F 的 block RAM 還多）。
- ASIC（veryl-eda 自己的佈局繞線）跑 `Rv64Core` 時全域繞線太慢，移到 v2.10。
- xv6 的 `usertests -q`（62 項）在 RTL 上全部通過：293 億個指令、686 億拍，Verilator 3.4 小時。

### v2.10：Rv64Core 用自己的 ASIC 流程佈局繞線（vlib）

- 問題：`v2c asic` 跑 `Rv64Core`（6.6 萬個元件）時，全域繞線一個多小時沒有結束，第一輪的溢出量（330 萬）比整個繞線格的容量還多。
  原因是佈局：元件照網表順序蛇形排進列，再模擬退火；元件這麼多時，退火在有限的移動次數裡解不開，線都太長。
- `asic/place.rs` 的 `global_place`：1 萬個元件以上（而且沒有巨集）先做全域佈局。二次線長（星形模型，每個元件移到它所連
  各條線中心的加權平均，IO 腳固定），用 Gauss-Seidel 解；和遞迴二分交替（沿較長邊排序、在一半寬度處切開，直到每區只剩幾個元件，
  在區內平均排開），攤開後的位置以逐輪變大的權重拉住下一次的解。最後一次攤開的結果排進列（依 y 填滿各列、列內依 x），
  再交給原本的退火低溫微調。1 萬個元件以下的設計不受影響。
- `asic::def` 每條線都掃過全部元件找腳位（8 萬條線 × 6.6 萬個元件），改成先建好「線 → 腳位」的表。
- `VERYL_EDA_PROFILE` 另外印出全域繞線每一輪的溢出量，以及探測後放大晶片的原因。
- 結果（vlib）：整個流程約 5 分鐘，0 衝突、0 斷線，時脈樹 1534 個緩衝器、skew 0.55 ns，Fmax 25.6 MHz（關鍵路徑是漣波進位的加法器）。
  `examples/rv64/sim/build_gates.sh vlib_routed` 把繞線後的網表（含時脈樹、緩衝器）放回 Verilator，通過 196 支 riscv-tests。
- SKY130 版：晶片放大三次後細部繞線仍留下幾十個衝突與 1–3 個斷線，暫緩處理。
- 原則（使用者）：Linux、xv6 這種很久的測試只在 RTL 的 Verilator 版上跑，網表只跑 riscv-tests。

### v2.11：Linux 有 shell 了（busybox）

- 方向（使用者）：先不處理 SKY130 的衝突；不重建網頁、不跑 npm test；很久的測試只在 RTL 的 Verilator 版上跑。
- C 函式庫：官方 musl 1.2.5。它的 configure 腳本不在允許執行的範圍（只允許 `git clone` 與 `make`），所以 `linux/musl.mak`
  手寫 config.mak，`make` 編成靜態的 `libc.a`，裝進 `linux/build/sysroot`，再加上 kernel 的 `headers_install`。
  編譯器是 clang（`--target=riscv64-unknown-linux-musl`，rv64imac / lp64），128 位元浮點等輔助函式用
  `riscv64-unknown-elf-gcc` 附的 rv64imac / lp64 `libgcc.a`；`linux/musl-cc` 包起來（clang 找不到 GCC，所以自己放 musl 的 crt1 / crti / crtn，
  部分連結 `-r` / `-nostdlib` 時不放）。
- busybox 1.36.1：defconfig、靜態、拿掉 `tc`（需要較舊的 kernel 標頭），1 MB、401 個指令；主機工具在 macOS 上直接能編。
- initramfs：busybox 與它的連結、`linux/init.sh`（`/init`：掛上 proc / sysfs / devtmpfs / tmpfs，`setsid cttyhack sh`，shell 結束就關機）；
  `linux/init.c` 拿掉。kernel 設定加上 `BINFMT_SCRIPT`、`MULTIUSER`、`FUTEX`、`POSIX_TIMERS`、`SHMEM` / `TMPFS`。
- 結果：開機到 shell 約 8000 萬個指令、2.3 億拍，Verilator 上約 30 秒；鍵盤輸入經 UART 收字中斷（PLIC）進來，`ps`、`free`、`ls`、
  算術都正常；`linux/test.sh` 用 `rv64sim -s` 打幾個指令，最後 `poweroff -f` 結束模擬。

### v2.12：veryl-emu（編譯成 WebAssembly 的模擬器）

- 動機：veryl-sim 是 4 態的解譯器，組合邏輯每次都整個重跑，比 Verilator 慢上千倍，Rv64 的 256 MB RAM 也放不進它的訊號表。
  使用者要求 veryl-sim 保持原樣，另外做一個 veryl-emu。
- `veryl-emu/`（新 crate，不發布）：展開用 veryl-sim 的 `elab.rs` 複製一份，只改陣列（一個訊號、一塊記憶體）與拿掉閘級網表；
  `ir.rs` 依 veryl-sim `Sim::eval` 的規則在編譯時決定每個運算式的寬度與正負號；`gen.rs` 排序組合邏輯、處理非阻塞寫入
  （只有 always_ff 也會讀的暫存器走影子區、陣列走寫入佇列，Rv64Soc 只有 30 個、240 位元組）、產生 i64 字組的程式碼；
  `wasm.rs` 是自寫的 WebAssembly 編碼器。命令列 `veryl-emu --top M --stop SIG -o out.wasm`，`js/emu.mjs` 是 Node / 瀏覽器的測試平台。
- 驗證：`tests/check.sh` 和 veryl-sim 差分比對（第一次就抓到多字組變數移位的 select 順序錯誤）；Rv64Soc 編成 86 KB 的 wasm，
  196 支 riscv-tests、120 支隨機程式與 spike 逐指令相同、中斷測試、Linux 開到 busybox 的 shell。
- 速度：Linux 開機 2.3 億拍，Node 24 上 104 秒（220 萬拍 / 秒），Verilator 32 秒（720 萬拍 / 秒）。
- 網頁暫時不重建，所以 veryl-emu 還沒有進 IDE（v2.13）。

### v2.13：IDE 的模擬機（瀏覽器裡開 Linux）

- 討論：RV64 這種大設計放不進 FPGA，也不適合 ASIC，所以 IDE 除了 FPGA（虛擬板）與 ASIC（版圖）之外，加上第三種「模擬機」：
  設計用 veryl-emu 編成 WebAssembly，當成一台機器開機。放成和 ⚡ 虛擬板並列的「🖥 模擬機」按鈕與分頁（不放進合成後端的選單，因為它不經過合成）。
- `veryl-wasm` 加上 veryl-emu 與 `emu_compile` 指令（核心 wasm 9.9 → 11.1 MB）。`web/src/emu_machine.ts`（沒有 DOM：載入 ELF / 二進位、重設、
  UART、關機裝置）、`emu_worker.ts`（每片約 50 ms，回報輸出與速度）、`ide/emu.ts`（工具列、終端機：處理 Linux 用的 VT100 序列，
  打字經過隱藏的 textarea，所以手機、輸入法、貼上都可以）。專案的 `machine.json` 說明頂層與腳位。
- 範例「RV64 + Linux（模擬機）」：Rv64Core + Rv64Soc 與 machine.json；`img_linux.js`（OpenSBI + Linux + busybox，gzip + base64 約 2.4 MB）
  第一次開機才用 `<script>` 載入，所以 `file://` 也能用。這種專案按 ▶ 測試或合成頂層時改成提示（veryl-sim 展開 256 MB 的陣列會讓分頁當掉）。
- 結果：瀏覽器（Claude 的預覽，Chromium）每秒約 130–160 萬拍，約 2.5 分鐘開到 `rv64:~$`，`uname -a`、`ls /bin | wc -l`、`free` 都正常。
- npm test 新增：Node 用同一個 `emu_machine` 跑 rv64 範例到 OpenSBI 的平台橫幅（約 1500 萬拍，7 秒）。
  這次重建網頁時也抓到 v2.10 的錯誤：全域繞線的進度計時用了 `std::time::Instant`，wasm 上沒有時鐘，網頁的 ASIC 流程全部失敗；改用 `asic::now()`。

### v2.14：veryl-emu 加速

- 先量測：每拍約 440 ns，組合邏輯（`settle`）佔約 390 ns。wasm 加上 name 區段，`VERYL_EMU_CHUNK=1` 讓每個程序一個函式，
  用 `node --cpu-prof` 看：PLIC 找最高優先權的 32 次迴圈 13%、TLB 16 筆比對迴圈 12%、立即值的 `{ir[31] repeat 52, …}` 約 8%。
- 改進：常數範圍（≤ 128 次）的 `for` 迴圈展開（在 veryl-sim 的 IR 上代換迴圈變數），常數索引的陣列讀寫用固定位址，
  `repeat` 只算一次（1 位元用 0 − bit 填滿），`if` / 三元 / 邏輯運算的條件直接產生 i32。每拍 440 → 220 ns。
- 活動偵測：每個組合程序一個髒旗標，寫入讓值改變時標記讀它的程序，`settle` 只跑髒的。Rv64Soc 每拍平均跑 108 / 275 個程序
  （`VERYL_EMU_COUNT` 計數），但重的程序每拍都要跑（例如 mtime 每拍變，CSR 讀取多工器就每拍重算），所以這一項對它幾乎沒有差；保留給閒置部分多的設計。
- 結果：Node 上 Linux 開到 shell 104 → 55 秒（420 萬拍 / 秒；Verilator 720 萬）；差分測試、196 支 riscv-tests、隨機程式、中斷測試、
  Linux、npm test 都通過。網頁的核心 wasm 重建：瀏覽器裡的模擬機從約 150 萬拍 / 秒變成約 370 萬，開到 `rv64:~$` 約 2.5 分鐘 → 61 秒
  （停在 shell 等輸入時，活動偵測讓它跑到 740 萬拍 / 秒）。

### v2.15：開發板 1，GPIO

- 開發板規劃（`web/PLAN.md`「虛擬樹莓派」）：MicroPython 為主、C 為輔、shell 一定有；v2.15–v2.21。
- `Rv64Gpio`（`examples/rv64/src/rv64soc.veryl`）：16 支腳，暫存器和 SiFive 的 GPIO 相容，所以 Linux 現成的 `gpio-sifive` 驅動直接能用；
  輸入先過一級暫存器，上升 / 下降緣與高 / 低準位的待處理位元黏住、寫 1 清掉，腳 k 的中斷是 PLIC 的來源 16 + k（`gpio-sifive` 的腳數
  等於裝置樹列出的中斷數）。位址 0x1006_0000（和 QEMU sifive_u 相同）；SoC 多了 `o_gpio` / `o_gpio_oe` / `i_gpio`。
- 裝置樹：GPIO 控制器（腳名 LED_ACT、LED_USER、BUTTON、GPIO3…）、`gpio-leds`（act 預設心跳、user）。kernel：GPIOLIB、GPIO_SIFIVE、
  GPIO_CDEV、GPIO_SYSFS、LEDS_GPIO、心跳觸發；sparse checkout 加上 `drivers/leds/`。
- 測試平台印出 GPIO 輸出的變化，腳本的 `!gpio N=V` 設定輸入腳。`linux/test.sh`（Verilator 與 `SIM=emu/rv64emu`）檢查：LED、匯出的輸出腳
  （`out=0x0022`）、按鈕 0 → 1、邊緣中斷經過 PLIC（`/proc/interrupts` 計數 1）。riscv-tests 與其他回歸不變。
- 網頁的範例與 Linux 映像在 v2.16（IDE 的開發板）一起更新。

### v2.16：開發板 2，IDE 裡的虛擬開發板

- `machine.json` 加上 `gpio`（輸出值、輸出致能、輸入的埠）與 `board: "pi"`。`emu_machine.ts` 每 1024 拍取樣一次 GPIO 輸出，算出每支腳的
  佔空比（亮度），`setGpio` 設定輸入；worker 每片回報 `duty` / `oe`，收 `{type: 'gpio', bits}`。
- `ide/pi.ts`：樹莓派風格的板子（SVG）：40 針排針，GPIO 3–15 放在樹莓派相同 BCM 編號的位置（例如 GPIO 5 在第 29 腳），被驅動成 1 的腳會亮；
  PWR、ACT（GPIO 0，心跳）、USER（GPIO 1）、按鈕（GPIO 2）。下面是虛擬 iCEBreaker 的麵包板（`breadboard.ts` 改成可以傳入排針定義，
  `bbmodel.ts` 不變）：預設接好 GPIO 5 的 LED + 電阻、GPIO 6 的按鈕 + 下拉電阻，配置存在專案（`piBoard`）。
- 範例「RV64 開發板：Linux + GPIO（模擬機）」（原本的 rv64_linux），Linux 映像換成 v2.15 有 GPIO 的版本。
- 驗證：瀏覽器裡開機（約 70 秒，同時跑 npm test），shell 點亮 USER LED 與 GPIO 5（排針亮、麵包板 LED 亮），按住板上按鈕讀到 1、放開讀到 0，
  按住麵包板按鈕讀到 GPIO 6 = 1。npm test：Node 上開到 shell，用 shell 點亮 GPIO 5，`bbmodel` 算出麵包板 LED 亮。

### v2.17：開發板 3，快照開機

- 機器的全部狀態都在模型的線性記憶體裡：`Machine.snapshot()` 存非 0 的 4 KB 頁（"VESN" 格式），`restore()` 還原；`fingerprint(meta)` 是編譯結果
  的訊號配置，快照只用在同樣的配置上。開到 shell 時只有 2625 頁（10 MB），gzip 後 2.4 MB。
- `web/snapshot.mjs`（`build.mjs` 最後執行）：在 Node 用同一個核心與機器開到 `machine.json` 的 `prompt`，寫出 `img_snap_linux.js`（記憶體、拍數、
  開機訊息、指紋）；模型、映像、設定都沒變就不重做（約 1 分鐘）。
- IDE：開機先找瀏覽器裡存下的狀態（💾，IndexedDB，依專案），再找內附的快照，都沒有才冷開機；開機訊息重新顯示在終端機；⟲ 是冷開機。
  瀏覽器實測：從快照約 10 秒有 shell（冷開機約 60 秒），存狀態後重新開機，`/tmp` 裡的檔案還在。
- npm test：冷開機的機器與從快照還原的機器打同樣的指令（`uname -a`、算術、`/proc/cpuinfo`），輸出相同。

### v2.18：開發板 4，檔案進出板子

- RAM 最後 16 MB（0x8F00_0000）是交換區：開頭一行 `VERYLFS <大小>`，後面接 tar。第一版把它排除在 Linux 的記憶體之外，結果 `/dev/mem` 讀到
  `Bad address`：RISC-V 的 `/dev/mem` 只允許 Linux 記憶體範圍內的位址；改成裝置樹的 reserved-memory（Linux 不配置它，但仍在記憶體裡）。
  kernel 開 DEVMEM、關 STRICT_DEVMEM。
- 板子上的 `getfiles`（`/init` 開機時執行）與 `savefiles`（busybox 的 dd + tar；寫完送出 `ESC ] 1337 ; veryl-save BEL`）。
- IDE：`machine.json` 的 `files`；專案的檔案（Veryl、machine.json、.pcf 以外）用 `tar.ts`（ustar）打包放進交換區（冷開機由 `/init` 讀，
  從快照開機時自動打 `getfiles`，⇅ 隨時再送）；worker 在輸出裡看到通知就讀回交換區，IDE 把檔案寫進專案（隱藏檔不要）。終端機不顯示 OSC 序列。
- 範例加上 `board/blink.sh`、`button.sh`。瀏覽器實測：開機後 `/root` 有兩個腳本、`sh blink.sh` 閃 5 次，板子上建的 `notes.txt` 經 `savefiles` 出現在專案。
  `linux/test.sh`（Verilator 與 veryl-emu）用 `-l` 放一個檔案進去檢查 `getfiles`；npm test 在從快照還原的機器上做一次來回。

### v2.19：開發板 5，MicroPython

- 官方 MicroPython v1.24.1 的 Unix 版本（`git clone` + `make`），用 `linux/musl-cc` 交叉編譯成靜態 RV64 執行檔（約 400 KB）。
  主機上先編 mpy-cross（`/usr/bin/clang`：Homebrew 的 clang 找不到 macOS SDK）；`UNAME_S=Linux` 讓 Makefile 用 lld 的連結參數；
  沒有子模組，所以關掉 ffi / btree / ssl / FAT / littlefs，`MPY_LIB_DIR` 指向一個只有 README 的目錄（manifest 不用 micropython-lib）。
  新版 clang 的 `-Wunterminated-string-initialization` 要關掉。
- GC：`gchelper_generic.c` 的 RISC-V 版用 `register ... asm("x8")` 讀 s0–s11，clang 不保證這樣讀到暫存器（還警告「未初始化」），
  GC 會漏掃根；改用 `MICROPY_GCREGS_SETJMP`。
- `pi` 模組（frozen 進執行檔）：`LED`、`Button`、`Pin`、`sleep`，像 gpiozero；GPIO 0 / 1 走 `/sys/class/leds`（先把 trigger 設成 none），其餘走 sysfs GPIO。
- IDE：打開 `.py` / `.sh` 時 ▶ 變成「▶ 執行」；worker 送 Ctrl-C（在 REPL 裡再 Ctrl-D），等到 shell 提示符（`$ ` 結尾）才寫交換區、打
  `cd /root && getfiles > /dev/null && micropython 檔名`。板子沒開就先開機（從快照開機時也先送 Ctrl-C 叫出提示符）。編輯器加上 Python 與 shell 的語法顏色。
- 範例：`main.py`、`button.py`、`traffic.py`；麵包板預設多了 GPIO 12（黃）與 13（綠）兩顆 LED。
- 驗證：`linux/test.sh`（Verilator 與 veryl-emu）用 `micropython -c` 點亮 GPIO 13、讀按鈕、算 `2 ** 70`；npm test 在快照還原的機器上跑 MicroPython 點亮 GPIO 13。

### v2.20：開發板 6，C 程式

- veryl-eda 的 C 編譯器加上 Linux 目標（`Options::linux`、`--linux`）：沒有改型別系統，而是像 x32 一樣保留 32 位元的
  `int` / `long` / 指標，產生 RV64 程式碼時把算 32 位元整數的指令換成 *W 版（`addw`、`subw`、`mulw`、`divuw`、`sllw`、`sraiw`…），
  暫存器永遠是符號延伸的 32 位元值（`lw` 載入、`sltu` / `bltu` 比較都還是對的）。指標要 32 位元就夠，所以程式碰到的位址都要在
  2 GB 以下：程式在 0x10000，自己的 256 KB 堆疊在 bss（Linux 給的堆疊在高位址，不用），堆積用 `brk`。`argv` 因此不支援。
- 組譯器：`assemble_with(src, Opts { origin, rv64 })`，RV64 的 *W 指令、`ld` / `sd` / `lwu`、6 位元的移位量、`li` 用 `lui + addiw`；
  `elf_linux` 寫出一個 PT_LOAD 段的 ELF64。
- 執行期函式庫（`prelude.c` 用 `#ifdef __linux__` 分開）：系統呼叫（`__syscall`，ecall）、檔案、一行一行緩衝的標準輸出、
  `malloc`、時間、GPIO（`gpio_base` 用 `getdents64` 找 `/sys/class/gpio/gpiochipN`）。
- 驗證：spike + pk 執行 `src/rv/tests/*.c` 與新的 `tests/linux/files.c`（檔案、堆積、字串），輸出和主機編譯的相同；
  `linux/test.sh`（Verilator 與 veryl-emu）與 npm test（從快照還原的機器）在板子上執行編好的 C 程式、點亮 GPIO 12。
- IDE：開發板專案可以有好幾個 `.c`；▶ 執行時在瀏覽器裡編譯（wasm `cc` 的 `linux`，回傳 `elf`），執行檔放進交換區（tar 的模式 0755）；
  `savefiles` 不收二進位檔。範例 `blink.c`、`count.c`、`lights.c`。
- `emu/rv64emu.mjs` 的 `[gpio] out=…` 改成等 UART 的這一行結束才印（之前會把程式印的一行切開，`linux/test.sh` 對行首的檢查失敗）。

### v2.21：開發板 7，螢幕

- 裝置樹：`simple-framebuffer`（320 × 240、stride 640、`r5g6b5`）在 0x8EF0_0000，reserved-memory 用 `no-map`（fbdev 自己映射）。
  kernel：VT、FB、FB_DEVICE、FB_SIMPLE、FRAMEBUFFER_CONSOLE、8 × 8 字型；VT 會選 INPUT，所以 sparse checkout 要加 `drivers/input`
  （第一次編譯缺它失敗）與 `drivers/video`。核心的 console 仍然只在 ttyS0，fbcon 只顯示 tty1；`vt.global_cursor_default=0` 免得游標一直閃。
  開機的拍數幾乎不變。
- IDE：`machine.json` 的 `fb`；`Machine.screen()` 是 RAM 裡那塊的 view，worker 每 0.1 秒算一次雜湊，有變才送；板子畫面多一個 canvas。
- MicroPython：`pi.Screen`（`framebuf.FrameBuffer` 的子類別，`show()` 寫進 `/dev/fb0`）、`big_text`、`rgb`、顏色常數。
- C：`fb_init` 用 `mmap(0x40000000, …, MAP_SHARED | MAP_FIXED)` 把 `/dev/fb0` 映射到 2 GB 以下（指標是 32 位元）；`fb_pixel`、`fb_rect`、
  `fb_line`、`fb_circle`、`fb_text`（和 VGA 共用的 5 × 7 字型移到共用區）；`__syscall6`。
- 範例 `clock.py`、`shapes.c`。驗證：`linux/test.sh`（Verilator 與 veryl-emu）MicroPython 與 C 各畫一個點再讀回；npm test 確認開機問候語在
  螢幕上，MicroPython 畫的內容就是 `screen()` 的內容。

### v2.22：riscv-emu 1，指令集模擬器

- 使用者問：像 QEMU 那樣模擬指令集、轉成 wasm 會不會更快？會：veryl-emu 每一拍都要算整顆 Rv64Core 的訊號。於是另寫 **riscv-emu**
  （新的 crate，不依賴其他套件）：`cpu.rs`（RV64IMAC + Zicsr + Zicntr + Zifencei + Sstc + Svadu、M / S / U、SV39 與 TLB、中斷與例外，
  行為照 Rv64Core）、`bus.rs`（Rv64Soc 的 finisher、CLINT、PLIC、UART、GPIO，一個暫存器一個暫存器照 `rv64soc.veryl`）、CLI `rvemu`
  （選項和 `rv64sim` / `rv64emu` 相同，所以 `examples/rv64` 的腳本都能用 `SIM=` 換成它；`xv6/test.sh` 也加上 `SIM`）。
- 時間：`mtime` 每個指令加一（結果可以重現），`wfi` 沒事時跳到下一個計時器；`-r` 跟著真實時間（在終端機打字時的預設）。
- 驗證：riscv-tests 196 支全過（第一次跑 194 支：`minstret` 寫入的那個指令不能算；`tselect` / `tdata*` 要存在、讀 0）；
  和 spike 逐指令比對 192 支相同，另外 4 支是 RTL 也有的已知差別；`verify/random.sh` 90 支隨機程式（M / S / U）和 spike 相同；
  開 Linux 時和 RTL 的 commit log 前 589,593 個指令相同（第一個差別是讀 `cycle`）；`linux/test.sh` 1.6 秒（Verilator 50 秒、
  veryl-emu 107 秒）；xv6 `usertests` 全過（285 億個指令，5.6 分鐘，84 MIPS）。`cargo test`：手組的小程式、壓縮指令、
  riscv-tests 與 Linux（有建置時）。
- 根目錄的 `build.sh`、`test.sh` 與 CI 加上 riscv-emu。

### v2.23：riscv-emu 2，IDE 的引擎

- `riscv-emu/src/wasm.rs`：C ABI（`rv_*`），一個 instance 一台機器，位元組經過 `rv_buf`，RAM 直接讀寫；`Machine::state` / `set_state`
  與 `rv_save` / `rv_restore`（暫存器、CSR、周邊、RAM 的非零頁）。編成 59 KB、沒有 import 的 wasm（crate 加上 `cdylib`）。
- `web/src/rv_machine.ts`：`RvMachine`，和 veryl-emu 的 `Machine` 同樣的介面（load、reset、writeArea / readArea、screen、input、setGpio、
  snapshot / restore、step 回傳輸出與 GPIO 佔空比），`realtime` 時 mtime 跟著 `performance.now()`，hart 在 wfi 時回報 `idle`，worker 就睡 4 ms。
- IDE：`machine.json` 的 `riscv`；模擬機工具列的引擎選單（預設 riscv-emu，存在專案的 `emuEngine`），換引擎就重新開機；狀態列顯示 MIPS；
  存下的狀態以 `riscv-emu:<wasm 大小>` 當指紋。`build.mjs` 建 `dist/rvemu.js` 與 `dist/rv_machine.cjs`。
- 驗證：npm test 在 Node 上用 riscv-emu 冷開機（約 1.6 秒、50 MIPS），檔案、MicroPython、C、GPIO 12 / 13、螢幕；瀏覽器實測開機、
  執行 `shapes.c`、切換兩種引擎。
- 下一版的翻譯器（`jit.rs`、wasm 的 `rv_jit*` 與 `jit_ld` / `jit_st` / `jit_ar`、匯出可成長的函式表）已經在這版的程式裡，但沒有打開。

### v2.24：riscv-emu 3，翻譯成 WebAssembly

- `riscv-emu/src/jit.rs`：基本區塊（同一頁、最多 64 個指令）翻成一個模組的函式 `(m: i32) -> i32`，import 核心的記憶體與 `ld` / `st` / `ar`
  三個 helper；`Machine` 改成 `repr(C)`，前面是 `x`、`pc`、`jit_fault`、`prv`，生成的碼用固定位移讀寫。核心用 `--export-table
  --growable-table` 連結（`riscv-emu/.cargo/config.toml`），宿主把模組的函式放進表，核心用函式指標（= 表的索引）呼叫。
- 第一版（每次都查 HashMap、載入儲存都呼叫 helper）指令只快 1.5 倍；加上依虛擬位址的區塊快取（4096 項）到 2.2 倍；載入 / 儲存先查
  翻譯碼自己的 TLB（每個特權 512 項，helper 成功時填，satp / sfence / SUM / MXR / MPRV / MPP 改變時清；有翻譯碼的頁不放進儲存的
  TLB，tohost 那頁也不放）到 3.6–4 倍。門檻：100 次翻得太多（6410 個區塊）、5000 次太少，用 1000。
- 正確性：區塊以「實體 + 虛擬位址」為鍵（碼裡有虛擬的 pc）；寫到有翻譯碼的頁就丟掉那頁的區塊，如果是翻譯碼自己寫的，區塊在這個儲存之後
  就結束（`jit_fault` = 2）；helper 發出例外時寫回暫存器、pc 停在那個指令（`jit_fault` = 1）。riscv-tests 在門檻 2（幾乎全部翻譯）
  196 支全過；Linux 開機與指令在直譯、門檻 2（翻了 2.7 萬個區塊）、預設下輸出相同（`riscv-emu/tests/jit.mjs`，根目錄的 `test.sh`
  與 CI 也跑）。修正：`Bus::reset` 要保留 tohost（wasm 裡先載入再重設的 riscv-tests 都沒結束）；wasm 加上 `rv_load_program`。
- IDE 的 riscv-emu 打開翻譯；瀏覽器實測冷開機加上 `traffic.py` 約 15 秒內在跑。

### v2.25：四種目標

- 使用者的目標：一個融合 Arduino（FPGA 虛擬板）、樹莓派（RV64 開發板）、FPGA、ASIC 的平台，讓使用者依需要與速度選。
- IDE 標題列的目標選單分成兩組：合成（FPGA、ASIC · vlib、ASIC · SKY130）與模擬機（veryl-emu、riscv-emu）。選模擬機就打開模擬機分頁、
  用那個引擎開機（另一個引擎的機器正在跑就重新開機）；選合成回到合成流程。合成的後端記在 `synthTarget`，所以選單停在模擬機時合成
  照樣用上一次的後端；選單跟著分頁走（`syncTarget`），專案用不到的模擬機是灰的。
- 手冊新增第 15 章「選哪一種」：四種目標跑的是什麼、看得到什麼、速度、什麼時候用，以及 veryl-emu（硬體）和 riscv-emu（指令集）
  的差別與一致性怎麼驗證。README 更新模擬機的說明。

### v2.26：哪個能按、先按哪個

- 使用者的回饋：介面東西多，不知道哪個能點；一個範例該按合成、虛擬板還是模擬機，搞不清楚。原因：核心載入後標題列的按鈕全部啟用，
  不管專案能不能用（沒有腳位的設計也能按 ⚡，開發板的 ▶ 測試按了才被拒絕）。
- `web/src/ide/caps.ts`（沒有 DOM）只看專案的檔案決定每個動作能不能用：▶ 測試 / ✔ 全面驗證要有 `#[test]` 模組、不是模擬機
  （開發板專案打開板上的程式時 ▶ 是「執行」）；⚡ 虛擬板要有可合成的頂層、不是模擬機、有 `.pcf`；🖥 模擬機要有 `machine.json`；
  合成要有可合成的頂層。不能用的按鈕淡色、虛線框，但還能按：按了跳出原因與能做的事（新增 `pins.pcf`、仍要用預設腳位燒錄、
  打開 `main.py`、開機、開啟 RV64 開發板範例）。
- 建議的第一步：模擬機 → 🖥，有腳位 → ⚡，有測試 → ▶，否則 ⚙ 合成；它是標題列的藍色按鈕，編輯器上方的「建議步驟」列出
  ①②③ 與每一步做什麼。範例庫每個範例旁有 🧪 ⚡ 🖥 標記，框起來的是第一步。
- npm test 新增 `caps`：35 個範例的第一步（模擬機 → 🖥、有腳位 → ⚡、其他 → ▶）、每個關掉的動作都有原因、沒有腳位的設計有
  「新增 pins.pcf」。手冊第 11 章加上說明；第 16 章範例總表（每個範例的功能、檔案、命令列與 IDE 連結）與
  `examples/rv64/linux/mkarea.py`（命令列把檔案打包成交換區）是上一個 commit。

---

## 附註

- v1.2 與 v1.5–v1.9 的 git tag 是後來（2.1 時）才在上表的 commit 補上的。
- 每個 M 的細節見 `web/PLAN.md`，各工具的用法見 `README.md`、`veryl-sim/README.md`、`veryl-eda/README.md`。
