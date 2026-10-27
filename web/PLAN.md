# veryl2chip 網頁環境：規劃

純前端（`web/dist/index.html` 直接用瀏覽器開，`file://` 也可），Rust（veryl-sim、veryl-eda）
編譯成 WebAssembly 給 TypeScript 前端呼叫。介面參考 `hack-computer/dist/hdl.html`
（深色主題、上方工具列、左來源右結果、「合成」浮層的階段列＋圖＋報告＋側欄）。

## 架構
```
veryl-sim/  (lib + CLI)   veryl-eda/ (lib + CLI)
        \                    /
         veryl-wasm/  cdylib，C ABI：alloc / dealloc / call(JSON) -> JSON，零 import
                 |
web/  TypeScript（esbuild 打包成單一 IIFE，非 ES module → file:// 可用）
      build.mjs：cargo build wasm → base64 內嵌到 dist/wasm.js；範例 → dist/examples.js；
                 IceStorm chipdb（gzip+base64，瀏覽器以 DecompressionStream 解壓）→ dist/chipdb.js
      test/run.mjs：Node 載入同一份 dist，把所有範例跑過模擬與完整流程
```

## 里程碑
| | 內容 | 完成條件 |
|---|---|---|
| M1 | Rust 拆成 lib；wasm API；建置腳本；頁面：範例（含多檔專案）、編輯、模擬輸出 | 所有範例 testbench 在瀏覽器與 Node 測試中 PASS |
| M2 | 合成浮層 FPGA ①RTL→Logic ②Logic Netlist ③Tech-indep Syn ④LUT4 Techmap：每階段報告＋圖＋側欄細節 | 所有可合成設計四階段都能顯示，數字與 CLI 一致 |
| M3 | ⑤Placement（退火動畫）⑥Global+Detail Routing ⑦Timing（自己的 STA，對照 icetime）；下載 .asc / .pcf | 所有範例在瀏覽器跑完 FPGA 全流程；位元流（.asc）與 CLI 相同 |
| M4 | 波形檢視（VCD）、.bin 位元流（自製 icepack）、使用體驗 | 範例可看波形；.bin 與 icepack 相同 |
| M5 | ASIC（veryl-eda `asic/`，自製 vlib 標準元件庫）：④Standard Cell Map（tree covering + BUF 樹）⑤Row Placement（合法退火、動畫）⑥Global Routing（gcell、Prim + A* + PathFinder、擁塞圖）⑦STA（元件 + 線 RC）；下載 .v / .def | 所有範例在瀏覽器跑完 ASIC 流程且與 CLI 相同；標準元件 netlist 通過 testbench 模擬與對 `veryl build` 的形式等價 |
| M6 | 文件、總驗證 | `web/test` 全過、README |
| M7–M10 | 十項擴充：block RAM、時序導向 P&R、CTS + hold、細部繞線、電源網路、功耗、佈局密度、語言（除法、interface、寬位元、多時脈）、閘級模擬、網頁（檔案管理、.zip、UART/FIFO/VGA、FPGA vs ASIC） | 每項 commit；CLI 回歸、`npm test` 全過 |
| M11 | IDE（`ide.html`，VS Code 風格）：活動列＋側欄（專案 / 檔案 / 模組大綱、範例庫、合成流程、測試、說明）、分頁編輯器（語法上色、即時語法檢查、行號旁錯誤標記）、下方面板（問題 / 輸出 / 測試結果 / 波形）、狀態列、命令選單（Ctrl+Shift+P）與快速開檔（Ctrl+P）；專案存在瀏覽器（多專案、新增 / 改名 / 刪除 / 匯入、.zip 匯出）；「全面驗證」＝ RTL ＋三種閘級網表的測試矩陣；合成流程各階段（共 ①–③、F ④–⑦、A ④–⑨、FPGA vs ASIC）是一個編輯器分頁 | 範例與新專案能在 IDE 裡編輯、測試、全面驗證、檢視每個階段；原展示頁保留 |

| M12 | 虛擬 iCEBreaker：Rust 的活動驅動逐週期模擬引擎（`veryl-eda/src/board/`，4 輸入真值表 + 正反器 + block RAM）、iCEBreaker 腳位、IDE 的「⚡ 虛擬板」分頁（SVG 開發板、LED 亮度依工作週期、可按的按鈕、獨立的 worker、速度與虛擬時間） | 引擎在 15 個設計上與 netsim 一致；教學兩課與 RISC-V SoC 在虛擬板上行為正確 |
| M13 | 位元流模擬：`.bin` → `.asc`（icepack 反向）→ 解碼回電路（pip、LC、IO、全域網路、block RAM），虛擬板預設跑真正的位元流、可上傳任何 `.bin`、下載 `.bin`、Fmax 警告 | 11 個設計（自己的 P&R）與 nextpnr 產生的位元流解碼後與網表逐週期一致；`bin → asc → bin` 不變 |
| M14 | 周邊：USB 序列終端機（雙向、可選鮑率）、PMOD 模組（8 LED、8 開關、兩位數七段、VGA 螢幕、蜂鳴器）、每個專案記住接了什麼；教學第 3 課 UART、七段計數範例、VgaDemo；Veryl 的 `port: _`（不接的輸出） | 終端機、七段、VGA 在 cargo test 與 npm test 都有逐項檢查；瀏覽器實測 |
| M15 | 麵包板：零件（LED、電阻、按鈕、開關、導線）接在 PMOD 腳與 3V3 / GND 上，數位電路模型（強連接、經電阻的弱電位＝上拉 / 下拉、LED 亮度＝正極電位 ×（1 − 負極電位）），短路 / 缺限流電阻 / 輸入浮接警告；腳位檔變成專案檔 `pins.pcf` 與腳位表；實驗分享連結與 `.lab.json`；邏輯閘麵包板實驗 | 模型單元測試（npm test）、瀏覽器實測真值表、分享連結來回 |
| M16 | 虛擬實驗課：講義 `tutorial/labs.tw.md`（8 個實驗，每個都有直接燒進虛擬板的連結 `ide.html#ex=…&board=1`、檢查點、動手改、思考題）；新實驗 `ButtonCounter`（上升緣）與 `TrafficLight`（狀態機，麵包板上三顆 LED） | veryl test / veryl-sim / 三種閘級模擬、npm test 在虛擬板上按按鈕檢查計數與紅綠燈、麵包板接線無警告、全面形式驗證 |
| M16+ | 合成介面改成 VS Code 式：「⚙ 合成」按鈕換成標題列的後端（FPGA / ASIC）＋階段選單（最後一項是 FPGA vs ASIC 比較）；流程分頁只剩一行麵包屑＋圖示按鈕（ⓘ 說明浮框、連線、退火動畫、⬇ 下載選單、縮放），進度與錯誤在同一行；數字移到狀態列；拿掉側欄的合成流程 | 瀏覽器實測 FPGA / ASIC / 比較、下載選單、ⓘ；展示頁不變；npm test |
| M17 | 多週期 RISC-V SoC `RvSoc`（`examples/src/rvsoc.veryl`）：暫存器檔（兩份同步讀取 RAM）與 8 KB 記憶體（四個位元組通道）在 block RAM，記憶體映射的 LED / 按鈕 / 開關 / UART / 計時器，載入埠；`RvBoard` 1844 LUT + 20 BRAM、Fmax 13.3 MHz | `TestRvSoc` 跑 rv32i_test.S（官方 veryl test、veryl-sim、三種閘級模擬）；`RvSocSmall` 形式等價 |
| M18 | 程式放在 block RAM：`MEM_SLOT`、`bram::set_mem_init`、`--program`、`pnr::patch_ram`（只改寫 `.ram_data`）；wasm `board_program` 換程式不重新合成 | 改寫後的位元流 = 帶程式佈局繞線的位元流，在虛擬板上跑完 ISA 測試 |
| M19 | C 編譯器（`src/rv/cc.rs`，C 子集 → RV32I 組合語言）、組譯器、指令集模擬器、執行期函式庫（printf…）；CLI `--cc`；IDE：`.c` 檔、C / 組合語言上色、即時錯誤、組合語言分頁、ISS 執行 | 測試程式與主機 C 編譯器輸出相同；C 程式在閘級 RvBoard 上的序列埠輸出與 ISS 相同 |
| M20 | C 程式範例（Hello、跑馬燈、猜數字、七段、蜂鳴器、開關、VGA）、VGA 文字模式 `VgaText` / `RvVgaBoard`（40 × 30 字元，字型由程式載入 block RAM）、虛擬板的 CPU 模式（ISS 驅動同樣的腳位與周邊，即時速度）、講義第二部分 | npm test：所有 C 範例、網表 / 位元流 / CPU 三種模式的問候、回聲與換程式、VGA 畫面；cargo test：閘級 RvVgaBoard 的 VGA 畫面與 CPU 模式逐像素相同 |
| M21 | `RvCore` 擴充成 RV32IMA + Zicsr：M（反覆式乘除法）、A（LR/SC、AMO）、CSR、machine mode 陷阱（中斷、ecall、ebreak、非法指令、沒對齊）、`mret`、`wfi`；SoC 加 CLINT（mtime、mtimecmp、msip）、UART 收到位元組的外部中斷；組譯器、ISS 跟上；合成：case 的 one-hot 把同值分支合併（暫存器保持只要一個 2 選 1）、LUT 映射加面積回收；RvBoard 3960 LUT、約 12.8 MHz | `rv32ima_test.S` 與 spike 相同（veryl test、veryl-sim、三種閘級模擬、ISS） |
| M22 | C 的多執行緒：編譯器產生 M 指令、`asm(...)`、naked 函式、函式位址；epilogue 不再讀 sp 以下（中斷會蓋掉）；執行期函式庫的中斷 / CSR / 原子操作；範例 `threads.c`（計時器搶佔、ecall yield / sleep、amoswap 互斥鎖）；講義 C8 | `cargo test threads_on_rvsoc`：閘級 RvBoard 與 ISS 逐週期相同的輸出與 LED；npm test 跑所有 C 範例 |


### 往 v2.0：接上 SkyWater SKY130 開源 PDK（完成）

目標：同一個 ASIC 流程（對應、佈局、時脈樹、繞線、時序、功耗）除了教學用的 vlib，也能用 SKY130 的
`sky130_fd_sc_hd` 標準元件庫，產出 OpenROAD / Magic / KLayout 看得懂的 Verilog、DEF 與 GDS。
PDK 來源：OpenROAD-flow-scripts 的 `platforms/sky130hd`（Liberty `tt_025C_1v80`、tech LEF、merged LEF、GDS；Apache-2.0），
`tools/sky130.sh` 下載完整檔案，倉庫裡只放流程用到的元件子集（`veryl-eda/pdk/sky130hd/`，附授權）。

| 版本 | M | 內容 | 驗證 |
|---|---|---|---|
| v1.5 | M23 | 讀 Liberty（群組語法、單位、NLDM 表、`function`、`ff`）、LEF、DEF；`Tech` 抽象（列高、site、軌距、元件綁定、腳位存取點、時序由 Tech 提供，vlib 是內建的）；SKY130 元件子集放進倉庫；`--pdk sky130`：對應（沒有 SRAM、負緣正反器加時脈反相器）、unithd 列、IO 腳在格點上、well tap 與 fill、li1 腳位 + met1 短線、NLDM 時序（斜率傳遞、腳位與導線電容、setup / hold 表）、Verilog / DEF 用 sky130 名稱與 Liberty 模型；`--gatesim sky130`、`--map-only`、`--pdk-check` | 綁定與 Liberty 函式真值表一致；test.sh：sky130 網表用 yosys `read_liberty` 證明與 `veryl build` 等價、testbench 通過；cargo test：DEF 讀回對照 LEF（列、site、不重疊、填滿、tap 距離） |
| v1.6 | M24 | 版圖幾何（每條線、via 的金屬與 cut、短線、電源）與自己的 DRC（短路、間距、cut 間距、最小面積、斷路，含元件內部的 OBS 與腳位形狀）；繞線遵守 sky130 規則：met3 / met4 隔一條軌道、via 不相鄰（棋盤格）、避開正反器的 met1 OBS | 範例 0 個 DRC / 短路 / 斷路 |
| v1.7 | M25 | GDS II 輸出：PDK 的元件 GDS + 繞線、via、腳位標籤、電源；`--gds` | GDS 用 KLayout（Python 套件）讀回，層、元件數一致 |
| v1.8 | M26 | 更好的 SKY130 結果：更多元件（nand3、a22oi、o22ai…）的對應、驅動強度（buf_2 / 4 / 8、clkbuf_4 / 8）、大設計的繞線速度 | Fmax、面積比 v1.7 好；test.sh |
| v1.9 | M27 | IDE：ASIC 後端可選 vlib / SKY130（圖用真實元件尺寸、下載 GDS / DEF / Verilog） | npm test、瀏覽器實測 |
| v2.0 | M28 | 文件、全面回歸、發布 2.0.0 | npm test、cargo test、test.sh |

每個 M 完成就 commit。

### 往 v3.0：RV64 + SV39 與 ECP5（進行中：v2.2 完成）

目標：一顆用 Veryl 寫的 **RV64IMA + Zicsr、M / S / U 三種模式、SV39 虛擬記憶體**的 CPU，
放進 Lattice **ECP5** FPGA，跑 **xv6-riscv**（有分頁、行程、檔案系統的教學作業系統）。
iCE40UP5K 放不下（現在 RV32IMA 的 `RvCore` 已經用掉 3817 / 5280 個 LUT4，RV64 + SV39 估計要 1–1.5 萬），也沒有外部 RAM。

**板子：ULX3S**（LFE5U-85F，另有 12F / 25F / 45F；32 MB SDR SDRAM、25 MHz 時脈、8 顆 LED、7 個按鈕、
FTDI USB 序列埠、SD 卡、HDMI 接頭；開源硬體）。核心的目標是 25F 也放得下（≤ 2.4 萬 LUT4）。

**工具**（OSS CAD Suite 都已經有）：

| 工具 | 用途 |
|---|---|
| `nextpnr-ecp5`、`ecppack` | 佈局繞線與位元流（Project Trellis） |
| `ecpunpack` | 位元流 → 文字設定，用來檢查 |
| `openFPGALoader` | 燒錄 |
| yosys `share/ecp5/cells_sim.v` | 元件模型：閘級模擬與形式等價的標準答案 |
| `spike` | 參考模擬器，`--isa=rv64imac_zicsr -p1`，含 SV39 |
| `qemu-system-riscv64` | 原版 xv6 的參考執行 |
| `riscv64-unknown-elf-gcc` | 編譯 xv6、測試程式 |

**策略**：
- 和 iCE40 一樣，**先串外部工具（nextpnr-ecp5），自己的佈局繞線之後再說**。ECP5 的 Trellis 資料庫很大（85F 數百 MB），
  不適合放進網頁。
- CPU 先在**指令集模擬器**與 RTL 模擬上做對（跟 spike 逐指令比對），再上 FPGA。
- 虛擬板的 CPU 模式用 RV64 ISS，所以 **xv6 可以在瀏覽器裡跑**，不需要板子。

| 版本 | M | 內容 | 驗證 |
|---|---|---|---|
| v2.2 ✓ | M29 | **ECP5 對應**（`veryl-eda/src/ecp5.rs`）：`LUT4`（沿用 iCE40 的切割式 LUT 對應）、`PFUMX` / `L6MUX21`（5、6 輸入）、`CCU2C`（進位鏈，兩位元一組）、`TRELLIS_FF`（同步 / 非同步 reset、致能）、`TRELLIS_IO`；輸出 nextpnr-ecp5 讀得懂的 JSON；CLI `v2c fpga --arch ecp5 [--device 25k\|45k\|85k] [--lpf PINS.lpf] [--bit OUT.bit]`（呼叫 nextpnr-ecp5 + ecppack）；`v2c gatesim ecp5`；netsim 加 ECP5 元件 | 所有範例：ECP5 網表跑原本的 testbench；yosys 用 `cells_sim.v` 證明與 `veryl build` 等價；nextpnr-ecp5 繞得完、`ecppack` 產生 `.bit`；nextpnr 繞好的網表（`--write`）再模擬一次 |
| v2.3 | M30 | **ECP5 資源與板子**：同步讀取的記憶體 → `DP16KD`（18 Kbit block RAM，含程式初值 `--program`）、乘法 → `MULT18X18D`；ULX3S 腳位檔 `examples/ulx3s.lpf`（25 MHz、LED、按鈕、序列埠）；Blinky、跑馬燈與 `RvBoard`（RV32 SoC + C 程式）移植到 ULX3S（`RvUlx3s`，25 MHz）；nextpnr 的時序報告（Fmax）接到 `v2c` 的輸出 | 記憶體設計的 ECP5 網表與 yosys 模型等價；RvUlx3s 在 ECP5 網表上跑完 rv32ima_test 與 C 程式；`.bit` 實際燒進 ULX3S（有板子時） |
| v2.4 | M31 | **RV64 參考模型**（`veryl-eda/src/rv/iss64.rs`）：RV64IMA + Zicsr、M / S / U 模式、陷阱委派（medeleg / mideleg）、`mret` / `sret`、`wfi`、**SV39**（三層分頁表、A / D 位元由硬體設定、page fault、`sfence.vma`、SUM / MXR）、**Sstc**（`stimecmp`，新版 xv6 用它做計時器）；組譯器支援 RV64（`ld` / `sd`、`*w` 指令）；SoC 記憶體映射：開機 ROM、SDRAM、UART（16550 相容的子集，xv6 的驅動可以直接用）、CLINT、PLIC（只接 UART） | spike 的 commit log 逐指令比對：自己寫的測試（每類指令、例外、委派、各種分頁表與 page fault）；有網路時再加官方 riscv-tests（rv64ui / um / ua / si / mi） |
| v2.5 | M32 | **`Rv64Core`**（`examples/src/rv64.veryl`）：多週期 RV64IMA + Zicsr + M / S / U，暫存器檔在 block RAM，還沒有 MMU；指令與 ISS 逐週期相同的時序模型；`TestRv64Core` | 同一組測試在 veryl-sim、官方 veryl test、ECP5 閘級模擬上與 ISS 相同；ECP5 上的 LUT 數與 Fmax 記錄在案 |
| v2.6 | M33 | **SV39 MMU**：分頁表走訪器（三層、A / D 寫回）、指令與資料各一個小 TLB（例如 8 筆全關聯）、`satp` 切換與 `sfence.vma` 清 TLB、page fault 的 `stval`；`Rv64Core` 經過 MMU 存取記憶體 | 分頁測試（恆等對應、使用者頁、權限錯誤、超級頁 2 MB / 1 GB、A / D）RTL 與 ISS / spike 相同；形式檢查 TLB 命中與走訪結果一致（小型 bmc） |
| v2.7 | M34 | **`Rv64Soc` 與 ULX3S**：SDRAM 控制器（32 MB SDR，含模擬用的 SDRAM 模型）、指令與資料快取（直接對應、block RAM）、開機 ROM、UART、CLINT、PLIC、按鈕 / LED；`Rv64Ulx3s` 頂層 | 帶 SDRAM 模型的 testbench 跑測試程式；ECP5 網表在 25 MHz 下時序過；ULX3S 實機跑 UART 測試程式（有板子時） |
| v2.8 | M35 | **xv6-riscv**：`examples/xv6/`（上游 MIT 授權，加上我們的移植：記憶體映射、UART、ramdisk 取代 virtio 磁碟、開機流程）；`tools/xv6.sh` 用 riscv64-unknown-elf-gcc 編出 kernel 與檔案系統映像；`v2c` 的 ISS 也能跑 RV64 映像（`v2c run64 kernel.bin fs.img`） | xv6 在 ISS 上開到 `$` 提示，跑完 `usertests` 的快速版；同一映像在 QEMU（virtio 版）結果一致；RTL / 閘級（虛擬板引擎）開到 shell；ULX3S 實機開機（有板子時） |
| v2.9 | M36 | **虛擬 ULX3S 與 IDE**：IDE 的後端加「FPGA · ECP5（ULX3S）」——階段到 ④ 對應與統計（網頁裡沒有 nextpnr，佈局繞線用 CLI）；虛擬板可切換 iCEBreaker / ULX3S（LED、按鈕、USB 終端機）；ULX3S 的**網表模式**（跑對應後的 ECP5 網表）與 **CPU 模式**（RV64 ISS，在瀏覽器裡開 xv6，檔案系統映像放在 `dist/`）；範例 `RV64 + xv6` | npm test：ECP5 範例的對應與 CLI 相同；CPU 模式開 xv6 到 shell、在終端機執行 `ls`、`echo`；瀏覽器實測 |
| v3.0 | M37 | 文件：手冊加「ECP5」與「RV64 與 xv6」兩章、history.md；選做：`Rv64Core` 走 SKY130 ASIC 流程（對應 + 形式等價，完整佈局繞線視時間而定）；全面回歸、發布 3.0.0 | `./test.sh --full`、npm test |

**還不做**：自己的 ECP5 佈局繞線與位元流（v3.x 以後）、ECP5 的位元流模擬（虛擬板的「位元流模式」只有 iCE40）、
HDMI 影像輸出、C 編譯器產生 RV64（xv6 用 gcc；需要時再做）、Linux（要 RV64GC：浮點與壓縮指令，另立計畫）。

**風險與對策**：

| 風險 | 對策 |
|---|---|
| veryl-sim 跑 xv6 開機（數千萬個時脈）太慢 | RTL 只跑測試程式；開機用 ISS 與虛擬板引擎（網表的逐週期模擬比 RTL 快很多） |
| xv6 依賴硬體設定 A / D 位元 | MMU 走訪時寫回 A / D（和 QEMU、spike 一樣） |
| 新版 xv6 用 Sstc（`stimecmp`） | 實作 Sstc；或者用舊版 xv6 的 M 模式計時器轉送 |
| 沒有 ULX3S 板子 | 每一版都以模擬（ECP5 網表 + SDRAM 模型）和 nextpnr 的時序為準；實機測試列為「有板子時」 |
| 核心太大或太慢，放不進 25F 或跑不到 25 MHz | 多週期設計、暫存器檔與 CSR 放 block RAM；先以 85F 為準，再縮減 |

每個 M 完成就 commit，版本號照 v2.2 → v3.0 遞增。
