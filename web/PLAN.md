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
| M5 | ASIC：④Standard Cell Map ⑤Row Placement ⑥Detail Routing ⑦STA | 所有範例跑完 ASIC 流程，標準元件 netlist 與 RTL 等價 |
| M6 | 文件、總驗證 | `web/test` 全過、README |

每個 M 完成就 commit。
