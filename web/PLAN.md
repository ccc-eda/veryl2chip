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

### 往 v3.0：RV64 處理器，跑 xv6 與 Linux（進行中：v2.14 完成）

**目標**：一顆用 Veryl 寫的 RV64 處理器，先跑起 **xv6-riscv**，再跑 **Linux**。重點是 HDL 本身正確；
EDA（v2c 的模擬、合成、FPGA）等 CPU 做對了再跟上。

**驗證方式**：不靠 veryl2chip 自己的工具，用官方工具鏈當標準答案——
`veryl build`（Veryl 0.22 產生 SystemVerilog）→ **Verilator**（編成 C++，每秒數百萬個時脈，開機 OS 才跑得動）。
C++ 測試平台模擬 QEMU `virt` 機器的記憶體映射與周邊，所以 xv6、OpenSBI、Linux 不用為我們改：

| 位址 | 裝置 | 在哪裡 |
|---|---|---|
| `0x0000_1000` | 開機 ROM（跳到 0x8000_0000，a0 = hartid，a1 = 裝置樹） | C++ |
| `0x0200_0000` | CLINT（`mtime`、`mtimecmp`、`msip`） | C++，中斷線接到核心 |
| `0x0C00_0000` | PLIC（UART、virtio 的外部中斷，M / S 兩個 context） | C++ |
| `0x1000_0000` | UART 16550 | C++ |
| `0x1000_1000` | virtio-mmio 區塊裝置（xv6 的磁碟） | C++ |
| `0x8000_0000` | RAM（128 MB 起） | C++ |

核心只有一條簡單的記憶體匯流排（請求 / 回應）和四條中斷線（MTIP、MSIP、MEIP、SEIP）加上 `mtime` 輸入，
之後要上 FPGA 時再把周邊改寫成 Veryl。

**參考答案**：spike（`--isa=rv64ima`，同樣的記憶體映射）的逐指令紀錄；官方 **riscv-tests**（`rv64ui/um/ua/si/mi`，
`-p` 實體位址版與 `-v` 虛擬記憶體版）；QEMU 跑同樣的 xv6 / Linux 映像。

| 版本 | 內容 | 驗證 |
|---|---|---|
| v2.2 ✓ | ECP5 對應 + nextpnr-ecp5（見 history.md） | test.sh |
| v2.3 ✓ | **`Rv64Core`**（`examples/rv64/`，獨立的 Veryl 專案）：多週期 RV64IMA + Zicsr + Zifencei，M / S / U 三種模式、陷阱與委派（medeleg / mideleg）、`mret` / `sret` / `wfi`、`time` CSR、**SV39**（三層走訪、硬體設定 A / D、page fault、`sfence.vma`、SUM / MXR、MPRV）；Verilator 測試平台 `sim/`（C++：記憶體、HTIF `tohost`、CLINT、UART） | riscv-tests 的 rv64ui / um / ua / mi / si，`-p` 與 `-v` 全部通過 |
| v2.4 ✓ | **xv6-riscv**：開到 `$`。實際做法：virtio 改成 RAM 磁碟（`xv6/ramdisk.c`，xv6 只改三處）、Svadu（`menvcfg.ADUE`）、16 筆 TLB（提前做，只影響速度）、`mstatus.FS` 可寫；`xv6/build.sh`、`xv6/test.sh` | xv6 開機、`echo` / `cat` / `ls` / `mkdir` / `wc`；194 支 riscv-tests 和 spike 逐指令相同（3 個已知差異）；`usertests -q` |
| v2.5 ✓ | **加速 + C 擴充**：取指令和上一個指令的結束重疊、RAM 少等一拍；壓縮指令（16 位元指令展開、跨 4 位元組邊界的取指） | riscv-tests 加上 rv64uc；xv6 用 `rv64imac` 重編也能跑；開機的拍數 |
| v2.6 ✓ | **Linux**：OpenSBI（`fw_payload`，裝置樹嵌入）+ Linux 6.12（`rv64imac`、不含 FPU、tinyconfig 加 `linux/rv64soc.config`）+ 只有一個小 init 的 initramfs；SoC 加上關機裝置（`sifive,test0`）；kernel 用 LLVM 在 macOS 上編（sparse checkout） | 開到 init、印出 `/proc/version` / `/proc/cpuinfo`、poweroff（`linux/test.sh`）；之後視情況加 F / D 擴充，跑 busybox |
| v2.7 ✓ | **正確性**：隨機指令測試（`verify/randgen.py`：M / S / U 模式、Sv39 隨機權限、非法編碼、例外）和 spike 逐指令比對；中斷的定向測試（`verify/irq.S`）；`examples/rv64/test.sh` 回歸 | 900 支隨機程式與 spike 完全相同；中斷 10 項；riscv-tests、Linux |
| v2.8 ✓ | **合成**：乘除法改成多週期（64 拍反覆式，網表 13 萬 → 6 萬元件），veryl-eda 合成 `Rv64Core`，網表（通用閘、ECP5、vlib、SKY130）放回 Verilator 跑同樣的測試（`sim/build_gates.sh`） | 四種網表都通過 riscv-tests；通用閘網表另跑隨機測試、中斷測試、Linux |
| v2.9 ✓ | **FPGA 佈局繞線**：`Rv64Fpga`（128 KB block RAM、序列 UART、載入埠）；veryl-eda 的 ECP5 對應加上 `DP16KD`；nextpnr-ecp5（85F、ULX3S 腳位）→ 位元流，繞線後的網表再模擬（`fpga/ecp5.sh`、`sim/build_fpga.sh`） | RTL、ECP5 網表、繞線後的網表都通過 110 支 `-p` riscv-tests；Fmax 12.7 MHz |
| v2.10 ✓ | **ASIC 佈局繞線（vlib）**：veryl-eda 自己的佈局繞線跑 `Rv64Core`（6.6 萬個元件）。大設計先做全域佈局（二次線長 + 遞迴二分攤開 + 排進列），再退火微調；DEF 輸出加速；繞線後的標準元件網表再模擬（`sim/build_gates.sh vlib_routed`） | 約 5 分鐘、0 衝突 0 斷線、Fmax 25.6 MHz；繞線後網表通過 196 支 riscv-tests |
| 暫緩 | **SKY130 佈局繞線**：同一個 `Rv64Core` 在 SKY130 上細部繞線還留下衝突與 1–3 個斷線（晶片放大也消不掉，像是腳位接不進去），找出原因、DRC 乾淨 | 繞線後網表通過 riscv-tests、DRC 0 |
| v2.11 ✓ | **Linux + busybox**：musl 1.2.5（只用 make 編）、busybox 1.36（靜態、defconfig）當 initramfs，`/init` 開 shell；kernel 加上腳本、多使用者、futex、tmpfs | Verilator 上開機到 shell 約 30 秒，`linux/test.sh` 打指令、關機 |
| v2.12 ✓ | **veryl-emu**：自己的編譯式模擬器（另一個 crate，veryl-sim 不動）：Veryl → 有寬度的 IR → WebAssembly（自寫編碼器），2 態、以週期為單位、組合邏輯排序、只延後 always_ff 會讀的暫存器 / 陣列；Node 的測試平台 `js/emu.mjs` | 和 veryl-sim 的差分測試（21 個輸出 × 300 拍）；Rv64Soc：196 支 riscv-tests、隨機程式與 spike 相同、中斷測試、Linux 開到 shell，220 萬拍 / 秒（Verilator 720 萬） |
| v2.13 ✓ | **IDE 的模擬機（🖥）**：第三種實體化方式（FPGA、ASIC 之外），veryl-emu 編進核心 wasm（`emu_compile`），機器在自己的 worker 跑（`emu_machine.ts`、`emu_worker.ts`），分頁裡的終端機接 UART；專案的 `machine.json` 描述腳位；範例「RV64 + Linux」，Linux 映像 `img_linux.js` 開機時才載入 | 瀏覽器裡開到 busybox 並打指令；npm test 在 Node 用同一個機器跑到 OpenSBI 的橫幅 |
| v2.14 ✓ | **veryl-emu 加速**：剖析（VERYL_EMU_CHUNK / VERYL_EMU_COUNT、wasm name 區段）後展開常數範圍的迴圈、常數索引陣列、`repeat` 只算一次、條件直接 i32；活動偵測（髒旗標，值有變才重算讀它的程序） | Node 上 Linux 開機 104 → 55 秒（420 萬拍 / 秒，Verilator 720 萬）；差分測試、riscv-tests、隨機、中斷、Linux、npm test |
| 之後 | veryl-emu 再加速（同一訊號只載入一次等）；xv6 映像 | |
| 之後 | **上板**：時序（PLL 12.5 MHz 或縮短關鍵路徑）、UART 載入器取代載入埠，ULX3S 實機 | 實機跑 riscv-tests 與小程式 |
| 之後 | 回到 v2c（veryl-sim 跑得動 Rv64：記憶體、事件驅動，修補檔已存）；F / D 與 busybox；ULX3S 實機 | |

### 虛擬樹莓派：RV64 Linux 開發板（v2.15 起）

目標：IDE 裡有一塊像樹莓派的開發板。CPU 是我們用 Veryl 寫的 Rv64Core（在 🖥 模擬機上跑），上面跑 Linux；
板子有 40 針排針、LED、按鈕、麵包板，之後還有螢幕。程式語言以 **MicroPython 為主、C 為輔，shell 一定有**。
和實體樹莓派最大的不同：SoC 本身也是專案的一部分，學生可以打開 Veryl 原始碼看（甚至改）GPIO 控制器，再看 Linux 驅動怎麼用它。

預期的限制（先講清楚）：瀏覽器裡約 370 萬拍 / 秒，約 180 萬個指令 / 秒（比 1990 年代初的電腦還慢）。點 LED、讀按鈕、
小腳本、MicroPython 的小程式都夠用；圖形介面、大量運算不切實際。RAM 256 MB 在手機上可能配置不到。

| 版本 | 內容 | 驗證 |
|---|---|---|
| v2.15 ✓ | **GPIO（硬體 + Linux）**：Rv64Soc 加 32 腳的 GPIO 控制器（Veryl，暫存器相容 SiFive GPIO，Linux 已有 `gpio-sifive` 驅動；輸入、輸出、方向、上升 / 下降緣中斷接 PLIC）與腳位 `o_gpio` / `o_gpio_oe` / `i_gpio`；裝置樹加 `gpio-leds`（板上 LED，`/sys/class/leds`）與按鈕；kernel 開 GPIOLIB、GPIO_SIFIVE、GPIO_CDEV、GPIO_SYSFS、LEDS_GPIO；Verilator 與 `rv64emu` 的測試平台印出 GPIO 的變化 | Verilator：開機後用 shell `echo 1 > /sys/class/leds/led0/brightness`、`/sys/class/gpio` 讀寫腳位，測試平台看到腳位改變、送進按鈕；veryl-emu 同樣的腳本；riscv-tests、Linux 回歸不變 |
| v2.16 ✓ | **IDE 的虛擬開發板**：`machine.json` 加上 `gpio`；模擬機的 worker 每片回報 GPIO 輸出（亮度用佔空比）、接受輸入；畫面是樹莓派風格的板子（40 針排針與腳位名稱、電源 / ACT LED、板上 LED 與按鈕），沿用 FPGA 虛擬板的麵包板（`bbmodel.ts`）接 LED、電阻、按鈕；範例「RV64 開發板」 | npm test：Node 上開機、用 shell 點亮腳位，`bbmodel` 算出 LED 亮；瀏覽器實測 |
| v2.17 ✓ | **快照開機**：機器狀態全部在 wasm 的線性記憶體，開到 shell 時存成快照（256 MB 幾乎都是 0：只存非零的頁，壓縮後預估幾 MB），內附在 `img_board.js`；按電源從快照繼續，幾秒內有 shell；IDE 也可以「存目前狀態」（IndexedDB） | 從快照繼續後的指令與從頭開機的結果相同；Node 上比對兩種方式的 UART 輸出 |
| v2.18 ✓ | **檔案進出板子**：專案檔案在開機時放進 `/root`（測試平台把一個 tar 寫進 RAM 最後 16 MB 的保留區，裝置樹排除這塊，`/init` 用 `/dev/mem` 解開）；`sync` 指令把 `/root` 寫回保留區，IDE 讀回專案。shell 腳本在 IDE 改完就能在板子上執行 | Node：專案檔進板子、在板子上改、寫回後內容相同 |
| v2.19 ✓ | **MicroPython**：官方 MicroPython 的 Unix 版本，用 musl 靜態編成 RV64 執行檔（`git clone` + `make`，MIT 授權）放進映像；`pi` 模組（`LED`、`Button`、`Pin`，像 `gpiozero`，底下用 `/sys/class/gpio` 或 GPIO 的字元裝置）；終端機的 REPL、`micropython /root/main.py`；IDE 有「▶ 在板子上執行」；範例：閃爍、按鈕計數、紅綠燈 | Verilator 與 veryl-emu：`main.py` 讓腳位依序變化、讀到按鈕；MicroPython 自己的基本測試 |
| v2.20 ✓ | **C 程式**：veryl-eda 的 C 編譯器（`src/rv/`，目前是 RV32 裸機）加上 RV64 Linux 目標：64 位元暫存器與指標、系統呼叫（`ecall`）、小小的 libc（`printf`、`open` / `read` / `write`、`usleep`）、輸出靜態 ELF；IDE 在瀏覽器裡編譯，經 v2.18 的機制放進 `/root` 執行；`gpio.h`；範例對應 MicroPython 的那幾個 | 編譯器測試（`.c` 對照 `.out`，和現有 RV32 測試同樣的做法）；板子上跑 C 範例 |
| v2.21 ✓ | **螢幕**：`simple-framebuffer`（320 × 240、RGB565，放在保留的 RAM），kernel 開 fbcon；worker 每幀把那塊記憶體畫到 canvas；MicroPython 的 `framebuf` 與 C 的畫圖函式；範例：時鐘、圖形 | Node：寫入 framebuffer 的內容和畫出的影像相同；瀏覽器實測 |
| 之後 | I2C / SPI 的虛擬元件（溫度感測器、OLED）、PWM 蜂鳴器、儲存狀態到檔案；也可以在板子上放 TinyCC（在 Linux 裡自己編 C） | |

原則：每一版先在 Verilator（RTL）上驗證硬體與 Linux，再在 veryl-emu（Node）上跑同樣的腳本；很久的測試只在 RTL 上跑。
v2.16 起要重建網頁（IDE 的部分）。

### riscv-emu：指令集模擬，讓板子快幾十倍（v2.22 起）

veryl-emu 模擬的是硬體：每一拍都要算整顆 Rv64Core 的訊號，瀏覽器裡約 370 萬拍 / 秒（約 120 萬個指令 / 秒），開到 shell 要 1 分鐘。
**riscv-emu** 像 QEMU 一樣只模擬指令集：同一塊板子（Rv64Soc 的記憶體映射：RAM、CLINT、PLIC、UART 16550、GPIO、finisher、螢幕），
同一個 `fw_payload.bin`（OpenSBI + Linux），但不看電路，只算每個指令的效果；再把常跑的基本區塊翻成 WebAssembly，讓瀏覽器的 JIT 編成
機器碼。預估快 20–100 倍：開機幾秒、MicroPython 與 C 的程式都像真的板子一樣快。代價是它不是硬體：驗證 Veryl 設計還是用 Verilator
與 veryl-emu；riscv-emu 的正確性用 spike 對照。IDE 的執行目標變成 **FPGA / ASIC / veryl-emu（硬體）/ riscv-emu（指令集）**，
讓使用者依需要選：要看電路就用前三個，要跑軟體就用 riscv-emu——Arduino、樹莓派、FPGA、ASIC 在同一個平台。

| 版本 | 內容 | 驗證 |
|---|---|---|
| v2.22 ✓ | **riscv-emu 核心**：新的 Rust crate `riscv-emu/`（不依賴其他套件）：RV64IMAC + Zicsr + Zicntr + Zifencei + Sstc + Svadu、M / S / U、SV39（含 TLB）、中斷與例外，和 Rv64Core 的行為一致（mtval、misa、PMP 只有暫存器等）；Rv64Soc 的周邊（CLINT、PLIC、UART、GPIO、finisher、交換區、螢幕）；時間：預設每個指令 1 拍，wfi 直接跳到下一個計時器中斷；CLI `rvemu`（同 `rv64sim` 的 `-s` 腳本、`!gpio`、`-l`、`-d`、`--log` commit log） | riscv-tests（同 `sim/riscv_tests.sh`）；commit log 與 spike 逐行比對（`sim/spike_diff.sh`）；`linux/test.sh SIM=…/rvemu`；xv6 `test.sh`；速度 |
| v2.23 ✓ | **IDE 的 riscv-emu**：crate 編成 wasm（第二個 wasm，按需載入），worker 有兩種引擎；`machine.json` 的 `engine` 與工具列的選擇（veryl-emu / riscv-emu）；GPIO、檔案、螢幕、▶ 執行都一樣；瀏覽器裡的時間跟著真實時間走（`sleep(1)` 就是一秒）；冷開機就夠快，不用快照 | npm test：Node 上用 riscv-emu 開機，跑和 veryl-emu 一樣的檢查（GPIO、檔案、MicroPython、C、螢幕）；瀏覽器實測速度 |
| v2.24 | **翻譯成 WebAssembly（像 QEMU 的 TCG）**：常跑的基本區塊（同一個實體頁、同一個權限）翻成 wasm 函式，一批一批編成模組，以後直接呼叫；寫到程式碼頁、`fence.i`、`sfence.vma`、換頁表時丟掉翻譯；中斷在區塊之間檢查；翻譯器與直譯器結果逐指令比對 | 翻譯與直譯跑同樣的程式，暫存器、記憶體、輸出相同；riscv-tests、Linux、MicroPython；量速度（目標：比直譯再快幾倍） |
| v2.25 | **四種目標的介面**：標題列的目標選單改成 FPGA / ASIC / veryl-emu / riscv-emu，各自的說明（看電路還是跑軟體、速度）；手冊一章「選哪一種」 | 瀏覽器實測；npm test |

每版 commit，版本號照 v2.3、v2.4… 遞增。
