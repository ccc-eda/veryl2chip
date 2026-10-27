# 11. 網頁 IDE

<https://ccc-eda.github.io/veryl2chip/web/dist/index.html>

整套工具（模擬器、合成器、FPGA 與 ASIC 流程、C 編譯器）編成 WebAssembly 放在網頁裡，
**不需要伺服器、不上傳程式碼**：所有計算都在你的瀏覽器裡做。`web/dist/` 整個目錄下載下來，用 `file://` 打開也能離線用。

## 畫面

```
┌ 標題列：▶ 測試  ✔ 全面驗證 │ 後端 ▾  階段 ▾  頂層 ▾  ⚡ 虛擬板 │ ⌘ 命令  語言 ┐
├────────┬──────────────────────────────────────────────────┤
│ 活動列 │ 編輯器分頁：檔案、⚙ 合成流程、⚡ 虛擬 iCEBreaker、組合語言 │
│ 側欄   │                                                    │
│ 檔案   ├──────────────────────────────────────────────────┤
│ 模組   │ 面板：問題 │ 輸出 │ 測試結果 │ 波形                     │
│ 測試   │                                                    │
│ 範例   │                                                    │
├────────┴──────────────────────────────────────────────────┤
│ 狀態列：WebAssembly、檢查結果、測試、合成統計                    │
└───────────────────────────────────────────────────────────┘
```

| 區域 | 內容 |
|---|---|
| 側欄 · 檔案 | 專案的檔案（`.veryl`、`pins.pcf`、最多一個 `.c`）；＋ 新增，滑過檔名出現 ✎ 重新命名、🗑 刪除 |
| 側欄 · 模組 | 每個 module，哪些是 `#[test]`；點一下跳到定義 |
| 側欄 · 測試 | 每個 testbench 的 ▶ 與通過 / 失敗狀態，「全部執行」 |
| 側欄 · 範例 | 範例庫（下面），點一下開成新專案 |
| 面板 | 問題（語法錯誤會一邊打字一邊出現，點一下跳到那一行）、輸出、測試結果、波形 |

介面有繁體中文、English、简体中文三種語言（標題列右側的選單）。

### 在手機上

螢幕寬度在 760 px 以下時（手機直放），版面自動改成：

- **標題列**：只有 ▶ 測試、⚡ 虛擬板、⌘ 命令和 **⋯**；按 ⋯ 展開模擬與合成的選單、全面驗證和語言。
  點合成流程分頁的麵包屑也會自動展開。
- **側欄**：平常收起；點左邊活動列的圖示，從左側滑出、蓋在編輯器上；點選檔案或範例、或點編輯器就收回。
- **編輯器**：16 px 字（避免手機在輸入時自動放大畫面）；面板分頁可以左右滑動，面板高度可以拖曳。
- **合成流程**：晶片圖在上、說明在下；**虛擬板**：控制列可以左右滑動，板子佔滿寬度。

功能和桌面版完全相同（同一個網頁），網址參數與分享的實驗連結照常可用。

## 專案

- 專案存在瀏覽器的 localStorage 裡（每次修改自動儲存；換電腦或清除網站資料就不見了，重要的請下載）。
- 歡迎頁：＋ 新專案、📚 開啟範例、⇪ 匯入 `.veryl` 檔、最近的專案。
- 從範例開的專案改了也不會影響範例；「還原成範例原始碼」可以回到原樣，改過的檔案在分頁上有標記。
- 下載專案 `.zip`：`Veryl.toml` + `src/`，就是一個官方 `veryl` 能用的專案；`v2c` 直接讀 `src/*.veryl` 即可。
- C 程式：新增檔案時取名 `xxx.c`（一個專案一個），設計要用 `RvBoard`（從「C 程式」範例開始最簡單）。

## 測試與驗證

| 動作 | 對應的命令列 |
|---|---|
| ▶ 測試（Ctrl/⌘+Enter） | `v2c sim` |
| 模擬對象：RTL / 閘級：通用閘 / iCE40 / 標準元件 | `v2c gatesim opt / ice40 / asic` |
| ✔ 全面驗證 | RTL 和三種網表各跑一次，比較結果 |
| 模擬頂層選單 | `--top`（預設：全部 `#[test]`） |

✔ 全面驗證的結果：

- 全部通過，就是合成正確。
- 「有測試失敗（各實作結果一致）」：設計本身有錯。
- 「合成前後結果不一致」：合成出問題，或設計依賴了上電為 0 之外的初始值。

波形分頁顯示 testbench 的全部訊號（等於 `--vcd` 用 GTKWave 看），可以縮放、拖曳。

## 合成流程分頁

標題列的三個選單：

| 選單 | 選項 |
|---|---|
| **後端** | FPGA、ASIC · vlib、ASIC · SKY130 |
| **階段** | 要看哪一步（Ctrl/⌘+Shift+B 合成並顯示目前的階段） |
| **頂層** | 合成哪個 module（等於 `--top`） |

| 階段 | FPGA | ASIC |
|---|---|---|
| ① RTL→Logic | 共用：Veryl 原始碼對應到的邏輯 | |
| ② Logic Netlist | 共用：最佳化前的閘級網表 | |
| ③ Tech-indep Syn | 共用：最佳化後（`v2c synth`） | |
| ④ | LUT4 對應（`SB_LUT4` / `SB_CARRY`…） | 標準元件對應 |
| ⑤ | 佈局（退火動畫） | 列式佈局（退火動畫） |
| ⑥ | 全域與細部繞線 | 時脈樹 + 全域繞線 |
| ⑦ | 時序（STA） | 細部繞線（SKY130 顯示每一層金屬與 DRC） |
| ⑧ | | 時序（STA） |
| ⑨ | | 功耗 + IR drop |

- 麵包屑列：切換階段，放大 / 縮小 / 符合視窗，開關連線。
- ⓘ：這個階段在做什麼，以及它的數字。
- 下載按鈕依階段而定：

  | 後端 | 可下載 |
  |---|---|
  | FPGA | `.asc`、`.bin`（可以直接 `iceprog`）、`.pcf` |
  | ASIC | 標準元件 Verilog、DEF |
  | SKY130 | 另外還有 GDSII |

- 「⇄ FPGA vs ASIC 比較」把兩個後端的面積、時序、功耗並排。

## 模擬機（🖥）

有些設計放不進 FPGA，也不適合走 ASIC，例如有 256 MB RAM 的 RV64 SoC。這種設計用第三種方式「實體化」：
標題列的「🖥 模擬機」用 veryl-emu（`veryl-emu/`，見第 13 章的原始碼地圖）把設計編譯成 WebAssembly，在瀏覽器的背景 worker 裡當成一台機器開機，
UART 接到分頁裡的終端機。

- 專案要有 `machine.json`，說明頂層模組和腳位的用途：

  ```json
  {
    "top": "Rv64Soc",
    "reset": { "port": "i_rst", "active": 0, "cycles": 2 },
    "uart": { "tx_valid": "o_tx_valid", "tx_data": "o_tx_data", "rx_valid": "i_rx_valid", "rx_data": "i_rx_data", "rx_ready": "o_rx_ready" },
    "finish": { "valid": "o_finish", "code": "o_finish_code", "pass": 21845 },
    "ram": { "array": "mem", "base": "0x80000000" },
    "load": [{ "image": "linux" }]
  }
  ```

  UART 是交握式的埠（一拍一個位元組：`tx_valid` 那一拍送出 `tx_data`，`rx_valid` 送進 `rx_data`）；
  寫入關機裝置（`finish`）時結束；`load` 是開機前放進 RAM 的程式（內建的映像，ELF 依它的程式段）。
- 工具列：🖥 開機（重新編譯、載入、開機）、⏸ / ▶、⟲ 重設、📂 程式（載入自己的 ELF 或二進位檔再開機），以及拍數與速度。
- 範例「RV64 + Linux（模擬機）」開 OpenSBI + Linux 6.12 + busybox：瀏覽器裡每秒約 370 萬拍，開到 `rv64:~$` 約 1 分鐘，
  之後就可以在終端機打指令。Linux 映像（`img_linux.js`，約 2.4 MB）第一次開機時才載入。
- 這種專案的頂層太大，▶ 測試與合成會改成提示用模擬機（裡面的 `Rv64Core` 仍然可以合成）。
- **開發板**（v2.16）：`machine.json` 有 `"gpio": { "out": "o_gpio", "oe": "o_gpio_oe", "in": "i_gpio" }` 與 `"board": "pi"` 時，
  終端機旁邊畫一塊像樹莓派的板子：40 針排針（GPIO 3–15 放在樹莓派相同 BCM 編號的位置）、PWR 燈、ACT（GPIO 0，Linux 的心跳）
  與 USER（GPIO 1）LED、按鈕（GPIO 2，按住 = 1），下面是和虛擬 iCEBreaker 相同的麵包板（接排針的 GPIO 3–15、3V3、GND）。
  麵包板的配置存在專案裡。試試看：

  ```sh
  echo 1 > /sys/class/leds/user/brightness          # USER LED
  B=$(cat /sys/class/gpio/gpiochip*/base)
  echo $((B+5)) > /sys/class/gpio/export; echo out > /sys/class/gpio/gpio$((B+5))/direction
  echo 1 > /sys/class/gpio/gpio$((B+5))/value       # 麵包板上的 LED（接在 GPIO 5）
  echo $((B+2)) > /sys/class/gpio/export; cat /sys/class/gpio/gpio$((B+2))/value   # 按住板上的按鈕再讀
  ```
- 手機上 256 MB 的記憶體可能配置不到；模擬機的按鈕在手機版收在 ⋯ 裡。

## C 程式

專案有 `.c` 檔時：

- 命令選單的「C：檢視組合語言」打開組合語言分頁（與 `v2c cc -S` 相同）。
- 「C：在指令集模擬器上執行」把序列埠輸出印到輸出面板（等於 `v2c cc --run`，可以先輸入要送給程式的文字）。
- ⚡ 虛擬板會自動編譯 C 並載入（第 12 章）。

## 鍵盤

| 鍵 | 作用 |
|---|---|
| Ctrl/⌘+Enter | 執行測試 |
| Ctrl/⌘+Shift+B | 合成並顯示目前階段 |
| Ctrl/⌘+Shift+P | 命令選單（所有動作都在這裡） |
| Ctrl/⌘+P | 快速開啟：專案、範例、檔案 |
| Ctrl/⌘+S | 儲存（其實一直都在自動儲存） |
| Ctrl/⌘+J | 收合 / 展開面板 |
| Tab / Shift+Tab | 縮排 / 取消縮排 |

## 範例庫

| 分類 | 範例 |
|---|---|
| 教學 | Blinky、跑馬燈、UART 回聲（`tutorial/`） |
| 實驗 | 按一下加一、紅綠燈狀態機、麵包板邏輯閘（`tutorial/labs.tw.md` 用） |
| 基礎 | 加法器、package + enum、generate、function |
| 時序 | 計數器、狀態機、RAM、block RAM、FIFO、struct、七段顯示器 |
| 周邊 | UART、VGA |
| RISC-V | 單週期 RV32I、RISC-V SoC |
| C 程式 | `examples/c/` 的 8 個程式在 `RvBoard` 上 |
| 綜合 | 進位鏈、多塊 block RAM、語言功能大雜燴 |

## 網址參數

網址 `#` 後面可以帶參數，用 `&` 連接，適合放在講義裡：

| 參數 | 作用 |
|---|---|
| `ex=ID` | 開啟範例（例如 `ex=tut_blinky`；已經開過就切到那個專案） |
| `run=1` | 開好後執行測試 |
| `verify=1` | 執行全面驗證 |
| `stage=KEY` | 合成並顯示某階段：`rtl raw opt map place route sta`（FPGA）、`amap aplace aroute adetail asta apower`（ASIC） |
| `pdk=sky130` | ASIC 用 SKY130 |
| `board=1` | 燒錄到虛擬板 |
| `lab=…` | 匯入分享的實驗（第 12 章） |

例：`index.html#ex=tut_knight&board=1`、`index.html#ex=fifo&stage=adetail&pdk=sky130`。
範例的 ID 在 `web/build.mjs`。

## 展示頁

`demo.html` 是最早的單頁展示（繁體中文）：選範例、模擬、合成流程以全螢幕覆蓋顯示。功能是 IDE 的子集。
