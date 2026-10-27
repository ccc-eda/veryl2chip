# 15. 選哪一種：FPGA、ASIC、veryl-emu、riscv-emu

同一個專案可以在四個地方「跑」。標題列的目標選單（v2.25）把它們放在一起：上面兩個是**合成**（看電路變成什麼），
下面兩個是**模擬機**（讓一台機器開機、跑軟體）。

| 目標 | 跑的是什麼 | 看得到什麼 | 速度（瀏覽器） | 什麼時候用 |
|---|---|---|---|---|
| **FPGA**（iCE40） | 你的 Veryl 設計合成、佈局繞線成 iCEBreaker 的位元流 | LUT、進位鏈、block RAM、繞線、時序；⚡ 虛擬板上的 LED、按鈕、七段顯示器、VGA、UART | 虛擬板即時（12 MHz 的設計） | 小到中型的數位電路：計數器、狀態機、UART、自己的 RV32 CPU（像 Arduino） |
| **ASIC**（vlib / SKY130） | 同一個設計對應到標準元件、擺放、繞線、DRC、GDSII | 晶片版圖、面積、時序、功耗 | 合成幾秒到幾分鐘 | 想知道電路做成晶片長什麼樣子 |
| **veryl-emu**（模擬機·硬體） | 你的 Veryl 設計本身編成 WebAssembly，一拍一拍地跑（像 Verilator） | 每一拍、每個訊號都是你寫的電路算出來的；改了 Veryl 就是新的硬體 | 約 370 萬拍 / 秒（RV64 約 120 萬個指令 / 秒）；RV64 開到 shell 從快照約 10 秒 | 放不進 FPGA / ASIC 流程的大設計（256 MB RAM 的 RV64 SoC），要看「硬體本身」對不對 |
| **riscv-emu**（模擬機·指令集） | RV64 開發板的指令集模擬器（像 QEMU），常跑的程式翻成 WebAssembly | 軟體的行為：Linux、MicroPython、C、GPIO、螢幕；不看 Veryl 原始碼 | 約 5000 萬–1.7 億個指令 / 秒；冷開機幾秒 | 在 RV64 板子上寫程式（像樹莓派），要快、要即時 |

## 硬體還是軟體

veryl-emu 和 riscv-emu 跑的是**同一塊板子**（`examples/rv64` 的 Rv64Soc）、**同一份** OpenSBI + Linux 映像、
同樣的 GPIO、麵包板、檔案交換與螢幕，差別在「誰算出結果」：

- veryl-emu：你用 Veryl 寫的 Rv64Core 與周邊。改了 `rv64core.veryl`，下一次開機就是你改過的 CPU；
  慢，但是每個訊號都是真的。
- riscv-emu：照 Rv64Soc 寫的模擬器（[riscv-emu](../riscv-emu/README.tw.md)）。它和硬體的一致性靠測試：
  riscv-tests、隨機程式與 spike 逐指令比對、開 Linux 時和 RTL 的 commit log 逐指令比對（第一個差別是讀 `cycle`：
  硬體數時脈、模擬器數指令）、xv6 的 usertests。快幾十倍，適合寫軟體；改了 Veryl 不會有任何影響。

所以常見的做法是：寫程式、做實驗用 riscv-emu；改了硬體以後切到 veryl-emu 開一次機，確認你的電路跑同樣的軟體也對；
要知道它做成晶片多大、多快，就切到 FPGA / ASIC。

## 速度從哪裡來

| | 一個指令要做的事 | Linux 開到 shell |
|---|---|---|
| Verilator（RTL，原生） | 算整顆 CPU 的每個訊號，一個指令約 3 拍 | 約 45 秒 |
| veryl-emu（RTL，wasm） | 同上，在瀏覽器裡 | 約 70 秒（快照：約 10 秒） |
| riscv-emu 直譯（wasm） | 解碼一個指令、做它的效果 | 約 1.7 秒 |
| riscv-emu 翻譯（wasm） | 一段程式翻成 wasm 函式後由瀏覽器編成機器碼，直接執行 | 約 1.6 秒（開機多半是只跑一次的碼）；之後的程式快約 4 倍 |

命令列也有對應的工具：`examples/rv64` 的 `sim/obj/rv64sim`（Verilator）、`emu/rv64emu`（veryl-emu）與
`riscv-emu/target/release/rvemu`（riscv-emu），選項都一樣，測試腳本用 `SIM=` 換。
