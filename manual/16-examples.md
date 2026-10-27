# 16. 範例總表

這一章列出所有範例：做什麼、用到哪些檔案、命令列怎麼跑、網頁 IDE 怎麼開。

- **IDE**：表格裡的範例 ID 都是連結，點了就在線上 IDE 開成一個新專案
  （`https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=ID`；本機用 `web/dist/index.html#ex=ID`）。
  網址後面加 `&board=1` 直接燒進虛擬板，`&run=1` 跑測試，其他參數見第 11 章〈網址參數〉。
  側欄範例旁的 🧪 ⚡ 🖥 是它能做的事，框起來的是建議的第一步；開啟後標題列的主按鈕（藍色）與編輯器上方的「建議步驟」也是，主按鈕旁的 ▾ 列出其他做法。
- **命令列**：在專案根目錄下打，`v2c` 的安裝見第 2 章。一個範例要好幾個檔案時，要全部列出來。

## 共通的跑法

每個 Veryl 範例都有 `#[test]` 測試模組（`Test…`、`tb_…`），所以同一組指令可以用在任何範例上：

| 想做的事 | 指令 | 章 |
|---|---|---|
| 看有哪些模組 | `v2c list FILE.veryl` | 5 |
| 跑測試（RTL 模擬） | `v2c sim FILE.veryl`（全部的 `#[test]`；`--top TestX` 只跑一個；`--vcd w.vcd` 寫波形） | 5 |
| 合成看統計 | `v2c synth --top MODULE FILE.veryl` | 6 |
| 合成後再跑一次測試 | `v2c gatesim ice40 FILE.veryl`（或 `opt`、`ecp5`、`asic`、`sky130`） | 8 |
| FPGA 位元流 | `v2c fpga --pnr veryl --pcf PINS.pcf --bin out.bin FILE.veryl`，再 `iceprog out.bin` 燒進 iCEBreaker | 7 |
| ASIC 版圖 | `v2c asic --pdk sky130 --gds out.gds FILE.veryl` | 9 |

`v2c synth` / `fpga` / `asic` 不指定 `--top` 時用最後一個不是測試的模組，下面表格的「頂層」欄就是 IDE 預設合成的那一個。
表格裡有 `.pcf` 的範例才有腳位，可以做成 FPGA 位元流、放上虛擬板。

## 教學與實驗課

給第一次寫硬體的人，講義是 [`tutorial/README.tw.md`](../tutorial/README.tw.md)（教學）與
[`tutorial/labs.tw.md`](../tutorial/labs.tw.md)（虛擬實驗課）。腳位都是 iCEBreaker 板上的 LED / 按鈕或 PMOD 模組。

| ID | 做什麼 | 檔案（頂層） | 命令列 |
|---|---|---|---|
| [tut_blinky](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=tut_blinky&board=1) | 第 1 課：計數器讓 LED 閃爍 | `tutorial/src/blinky.veryl`（`Blinky`）、`tutorial/icebreaker.pcf` | `v2c sim tutorial/src/blinky.veryl`<br>`v2c fpga --pnr veryl --pcf tutorial/icebreaker.pcf --bin blinky.bin tutorial/src/blinky.veryl` |
| [tut_knight](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=tut_knight&board=1) | 第 2 課：跑馬燈；除頻 tick、按鈕同步器，按住 BTN1 暫停 | `tutorial/src/knight.veryl`（`KnightRider`）、`tutorial/icebreaker.pcf` | 同上，換檔名 |
| [tut_uart](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=tut_uart&board=1) | 第 3 課：USB 序列埠（115200 鮑）先說 Hi!，收到的字大小寫互換送回 | `tutorial/src/uart.veryl`（`UartEcho`）、`tutorial/icebreaker.pcf` | 同上，換檔名 |
| [lab_gates](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=lab_gates&board=1) | 麵包板：兩個開關 → AND、OR、XOR、NOT 四顆 LED（電阻、接線都畫好了） | `examples/src/gates.veryl`（`Gates`）、`examples/gates.pcf` | `v2c sim examples/src/gates.veryl`<br>`v2c fpga --pnr veryl --pcf examples/gates.pcf --bin gates.bin examples/src/gates.veryl` |
| [lab_counter](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=lab_counter&board=1) | BTN1 每按一下加一（同步器 + 上升緣），8 位元顯示在 PMOD1A 的 LED；BTN2 歸零 | `examples/src/button_counter.veryl`（`ButtonCounter`）、`examples/button_counter.pcf` | 同上，換檔名 |
| [lab_traffic](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=lab_traffic&board=1) | 紅綠燈狀態機：綠 5 秒 → 黃 1 秒 → 紅 4 秒，綠燈時按 BTN1 提早結束；LED 在麵包板上 | `examples/src/traffic.veryl`（`TrafficLight`）、`examples/traffic.pcf` | 同上，換檔名 |

`tutorial/check.sh` 一次跑完教學的整條流程（模擬、合成、FPGA）。

## 基礎（組合邏輯與語法）

| ID | 做什麼 | 檔案（頂層） | 命令列 |
|---|---|---|---|
| [adder](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=adder) | 加法器（最小的例子） | `examples/src/adder.veryl`（`Adder`） | `v2c sim examples/src/adder.veryl` |
| [max3](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=max3) | 三個數取最大，示範 `function` | `examples/src/max3.veryl`（`Max3`） | `v2c sim examples/src/max3.veryl` |
| [alu_pkg](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=alu_pkg) | ALU，運算碼放在 `package` 的 `enum` | `examples/src/alu_pkg.veryl`（`AluUnit`） | `v2c sim examples/src/alu_pkg.veryl` |
| [gen_rev](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=gen_rev) | 位元反轉與格雷碼，示範 generate `for` | `examples/src/gen_rev.veryl`（`GrayConv`；另有 `BitRev`） | `v2c sim examples/src/gen_rev.veryl` |
| [alu_fail](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=alu_fail&run=1) | 一個故意失敗的斷言：看測試失敗長什麼樣子（結束碼 1） | `veryl-sim/examples/alu.veryl`（`Alu`） | `v2c sim veryl-sim/examples/alu.veryl` |

## 時序電路與記憶體

| ID | 做什麼 | 檔案（頂層） | 命令列 |
|---|---|---|---|
| [counter](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=counter) | 計數器，veryl-sim 自己的測試範例 | `veryl-sim/examples/counter.veryl`（`Counter`） | `v2c sim veryl-sim/examples/counter.veryl` |
| [seq101](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=seq101) | 偵測輸入序列 101 的狀態機 | `examples/src/seq101.veryl`（`Seq101`） | `v2c sim examples/src/seq101.veryl` |
| [pkt_reg](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=pkt_reg) | 以 `struct` 為單位的暫存器（第一個欄位在最高位元） | `examples/src/pkt_reg.veryl`（`PktReg`） | `v2c sim examples/src/pkt_reg.veryl` |
| [ram](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=ram) | 16 × 8 的 RAM，非同步讀取（留在邏輯裡） | `examples/src/ram.veryl`（`Ram`） | `v2c sim examples/src/ram.veryl` |
| [sync_ram](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=sync_ram) | 同步讀取的 RAM：合成成 block RAM（iCE40 `SB_RAM40_4K`） | `examples/src/sync_ram.veryl`（`SyncRam`） | `v2c sim examples/src/sync_ram.veryl` |
| [fifo](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=fifo) | 256 × 8 FIFO，記憶體是一塊 block RAM / ASIC 的一個 SRAM 巨集 | `examples/src/fifo.veryl`（`Fifo`） | `v2c sim examples/src/fifo.veryl`<br>`v2c asic --pdk sky130 examples/src/fifo.veryl` |
| [sevenseg](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=sevenseg&board=1) | 七段顯示器 00–99 計數，兩位數多工掃描；BTN1 歸零 | `examples/src/sevenseg.veryl`（`SevenSeg`）、`examples/sevenseg.pcf` | `v2c sim examples/src/sevenseg.veryl`<br>`v2c fpga --pnr veryl --pcf examples/sevenseg.pcf --bin seg.bin examples/src/sevenseg.veryl` |

## 周邊

| ID | 做什麼 | 檔案（頂層） | 命令列 |
|---|---|---|---|
| [uart](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=uart) | UART 發送器 → 接收器迴路（8N1，每位元 8 個時脈） | `examples/src/uart.veryl`（`UartLoop`；另有 `UartTx`、`UartRx`） | `v2c sim examples/src/uart.veryl` |
| [vga](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=vga&board=1) | VGA 640 × 480 時序與色條；測試用縮小的畫面，虛擬板接 PMOD 的 VGA 螢幕 | `examples/src/vga.veryl`（`VgaDemo`）、`examples/vga.pcf` | `v2c sim examples/src/vga.veryl`<br>`v2c fpga --pnr veryl --pcf examples/vga.pcf --bin vga.bin examples/src/vga.veryl` |

## 綜合測試設計

veryl-eda 自己的合成測試用的設計，也是看合成結果的好例子。

| ID | 做什麼 | 檔案（頂層） | 命令列 |
|---|---|---|---|
| [features](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=features) | 移位器、函式、位元範圍、計數器 | `veryl-eda/examples/features.veryl`（`Top`） | `v2c sim veryl-eda/examples/features.veryl` |
| [bram](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=bram) | 四種形狀的 block RAM 加上邏輯 | `examples/src/sync_ram.veryl` + `veryl-eda/examples/bram_tests.veryl`（`BramMix`） | `v2c sim --top TestBramMix examples/src/sync_ram.veryl veryl-eda/examples/bram_tests.veryl` |
| [lang](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=lang) | 除法、`interface` 握手、200 位元的值、兩個時脈 | `veryl-eda/examples/lang.veryl`（`HsTop`） | `v2c sim veryl-eda/examples/lang.veryl` |
| [acc](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=acc) | 32 位元累加器：看 FPGA 的進位鏈（`SB_CARRY`） | `veryl-eda/examples/pnr_tests.veryl`（`AccTest`） | `v2c sim veryl-eda/examples/pnr_tests.veryl` |

## RISC-V 處理器（Veryl）

| ID | 做什麼 | 檔案（頂層） | 命令列 |
|---|---|---|---|
| [rv32i](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=rv32i) | 單週期 RV32I CPU；測試跑 `examples/sw/rv32i_test.S`，41 個結果和 spike 交叉比對過 | `examples/src/rv32i.veryl` + `rv32i_rom.veryl`（`RiscvCore`） | `v2c sim examples/src/rv32i.veryl examples/src/rv32i_rom.veryl` |
| [soc](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=soc&board=1) | 上面的 CPU 加 ROM / RAM 做成 SoC：算 Fibonacci(10) = 55 顯示在 LED | `examples/src/rv32i.veryl` + `rv32i_rom.veryl` + `veryl-eda/examples/soc.veryl`（`RiscvSoc`）、`veryl-eda/examples/icebreaker.pcf` | `v2c sim --top TestRiscvSoc examples/src/rv32i.veryl examples/src/rv32i_rom.veryl veryl-eda/examples/soc.veryl`<br>`veryl-eda/fpga/flow.sh`（位元流 + 繞線後模擬） |
| [rv64_linux](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=rv64_linux) | RV64 開發板（像樹莓派）：Linux、MicroPython、C、GPIO、螢幕。見下面〈RV64 開發板〉 | `examples/rv64/src/`（`Rv64Soc`）、`examples/rv64/board/` | 見下面 |

多週期 RV32IMA 的 SoC（`examples/src/rvsoc.veryl`，`RvBoard`）在下一節和 C 程式一起用。改了 `examples/sw/*.S` 之後要跑
`examples/sw/build.sh`（需要 riscv64-unknown-elf 工具鏈與 spike）重新產生 ROM。

## C 程式在自己做的 RISC-V SoC 上（`examples/c/`）

硬體都是 `examples/src/rvsoc.veryl` 的 `RvBoard`（RV32IMA + Zicsr，12 MHz，UART、LED、按鈕、PMOD），C 程式用 veryl-eda 的
C 編譯器編譯（第 10 章）。IDE 裡 ⚡ 虛擬板預設用 **CPU 模式**（指令集模擬器即時執行），也可以切到「位元流」模式跑真正合成出來的電路。

| ID | 做什麼 | 檔案 |
|---|---|---|
| [c_hello](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=c_hello&board=1) | 在 USB 終端機打招呼、LED 計數、把收到的字轉成大寫送回 | `examples/c/hello.c` |
| [c_knight](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=c_knight&board=1) | 軟體跑馬燈，BTN1 加快、BTN2 變慢（在 C 裡偵測上升緣） | `examples/c/knight.c` |
| [c_guess](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=c_guess&board=1) | 終端機猜數字遊戲（`read_line`、`atoi`） | `examples/c/guess.c` |
| [c_sevenseg](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=c_sevenseg&board=1) | 七段顯示器 00–99，軟體多工掃描；BTN1 歸零 | `examples/c/sevenseg.c` |
| [c_music](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=c_music&board=1) | 蜂鳴器播放〈小星星〉 | `examples/c/music.c` |
| [c_switches](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=c_switches&board=1) | PMOD1B 的 8 個開關顯示在 PMOD1A 的 LED，終端機印出二進位 / 十六進位 | `examples/c/switches.c` |
| [c_threads](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=c_threads&board=1) | 搶佔式多執行緒小核心：計時器中斷每 10 ms 切換、`ecall` 做 yield / sleep、`amoswap` 互斥鎖 | `examples/c/threads.c` |
| [c_vga](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=c_vga&board=1) | VGA 文字模式（40 × 30 字元）：開機時間、按鈕、終端機打的字。硬體是 `RvVgaBoard`（`examples/src/rvvga.veryl`、`examples/rvvga.pcf`） | `examples/c/vga.c` |

命令列：

```sh
v2c cc --run examples/c/hello.c                  # 在指令集模擬器上跑，UART 輸出印在終端機
v2c cc -o hello.bin examples/c/hello.c           # 編成映像檔
v2c fpga --top RvBoard --pnr veryl --pcf examples/rvsoc.pcf --program hello.bin --bin soc.bin \
  examples/src/rvsoc.veryl examples/src/rv32i.veryl examples/src/sync_ram.veryl examples/src/uart.veryl
iceprog soc.bin                                  # 燒進 iCEBreaker
```

`c_vga` 的位元流用 `--top RvVgaBoard --pcf examples/rvvga.pcf`，檔案再加上 `examples/src/rvvga.veryl examples/src/vga.veryl`。
SoC 本身的 RTL 測試：

```sh
cd examples/src
v2c sim --top TestRvSoc rvsoc.veryl rv32i.veryl sync_ram.veryl uart.veryl rvsoc_rom.veryl rv32i_rom.veryl
v2c sim --top TestVgaText rvsoc.veryl rv32i.veryl sync_ram.veryl uart.veryl rvsoc_rom.veryl rv32i_rom.veryl rvvga.veryl vga.veryl
```

## RV64 開發板（`examples/rv64/`）

`Rv64Soc`：RV64IMAC 的 `Rv64Core`、256 MB RAM、UART、16 支 GPIO（ACT / USER LED 是 GPIO 0、1，按鈕是 GPIO 2，排針與麵包板上是
GPIO 3–15，和樹莓派一樣的 BCM 編號）、320 × 240 螢幕。開的是 OpenSBI + Linux 6.12 + busybox，裡面有 MicroPython。

**IDE**：開 [rv64_linux](https://ccc-eda.github.io/veryl2chip/web/dist/index.html#ex=rv64_linux)，按 🖥 模擬機開機（或從標題列的目標選單選
riscv-emu / veryl-emu，第 15 章）。打開下面任何一個檔案按「▶ 執行」（Ctrl+Enter）：專案的檔案送進板子的 `/root` 再執行它；
`.c` 會先在瀏覽器裡編譯。在板子的 shell 打 `savefiles` 把 `/root` 送回專案。

| 檔案 | 做什麼 | 在板子上的指令 |
|---|---|---|
| `main.py` | 麵包板 GPIO 5 的紅燈與 USER 燈輪流亮 | `micropython main.py` |
| `button.py` | 數按鈕（GPIO 2）按了幾次，GPIO 5 的 LED 顯示最低位元 | `micropython button.py` |
| `traffic.py` | 麵包板上的紅綠燈（GPIO 5 / 12 / 13）；GPIO 6 的按鈕讓綠燈提早結束 | `micropython traffic.py` |
| `clock.py` | 螢幕上的指針時鐘（開機後的時間） | `micropython clock.py` |
| `blink.c` | 同 `main.py`，用 C | `./blink` |
| `count.c` | 同 `button.py`，用 C | `./count` |
| `lights.c` | 同 `traffic.py`，用 C | `./lights` |
| `shapes.c` | 螢幕上畫色條、圖形、文字、一顆彈跳的球 | `./shapes` |
| `blink.sh` | 用 `/sys/class/gpio` 閃 GPIO 5 的 LED 五次 | `sh blink.sh` |
| `button.sh` | 數按鈕次數，USER 燈顯示最低位元 | `sh button.sh` |

Ctrl-C 停止程式；打 `micropython` 進 REPL。MicroPython 的 `pi` 模組有 `LED`、`Button`、`Pin`、`Screen`，
C 的函式庫有 `gpio_write`、`gpio_read`、`delay_ms`、`fb_*`（第 10、11 章）。

**命令列**（在 `examples/rv64` 下；映像檔由 `linux/build.sh` 產生，模擬器 `rvemu` 由 `riscv-emu` 的 `cargo build --release` 產生）。
`linux/mkarea.py` 把檔案打包成交換區，開機時 `/init` 會把它們放進 `/root`：

```sh
v2c cc --linux -o blink board/blink.c
python3 linux/mkarea.py -o area.img board/*.py board/*.sh blink
../../riscv-emu/target/release/rvemu -l 0x8F000000:area.img linux/build/opensbi/platform/generic/firmware/fw_payload.bin
```

開到 `rv64:~$` 約 1.5 秒，然後就像上面的表格直接打指令（GPIO 的變化印成 `[gpio] out=…`）。
把 `rvemu` 換成 `emu/rv64emu`（veryl-emu）或 `sim/obj/rv64sim`（Verilator）就是在 Veryl 寫的硬體上跑同樣的東西，慢幾十倍。

`examples/rv64` 還有不在 IDE 裡的測試與大程式，說明在 [`examples/rv64/README.md`](../examples/rv64/README.md)：

| 指令 | 做什麼 |
|---|---|
| `sim/riscv_tests.sh` | 官方 riscv-tests（196 支） |
| `verify/random.sh 1 30` | 隨機程式，和 spike 逐指令比對 |
| `linux/test.sh` | 開 Linux、打幾個指令（GPIO、檔案、MicroPython、C、螢幕）、關機 |
| `xv6/test.sh` | 開 xv6（MIT 的教學作業系統）；`xv6/test.sh usertests` 跑它全部的測試 |
| `sim/build_fpga.sh`、`fpga/ecp5.sh` | `Rv64Fpga`：放進 ECP5 FPGA（ULX3S）的版本 |

這些指令前面加 `SIM=../../riscv-emu/target/release/rvemu` 或 `SIM=emu/rv64emu` 就換成另一個模擬器。
