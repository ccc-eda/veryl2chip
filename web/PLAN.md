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

每個 M 完成就 commit。
