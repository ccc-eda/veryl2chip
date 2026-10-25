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

每個 M 完成就 commit。
