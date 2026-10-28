# 11. 網頁 IDE

<https://ccc-eda.github.io/veryl2chip/web/dist/index.html>

整套工具（模擬器、合成器、FPGA 與 ASIC 流程、C 編譯器）編成 WebAssembly 放在網頁裡，
**不需要伺服器、不上傳程式碼**：所有計算都在你的瀏覽器裡做。`web/dist/` 整個目錄下載下來，用 `file://` 打開也能離線用。

## 畫面

```
┌ 標題列：[主按鈕 ▾]（進階：驗證 │ 看電路 │ 跑起來）     ⌘ 命令  進階 ▸  語言 ┐
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

### 主按鈕與選單（v2.27）

標題列最左邊的藍色按鈕是**主按鈕**：這個專案建議的下一步。它跟著專案走：

| 專案 | 主按鈕 |
|---|---|
| 一台模擬機（有 `machine.json`，例如 RV64 開發板） | 🖥 模擬機（開機） |
| 開發板專案、打開了 `.py` / `.c` / `.sh` | ▶ 執行 `main.py`（在板子上執行打開的程式） |
| 有腳位檔（`.pcf`） | ⚡ 虛擬板 |
| 其他（有 testbench） | ▶ 測試 |

旁邊的 **▾** 列出所有動作，照「想做什麼」分成三組，每項附一行說明：

| 組 | 動作 |
|---|---|
| 驗證 | ▶ 測試、✔ 全面驗證 |
| 看電路 | ⚙ 合成：FPGA（iCE40）、ASIC · vlib、ASIC · SKY130，⇄ FPGA 與 ASIC 比較 |
| 跑起來 | ⚡ 虛擬板、🖥 模擬機（RV64 開發板可選 riscv-emu 或 veryl-emu） |

建議的那一項標著「建議」。這個專案用不到的動作是淡色的，說明寫的是原因；點了會跳出原因與能做的事，例如「新增 pins.pcf」
「仍要燒錄（預設腳位）」「打開 main.py」「🖥 開機」。

**簡易與進階**：預設是簡易，標題列只有主按鈕和 ▾；在合成流程分頁時才出現合成的選單（目標、階段、頂層）。按標題列右邊的
「進階 ▸」（或 ▾ 選單最下面、命令選單）切到進階：所有控制都在標題列上，分成「驗證」（▶ 測試、測試的頂層、RTL / 閘級模擬、
✔ 全面驗證）、「看電路」（目標、階段、頂層）、「跑起來」（⚡ 虛擬板、🖥 模擬機）三組，視窗窄時排成兩列。專案用不到的按鈕
一樣是淡色虛線框，點了說明原因。選擇記在瀏覽器裡。

編輯器上方的**建議步驟**列出這個專案的 ①②③（例如 ① ⚡ 虛擬板 → ② ▶ 測試 → ③ ⚙ 合成），點一下就做；
× 關掉，命令選單的「顯示建議步驟」再打開。

### 在手機上

螢幕寬度在 760 px 以下時（手機直放），版面自動改成：

- **標題列**：只有主按鈕和 ▾、⌘ 命令和 **⋯**；按 ⋯ 展開「驗證」「看電路」「跑起來」三組的所有控制和語言。
  點合成流程分頁的麵包屑也會自動展開。
- **側欄**：平常收起；點左邊活動列的圖示，從左側滑出、蓋在編輯器上；點選檔案或範例、或點編輯器就收回。
- **編輯器**：16 px 字（避免手機在輸入時自動放大畫面）；面板分頁可以左右滑動，面板高度可以拖曳。
- **合成流程**：晶片圖在上、說明在下；**虛擬板**：控制列可以左右滑動，板子佔滿寬度。

功能和桌面版完全相同（同一個網頁），網址參數與分享的實驗連結照常可用。

## 專案

- 專案存在瀏覽器的 localStorage 裡（每次修改自動儲存；換電腦或清除網站資料就不見了，重要的請下載）。
- 歡迎頁（第一次打開 IDE 時出現；命令選單的「歡迎頁」再打開）先問**你想做什麼？**（v2.28），四張卡片各有一個起點範例：

  | 卡片 | 起點範例 | 按「從這裡開始」 |
  |---|---|---|
  | 🧪 學 Veryl | 第 1 課 Blinky | 開啟並跑測試（看結果和波形） |
  | ⚡ 做電路，放上開發板（像 Arduino） | 實驗：紅綠燈狀態機 | 開啟並燒進虛擬板（麵包板已接好） |
  | 🖥 開一台電腦，寫程式（像樹莓派） | RV64 開發板 | 開啟並開機 |
  | ⚙ 看電路變成晶片 | FIFO 256×8 | 開啟並合成 |

  「看這一類的範例」打開範例庫並篩選成那一類。下面是＋ 新專案、📚 開啟範例、⇪ 匯入 `.veryl` 檔、最近的專案。
  選了卡片只決定從哪裡開始，介面不會被鎖住：主按鈕與 ▾ 照樣跟著專案走。
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
- 工具列：🖥 開機（重新編譯、載入、開機）、⏸ / ▶、⟲ 冷開機、💾 存狀態、📂 程式（載入自己的 ELF 或二進位檔再開機），以及拍數與速度。
- 快照（v2.17）：開機時，先找這個專案在瀏覽器裡存下的狀態（💾），再找內附的快照（`machine.json` 的 `"snapshot"`，建置網頁時
  由 `web/snapshot.mjs` 開到 `"prompt"` 做成 `img_snap_*.js`），都沒有才冷開機；狀態只適用於同一個編譯結果（改過 Veryl 就會冷開機）。
  RV64 開發板從快照約 10 秒就有 shell（冷開機約 1 分鐘）。
- 檔案（v2.18）：`machine.json` 有 `"files": { "addr": "0x8F000000", "size": 16777216 }` 時，專案的檔案（Veryl、`machine.json`、
  `.pcf` 以外）開機時放進板子的 `/root`（冷開機時 `/init` 執行 `getfiles`；從快照開機時 IDE 自動打 `getfiles`）；⇅ 檔案隨時再送一次。
  板子上打 `savefiles` 把 `/root`（隱藏檔以外）送回專案：檔案總管裡就出現在板子上建立或改過的檔案。
  RV64 範例附 `blink.sh`（閃 GPIO 5 的 LED）與 `button.sh`（數按鈕次數）：在板子上 `sh blink.sh`。
- **MicroPython**（v2.19）：板子上有 MicroPython 1.24（`micropython`，也叫 `python`；打 `micropython` 進 REPL，Ctrl-D 離開）與 `pi` 模組：
  `LED(n)`（`on()`、`off()`、`toggle()`、`value`、`blink()`；n = 0 / 1 是板上的 ACT / USER）、`Button(n)`（`is_pressed`、
  `wait_for_press()`、`wait_for_release()`；板上的按鈕是 2）、`Pin(n, Pin.OUT)`、`sleep`。打開 `.py` 或 `.sh` 檔時，標題列的 ▶ 變成
  「▶ 執行」（Ctrl/⌘+Enter）：先停掉板子上正在跑的程式（Ctrl-C，在 REPL 裡再 Ctrl-D），把專案的檔案送進 `/root`，再執行
  `micropython 檔名`（`.sh` 是 `sh 檔名`）；板子沒開時先開機。模擬機工具列的「▶ 執行 main.py」做同樣的事。
  範例：`main.py`（GPIO 5 的紅燈與 USER 燈輪流亮）、`button.py`（數按鈕次數）、`traffic.py`（麵包板上的紅黃綠燈 GPIO 5 / 12 / 13，
  GPIO 6 的按鈕讓綠燈提早結束）。
- **C**（v2.20）：開發板專案可以有好幾個 `.c` 檔；打開一個按「▶ 執行」，IDE 用 veryl-eda 的 C 編譯器（`--linux`，見第 10 章）在瀏覽器裡
  編成 RV64 Linux 執行檔，放進 `/root`（檔名去掉 `.c`）再執行 `./檔名`；編譯錯誤在「問題」面板。組合語言分頁顯示打開的那個 `.c`。
  函式庫：`printf`、`delay_ms`、`gpio_write`、`gpio_read`、`pin_mode`、檔案的 `open` / `read` / `write` 等。範例 `blink.c`、`count.c`、
  `lights.c` 對應三個 MicroPython 範例。`savefiles` 不會把編譯出來的執行檔送回專案（只收文字檔）。
- **目標選單**（v2.25）：標題列的目標選單有兩組：合成（FPGA、ASIC · vlib、ASIC · SKY130）與模擬機（veryl-emu、riscv-emu）。
  選模擬機就打開模擬機分頁、用那個引擎開機；選合成就回到合成流程。選單跟著分頁走（在模擬機分頁顯示它的引擎），專案用不到的模擬機
  是灰的（沒有 `machine.json`，或不是 Rv64Soc 時的 riscv-emu）。四種目標怎麼選見[第 15 章](15-targets.md)。
- **引擎**（v2.23）：`machine.json` 有 `"riscv": true`（設計是 Rv64Soc）時，模擬機工具列可以選引擎：**riscv-emu**（預設）只模擬指令集，
  像 QEMU，冷開機幾秒就有 shell，`sleep(1)` 就是真的一秒（時間跟著時鐘走），狀態列顯示 MIPS；**veryl-emu** 模擬 Veryl 寫的硬體本身
  （每一拍、每個訊號，從快照開機），要看自己改過的 Veryl 設計就選它。GPIO、麵包板、檔案、▶ 執行、螢幕、💾 兩種引擎都一樣
  （存下的狀態屬於存它的引擎）。riscv-emu 不看專案的 Veryl 原始碼：它的 SoC 是 [riscv-emu](../riscv-emu/README.tw.md) 照 Rv64Soc 寫的。
  v2.24 起 riscv-emu 把常跑的程式片段翻成 WebAssembly（像 QEMU），一直在跑的程式約快四倍。
- **螢幕**（v2.21）：`machine.json` 有 `"fb": { "addr": "0x8EF00000", "width": 320, "height": 240 }` 時，板子和麵包板之間多一個
  320 × 240 的螢幕：Linux 的 `simple-framebuffer`（`/dev/fb0`，RGB565）放在 RAM 裡，worker 每 0.1 秒看一次，有變化才畫到 canvas。
  開機時 fbcon（tty1）顯示問候語；`echo hi > /dev/tty1` 寫字到螢幕上。MicroPython：`from pi import Screen` 是 320 × 240 的
  `framebuf`（`fill`、`line`、`rect`、`ellipse`、`text`…，再 `show()`），`big_text` 放大字、`rgb(r, g, b)` 算顏色；
  C：`fb_clear`、`fb_pixel`、`fb_rect`、`fb_line`、`fb_circle`、`fb_text`、`RGB()`（`/dev/fb0` 映射在 0x40000000，直接寫就看得到）。
  範例 `clock.py`（指針時鐘）、`shapes.c`（色條、圖形、文字、彈跳的球）。
- 範例「RV64 + Linux（模擬機）」開 OpenSBI + Linux 6.12 + busybox：瀏覽器裡每秒約 370 萬拍，開到 `rv64:~$` 約 1 分鐘，
  之後就可以在終端機打指令。Linux 映像（`img_linux.js`，約 2.4 MB）第一次開機時才載入。
- 這種專案的頂層太大，▶ 測試與合成會改成提示用模擬機（裡面的 `Rv64Core` 仍然可以合成）。
- **開發板**（v2.16）：`machine.json` 有 `"gpio": { "out": "o_gpio", "oe": "o_gpio_oe", "in": "i_gpio" }` 與 `"board": "pi"` 時，
  終端機旁邊畫一塊像樹莓派的板子：40 針排針（GPIO 3–15 放在樹莓派相同 BCM 編號的位置）、PWR 燈、ACT（GPIO 0，Linux 的心跳）
  與 USER（GPIO 1）LED、按鈕（GPIO 2，按住 = 1），下面是和虛擬 iCEBreaker 相同的麵包板（接排針的 GPIO 3–15、3V3、GND）。
  麵包板的配置存在專案裡。
  **鍵盤**（v2.30）：點一下板子或螢幕（周圍出現藍框），就能用鍵盤按按鈕：← 或空白鍵 = 麵包板上最左邊的按鈕、→ = 第二個、
  ↑ ↓ = 第三、四個，1–9 照順序，B = 板上的 BTN（GPIO 2）；板子下方那行會列出每個鍵對應哪支 GPIO。點終端機就回到打字。
  每次按鍵至少按住 0.12 秒，每幾十毫秒才讀一次按鈕的程式也不會漏掉。試試看：

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
| RV64 開發板 | Linux + MicroPython + C + 螢幕（模擬機）；跑馬燈、反應時間遊戲、呼吸燈、貪食蛇、俄羅斯方塊、系統監視器、Linux 指令入門 |
| RISC-V | 單週期 RV32I、RISC-V SoC |
| C 程式 | `examples/c/` 的 8 個程式在 `RvBoard` 上 |
| 綜合 | 進位鏈、多塊 block RAM、語言功能大雜燴 |

範例庫上方的篩選鈕（全部、🧪、⚡、🖥、⚙，旁邊是個數）只顯示能做那件事的範例，選擇記在瀏覽器裡；歡迎頁的卡片也會設定它。
範例旁的圖示說明它能做什麼：🧪 有測試、⚡ 能放上虛擬板、🖥 是一台模擬機；框起來的是建議的第一步。
每個範例的說明、檔案與命令列的跑法見第 16 章〈[範例總表](16-examples.md)〉。

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
