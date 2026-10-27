[English](README.md) | [繁體中文](README.tw.md)

# riscv-emu

veryl2chip 的 RV64 開發板（[`examples/rv64`](../examples/rv64/) 的 `Rv64Soc`）的**指令集模擬器**，像 QEMU：
不模擬電路，只算每個指令的效果，所以比模擬硬體的 [veryl-emu](../veryl-emu/) 與 Verilator 快幾十倍；
跑的是同樣的程式（riscv-tests、OpenSBI + Linux、xv6、板子上的 MicroPython 與 C）。Veryl 設計本身的驗證還是用
Verilator 與 veryl-emu；riscv-emu 的正確性用 riscv-tests、spike 與 RTL 的逐指令比對來確認。

```sh
cargo build --release
cargo test --release          # 自己的小測試；有 riscv-tests 與 Linux 的建置時也跑它們
target/release/rvemu ../examples/rv64/linux/build/opensbi/platform/generic/firmware/fw_payload.bin   # 開 Linux，終端機直接打字
```

| | Verilator（RTL） | veryl-emu（RTL，Node） | riscv-emu |
|---|---|---|---|
| `linux/test.sh`（開機 + 指令，約 1 億個指令） | 50 秒 | 107 秒 | 1.6 秒 |
| xv6 `usertests`（285 億個指令） | 不實際 | 不實際 | 5.6 分鐘 |

## 機器

- **核心**（`src/cpu.rs`）：RV64IMAC + Zicsr + Zicntr + Zifencei + Sstc + Svadu，M / S / U、SV39，和 Rv64Core 的行為一致：
  沒對齊的載入 / 儲存發出例外、PMP 只有暫存器、只有 `menvcfg.ADUE` 打開時硬體才設 A / D 位元、沒有除錯觸發器
  （`tdata1` 讀 0）、`mcountinhibit` 固定 0、`mtval` 是出錯的位址或指令。壓縮指令先展開成 32 位元的形式再執行。
  一個小 TLB 依 4 KB 頁快取 SV39 的葉節點，權限每次存取都用快取的 PTE 位元檢查，所以快取不會改變行為。
- **周邊**（`src/bus.rs`）：和 `rv64soc.veryl` 一個暫存器一個暫存器對應：finisher（0x10_0000）、CLINT、PLIC（31 個來源，
  M / S 兩個 context）、UART 16550 子集（THR 永遠是空的，接收一個位元組的緩衝）、16 支腳的 SiFive GPIO、256 MB RAM。
- **時間**：預設 `mtime` 每個指令加一（裝置樹說 10 MHz，所以一秒是一千萬個指令，結果可以重現）；`wfi` 沒有事情時直接跳到下一個
  計時器中斷。`-r`（在終端機打字時的預設）改成跟著真實時間走。

## rvemu

```
rvemu [-t] [-r] [-m N] [-l ADDR:FILE]... [-d ADDR:LEN:FILE]... [-s SCRIPT] PROG
```

選項和 `examples/rv64` 的 `sim/obj/rv64sim`（Verilator）與 `emu/rv64emu`（veryl-emu）相同，所以那裡的腳本都可以換成它：

```sh
cd ../examples/rv64
SIM=../../riscv-emu/target/release/rvemu sim/riscv_tests.sh
SIM=../../riscv-emu/target/release/rvemu linux/test.sh
SIM=../../riscv-emu/target/release/rvemu xv6/test.sh usertests
```

`-t` 每個指令印一行，格式和 `spike -l --log-commits` 相同（可以和 RTL 的 `rv64sim -t` diff；開 Linux 時前 58 萬個指令
完全相同，第一個差別是讀 `cycle`：硬體數時脈，這裡數指令）。
