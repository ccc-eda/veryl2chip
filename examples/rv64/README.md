# Rv64：用 Veryl 寫的 RV64 處理器

目標是跑起 **xv6-riscv**（之後是 Linux）。這個目錄是獨立的 Veryl 專案；驗證用官方工具鏈，
不靠 veryl2chip 自己的模擬器：`veryl build`（Veryl 0.22 → SystemVerilog）＋ **Verilator**（→ C++）。

| 檔案 | 內容 |
|---|---|
| `src/rv64core.veryl` | `Rv64Core`：多週期 RV64IMA + Zicsr + Zicntr + Zifencei + Sstc，M / S / U 模式，SV39 |
| `src/rv64soc.veryl` | `Rv64Soc`：核心 + RAM（128 MB）+ CLINT + PLIC + UART 16550，QEMU `virt` 的記憶體映射 |
| `sim/main.cpp` | Verilator 測試平台：載入 ELF、UART ↔ 終端機、`tohost`、spike 格式的指令紀錄 |
| `sim/build.sh` | `veryl build` + `verilator` → `sim/obj/rv64sim` |
| `sim/riscv_tests.sh` | 跑官方 riscv-tests |
| `sim/spike_diff.sh` | 逐指令和 spike 比對 |

## 處理器

多週期狀態機，一個指令依序走過：

    Fetch → [Walk → (WalkW)]* → Mem（取指令）→ Exec → [Walk → (WalkW)]* → Mem → (AmoW)
                                                     └─ 只有 load / store / AMO

- **Walk**：SV39 的分頁表走訪（最多三層，沒有 TLB：每次存取都重新走訪）；
  **WalkW**：A / D 位元由硬體寫回分頁表項目（xv6 靠這個，QEMU 也是這樣做）。
- **Exec**：一拍完成解碼、運算、寫回、CSR、分支；乘除法是組合邏輯。
- 中斷在 Fetch（指令之間）檢查；例外可以在任何一個存取或 Exec 發生，委派（medeleg / mideleg）到 S。
- 一般指令約 4 拍，開了 SV39 之後取指令多三次分頁表讀取。

| 有 | 還沒有 |
|---|---|
| RV64I、M、A（LR / SC、AMO）、Zicsr、Zicntr、Zifencei | C（壓縮指令）、F / D |
| M / S / U、陷阱委派、mret / sret / wfi、TVM / TW / TSR | 沒對齊的 load / store（發出例外，規格允許） |
| SV39：大頁、SUM、MXR、MPRV、A / D 硬體更新 | TLB（只影響速度） |
| Sstc（`stimecmp`）、`time` / `cycle` / `instret` | PMP 權限檢查（暫存器可讀寫，但不檢查） |
| | 除錯觸發器（`tselect` 等讀 0） |

## 周邊（`Rv64Soc`）

| 位址 | 裝置 |
|---|---|
| `0x0200_0000` | CLINT：`msip`、`mtimecmp`（+0x4000）、`mtime`（+0xBFF8，每拍加一） |
| `0x0C00_0000` | PLIC：31 個來源、M / S 兩個 context（UART 是來源 10） |
| `0x1000_0000` | UART 16550（位元組暫存器；送出的字直接交給測試平台） |
| `0x8000_0000` | RAM 128 MB；重設後從這裡開始執行 |

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
cd riscv-tests/isa && make XLEN=64 rv64ui rv64um rv64ua rv64si rv64mi
```

## 驗證結果

- **riscv-tests**：rv64ui / um / ua / si / mi 的 `-p`（實體位址）與 `-v`（SV39 虛擬記憶體）共 194 支全部通過；
  `ma_data`（沒對齊的存取）不在清單裡。
- **和 spike 逐指令比對**（`-p` 的測試，特權、pc、指令、寫入的暫存器值）：除了下面這些已知的差異，全部相同。

  | 測試 | 差異 |
  |---|---|
  | rv64mi-p-breakpoint | spike 有除錯觸發器 |
  | rv64mi-p-mcsr | spike 的 `marchid` 是 5 |
  | rv64si-p-dirty | spike 不由硬體設定 A / D，而是發出 page fault |
  | rv64ua-p-lrsc | spike 每 5000 個指令清掉一次 LR 的保留，SC 偶爾失敗（規格允許） |
