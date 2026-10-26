# 從零開始：用 Veryl 設計數位電路，燒進 iCEBreaker

這份教學從一個空白檔案開始，一路走到 FPGA 板子上的 LED 亮起來：

```
寫 Veryl → 模擬（testbench） → 看波形 → 合成 → 佈局繞線 → 位元流 → 燒進 iCEBreaker
```

適合當數位邏輯 / 計算機組織課程的實驗教材，大約 2 到 3 次實驗課（每次 2–3 小時）。
讀者需要知道布林代數、正反器、計數器這些基本觀念；不需要學過 Verilog。

三個範例設計（本目錄 `src/`），每一個都附 testbench：

| 課 | 設計 | 用到的觀念 |
|---|---|---|
| 第 1 課 | `Blinky`：閃爍 LED、二進位計數 | 模組、埠、`always_ff`、`if_reset`、`assign`、參數、testbench、`$assert` |
| 第 2 課 | `KnightRider`：跑馬燈，按鈕暫停 | 除頻（tick）、按鈕同步器、多個 `always_ff`、巢狀 `if`、測試的時序 |
| 第 3 課 | `UartEcho`：用序列埠和電腦說話 | 序列通訊（UART 8N1）、狀態與計數器、移位暫存器、testbench 扮演對方 |

> 沒有板子？[虛擬實驗課](labs.tw.md) 把這三課和另外五個實驗都搬到瀏覽器裡的虛擬 iCEBreaker 上，每個實驗都有檢查點和動手改的題目。

---

## 目錄

0. [準備](#0-準備)
1. [Veryl 的模組長什麼樣](#1-veryl-的模組長什麼樣)
2. [第 1 課：Blinky](#2-第-1-課blinky)
3. [寫 testbench 並模擬](#3-寫-testbench-並模擬)
4. [看波形](#4-看波形)
5. [合成：從 RTL 到 LUT](#5-合成從-rtl-到-lut)
6. [閘級模擬：合成前後一樣嗎](#6-閘級模擬合成前後一樣嗎)
7. [佈局、繞線與時序](#7-佈局繞線與時序)
8. [產生位元流並燒錄](#8-產生位元流並燒錄)
9. [第 2 課：跑馬燈](#9-第-2-課跑馬燈)
10. [第 3 課：UART](#10-第-3-課uart)
11. [練習題](#11-練習題)
12. [附錄：常見錯誤與指令速查](#12-附錄常見錯誤與指令速查)

---

## 0. 準備

### 硬體
- **iCEBreaker** 開發板（晶片是 Lattice iCE40UP5K-SG48），以及一條 micro-USB 線。
- 板子右邊可以折下來的部分（break-off section）有 5 顆 LED（LED1–LED5）和 3 個按鈕（BTN1–BTN3）。
  第 2 課會用到，**先不要折斷**，或折斷後用排針接回去。

沒有板子也能做第 0–7 章：模擬、波形、合成、佈局繞線都在電腦上。

### 軟體：兩條路線任選

**路線 A：瀏覽器（免安裝，建議課堂使用）**

打開 veryl2chip IDE：<https://ccc-eda.github.io/veryl2chip/web/dist/ide.html>

所有工具（模擬器、合成、佈局繞線、位元流產生器）都編譯成 WebAssembly 在瀏覽器裡執行，不需要伺服器。
左邊「📚 範例庫」最上面的「教學」分組就是本教學的兩個設計。
只有最後「燒進板子」這一步需要在電腦上裝 `iceprog`（見第 8 章）。

**路線 B：命令列**

```sh
# 1. Rust（https://rustup.rs）與官方 Veryl 工具
cargo install veryl

# 2. 本專案的模擬器與合成工具
git clone https://github.com/ccc-eda/veryl2chip.git
cd veryl2chip
(cd veryl-sim && cargo build --release)
(cd veryl-eda && cargo build --release)

# 3. FPGA 工具鏈（iceprog 燒錄、gtkwave 看波形、nextpnr 可選）
#    下載 OSS CAD Suite：https://github.com/YosysHQ/oss-cad-suite-build/releases
source oss-cad-suite/environment
```

為了少打字，以下假設你在 `tutorial/` 目錄，並設好兩個變數：

```sh
cd tutorial
SIM=../veryl-sim/target/release/veryl-sim
EDA=../veryl-eda/target/release/veryl-eda
```

---

## 1. Veryl 的模組長什麼樣

Veryl 是一種新的硬體描述語言，語法像 Rust，編譯成 SystemVerilog。和 Verilog 比，它少了很多容易犯錯的地方：
時脈和重設有自己的型別、`always_ff` 不用寫敏感列表、`if_reset` 統一處理重設。

```veryl
module 名稱 #(
    param 參數: u32 = 預設值,
) (
    埠名稱: input  clock   ,   // 時脈
    埠名稱: input  reset   ,   // 重設（預設：非同步、低電位有效）
    埠名稱: output logic<5>,   // 5 位元輸出
) {
    var 暫存器: logic<8>;      // 宣告一個 8 位元的訊號

    always_ff {                // 每個時脈正緣執行（時脈、重設自動找）
        if_reset {
            暫存器 = 0;        // 重設時
        } else {
            暫存器 = 暫存器 + 1;
        }
    }

    assign 埠名稱 = 暫存器[7:3];  // 組合邏輯：一直成立的連線
}
```

幾個重點：

| Veryl | 意思 | 對應的 Verilog |
|---|---|---|
| `logic<8>` | 8 位元 | `logic [7:0]` |
| `always_ff { ... }` | 時序邏輯（正反器） | `always_ff @(posedge clk or negedge rst)` |
| `if_reset { ... }` | 重設時要做的事 | `if (!rst) ...` |
| `assign a = b;` | 組合邏輯 | `assign a = b;` |
| `x[7:3]` | 取第 7 到第 3 位元 | `x[7:3]` |
| `{a, b}` | 串接 | `{a, b}` |
| `5'b00001`、`8'hA5` | 有寬度的常數 | 同 |
| `#[test(name)]` | 這個模組是 testbench | — |

`always_ff` 裡的 `=` 是「下一個時脈才生效」（等於 Verilog 的 `<=`）：同一個 `always_ff` 裡讀到的永遠是時脈前的舊值。

---

## 2. 第 1 課：Blinky

iCEBreaker 有一顆 12 MHz 的振盪器，也就是每秒 1200 萬個時脈。
如果用一個每個時脈加 1 的計數器，最高位元翻轉的速度就是 12 MHz 除以 2 的很多次方：

| 計數器寬度 | 最高位元一輪 | 看得到嗎 |
|---|---|---|
| 8 位元 | 2^8 / 12 MHz ≈ 21 µs | 太快，看起來一直亮 |
| 24 位元 | 2^24 / 12 MHz ≈ 1.4 s | 剛好 |

完整程式在 [`src/blinky.veryl`](src/blinky.veryl)：

```veryl
module Blinky #(
    param WIDTH: u32 = 24, // 2^24 / 12 MHz ≈ 1.4 秒一輪
) (
    i_clk : input  clock   , // 12 MHz
    i_rst : input  reset   , // 板上按鈕 BTN_N（按下 = 重設）
    o_ledr: output logic   , // 板上紅燈（低電位點亮）
    o_ledg: output logic   , // 板上綠燈（低電位點亮）
    o_led : output logic<5>, // 擴充板 LED1..LED5（高電位點亮）
) {
    var cnt: logic<WIDTH>;

    always_ff {
        if_reset {
            cnt = 0;
        } else {
            cnt = cnt + 1;
        }
    }

    assign o_ledr = !cnt[WIDTH - 1];
    assign o_ledg = cnt[WIDTH - 1];
    assign o_led  = cnt[WIDTH - 1:WIDTH - 5];
}
```

- 計數器 `cnt` 有 `WIDTH` 個位元，每個時脈加 1，溢位自動回到 0。
- 板上的紅、綠燈是**低電位點亮**（`_N` 結尾的接腳都是這樣），所以兩顆接到最高位元的正反兩面：輪流亮。
- 擴充板的 5 顆 LED 是**高電位點亮**，接到最高的 5 個位元：你會看到它們以二進位往上數，0 → 31 → 0。
- 板上的按鈕 BTN_N 接到 `i_rst`：Veryl 的 `reset` 預設是「非同步、低電位有效」，正好是按鈕按下時的 0。

> **想一想**：LED5（`o_led[4]`）和綠燈接的是同一個位元，它們的閃爍有什麼關係？LED1 一秒大約閃幾次？

---

## 3. 寫 testbench 並模擬

在真的燒進板子之前，先用**模擬**確認電路是對的。testbench 是另一個模組，它：
1. 產生時脈與重設，
2. 實例化要測的模組（device under test，DUT），
3. 在 `initial` 區塊裡一步一步推進時間，並用 `$assert` 檢查輸出。

`src/blinky.veryl` 後半段：

```veryl
#[test(test_blinky)]
module TestBlinky {
    inst clk: $tb::clock_gen;          // 這個 inst 本身就是時脈
    inst rst: $tb::reset_gen(clk);     // 重設產生器，跟著 clk

    var ledr: logic   ;
    var ledg: logic   ;
    var led : logic<5>;

    inst dut: Blinky #(
        WIDTH: 6,                      // 測試時用 6 位元，幾十個時脈就看得到變化
    ) (
        i_clk : clk ,
        i_rst : rst ,
        o_ledr: ledr,
        o_ledg: ledg,
        o_led : led ,
    );

    initial {
        rst.assert();                  // 重設一下：cnt = 0，綠燈亮（ledg = 0）
        $assert(led == 5'd0 && ledr == 1'b1 && ledg == 1'b0, "after reset: count 0, green on");
        clk.next(37);                  // 前進 37 個時脈：cnt = 37 = 6'b100101
        $assert(led == 5'b10010, "the top 5 bits of 37");
        $assert(ledr == 1'b0 && ledg == 1'b1, "the top bit is 1: red on, green off");
        clk.next(27);                  // 再 27 個：64 溢位回到 0
        $assert(led == 5'd0, "wraps around");
        $finish();
    }
}
```

**重點：用參數把電路縮小再測。** 24 位元的計數器要 1600 萬個時脈才轉一圈，模擬太久；
`WIDTH: 6` 讓一樣的電路 64 個時脈就轉一圈。這是硬體測試很常用的技巧。

### 執行模擬

**路線 A（IDE）**：範例庫 → 教學 → 「第 1 課 Blinky」，按標題列的 **▶ 測試**（或 Ctrl/⌘+Enter）。
下方「測試結果」面板會顯示 `✓ PASS`。

**路線 B（命令列）**：

```sh
$SIM src/blinky.veryl          # 本專案的模擬器
veryl test                     # 官方 Veryl 工具（會用自己的模擬器再跑一次）
```

輸出：

```
=== simulating TestBlinky ===
$finish called at time 655
TestBlinky: PASS
```

### 故意弄錯一次

把 `$assert(led == 5'b10010, ...)` 改成 `5'b10011` 再跑一次：

```
ASSERTION FAILED at time 385 the top 5 bits of 37
TestBlinky: 1 failure(s)
```

模擬器告訴你**哪一個斷言**在**哪個時間**失敗。寫測試時先確認它「會失敗」，才知道它真的有在檢查東西。改回來再繼續。

---

## 4. 看波形

斷言只告訴你對或錯；想知道**為什麼**，要看波形：每個訊號隨時間的變化。

**路線 A**：跑完測試後，下方面板切到「波形」。左邊勾選要看的訊號，滾輪縮放、拖曳平移、雙擊看全部。

**路線 B**：

```sh
$SIM --vcd build/blinky.vcd src/blinky.veryl
gtkwave build/blinky.vcd
```

在 GTKWave 左邊展開 `top` → 把 `clk`、`rst`、`dut.cnt`、`led`、`ledr`、`ledg` 拖到右邊。

**看什麼**：
- `rst` 放開之後，`dut.cnt` 每個時脈正緣加 1。
- `led` 是 `cnt` 去掉最低位元：`cnt` 每 2 個時脈，`led` 才變一次。
- `cnt` 從 31 變 32（`011111` → `100000`）的那一刻，`ledr` 和 `ledg` 同時翻轉。

> **練習**：從波形找出 `cnt` = 37 是第幾奈秒（時脈週期 10 ns），和斷言失敗訊息的時間對照。

---

## 5. 合成：從 RTL 到 LUT

模擬過了，接下來把 Veryl 變成 FPGA 裡真正的元件。這叫**合成（synthesis）**，分好幾個階段。

**路線 A**：標題列有兩個選單：後端 **FPGA** / ASIC，和**階段**。選一個階段，就會開一個「合成流程」分頁顯示它：

```
① RTL→Logic → ② Logic Netlist → ③ Tech-indep Syn → ④ LUT4 Techmap → ⑤ Placement → ⑥ Routing → ⑦ Timing
```

每個階段都有可縮放的圖（點方塊看細節）和右邊的細節；分頁右上的 **ⓘ** 是這個階段的說明和數字，
主要的數字（閘數、LUT、DFF、Fmax）也顯示在最下面的狀態列。

| 階段 | 做什麼 | Blinky 的結果 |
|---|---|---|
| ① RTL→Logic | 解析 Veryl、展開參數、攤平階層 | 1 個模組、5 個埠 |
| ② Logic Netlist | 每行程式變成 2 輸入的 AND / XOR / NOT 與正反器（DFF） | 24 個 DFF + 一串 AND/XOR（加 1 電路） |
| ③ Tech-indep Syn | 與技術無關的最佳化：常數傳播、去掉重複與沒用到的邏輯 | 71 個元件 |
| ④ LUT4 Techmap | 對應到 iCE40 的元件：4 輸入查表（LUT4）與正反器 | 33 個 SB_LUT4 + 24 個 SB_DFFR |

**路線 B**：

```sh
$EDA src/blinky.veryl            # ①–③：通用閘
$EDA --ice40 src/blinky.veryl    # ④：iCE40 元件
```

```
=== Blinky ===
  cells: 57
    SB_DFFR        24
    SB_LUT4        33
```

- **SB_DFFR**：有非同步重設的 D 型正反器，24 個 = 計數器的 24 個位元。
- **SB_LUT4**：4 輸入查表。任何 4 個輸入的布林函數都可以用一個 LUT 做出來（16 個位元的真值表）。
  在 IDE 的 ④ 點一個 LUT，可以看到它的真值表。

> **想一想**：加 1 電路每個位元需要「自己 XOR 進位」和「進位 AND 自己」，為什麼 24 位元只需要 33 個 LUT？
> （提示：一個 LUT4 可以同時吃進 4 個訊號。）

---

## 6. 閘級模擬：合成前後一樣嗎

合成工具也是程式，也可能有 bug。最直接的檢查：**用同一個 testbench，去跑合成後的網表**。

**路線 A**：標題列 **✔ 全面驗證**。它會把每個 testbench 跑四次：RTL、通用閘、iCE40 元件、ASIC 標準元件，
結果必須完全一樣：

```
✓ 全面驗證通過：1 個 testbench × 4 種實作結果一致
```

**路線 B**：

```sh
$EDA --top Blinky --gatesim ice40 src/blinky.veryl
```

```
TestBlinky: PASS
gate-level simulation: Blinky #(WIDTH=6) as 15 cells (ice40)
```

注意它合成的是 `WIDTH=6` 的版本：testbench 用什麼參數，就合成什麼參數。

---

## 7. 佈局、繞線與時序

LUT 和正反器要放到晶片上**實際的位置**（佈局，placement），再用晶片裡的導線把它們接起來（繞線，routing）。

### 腳位指定（.pcf）

設計的埠要接到晶片的哪一支腳，寫在 [`icebreaker.pcf`](icebreaker.pcf)：

```
set_io -nowarn i_clk    35  # 12 MHz 振盪器
set_io -nowarn i_rst    10  # BTN_N，板上按鈕（按下 = 0）
set_io -nowarn o_ledr   11  # LEDR_N，板上紅燈（0 = 亮）
set_io -nowarn o_ledg   37  # LEDG_N，板上綠燈（0 = 亮）
set_io -nowarn o_led[0] 26  # LED1（擴充板，1 = 亮）
...
set_io -nowarn i_btn    20  # BTN1（擴充板，按下 = 1）
```

腳位編號來自 iCEBreaker 的電路圖。`-nowarn` 表示「設計裡沒有這個埠也沒關係」，所以兩課可以共用同一個檔案。

### 看佈局與繞線

**路線 A**：在階段選單選 **⑤ Placement**（第一次會載入 4 MB 的晶片資料庫並佈局繞線，幾秒鐘）。
- ⑤：晶片的 26×32 個 tile；彩色的格子是用到的邏輯單元（LC = LUT + 正反器）。按「▶ 退火動畫」看
  模擬退火演算法怎麼把元件慢慢聚在一起，讓連線變短。
- ⑥：實際走的線。點右邊的 net 可以單獨看一條。
- ⑦：時序分析。紅線是**關鍵路徑**（最慢的一條），右邊列出它經過的每一段延遲。

**路線 B**：

```sh
$EDA --ice40 --pnr veryl --pcf icebreaker.pcf --asc build/blinky.asc --bin build/blinky.bin src/blinky.veryl
```

```
  timing: critical path 29.68 ns, Fmax 33.70 MHz
wrote build/blinky.bin
```

### Fmax 要多少才夠

關鍵路徑 29.7 ns，表示時脈週期不能短於 29.7 ns，也就是最高 33.7 MHz。
板子的時脈是 12 MHz（週期 83 ns），**綽綽有餘**。如果 Fmax 低於 12 MHz，電路在板子上就會出錯。

> **想一想**：關鍵路徑經過了什麼？（路線 A 在 ⑦ 的右邊看；提示：加 1 電路的進位要從最低位元一路傳到最高位元。）

`--pnr veryl` 用的是本專案自己寫的佈局繞線器。裝了 OSS CAD Suite 的話，拿掉 `--pnr veryl` 就改用業界常用的
開源工具 nextpnr，可以比較兩者的 Fmax。

---

## 8. 產生位元流並燒錄

**位元流（bitstream）** 是 FPGA 的設定檔：每個 LUT 的真值表、每個繞線開關的開或關，總共約 100 KB。

**路線 A**：階段選單選 **⑥** 或 **⑦** → 分頁右上的 **⬇** → **.bin**，下載 `Blinky.bin`。

**路線 B**：上一節的指令已經產生 `build/blinky.bin`。

### 燒錄

用 USB 線接上 iCEBreaker，然後：

```sh
iceprog Blinky.bin        # 路線 A 下載的檔案
iceprog build/blinky.bin  # 路線 B
```

`iceprog` 會把位元流寫進板子上的 SPI flash，FPGA 隨即重新載入。你應該看到：

- 板上的紅燈和綠燈輪流閃，一輪大約 1.4 秒；
- 擴充板的 5 顆 LED 以二進位往上數（LED1 閃最快）；
- 按住板上的按鈕（BTN_N）：計數器停在 0，擴充板 LED 全暗、板上綠燈亮紅燈暗；放開後從 0 重新開始。

**沒有板子？用虛擬板**：IDE 標題列的 **⚡ 虛擬板** 會把設計燒錄到一塊畫出來的 iCEBreaker 上：
LED 會亮（亮度依工作週期）、按鈕可以按住，腳位和真實板一樣。它是 iCE40 網表的逐週期模擬，
小設計大約是真實速度的 0.4 倍（畫面上會顯示虛擬時間與速度），所以 LED 閃得比實體板慢一些。

**燒不進去？**

| 症狀 | 原因與處理 |
|---|---|
| `Can't find iCE FTDI USB device` | Linux：需要 udev 規則或用 `sudo`；Windows：用 Zadig 把板子的 Interface 0 驅動換成 libusbK |
| 燒完沒反應 | 確認是 `.bin` 不是 `.asc`；確認腳位檔是 `icebreaker.pcf` |
| LED 亮的方式和預期相反 | 檢查高 / 低電位點亮：板上紅綠燈是低電位亮，擴充板 LED 是高電位亮 |

---

## 9. 第 2 課：跑馬燈

[`src/knight.veryl`](src/knight.veryl)：一顆亮點在 LED1 到 LED5 之間來回跑，按住 BTN1 會停住。

### 新觀念 1：除頻產生 tick

12 MHz 太快，要讓亮點每秒走 8 步，就每 1,500,000 個時脈產生一拍 `tick`：

```veryl
always_ff {
    if_reset {
        div  = 0;
        tick = 0;
    } else if div == TICK - 1 {
        div  = 0;
        tick = 1;          // 這一拍是 1
    } else {
        div  = div + 1;
        tick = 0;
    }
}
```

其他邏輯只在 `tick` 為 1 的那一拍動作。這比「用除出來的慢時脈去驅動正反器」安全得多：
**整個設計只用一個時脈**，這是 FPGA 設計的基本原則。

### 新觀念 2：按鈕同步器

按鈕是人按的，和時脈沒有任何關係。如果按鈕剛好在時脈正緣附近變化，正反器可能進入**亞穩態**（輸出暫時不是 0 也不是 1）。
標準做法是讓外部訊號先經過兩個正反器：

```veryl
always_ff {
    if_reset {
        btn_s = 0;
    } else {
        btn_s = {btn_s[0], i_btn};   // 每拍往左移一格
    }
}
// 之後只使用 btn_s[1]
```

### 新觀念 3：狀態與來回

`pos` 是 5 位元的 one-hot（只有一個位元是 1），`left` 記錄方向；到了兩端就回頭：

```veryl
} else if tick && !btn_s[1] {
    if left {
        if pos == 5'b10000 {
            left = 0;
            pos  = 5'b01000;
        } else {
            pos = pos << 1;
        }
    } else {
        ...
    }
}
```

### 測試的時序：一個真實的小故事

寫這個 testbench 的時候，第一版是這樣：

```veryl
btn = 1;                     // 按下按鈕
clk.next(2 * 5);
$assert(led == 5'b00100, "paused while the button is held");
```

結果**失敗**了。看波形才發現：按鈕要經過同步器的兩個正反器才會被看到，
這 2 個時脈裡亮點**又多走了一步**。電路沒錯，是測試對時序的假設錯了。改成：

```veryl
btn = 1;
clk.next(3);                 // 同步器要 2 拍才看得到按鈕，這期間可能還會走一步
held = led;                  // 記下停住的位置
clk.next(2 * 5);
$assert(led == held, "paused while the button is held");
```

放開按鈕後也一樣要小心：等太久的話，亮點可能剛好跑到端點又折回，回到同一個位置，
「有沒有動」就測不出來。所以只等「同步器 + 一步」的時間。
**寫 testbench 要想清楚每一個訊號在第幾個時脈才生效。**

### 跑一遍完整流程

```sh
$SIM src/knight.veryl
$EDA --top KnightRider --gatesim ice40 src/knight.veryl
$EDA --top KnightRider --ice40 --pnr veryl --pcf icebreaker.pcf --bin build/knight.bin src/knight.veryl
iceprog build/knight.bin
```

路線 A：範例庫 → 教學 → 「第 2 課 跑馬燈」，依序 ▶ 測試、✔ 全面驗證、階段選單選 ⑥、⬇ → .bin。

---

## 10. 第 3 課：UART

[`src/uart.veryl`](src/uart.veryl)：iCEBreaker 的 USB 晶片同時是一個**序列埠**（FPGA 的 TX = 腳 9、RX = 腳 6）。
這一課的電路開機（或按 BTN1）時送出 `Hi!`，之後收到一個字元就把它的**大小寫互換**送回去。

### UART 的一個字元（8N1）

線路平常是 1。送一個位元組：**起始位元 0**、8 個資料位元（**低位在前**）、**停止位元 1**，每個位元持續相同的時間。
115200 鮑的意思是每秒 115200 個位元，在 12 MHz 下每個位元 = 12,000,000 / 115,200 ≈ **104 個時脈**（參數 `CLKS_PER_BIT`）。

```
  ‾‾‾‾\___/‾‾‾\___/‾‾‾‾‾‾‾\___…___/‾‾‾‾‾‾
       起始 d0  d1  d2 …          d7  停止
```

### 接收：在每個位元的「中間」取樣

1. 平常等線路從 1 變 0（起始位元的開始）；
2. 等半個位元時間，到起始位元的中間；
3. 之後每隔一個位元時間取樣一次：8 個資料位元依序移進移位暫存器 `rx_sh`；
4. 停止位元的中間：必須是 1，這個字元才算數（`rx_done` 亮一拍）。

在中間取樣，雙方的時脈稍有誤差也不會出錯。外部訊號一樣要先經過兩級同步器（第 2 課學過）。

### 傳送：一個 10 位元的移位暫存器

要送的字元裝成 `{1'b1, 資料, 1'b0}`（停止、資料、起始），每個位元時間往右移一格，`o_tx` 永遠送出最低位。
送問候語時，`msg_i` 記錄送到第幾個字，`case` 查出那個字的 ASCII 碼。

### testbench 扮演「電腦」

```veryl
// 等 o_tx 的起始位元，再每 8 拍在中間取一個位元
for _k in 0..200 {
    if tx == 1 {
        clk.next();
    }
}
clk.next(4 + 8);
for _i in 0..8 {
    got = {tx, got[7:1]};
    clk.next(8);
}
$assert(got == 8'h48, "first character H");
```

測試時用 `CLKS_PER_BIT: 8`，一個字元只要 80 拍。

> **一個值得記住的錯誤**：第一版的電路在收到第 8 個資料位元時就回應，但 testbench 那時還在送停止位元，
> 結果開始等回應時，回應已經開始送了，取樣全部錯開。改成「停止位元的中間確認是 1 才算收到」，
> 這也是 UART 本來就該做的檢查（停止位元不是 1 = 格式錯誤）。

### 在虛擬板上和它聊天

IDE：範例庫 → 教學 → 「第 3 課 UART 回聲」→ **⚡ 虛擬板**。這個範例會自動接上 **🖥 USB 終端機**（115200 鮑）：
畫面先出現 `Hi!`；在終端機下方輸入 `hello, World` 按 Enter，會收到 `HELLO, wORLD`；按 BTN1 再打一次招呼。
鮑率選錯的話，終端機會顯示「格式錯誤」。

在實體板上：燒錄後用 `screen /dev/ttyUSB1 115200`（macOS：`/dev/cu.usbserial-*` 的第二個）就能做一樣的事。

---

## 11. 練習題

由易到難。每一題都要：**先寫 testbench、模擬通過、全面驗證通過，再燒進板子。**

1. **調速度**：讓 Blinky 一輪約 0.35 秒。`WIDTH` 要改成多少？（2 的幾次方 / 12 MHz）
2. **倒數**：讓擴充板的 5 顆 LED 由 31 往下數到 0。testbench 的期望值也要跟著改。
3. **兩個按鈕調速**：跑馬燈加上 BTN2（腳 19）加速、BTN3（腳 18）減速。
   提示：`TICK` 改成一個暫存器；按鈕要「按一下算一次」，需要偵測**上升緣**（這一拍是 1、上一拍是 0）。
4. **呼吸燈（PWM）**：一個 8 位元計數器 `pwm` 一直轉，`o_led[0] = pwm < duty`；讓 `duty` 慢慢變大再變小。
   人眼看到的是亮度漸變。（Veryl 在 `function` 裡寫比較要用 `<:`，見附錄。）
5. **UART 計數器**：改第 3 課，每秒送出一行目前的秒數（`0`、`1`、…、`9` 再回到 `0`），並把收到的字元數顯示在擴充板的 5 顆 LED 上。
   提示：數字 n 的 ASCII 碼是 `8'h30 + n`。在虛擬板的終端機上驗證，再燒進實體板用 `screen` 看。
6. **晶片要多大？**：在 IDE 標題列把後端從 FPGA 切到 **ASIC**，看同一個設計變成標準元件後的面積和 Fmax，
   再點「⇄ FPGA vs ASIC」比較。為什麼 ASIC 快那麼多？

---

## 12. 附錄：常見錯誤與指令速查

### Veryl 常見錯誤

| 訊息或症狀 | 原因 |
|---|---|
| `function` 裡 `a < b` 解析錯誤 | Veryl 0.22 在 function 內的 `<` `>` 會被當成泛型；改用 `<:`、`>:` |
| `bit` 不能當名稱 | `bit` 是保留字 |
| enum 成員找不到 | 要寫 `Pkg::EnumName::Member` |
| `veryl check` 警告 `missing_reset_statement` | 記憶體陣列沒重設；在那個 `always_ff` 前加 `#[allow(missing_reset_statement)]` |
| 自己寫 `var clk: clock` 再翻轉 | 不要這樣做；用 `inst clk: $tb::clock_gen;` |
| `for i: u32 in ...` | `for` 的迴圈變數不寫型別：`for i in 0..8` |

### 指令速查

| 要做什麼 | 命令列 | IDE |
|---|---|---|
| 語法 / 語意檢查 | `veryl check` | 打字時自動檢查 |
| 模擬 | `$SIM a.veryl` | ▶ 測試（Ctrl/⌘+Enter） |
| 波形 | `$SIM --vcd out.vcd a.veryl`，`gtkwave out.vcd` | 下方面板「波形」 |
| 合成統計 | `$EDA --ice40 a.veryl` | 階段選單 ④ |
| 閘級模擬 | `$EDA --top M --gatesim ice40 a.veryl` | ✔ 全面驗證 |
| 佈局繞線 + 位元流 | `$EDA --ice40 --pnr veryl --pcf icebreaker.pcf --bin out.bin a.veryl` | 階段選單 ⑥ → ⬇ → .bin |
| 燒錄 | `iceprog out.bin` | （下載後在命令列執行） |
| ASIC 流程 | `$EDA --asic a.veryl` | 後端選單選 ASIC |

### 本教學驗證過的事

本目錄的三個設計都經過：官方 `veryl check` / `veryl test`、veryl-sim 模擬、三種網表的閘級模擬；
自製佈局繞線與 nextpnr 都產生了位元流（Fmax 都高於 12 MHz），`.bin` 與 icepack 的輸出逐位元組相同，
並用 icebox_vlog 把位元流轉回電路，和網表做 1000 個時脈的隨機輸入比對，結果一致。
（燒進實體板子的結果請以你手上的 iCEBreaker 為準；腳位依 iCEBreaker 官方腳位表。）
