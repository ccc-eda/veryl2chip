# 虛擬實驗課：不用買板子也能做完的 FPGA 實驗

這份講義是 [從零開始的教學](README.tw.md) 的實驗課版本。每個實驗都在**瀏覽器裡的虛擬 iCEBreaker** 上完成：
程式碼經過真正的合成、佈局繞線、產生位元流，虛擬板跑的就是那個位元流。所以在虛擬板上通過的設計，
燒進實體板也會有一樣的行為（腳位、時脈、按鈕和 LED 都照 iCEBreaker 的實際接法）。

```
寫 Veryl → testbench 模擬 → 合成 → 佈局繞線 → 位元流 → ⚡ 虛擬板（LED、按鈕、麵包板、終端機、七段、VGA）
```

- 線上 IDE：<https://ccc-eda.github.io/veryl2chip/web/dist/ide.html>（不用安裝任何東西，離線也能用：`web/dist/ide.html`）
- 每個實驗的「開啟」連結會直接載入範例並燒進虛擬板（網址後面的 `#ex=…&board=1`）。
- 做完的實驗可以用 **分享實驗** 產生一個連結（程式碼、腳位、麵包板接線都在網址裡），交作業或請助教看都用它。

## 實驗一覽

| # | 實驗 | IDE 範例 | 虛擬板上用到 | 新觀念 |
|---|---|---|---|---|
| 1 | Blinky 閃爍 LED | 教學 → 第 1 課 | 板上 LED、擴充板 LED、BTN_N | 計數器、除頻、`always_ff`、`if_reset` |
| 2 | 跑馬燈 | 教學 → 第 2 課 | 擴充板 LED、BTN1 | tick、按鈕同步器 |
| 3 | 邏輯閘（麵包板） | 實驗 → 邏輯閘 | 麵包板：開關、下拉電阻、LED、限流電阻 | 組合邏輯、上拉 / 下拉、浮接 |
| 4 | 按一下加一 | 實驗 → 按一下加一 | BTN1、BTN2、8 顆 LED 模組 | 上升緣偵測 |
| 5 | 紅綠燈 | 實驗 → 紅綠燈狀態機 | 麵包板上的三顆 LED、BTN1 | 有限狀態機（FSM）、參數化時間 |
| 6 | 七段顯示器 | 時序 → 七段顯示器計數 | 七段顯示器模組 | 多工掃描、解碼器 |
| 7 | UART | 教學 → 第 3 課 | USB 終端機 | 序列通訊、移位暫存器 |
| 8 | VGA | 周邊 → VGA | VGA 螢幕 | 視訊時序、計數器比較 |
| C1–C6 | C 程式（第二部分） | C 程式 → … | 終端機、LED、按鈕、開關、七段、蜂鳴器 | 在自己做的 RISC-V 上跑 C |

每個實驗都照同樣的四步走，**順序不能跳**：

1. **讀程式**：看懂設計和 testbench。
2. **模擬**：按 ▶ 執行測試（或 `veryl test`），全部通過才往下。
3. **合成與全面驗證**：用標題列的階段選單看 ③ 最佳化、④ LUT、⑤ 佈局，再按 ✔ 全面驗證（合成前後一樣嗎）。
4. **⚡ 虛擬板**：燒錄、操作、對照「檢查點」。

虛擬板的操作：按鈕用滑鼠按住（鍵盤 0–3 也可以：0 = BTN_N，1–3 = BTN1–3）；**📌 腳位**看每個埠接到哪一隻腳；勾 **🖥 USB 終端機** 和序列埠說話；
**PMOD1A / PMOD1B** 選單可以插上 8 顆 LED、8 個開關、七段顯示器、VGA 螢幕或蜂鳴器；**🧪 麵包板**可以放 LED、電阻、按鈕、開關和跳線，從板子的腳位拉線過去。接錯的時候（短路、LED 沒串電阻、輸入腳浮接）板子下方會出現警告。

---

## 實驗 1：Blinky

開啟：[第 1 課 Blinky](https://ccc-eda.github.io/veryl2chip/web/dist/ide.html#ex=tut_blinky&board=1)　講義：[教學第 2–8 節](README.tw.md#2-第-1-課blinky)

**檢查點**
- 擴充板的 5 顆 LED 以二進位往上數，LED5（最高位）大約 0.7 秒亮、0.7 秒暗。
- 按住 **BTN_N**（重置）：LED 全暗，板上的綠燈亮。放開後從 0 重新數。

**思考題**：在階段選單選 ⑦ Timing 看 Fmax（狀態列也有）。12 MHz 的板子需要多少？把 `WIDTH` 改成 20，閃得多快？（先改 testbench 的期望值！）

## 實驗 2：跑馬燈

開啟：[第 2 課 跑馬燈](https://ccc-eda.github.io/veryl2chip/web/dist/ide.html#ex=tut_knight&board=1)　講義：[教學第 9 節](README.tw.md#9-第-2-課跑馬燈)

**檢查點**
- 一顆燈在 5 顆 LED 之間來回跑。
- 按住 **BTN1**：燈停住；放開繼續。

**思考題**：把同步器拿掉（直接用 `i_btn`），模擬還會通過嗎？為什麼真實電路一定要同步器？

## 實驗 3：邏輯閘（麵包板）

開啟：[邏輯閘](https://ccc-eda.github.io/veryl2chip/web/dist/ide.html#ex=lab_gates&board=1)

麵包板已經接好：兩個開關（PMOD1B 腳 1、2）各接一個**下拉電阻**到 GND；四顆 LED（PMOD1A 腳 1–4）各串一個**限流電阻**。
四顆 LED 分別是 A AND B、A OR B、A XOR B、NOT A。

**檢查點**
- 撥動兩個開關，填完真值表（4 種組合 × 4 顆 LED），和你算的一樣。

**動手改接線**
1. 刪掉一個下拉電阻：板子下方出現「浮接」警告。真實的 FPGA 輸入腳浮接時讀到的值不確定，所以一定要上拉或下拉。
2. 把那個電阻改接到 3V3（**上拉**），開關改接到 GND：開關的意義反過來了（按下 = 0）。要讓 LED 的行為跟原來一樣，程式該怎麼改？
3. 刪掉一顆 LED 的電阻、讓 LED 直接接 GND：出現「沒有限流電阻」警告。實體電路上這樣接會燒壞 LED 或 FPGA 腳。

**思考題**：在階段選單選 ④ LUT4 看合成結果，四個輸出各用了幾個 LUT？為什麼？

## 實驗 4：按一下加一

開啟：[按一下加一](https://ccc-eda.github.io/veryl2chip/web/dist/ide.html#ex=lab_counter&board=1)（`examples/src/button_counter.veryl`）

按鈕先經過兩級同步器，再和「上一拍」比較：**這一拍是 1、上一拍是 0** 才算按下（上升緣），只維持一個時脈。
如果直接寫 `if btn { cnt = cnt + 1; }`，按住 0.1 秒就會加一百二十萬次。

**檢查點**
- 每按一次 **BTN1**，PMOD1A 的 8 顆 LED（二進位）加一；按住不放也只加一。
- 按 **BTN2** 歸零。
- testbench `TestButtonCounter`：按三下、每下按住 10 拍，結果是 3。

**動手改**
1. 把 `pressed` 改成 `btn_s[1]`（不抓上升緣），先跑 testbench：哪一個 `$assert` 失敗？計數變多少？
2. 加上 BTN3（腳 18）減一。腳位在 `pins.pcf` 加一行 `set_io -nowarn i_dec 18`，或在 📌 接腳表裡設。

**思考題**：實體按鈕還會**彈跳**（按下的幾毫秒內 0、1 跳好幾次）。要怎麼改才不會一次按下加好幾次？（提示：取樣慢一點，例如每 10 ms 看一次按鈕。）

## 實驗 5：紅綠燈（有限狀態機）

開啟：[紅綠燈狀態機](https://ccc-eda.github.io/veryl2chip/web/dist/ide.html#ex=lab_traffic&board=1)（`examples/src/traffic.veryl`）

三個狀態 GREEN → YELLOW → RED → GREEN，各有自己亮幾秒（綠 5、黃 1、紅 4）。
`tick` 數到一秒（`SEC` 個時脈）就讓 `secs` 加一，`secs` 到了這個狀態的時間就換下一個狀態。
綠燈時按下 **BTN1**（行人按鈕），綠燈最多再亮 1 秒就換黃燈。

麵包板上的三顆 LED（紅、黃、綠）接在 PMOD1A 腳 1–3，各串一個電阻到 GND 軌。

**檢查點**
- 綠 5 秒 → 黃 1 秒 → 紅 4 秒，一直循環。
- 綠燈時按 BTN1：1 秒內變黃燈。紅燈或黃燈時按 BTN1：沒有作用。
- testbench 用參數 `SEC = 4`（一秒只有 4 拍）跑完一整輪，不用模擬 1200 萬個時脈。

**動手改**
1. 把狀態轉移畫成狀態圖（三個圓圈、轉移條件寫在箭頭上），和程式對照。
2. 加一個「夜間模式」：開關（麵包板上加一個開關和下拉電阻，接到 PMOD1B 腳 1 = 腳 43）打開時，黃燈每秒閃一次，其他燈不亮。
   先在 testbench 裡加測試，再改設計。

**思考題**：為什麼 testbench 要把 `SEC` 改小？如果用預設值，`veryl test` 要模擬多久？

## 實驗 6：七段顯示器

開啟：[七段顯示器計數](https://ccc-eda.github.io/veryl2chip/web/dist/ide.html#ex=sevenseg&board=1)（`examples/src/sevenseg.veryl`）

兩位數的七段顯示器只有一組 a–g 腳和一隻「選位數」的腳：設計快速地輪流點亮個位和十位（多工掃描），人眼看起來兩位同時亮。

**檢查點**
- 顯示 00 → 99 每 0.25 秒加一；按 **BTN1** 歸零。

**動手改**
1. 把掃描速度調得很慢（例如每 0.5 秒換一位），在虛擬板上看會怎樣？再調回來。
2. 改成十六進位 00–FF：解碼器要加 A–F 六個字形。

## 實驗 7：UART

開啟：[第 3 課 UART 回聲](https://ccc-eda.github.io/veryl2chip/web/dist/ide.html#ex=tut_uart&board=1)　講義：[教學第 10 節](README.tw.md#10-第-3-課uart)

**檢查點**
- 終端機先出現 `Hi!`；輸入 `hello, World` 按 Enter，收到 `HELLO, wORLD`。
- 把終端機的鮑率改成 9600：出現「格式錯誤」。這就是兩端鮑率不一致時的樣子。

**動手改**：[教學練習題 5](README.tw.md#11-練習題)（每秒送出秒數）。

## 實驗 8：VGA

開啟：[VGA 640×480](https://ccc-eda.github.io/veryl2chip/web/dist/ide.html#ex=vga&board=1)（`examples/src/vga.veryl`）

VGA 是一個像素接一個像素送出去的：水平計數器數到 800（640 個可見像素 + 遮沒），垂直計數器數到 525。
HSYNC、VSYNC 在遮沒區間拉低一段時間，螢幕靠它們找到每一行、每一張畫面的開頭。虛擬板的 VGA 螢幕（PMOD1A + 1B）一個時脈收一個像素。

**檢查點**
- 螢幕上出現直的色條（每 64 個像素換一種顏色）。

**動手改**
1. 改成橫的色條（用垂直計數器決定顏色）。
2. 畫一個棋盤格：`x[5] ^ y[5]`。
3. 在畫面中間畫一個白色方塊，用 BTN1 / BTN2 讓它左右移動（每張畫面移動一次）。

---

# 第二部分：C 程式實驗（在你自己的 RISC-V 上）

前面的實驗都是「用 Veryl 寫硬體」。這一部分換個方向：硬體已經寫好了——`examples/src/rvsoc.veryl` 的 **RvSoc**，
一顆用 Veryl 寫的多週期 RISC-V CPU，加上 8 KB 記憶體、LED、按鈕、開關、序列埠和計時器——你寫的是**在它上面跑的 C 程式**。

```
C 程式 → 編譯器（veryl-eda 自己寫的，在瀏覽器裡）→ RISC-V 機器碼 → 放進 SoC 的 block RAM → ⚡ 虛擬板
```

- 範例庫 → **C 程式** 群組。每個範例都包含整個 SoC 的 Veryl 原始碼和一個 `.c` 檔。
- **⚡ 虛擬板** 會先編譯 C；有錯誤就顯示在「問題」面板（含行號）。
- 只改 C 程式時，再按 ⚡ 只會把新程式換進 block RAM，**不用重新合成、佈局繞線**（位元流模式也是：只改寫存放程式的那幾塊 RAM）。
- 虛擬板的模式：
  - **CPU（C 程式，即時）**：C 範例的預設。CPU 用指令集模擬器跑（記憶體映射、時脈數和 RvSoc 相同），即時速度，周邊和腳位照常。
  - **位元流（真實）** / **網表**：跑的是合成出來的閘級 SoC，速度約真實的 1%，`delay_ms(200)` 要等約 20 秒。拿來確認「我的硬體真的會跑這個程式」。
- 命令選單（Ctrl/⌘+Shift+P）：**C：檢視組合語言**（每一行 C 編出哪些指令、放在哪個位址）、**C：在指令集模擬器上執行**（輸出到「輸出」面板）。

**記憶體映射與函式庫**（自動包含，不用 `#include`）

| 名稱 | 位址 | 用途 |
|---|---|---|
| `LED` | 0x1000_0000 | 寫：PMOD1A 的 8 支腳（LED 模組、七段顯示器、蜂鳴器） |
| `BUTTONS` / `SWITCHES` | 0x1000_0004 | 讀：BTN1–3（bit 0–2）/ PMOD1B 的 8 個開關 |
| `UART_DATA` / `UART_STATUS` | 0x1000_0008 / 0C | 序列埠（通常用 `putchar` / `getchar` / `printf`） |
| `TIMER` | 0x1000_0010 | 重設後經過的時脈數（12 MHz） |

函式：`printf`（`%d %u %x %c %s`，可設寬度）、`putchar`、`getchar`、`kbhit`、`puts`、`read_line`、`delay_ms`、`delay_us`、`millis`、`rand`、`srand`、`abs`、`atoi`、`strlen`、`strcmp`、`strcpy`、`memset`、`memcpy`。
C 的子集：`char`（無號）/ `short` / `int` / `unsigned`、指標、陣列、所有運算子、`if` / `while` / `for` / `do` / `switch`；沒有 `struct`、浮點數。
RV32I 沒有乘除法指令，`*` `/` `%` 由函式庫用軟體做（看組合語言就會看到 `call __mulsi3`）。

## C1：Hello

開啟：[C：Hello](https://ccc-eda.github.io/veryl2chip/web/dist/ide.html#ex=c_hello&board=1)

**檢查點**：終端機出現問候語；LED 每 0.2 秒加一；在終端機打字，收到大寫。

**動手改**：讓它也回傳字元的 ASCII 碼（`printf("%c=%d ", c, c)`）。改完按 ⚡，看狀態列：「新程式已放進 block RAM」——沒有重新合成。

## C2：跑馬燈（軟體版）

開啟：[C：跑馬燈](https://ccc-eda.github.io/veryl2chip/web/dist/ide.html#ex=c_knight&board=1)

和實驗 2 的硬體跑馬燈做一樣的事，這次用軟體：`LED = 1 << pos`，按鈕的上升緣用 `b & ~prev` 偵測。

**思考題**：硬體版和軟體版，哪一個用的 LUT 比較多？（硬體版：② 合成看 LUT；軟體版：硬體是整顆 CPU，程式只是 RAM 裡的資料。）

## C3：猜數字

開啟：[C：猜數字](https://ccc-eda.github.io/veryl2chip/web/dist/ide.html#ex=c_guess&board=1)

**檢查點**：在終端機玩一局。**動手改**：猜太多次（超過 7 次）就公布答案。

## C4：七段顯示器（軟體掃描）

開啟：[C：七段顯示器](https://ccc-eda.github.io/veryl2chip/web/dist/ide.html#ex=c_sevenseg&board=1)

和實驗 6 比較：那裡由硬體掃描，這裡由程式每 2 ms 輪流點亮個位和十位。**動手改**：把 `delay_ms(2)` 改成 `delay_ms(200)`，看看會怎樣。

## C5：蜂鳴器音樂

開啟：[C：蜂鳴器音樂](https://ccc-eda.github.io/veryl2chip/web/dist/ide.html#ex=c_music&board=1)

一個頻率 f 的聲音 = 每 1/(2f) 秒把腳位反相一次。**動手改**：加上你喜歡的曲子（Do = 262、Re = 294、Mi = 330 Hz …）。

## C6：開關

開啟：[C：開關](https://ccc-eda.github.io/veryl2chip/web/dist/ide.html#ex=c_switches&board=1)

**檢查點**：撥開關，LED 跟著變，終端機印出二進位與十六進位。**動手改**：把開關的值當成兩個 4 位元的數，在終端機印出相加的結果。

**進階**：打開 **C：檢視組合語言**，找出 `printf` 被呼叫的地方，數數看一個 `for` 迴圈編成了幾道指令。再把 RvSoc 的硬體改一改（例如加一個暫存器），用 ⚡ 位元流模式確認程式還是能跑。

---

## 給老師

- 每個實驗都有 testbench，`veryl test` 和本專案的閘級模擬都能自動檢查；學生交的「分享實驗」連結打開就能重跑。
- 實驗 3、5 的麵包板接線存在範例裡（`web/build.mjs` 的 `board.bb`）。在 IDE 裡接好一組新電路，用 **匯出實驗**（`.lab.json`）或分享連結就能發給學生。
- 虛擬板跑的是真正的位元流（用 IceStorm 的晶片資料庫解碼），時脈 12 MHz。複雜設計跑得比實際慢，工具列上會顯示目前是即時的幾 %。
- 有實體板的話：同一份 `pins.pcf` 和位元流（虛擬板工具列的 ⬇ .bin）直接用 `iceprog` 燒進 iCEBreaker。
