# veryl2chip
[English](README.md) | **繁體中文** | [简体中文](README.cn.md)

**線上直接使用**（免安裝）：[展示頁](https://ccc-eda.github.io/veryl2chip/web/dist/index.html) · [IDE](https://ccc-eda.github.io/veryl2chip/web/dist/ide.html)

**從零開始的教學**（課程教材）：[寫 Veryl → 模擬 → 看波形 → 合成 → 燒進 iCEBreaker](tutorial/README.tw.md)；**虛擬實驗課**（不用買板子）：[虛擬 iCEBreaker 上的 8 個實驗](tutorial/labs.tw.md)

Veryl HDL 的 EDA 工具：模擬、邏輯合成、FPGA 流程（iCE40UP5K，一路到位元流）與 ASIC 流程
（標準元件、佈局、繞線、時序分析），全部用 Rust 寫成。

| | |
|---|---|
| [`veryl-sim/`](veryl-sim/) | Veryl testbench 的事件驅動模擬器（`$tb::clock_gen`、`$assert`、VCD） |
| [`veryl-eda/`](veryl-eda/) | 合成成閘級網表、iCE40 對應、自製佈局繞線 + 位元流、ASIC 後端（`--asic`） |
| [`veryl-wasm/`](veryl-wasm/) | 兩個 crate 編譯成 WebAssembly，以 JSON API 呼叫 |
| [`web/`](web/) | 純前端的網頁環境（TypeScript） |
| [`examples/`](examples/) | 範例設計的 Veryl 專案，含一顆單週期 RV32I CPU |

## 網頁環境
用瀏覽器開啟 `web/dist/index.html` 即可，不需要伺服器、不需要安裝，從 `file://` 開也能用。

- **原始碼**：範例專案（每個可有多個檔案，含 UART、FIFO、VGA）放在編輯器裡；修改存在瀏覽器（localStorage）。
  可以新增檔案（附模組 + testbench 範本）、刪除、匯入，也能把專案下載成 `.zip`（`Veryl.toml` + `src/`），
  官方的 `veryl build` / `veryl test` 可以直接使用。
- **▶ 模擬**：在 WebAssembly 裡執行所有 `#[test]` testbench，有輸出記錄、可點的錯誤位置與波形檢視。
  旁邊的選單可切到**合成後模擬**：把範例的設計模組換成合成出來的網表（通用閘、iCE40 LUT / block RAM、
  或標準元件），用同一個 testbench 跑。
- **⚙ 合成**：合成檢視。每個階段都有報告、可縮放的圖與細節側欄：
  - 共用：① RTL→Logic → ② Logic Netlist → ③ Tech-indep Syn
  - FPGA：④ LUT4 Techmap → ⑤ Placement（退火動畫）→ ⑥ Global+Detail Routing → ⑦ Timing (STA)。
    可下載 `.asc`、`.pcf` 與 `.bin`；`.bin` 與 icepack 的輸出逐位元組相同，可用 `iceprog` 燒錄。
  - ASIC：④ Standard Cell Map → ⑤ Row Placement（動畫）→ ⑥ CTS + Global Routing → ⑦ Detail Routing →
    ⑧ Timing (STA) → ⑨ Power + IR Drop。可下載標準元件 Verilog 與 DEF。
  - ⇄ FPGA vs ASIC：兩種佈局並排，加上比較表（元件、面積、繞線、Fmax、能量、功耗）。

（展示頁的介面是繁體中文；簡體中文或英文介面請用下面的 IDE。）

網址的 hash 可以指定範例與階段，例如 `index.html#ex=soc&synth=1&target=asic`。

### IDE
`web/dist/ide.html` 是建在同一個核心上、功能更完整的 VS Code 風格 IDE（上面的展示頁保持不變）：

- 活動列與側欄：專案檔案與模組大綱、範例庫、測試、說明
- 分頁編輯器：Veryl 語法上色、即時語法檢查（問題面板、行號旁標記、波浪底線）
- 專案存在瀏覽器：可有多個專案，新增 / 改名 / 刪除 / 匯入檔案，匯出 `.zip`
- ▶ 測試（RTL 或閘級）；✔ 全面驗證：每個 testbench 都在 RTL 與三種合成後網表上跑一遍
- 合成：標題列的 **FPGA / ASIC** 與**階段**選單（① RTL→Logic → ② Logic Netlist → ③ Tech-indep Syn，接著 FPGA ④–⑦
  或 ASIC ④–⑨，最後一項是 FPGA vs ASIC 比較），選了就在「合成流程」分頁顯示該階段；分頁只有一行麵包屑與圖示按鈕
  （ⓘ 階段說明、連線、退火動畫、⬇ 下載、縮放），數字在狀態列
- 下方面板（問題、輸出、測試結果、波形）、狀態列、命令選單（Ctrl/⌘+Shift+P）、快速開檔（Ctrl/⌘+P）
- ⚡ **虛擬 iCEBreaker**：把設計燒錄到畫出來的開發板上，LED 會亮（亮度依工作週期）、按鈕可以按，腳位和真實板相同（跑的是佈局繞線後真正的位元流：解碼回電路、逐週期模擬，小設計約真實速度的 0.3–0.4 倍；任何 iCE40UP5K 的 `.bin`，例如 nextpnr 產生的，都可以拖放上去）；可以接上 USB 序列終端機與 PMOD 模組（8 顆 LED、8 個開關、兩位數七段顯示器、VGA 螢幕、蜂鳴器）與**麵包板**（LED、電阻、按鈕、開關、導線接在 PMOD 腳上；短路、沒有限流電阻、輸入浮接都會警告）；腳位表會寫入專案的 `pins.pcf`；整個實驗（檔案、腳位、模組、麵包板）可以用一個連結分享
- **在你自己的 RISC-V 上跑 C**：`RvSoc`（`examples/src/rvsoc.veryl`，多週期 RV32IMA + Zicsr、有中斷，暫存器檔與 8 KB 記憶體都在 block RAM，加上 LED、按鈕、開關、UART、計時器）跑在瀏覽器裡由 veryl-eda 自己的編譯器（`src/rv/`：C 子集、組譯器、指令集模擬器）編出來的 C 程式；⚡ 把程式放進 block RAM（只改程式時不用重新合成、佈局繞線），虛擬板的 CPU 模式以即時速度執行，閘級 SoC 約真實的 1%；還有 VGA 文字模式（`RvVgaBoard`，40 × 30 字元）、用 C 寫的搶佔式多執行緒核心（計時器中斷、ecall、原子指令）；範例在「C 程式」群組
- 介面可用繁體中文、簡體中文或英文（標題列的選單切換；預設依瀏覽器語言）

`ide.html#ex=fifo&stage=place` 會開啟某個範例並跳到某個階段；加上 `&run=1` / `&verify=1` 會直接開始測試。

在專案根目錄一次建置、一次測試全部：

```sh
./build.sh          # veryl-sim、veryl-eda（release）與 web/dist（wasm + 網頁）；--no-web 只建 Rust 工具
./test.sh           # veryl-sim、veryl-eda 的 cargo test、教學流程、npm test（和 CI 相同）
./test.sh --full    # 再加 veryl-eda/test.sh：用 yosys 做形式等價、FPGA 流程（需要 OSS CAD Suite）
```

從 crates.io 安裝命令列工具（`veryl-sim`、`veryl-eda`）：

```sh
cargo install veryl2chip-sim veryl2chip-eda
```

重新建置（需要 Rust + wasm32 target、Node.js）：

```sh
cd web
npm install
npm run build
npm test
```

`npm run build` 重建 `web/dist`。`npm test` 用建好的 `dist/` 把每個範例跑過一遍：模擬、合成、FPGA 佈局繞線
（`.asc` 與 CLI 相同，`.bin` 與 icepack 相同）、ASIC 流程（結果與 CLI 相同）、每個範例的閘級模擬、
解開匯出的專案 `.zip` 並以 `veryl test` 檢查，以及介面翻譯。

指令與架構見 [AGENTS.md](AGENTS.md)；各 crate 的 README（[veryl-sim](veryl-sim/README.tw.md)、[veryl-eda](veryl-eda/README.tw.md)）有更多細節。
