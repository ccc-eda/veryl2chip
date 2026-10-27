# Rv64：用 Veryl 寫的 RV64 處理器

跑得起 **xv6-riscv** 與 **Linux** 的 RISC-V 處理器。這個目錄是獨立的 Veryl 專案；驗證用官方工具鏈，
不靠 veryl2chip 自己的模擬器：`veryl build`（Veryl 0.22 → SystemVerilog）＋ **Verilator**（→ C++）。

| 檔案 | 內容 |
|---|---|
| `src/rv64core.veryl` | `Rv64Core`：多週期 RV64IMAC + Zicsr + Zicntr + Zifencei + Sstc + Svadu，M / S / U 模式，SV39 + 16 筆 TLB |
| `src/rv64soc.veryl` | `Rv64Soc`：核心 + RAM（256 MB）+ CLINT + PLIC + UART 16550，QEMU `virt` 的記憶體映射 |
| `sim/main.cpp` | Verilator 測試平台：載入 ELF、UART ↔ 終端機、`tohost`、spike 格式的指令紀錄 |
| `sim/build.sh` | `veryl build` + `verilator` → `sim/obj/rv64sim` |
| `sim/riscv_tests.sh` | 跑官方 riscv-tests |
| `sim/spike_diff.sh` | 逐指令和 spike 比對 |
| `sim/build_gates.sh` | veryl-eda 合成 `Rv64Core`，網表（通用閘、ECP5、vlib、SKY130，以及 vlib 佈局繞線之後）放回同一個測試平台 |
| `src/rv64fpga.veryl`、`sim/fpga.cpp`、`sim/build_fpga.sh` | `Rv64Fpga`：放得進 ECP5 的系統（block RAM、序列 UART），只用腳位的測試平台 |
| `fpga/ecp5.sh`、`fpga/ulx3s.lpf` | `Rv64Fpga` → nextpnr-ecp5 佈局繞線 → 位元流（ULX3S 85F） |
| `emu/build.sh`、`emu/rv64emu.mjs`、`emu/rv64emu` | Rv64Soc 用 veryl-emu 編成 WebAssembly，在 Node 上跑（和 `sim/obj/rv64sim` 同樣的選項） |
| `xv6/build.sh`、`xv6/ramdisk.c` | 編譯官方 xv6-riscv（三處修改，見下） |
| `xv6/test.sh` | 開 xv6、用腳本打指令、檢查輸出 |
| `linux/build.sh`、`rv64soc.dts`、`rv64soc.config`、`init.sh`、`musl.mak`、`musl-cc` | OpenSBI + Linux 6.12 + busybox（musl）的 initramfs |
| `linux/test.sh` | 開 Linux、在 busybox 的 shell 打幾個指令、關機，檢查輸出 |
| `verify/randgen.py`、`verify/random.sh` | 隨機指令測試：M / S / U 模式（S、U 跑在隨機權限的 Sv39 分頁上），和 spike 逐指令比對 |
| `verify/irq.S` | 中斷的定向測試（會自己檢查）：計時器、軟體、外部（PLIC + UART）、委派、wfi、優先順序 |

## 處理器

多週期狀態機，一個指令依序走過：

    [Fetch] → [Walk → (WalkW)]* → Mem（取指令）→ [Fetch2 → …]（跨邊界的後半）→ Exec → [Walk → (WalkW)]* → Mem → (AmoW)
                                                                                    └─ 只有 load / store / AMO

- **取指令**：4 位元組對齊的位址取 4 位元組，否則取 2 位元組（可能是壓縮指令）；pc 在 2 的位置的 32 位元指令
  再用 **Fetch2** 取後半（可能在下一頁，另外轉換位址）。一個指令完成的那一拍就開始取下一個指令
  （有中斷、位址不合法、或系統指令時才回到 **Fetch**）。
- **C 擴充**：16 位元指令在 Exec 前展開成 32 位元指令，用同一個解碼器；保留的編碼是非法指令。

- **Walk**：SV39 的分頁表走訪（最多三層）；**WalkW**：`menvcfg.ADUE = 1` 時由硬體把 A / D 位元寫回分頁表項目
  （Svadu，xv6 會打開；ADUE = 0 時改發 page fault，讓軟體自己設）。
- **TLB**：16 筆全關聯，取指令與資料共用，只存走訪成功的葉節點。命中、權限夠、A / D 不用更新時直接用，
  其他情況照樣走訪（所以行為和沒有 TLB 時完全一樣）；`sfence.vma` 與寫 `satp` 時清空。
- **Exec**：一拍完成解碼、運算、寫回、CSR、分支。
- **MulDiv**：乘除法一次處理一個位元（移位相加 / 恢復式除法），64 拍；W 版本的指令也一樣。
- 中斷在 Fetch（指令之間）檢查；例外可以在任何一個存取或 Exec 發生，委派（medeleg / mideleg）到 S。
- 一般指令 2 拍（取指令 1 + Exec 1）、load / store 3 拍、乘除法約 66 拍；跨邊界的 32 位元指令多 1 拍；開了 SV39 且 TLB 沒命中時多三次分頁表讀取。

| 有 | 還沒有 |
|---|---|
| RV64I、M、A（LR / SC、AMO）、C（壓縮指令）、Zicsr、Zicntr、Zifencei | F / D；`misa` 唯讀（不能關掉 C） |
| M / S / U、陷阱委派、mret / sret / wfi、TVM / TW / TSR | 沒對齊的 load / store（發出例外，規格允許） |
| SV39：大頁、SUM、MXR、MPRV、Svadu、16 筆 TLB | ASID（TLB 清除不分 ASID） |
| Sstc（`stimecmp`）、`time` / `cycle` / `instret`、`mstatus.FS` 可寫（沒有 F，和 spike 一樣） | PMP 權限檢查（暫存器可讀寫，但不檢查） |
| | 除錯觸發器（`tselect` 等讀 0） |

## 周邊（`Rv64Soc`）

| 位址 | 裝置 |
|---|---|
| `0x0010_0000` | 關機裝置（QEMU 的 `sifive,test0`）：寫 0x5555 結束模擬（Linux 的 poweroff） |
| `0x0200_0000` | CLINT：`msip`、`mtimecmp`（+0x4000）、`mtime`（+0xBFF8，每拍加一） |
| `0x0C00_0000` | PLIC：31 個來源、M / S 兩個 context（UART 是來源 10） |
| `0x1000_0000` | UART 16550（位元組暫存器；送出的字直接交給測試平台） |
| `0x1006_0000` | GPIO（`Rv64Gpio`，v2.15）：16 支腳，暫存器和 SiFive 的 GPIO 相容（Linux 的 `gpio-sifive`）；腳 k 的中斷是 PLIC 的來源 16 + k；SoC 的腳位 `o_gpio` / `o_gpio_oe` / `i_gpio`。GPIO 0、1 是板上 LED（`/sys/class/leds/act`（心跳）、`user`），GPIO 2 是按鈕，其他給排針 |
| `0x8000_0000` | RAM 256 MB；重設後從這裡開始執行（xv6 用前 128 MB，`0x8800_0000` 放檔案系統映像）；請求的同一拍回應（模擬用） |

## 建置與測試

需要官方 `veryl`（0.22）、`verilator`（OSS CAD Suite）；比對需要 `spike`。

```sh
sim/build.sh                                 # → sim/obj/rv64sim
sim/obj/rv64sim PROG.elf                     # 跑程式（UART 的輸出印到終端機）
sim/obj/rv64sim -t PROG.elf                  # 每個指令印一行（spike -l --log-commits 的格式）
sim/riscv_tests.sh                           # 官方 riscv-tests
sim/spike_diff.sh PROG.elf                   # 和 spike 逐指令比對
```

riscv-tests 要另外下載編譯（`RISCV_TESTS` 指定目錄，預設 `/Users/Shared/ccc/riscv-tests`）：

```sh
git clone --recursive https://github.com/riscv-software-src/riscv-tests
cd riscv-tests/isa && make XLEN=64 rv64ui rv64um rv64ua rv64uc rv64si rv64mi
```

## 驗證結果

- **riscv-tests**：rv64ui / um / ua / uc / si / mi 的 `-p`（實體位址）與 `-v`（SV39 虛擬記憶體）共 196 支全部通過；
  `ma_data`（沒對齊的存取）不在清單裡。
- **和 spike 逐指令比對**（`-p` 與 `-v`，比特權、pc、指令、寫入的暫存器值；
  spike 用 `--isa=rv64imac_zicsr_zicntr_zifencei_sstc_svadu`）：除了下面四個已知的差異，196 支全部相同。

  | 測試 | 差異 |
  |---|---|
  | rv64mi-p-breakpoint | spike 有除錯觸發器 |
  | rv64mi-p-mcsr | spike 的 `marchid` 是 5 |
  | rv64mi-p-ma_fetch | spike 的 `misa` 可以寫入把 C 關掉，測試因此走另一條路 |
  | rv64ua-p-lrsc | spike 每 5000 個指令清掉一次 LR 的保留，SC 偶爾失敗（規格允許） |

## 隨機測試與中斷測試

riscv-tests 每支只測一件事；`verify/randgen.py` 產生隨機的程式，和 spike 逐指令比對：

- 所有 RV64IMAC 指令與 Zicsr，運算元偏向邊界值（0、-1、最大最小值）；load / store / AMO 有一成沒對齊；
  刻意產生非法的編碼（不存在的 funct、F / D 指令、保留的 16 位元編碼）、不存在或唯讀的 CSR、ecall / ebreak；
  分支與跳躍只往前（程式一定會結束）；例外由 M 模式的 handler 跳過出錯的指令。
- 模式 `m`：在 M 模式、沒有分頁。模式 `s` / `u`：在 S / U 模式、Sv39 分頁上；資料區的四個 4 KB 頁的
  V / R / W / X / U / A / D 都隨機，`menvcfg.ADUE`、`SUM`、`MXR` 也隨機，所以每支程式都有上百次 load / store page fault。

```sh
verify/random.sh 1 300            # 種子 1..300，每個種子 M、S、U 三種模式，各 2000 個指令
```

和 spike 比對出來而修正的地方：`mcounteren` / `scounteren` 只有 CY / TM / IR 三個位元可寫、`mcountinhibit` 固定為 0、
進入陷阱時清掉 LR 的保留（規格都允許兩種做法，改成和 spike 一樣）。隨機測試不寫 `misa`（spike 可以寫入關掉擴充）、
不讀 `marchid`、不碰 PMP（Rv64Core 不檢查 PMP）。

中斷的時機和 spike 不同，不能逐指令比；`verify/irq.S` 會自己檢查（全部通過時 `tohost = 1`）：
M 計時器、M 軟體中斷、全域中斷關閉時 `wfi` 照樣被喚醒、Sstc 的 S 計時器（委派）、S 軟體中斷（委派）、
在 U 模式時 M 層級的中斷照樣進來、UART 經 PLIC 的外部中斷（M、S 兩個 context，claim / complete）、
MSI 與 MTI 同時等待時先處理 MSI。spike 也跑得過第 2–7 項（它的 UART 沒有 THRE 中斷）。

## 合成與 ASIC 佈局繞線：網表放回 Verilator

`sim/build_gates.sh KIND` 用 veryl-eda（`v2c`）合成 `Rv64Core`，把網表換掉 SoC 裡的 RTL 處理器，
其他（周邊、記憶體、`sim/main.cpp`）不變，所以所有測試都能拿網表來跑：

| KIND | 網表 | 元件數 |
|---|---|---|
| `gate` | `v2c synth`：通用閘（AND / OR / XOR / MUX / DFF…） | 60,912 |
| `ecp5` | `v2c fpga --arch ecp5`：LUT4、CCU2C、TRELLIS_FF，用 yosys 的 ECP5 元件模型模擬 | 29,123 LUT4 + 455 CCU2C + 6,251 FF |
| `vlib` | `v2c asic --map-only`：vlib 標準元件（網表裡附元件模型） | 64,988 |
| `sky130` | `v2c asic --pdk sky130 --map-only`：sky130_fd_sc_hd | 59,243 |

```sh
sim/build_gates.sh ecp5                       # → sim/obj_ecp5/rv64sim
OBJ=sim/obj_ecp5 sim/riscv_tests.sh           # riscv-tests 跑在網表上
OBJ=sim/obj_ecp5 verify/random.sh 1 100       # 隨機測試（和 spike 比）
```

繞線之後（veryl-eda 自己的 ASIC 流程：佈局、時脈樹、全域與細部繞線）：

| KIND | 網表 | 結果 |
|---|---|---|
| `vlib_routed` | `v2c asic`：66,522 個 vlib 元件（含時脈樹 1534 個緩衝器），1433 × 1436 µm，約 5 分鐘 | 0 衝突、0 斷線，Fmax 25.6 MHz；196 支 riscv-tests 通過 |
| `sky130_routed` | `v2c asic --pdk sky130` | 細部繞線還留下衝突與斷線（暫緩） |

`DEF=out.def sim/build_gates.sh vlib_routed` 另外寫出版圖（DEF）。很久的測試（Linux、xv6）只在 RTL 上跑，網表只跑 riscv-tests。

四種對應後的網表都通過 196 支 riscv-tests；`gate` 另外跑過 300 支隨機程式、中斷測試與 Linux 開機。
乘除法原本是組合邏輯（64 位元的乘法器與除法器，網表 13 萬個元件），改成 64 拍的反覆式後剩 6 萬個。

## veryl-emu：編譯成 WebAssembly

[veryl-emu](../../veryl-emu/README.tw.md) 是我們自己的編譯式模擬器（像 Verilator，但產生 WebAssembly）：
`emu/build.sh` 把 Rv64Soc 編成 `build/emu/rv64soc.wasm`（86 KB，編譯不到 0.1 秒），`emu/rv64emu` 是和 `sim/main.cpp`
同樣的測試平台（JavaScript），選項也一樣，所以現有的腳本都能直接用：

```sh
emu/build.sh                                            # cargo build veryl-emu + 編譯 Rv64Soc
SIM=emu/rv64emu sim/riscv_tests.sh                      # 196 支 riscv-tests
SIM=emu/rv64emu verify/random.sh 1 30                   # 隨機程式，和 spike 逐指令比對（-t 印每個指令）
emu/rv64emu linux/build/opensbi/platform/generic/firmware/fw_payload.bin   # 開 Linux，直接打字
```

| | Verilator | veryl-emu（Node 24） |
|---|---|---|
| riscv-tests | 196 / 196 | 196 / 196 |
| 隨機程式（和 spike 相同） | 900 | 120 |
| Linux 開到 busybox shell（2.3 億拍） | 32 秒（720 萬拍 / 秒） | 55 秒（420 萬拍 / 秒；v2.13 是 104 秒） |

## FPGA：佈局繞線之後再模擬

`Rv64Soc` 的 256 MB RAM 放不進 FPGA，所以另外有 `Rv64Fpga`（`src/rv64fpga.veryl`）：

- RAM 128 KB：8 個位元組通道的同步讀取記憶體（下一拍回應），合成成 64 顆 ECP5 的 `DP16KD` block RAM。
- UART 是真的序列腳位（8N1，每位元 `CPB` 拍，預設 25 MHz / 115200）；CLINT、8 顆 LED、關機裝置；沒有 PLIC。
- 程式從載入埠送進來：`i_ld = 1` 時核心停在重設，每拍一個位元組（先 4 個位元組的 tohost 位址，再從 0x8000_0000 開始的程式）。
  程式寫 tohost 或關機裝置時 `o_halt = 1`、`o_code` 是寫入的值。

同一個只用腳位的測試平台（`sim/fpga.cpp`）跑三種版本：

```sh
sim/build_fpga.sh rtl                                   # RTL
sim/build_fpga.sh ecp5                                  # veryl-eda 的 ECP5 網表（LUT4、CCU2C、TRELLIS_FF、DP16KD）
fpga/ecp5.sh                                            # v2c → nextpnr-ecp5（LFE5U-85F、ULX3S 腳位）→ ecppack
sim/build_fpga.sh routed                                # nextpnr 繞線後的網表（TRELLIS_COMB、TRELLIS_FF、DP16KD）
SIM=sim/obj_fpga_routed/rv64fpga sim/riscv_tests.sh 'rv64*-p-*'
```

| 版本 | 用量 | riscv-tests `-p` |
|---|---|---|
| RTL | | 110 / 110 |
| ECP5 網表 | 31,399 LUT4、487 CCU2C、6,653 FF、64 DP16KD | 110 / 110 |
| 繞線後 | 32,469 TRELLIS_COMB（85F 的 38 %）、6,653 FF、64 DP16KD（30 %） | 110 / 110 |

- `-v` 的測試要 512 KB 的記憶體（測試環境的頁面散在前 512 KB），比 85F 全部的 block RAM 還多，所以只跑 `-p`。
- 繞線後的網表：nextpnr 的 `--write` 輸出經過 `veryl-eda/fpga/ecp5_unio.py`（IO 與時脈緩衝器變成導線、沒接的 LUT 輸入讀 1、
  DP16KD 被 nextpnr 改成參數的常數腳位接回來），yosys 寫成 Verilog，用 yosys 的 ECP5 元件模型模擬
  （DP16KD 在 yosys 裡只有宣告，模型是 `veryl-eda/fpga/ecp5_dp16kd.v`）。
- 時序：nextpnr 的 Fmax 約 12.7 MHz（ULX3S 的 25 MHz 不夠；關鍵路徑是 64 位元加法器的進位鏈加上繞線），
  上板要用 PLL 降到 12.5 MHz，或改善時序；載入埠在板子上也還沒有接（之後換成 UART 載入器）。

## xv6

官方 [xv6-riscv](https://github.com/mit-pdos/xv6-riscv)（MIT 授權）幾乎不用改：記憶體映射、UART、PLIC、CLINT 都和 QEMU 一樣，
Sstc（`stimecmp`）與 Svadu（`menvcfg.ADUE`）也照 xv6 的用法實作。`xv6/build.sh` 只改三處：

1. Makefile 的 `-march=rv64gc` 換成 `-march=rv64imac_zicsr_zifencei -mabi=lp64`（沒有 F / D 擴充）。
2. `kernel/virtio_disk.c` 換成 `xv6/ramdisk.c`：同樣的三個函式，檔案系統映像放在 RAM 的 `0x8800_0000`（xv6 用的 128 MB 之後），
   讀寫一個區塊就是複製 1 KB。virtio 要描述子佇列與 DMA，用 Veryl 寫很複雜，上 FPGA 也用不到。
3. `kernel/vm.c` 把這 2 MB 對應進 kernel 的分頁表（取代 virtio 暫存器那一頁）。

```sh
git clone https://github.com/mit-pdos/xv6-riscv /Users/Shared/ccc/xv6-riscv     # 或用 XV6=目錄 指定
xv6/build.sh                                                                     # → xv6/build/kernel/kernel、fs.img
sim/obj/rv64sim -m 0 -l 0x88000000:xv6/build/fs.img xv6/build/kernel/kernel      # 互動：直接在終端機打字
xv6/test.sh                                                                      # 自動：開機、打幾個指令、檢查輸出
```

開機到 `$` 約 4.5 億個指令、13 億拍（Verilator 每秒約 6–7 百萬拍，約 3 分鐘）；
其中九成是 `kinit` 把 128 MB 的每一頁逐位元組填過一遍。`usertests -q`（xv6 的整套使用者測試，62 項）全部通過：`ALL TESTS PASSED`，
共 293 億個指令、686 億拍，Verilator 上 3.4 小時（一開始就用 `sbrk` 要完全部記憶體再放掉，所以很久）：

```sh
printf 'usertests -q\n' > /tmp/ut.txt
sim/obj/rv64sim -m 0 -s /tmp/ut.txt -l 0x88000000:xv6/build/fs.img xv6/build/kernel/kernel
```

## Linux

**OpenSBI**（M 模式韌體）+ **Linux 6.12** + **busybox 1.36**（C 函式庫用 **musl 1.2.5**），都是官方原始碼、不用改。
開機後是 busybox 的 shell，可以直接在終端機打指令：

```
[   17.783681] Run /init as init process

Hello from busybox on Rv64Core
Linux version 6.12.0 (…) (Homebrew clang version 22.1.4, Homebrew LLD 22.1.4) …
isa		: rv64imac_zicntr_zicsr_zifencei_zca_sstc
mmu		: sv39
rv64:~$ echo $((6 * 7))
42
rv64:~$ ps
PID   USER     TIME  COMMAND
    1 0         0:08 {init} /bin/sh /init
…
   21 0         0:00 sh
   24 0         0:00 ps
rv64:~$ free
              total        used        free      shared  buff/cache   available
Mem:         255688        3056      251560        1072        1072      248536
rv64:~$ poweroff -f
[   21.288251] reboot: Power down
```

- `linux/rv64soc.dts`：描述這台機器的裝置樹（CPU 的 ISA 與 sv39、CLINT、PLIC、16550、記憶體、關機裝置）。
- `linux/rv64soc.config`：加在 `tinyconfig` 上的設定：RV64IMAC、沒有 FPU、單一 hart、只有 initramfs（沒有區塊裝置、網路、模組）、
  8250 序列埠（收字靠 PLIC 的外部中斷）、syscon 關機；給 busybox 的 shell 腳本、多使用者、futex、tmpfs。
- initramfs：靜態連結的 busybox（defconfig、不含 `tc`，約 1 MB、401 個指令的連結）與 `linux/init.sh`（`/init`：掛上 `/proc`、`/sys`、
  `/dev`、`/tmp`，印出版本，用 `setsid cttyhack sh` 開 shell；shell 結束就關機）。
- C 函式庫：musl 只用 `make` 編（`linux/musl.mak` 取代它的 configure 腳本），裝進 `linux/build/sysroot`，連同 kernel 的
  `headers_install`；`linux/musl-cc` 是 clang 加上 musl 與 rv64imac / lp64 的 libgcc（`riscv64-unknown-elf-gcc` 附的，提供 128 位元浮點等）。
- OpenSBI 建成 `fw_payload`：韌體、裝置樹、kernel 包成一個檔案，從 0x8000_0000 載入（`rv64sim` 遇到不是 ELF 的檔案就整個載入那裡）。

```sh
git clone --depth 1 https://github.com/riscv-software-src/opensbi /Users/Shared/ccc/opensbi
git clone --depth 1 --branch v6.12 --filter=blob:none --no-checkout https://github.com/torvalds/linux /Users/Shared/ccc/linux
cd /Users/Shared/ccc/linux && git sparse-checkout init --no-cone && cp <本目錄>/linux/sparse-checkout .git/info/ && git checkout v6.12
git clone --depth 1 --branch v1.2.5 https://git.musl-libc.org/git/musl /Users/Shared/ccc/musl
git clone --depth 1 --branch 1_36_1 https://git.busybox.net/busybox /Users/Shared/ccc/busybox
linux/build.sh            # → linux/build/opensbi/platform/generic/firmware/fw_payload.bin（第一次約 2 分鐘）
sim/obj/rv64sim -m 0 linux/build/opensbi/platform/generic/firmware/fw_payload.bin    # 互動：直接打字，exit 或 poweroff -f 結束
linux/test.sh             # 自動：開機、打幾個指令（含 GPIO）、poweroff -f，檢查輸出（SIM=emu/rv64emu：在 veryl-emu 上）
```

- sparse checkout 只取每個 Kconfig / Makefile 和用得到的驅動，kernel 原始碼約 300 MB。
- 要用 **LLVM**（clang + ld.lld）：GNU 的 `riscv64-unknown-elf-ld` 做不出共享物件（vDSO）和 PIE（OpenSBI），也沒有 Linux 用的 C 函式庫。
- 在 macOS 上編 kernel 與 busybox：GNU make / sed / coreutils、bison 3（Homebrew），kernel 的主機工具還要 `<elf.h>`（用 RISC-V 工具鏈附的 musl 版）、
  `<byteswap.h>`（腳本自己寫）與 `-D_UUID_T`；`build.sh` 都處理好了。

開機到出現 shell 提示：約 8000 萬個指令、2.3 億拍，Verilator 上約 30 秒。

### GPIO（v2.15）

```sh
echo none > /sys/class/leds/act/trigger           # ACT LED 預設是心跳，改成手動
echo 1 > /sys/class/leds/user/brightness          # 點亮 USER LED
B=$(cat /sys/class/gpio/gpiochip*/base)           # GPIO 0 在 sysfs 的編號（512）
echo $((B+5)) > /sys/class/gpio/export            # GPIO 5 當輸出
echo out > /sys/class/gpio/gpio$((B+5))/direction
echo 1 > /sys/class/gpio/gpio$((B+5))/value
echo $((B+2)) > /sys/class/gpio/export            # GPIO 2 是按鈕
cat /sys/class/gpio/gpio$((B+2))/value
```

檔案（v2.18）：RAM 最後 16 MB（0x8F00_0000）在裝置樹裡是 reserved-memory，作為和 IDE 交換檔案的區域（開頭 512 位元組是一行
`VERYLFS <大小>`，後面接 tar）：`getfiles`（`/init` 開機時執行）解到 `/root`，`savefiles` 把 `/root` 打包寫回，並送出 `ESC ] 1337 ; veryl-save BEL`
通知 IDE。RISC-V 的 `/dev/mem` 只能讀寫 Linux 記憶體範圍內的位址，所以不能把這塊排除在 RAM 之外。測試平台用 `-l 0x8F000000:檔案` 放進去，
`emu/rv64emu -d 0x8F000000:長度:檔案` 結束時存出來；`board/blink.sh`、`board/button.sh` 是開發板的範例腳本。

測試平台（`sim/main.cpp`、`emu/rv64emu.mjs`）在輸出改變時印出 `[gpio] out=…`；`-s` 腳本裡的 `!gpio N=V` 是「把輸入腳 N 設成 V」
（按下按鈕），不會送進終端機。`linux/test.sh` 用它檢查 LED、輸出腳、按鈕與邊緣中斷（`/proc/interrupts`）。
