# 10. RISC-V 與 C：`v2c cc`

這個專案用 Veryl 寫了一顆 RISC-V CPU，也附了一個能把 C 編成它的機器碼的編譯器。
所以可以「自己設計 CPU，再在上面跑自己寫的 C 程式」——在虛擬開發板上，或燒進真的 iCEBreaker。

## 硬體：`examples/src/rvsoc.veryl`

| 模組 | 內容 |
|---|---|
| `RvCore` | 多週期 **RV32IMA + Zicsr**：一般指令 2 拍、load 3 拍、乘除法 35 拍；machine mode 的中斷與例外（計時器、軟體、外部 = 序列埠收到位元組；ecall、ebreak、非法指令、位址沒對齊）、`mret`、`wfi`；暫存器檔放在 block RAM |
| `RvSoc` | CPU + 8 KB 記憶體（block RAM）+ 記憶體映射的周邊 + 給 testbench 用的載入埠 |
| `RvBoard` | iCEBreaker 的頂層（腳位 `examples/rvsoc.pcf`）：BTN1–3、PMOD1A 的 8 個輸出（LED 模組…）、PMOD1B 的 8 個開關、USB 序列埠 |
| `RvVgaBoard`（`examples/src/rvvga.veryl`） | 再加上 40 × 30 字元的 VGA 文字畫面 |

另外 `examples/src/rv32i.veryl` 是單週期的 RV32I（`RiscvCore`），比較好讀，適合教學。

### 記憶體映射

| 位址 | 名稱（C 裡的巨集） | 說明 |
|---|---|---|
| `0x0000_0000` | — | 8 KB RAM：程式與資料，堆疊從頂端往下長 |
| `0x1000_0000` | `LED` | 8 個輸出（讀寫） |
| `0x1000_0004` | `BUTTONS`、`SWITCHES` | bit 2..0 = BTN3..BTN1（1 = 按下），bit 15..8 = 8 個開關 |
| `0x1000_0008` | `UART_DATA` | 寫：送出一個位元組；讀：收到的位元組 |
| `0x1000_000C` | `UART_STATUS` | bit 0 = 傳送中，bit 1 = 收到一個位元組 |
| `0x1000_0010` | `TIMER`、`MTIME` | 開機後經過的時脈數（12 MHz） |
| `0x1000_0018` | `MTIMECMP` | `MTIME ≥ MTIMECMP` 時計時器中斷 |
| `0x1000_0020` | `MSIP` | 1 = 軟體中斷 |
| `0x1000_2000` 起 | `VGA_TEXT`、`VGA_FONT`、`VGA_COLOR` | VGA 文字模式（只有 `RvVgaBoard`） |

## 編譯與執行

```
v2c cc PROG.c [-o PROG.bin] [-S PROG.s] [-L PROG.lst] [--run [N]] [--mem BYTES]
```

```sh
$ v2c cc --run examples/c/hello.c
hello.c: 2488 bytes of code and data, 2492 with bss (RAM 8192 bytes)
Hello from C on a RISC-V you built in Veryl!
...
```

| 選項 | 內容 |
|---|---|
| `-o PROG.bin` | 從位址 0 開始的二進位映像檔（給 `v2c fpga --program`、虛擬板） |
| `-S PROG.s` | 產生的組合語言：每個敘述前面有一行 C 原始碼當註解 |
| `-L PROG.lst` | 列表：位址、機器碼、組合語言與 C 原始碼對照 |
| `--run [N]` | 在指令集模擬器上執行最多 N 個指令（預設 1000 萬）。序列埠的輸出印到螢幕；結束時印出指令數、時脈數與 LED |
| `--mem BYTES` | RAM 大小（預設 8192，與 RvSoc 相同） |
| `--linux` | 改成給 RV64 開發板的 Linux 的靜態執行檔（見下面的「在開發板的 Linux 上」） |

程式跑到 `main` 結束會停在 `_halt`（顯示 `halted`）；永遠不結束的程式在 N 個指令後停下（顯示 `stopped`）。
`--run` 不會把鍵盤輸入送給程式；要互動（`getchar`、`read_line`）請用虛擬開發板的 USB 終端機。

`.s` / `.S` 檔會直接組譯（支援 RV32IMA、Zicsr、虛擬指令、`%hi` / `%lo`、`.data` / `.rodata` / `.bss`）。

## 支援的 C

- 型別：`char`（無號，和 RISC-V ABI 一樣）、`signed char`、`short`、`int`、`long`（= `int`）與它們的 `unsigned`，`void`，
  指標，任意維的陣列；接受 `const` / `volatile` / `static` / `extern`。
- 敘述：區塊、`if`、`while`、`do`、`for`、`switch`、`break`、`continue`、`return`，宣告可以放在任何地方；所有 C 運算子。
- 函式：最多 8 個參數、`...` 可變參數；函式名稱可以當位址用（例如交給 `set_mtvec`）。
- 前置處理器：`#define`（含參數）、`#undef`、`#ifdef` / `#ifndef`、`#if 常數`、`#else`、`#endif`、`#error`；`#include` 與 `#pragma` 會被忽略（執行期函式庫一律在）。
- `asm("...")`：在函式裡插入組合語言；只有 `asm` 的函式不加進出程式碼（naked）；檔案最外層的 `asm(...)` 可以定義整段組合語言。
- **沒有**：struct、union、enum、typedef、浮點數、函式指標的呼叫。

### 執行期函式庫

| 類別 | 函式 / 巨集 |
|---|---|
| 序列埠 | `putchar`、`getchar`、`kbhit`、`puts`、`printf`（`%d %i %u %x %X %c %s`、寬度、補零）、`sprintf`、`read_line` |
| 時間 | `millis`、`delay_ms`、`delay_us`、`TIMER`、`CLOCK_HZ` |
| 字串與記憶體 | `strlen`、`strcmp`、`strcpy`、`memset`、`memcpy`、`atoi` |
| 其他 | `rand`、`srand`、`abs` |
| 周邊 | `LED`、`BUTTONS`、`SWITCHES`、`UART_DATA`、`UART_STATUS` |
| VGA 文字（`RvVgaBoard`） | `vga_init`（載入字型）、`vga_clear`、`vga_color(fg, bg)`（0xRGB）、`vga_goto(欄, 列)`、`vga_putc`、`vga_puts`、`vga_printf` |
| 中斷與 CSR | `interrupts_on` / `off`、`irq_save` / `irq_restore`、`wfi`、`set_mtvec`、`set_mie`（`MIE_MTIE` 計時器、`MIE_MSIE` 軟體、`MIE_MEIE` 序列埠）、`read_mcause`、`read_mepc` / `write_mepc`、`read_mstatus`、`read_mip`、`read_minstret`、`read_mscratch` / `write_mscratch`、`MTIME`、`MTIMECMP`、`MSIP` |
| 原子操作 | `atomic_swap`、`atomic_add`、`atomic_and`、`atomic_or`、`atomic_xor`、`atomic_cas`、`spin_lock`、`spin_unlock` |

只有程式真正用到的函式會放進映像檔。

## 範例（`examples/c/`）

| 檔案 | 示範 |
|---|---|
| `hello.c` | 序列埠問候、LED 計數、把收到的字轉大寫送回 |
| `knight.c` | 跑馬燈，按鈕調速（軟體的上升緣偵測） |
| `guess.c` | 終端機猜數字遊戲 |
| `sevenseg.c` | 七段顯示器的軟體掃描 |
| `music.c` | 蜂鳴器播放旋律 |
| `switches.c` | 開關顯示在 LED，終端機印出二進位 / 十六進位 |
| `vga.c` | VGA 文字模式（`RvVgaBoard`） |
| `threads.c` | 小小的搶佔式多執行緒核心：計時器中斷切換執行緒、`ecall` 做 yield / sleep、`amoswap` 互斥鎖 |

## 在開發板的 Linux 上（v2.20）

`v2c cc PROG.c --linux -o PROG` 把同樣的 C 編成 RV64 開發板（`examples/rv64`，第 11 章的模擬機）上 Linux 的靜態 ELF 執行檔：

- 資料模型不變：`int`、`long`、指標都是 4 個位元組（像 x32）。程式是 RV64 指令，算 32 位元整數用 `addw`、`mulw` 等 *W 指令，
  所以暫存器裡永遠是「32 位元、符號延伸」的值；程式載入在 0x10000，自己的堆疊（256 KB）放在 bss，堆積用 `brk` 往上長，
  程式碰到的位址都在 2 GB 以下，指標存 32 位元就夠。
- 執行期函式庫（`prelude.c` 的 `__linux__` 部分）用系統呼叫：`open` / `read` / `write` / `close` / `lseek` / `unlink`、
  `printf`（標準輸出一行一行緩衝）、`getchar`、`read_line`、`malloc`、`exit`、`sleep` / `usleep` / `delay_ms` / `millis`；
  `write_file`、`read_int`；GPIO：`gpio_write(pin, v)`、`gpio_read(pin)`、`pin_mode(pin, INPUT|OUTPUT)`（0 / 1 是 ACT / USER LED，
  2 是按鈕，其餘經 `/sys/class/gpio`）；螢幕（v2.21，320 × 240 RGB565）：`fb_init`、`fb_clear`、`fb_pixel`、`fb_rect`、`fb_line`、
  `fb_circle`、`fb_text`、`RGB(r, g, b)` 與幾個顏色名（`/dev/fb0` 用 `mmap` 固定映射在 0x40000000，因為指標只有 32 位元）。
  `#include <gpio.h>` 之類的 `#include` 一樣會被忽略（函式庫一直都在）。
- 測試：`cargo test cc_linux` 把 `src/rv/tests/*.c` 與 `tests/linux/*.c` 編成 Linux 執行檔，用 spike + pk（proxy kernel，
  系統呼叫號碼與 Linux 相同）執行，輸出要和主機的編譯結果（`.out`）相同；`linux/test.sh` 在 Verilator / veryl-emu 上的 Linux 跑一個。
- IDE：開發板專案裡打開 `.c` 檔按「▶ 執行」，在瀏覽器裡編譯，執行檔（檔名去掉 `.c`）和專案檔案一起送進 `/root` 執行。

## 放到 FPGA 上

虛擬開發板（最方便）：網頁 IDE 的「C 程式」範例，⚡ 虛擬板預設用 **CPU 模式**——指令集模擬器以即時速度執行，
記憶體映射、周邊與每個指令花的時脈數都和 `RvSoc` 相同（第 12 章）。切到位元流或網表模式，就是真的跑 `rvsoc.veryl` 合成出來的電路（慢很多）。

實體板子：

```sh
v2c cc -o hello.bin examples/c/hello.c
v2c fpga --top RvBoard --pnr veryl --pcf examples/rvsoc.pcf --program hello.bin --bin soc.bin \
    examples/src/rv32i.veryl examples/src/sync_ram.veryl examples/src/uart.veryl examples/src/rvsoc.veryl
iceprog soc.bin
```

整顆 SoC（約 4200 個邏輯單元、20 塊 block RAM）的佈局繞線約需一分鐘，Fmax 約 13–14 MHz。

接上序列埠終端機（115200 baud，例如 `screen /dev/tty.usbserial-xxx 115200`）就能看到輸出。
