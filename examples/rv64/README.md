# Rv64：用 Veryl 寫的 RV64 處理器

目標是跑起 **xv6-riscv**（之後是 Linux）。這個目錄是獨立的 Veryl 專案；驗證用官方工具鏈，
不靠 veryl2chip 自己的模擬器：`veryl build`（Veryl 0.22 → SystemVerilog）＋ **Verilator**（→ C++）。

| 檔案 | 內容 |
|---|---|
| `src/rv64core.veryl` | `Rv64Core`：多週期 RV64IMAC + Zicsr + Zicntr + Zifencei + Sstc + Svadu，M / S / U 模式，SV39 + 16 筆 TLB |
| `src/rv64soc.veryl` | `Rv64Soc`：核心 + RAM（256 MB）+ CLINT + PLIC + UART 16550，QEMU `virt` 的記憶體映射 |
| `sim/main.cpp` | Verilator 測試平台：載入 ELF、UART ↔ 終端機、`tohost`、spike 格式的指令紀錄 |
| `sim/build.sh` | `veryl build` + `verilator` → `sim/obj/rv64sim` |
| `sim/riscv_tests.sh` | 跑官方 riscv-tests |
| `sim/spike_diff.sh` | 逐指令和 spike 比對 |
| `xv6/build.sh`、`xv6/ramdisk.c` | 編譯官方 xv6-riscv（三處修改，見下） |
| `xv6/test.sh` | 開 xv6、用腳本打指令、檢查輸出 |

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
- **Exec**：一拍完成解碼、運算、寫回、CSR、分支；乘除法是組合邏輯。
- 中斷在 Fetch（指令之間）檢查；例外可以在任何一個存取或 Exec 發生，委派（medeleg / mideleg）到 S。
- 一般指令 2 拍（取指令 1 + Exec 1）、load / store 3 拍；跨邊界的 32 位元指令多 1 拍；開了 SV39 且 TLB 沒命中時多三次分頁表讀取。

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
| `0x0200_0000` | CLINT：`msip`、`mtimecmp`（+0x4000）、`mtime`（+0xBFF8，每拍加一） |
| `0x0C00_0000` | PLIC：31 個來源、M / S 兩個 context（UART 是來源 10） |
| `0x1000_0000` | UART 16550（位元組暫存器；送出的字直接交給測試平台） |
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
其中九成是 `kinit` 把 128 MB 的每一頁逐位元組填過一遍。`usertests -q` 一開始就用 `sbrk` 要完全部記憶體再放掉，
在模擬裡要跑一兩個小時。
