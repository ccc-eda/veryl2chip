# 7. FPGA：`v2c fpga`

```
v2c fpga [--top MODULE] [--pcf PINS.pcf] [--asc OUT.asc] [--bin OUT.bin]
         [--pnr veryl|nextpnr] [--seed N] [--no-timing-driven] [--program PROG.bin]
         [-o OUT.json] [--verilog OUT.v] [-v] FILE.veryl...
```

目標晶片是 Lattice **iCE40UP5K-SG48**（iCEBreaker 開發板上的那顆：5280 個邏輯單元、30 塊 4 Kbit block RAM、12 MHz 時脈）。

## 步驟

1. **對應**（一定做）：全加器的進位變成 `SB_CARRY` 進位鏈，其他邏輯以 4 輸入查表 `SB_LUT4` 覆蓋，
   正反器變成 `SB_DFF*`，同步讀取的記憶體變成 `SB_RAM40_4K`。印出元件統計；`-o` / `--verilog` 寫出對應後的網表。
2. **佈局繞線**（給了 `--asc` 或 `--bin` 才做）：把元件放到晶片上的位置並連線。
3. **位元流**：`--bin` 寫出可以燒的檔案。

## 兩種佈局繞線工具

| | `--pnr nextpnr`（預設） | `--pnr veryl` |
|---|---|---|
| 是誰 | 外部的 nextpnr-ice40 + icepack | 本專案自己的佈局繞線與位元流 |
| 需要 | OSS CAD Suite | IceStorm 的 `chipdb-5k.txt`（`VERYL_EDA_CHIPDB`） |
| 時序不夠 12 MHz | 失敗（nextpnr 的行為） | 照樣產生，印出 Fmax，由你判斷 |
| 其他 | | 時序導向（`--no-timing-driven` 關閉）、`--seed`、`-v` 印出關鍵路徑、粗估功耗 |

自己的佈局繞線產生的 `.bin` 與 icepack 逐位元組相同，並且用 IceStorm 的 `icebox_vlog` 把繞好的位元流轉回電路、
和網表逐週期比對過（第 13 章）。

```sh
$ v2c fpga --pnr veryl --pcf counter.pcf --bin counter.bin counter.veryl
  veryl pnr: 6 LCs, 52 routing pips, 0.2s
  power: 0.199 mW at 122.1 MHz = ...
  timing: critical path 8.19 ns, Fmax 122.10 MHz (wirelength-only pass 122.10 MHz)
wrote counter.bin
```

`--asc OUT.asc` 寫出 IceStorm 的文字格式（自己的佈局繞線會在旁邊一起寫 `.pcf`）；只給 `--bin` 時 `.asc` 放在暫存目錄。

## 腳位檔（`.pcf`）

每一行 `set_io 埠名 腳號`，向量埠寫 `o_led[0]`。`-nowarn` 表示設計沒用到這支腳也沒關係。
iCEBreaker 常用的腳（`tutorial/icebreaker.pcf` 有完整清單）：

| 腳 | 用途 |
|---|---|
| 35 | 12 MHz 時脈 |
| 10 | 板上按鈕 BTN_N（按下 = 0，拿來當 reset 剛好） |
| 11、37 | 板上紅 / 綠 LED（低電位亮） |
| 26、27、25、23、21 | 擴充板 LED1–LED5（高電位亮） |
| 20、19、18 | 擴充板 BTN1–BTN3（按下 = 1） |
| 6、9 | 序列埠 RX（進 FPGA）、TX（出 FPGA） |
| PMOD1A：4 2 47 45 3 48 46 44；PMOD1B：43 38 34 31 42 36 32 28 | 外接模組 |

沒有給 `--pcf` 時腳位由工具自己決定，位元流仍然可以做，但燒進板子不會接到你要的地方。

## 時序

`Fmax` 是電路能跑的最高頻率，要**高於 12 MHz** 才能在 iCEBreaker 上正常工作。不夠時：

- 把長的組合邏輯切成兩拍（加暫存器）；
- 試試不同的 `--seed`，或另一個佈局繞線工具；
- `-v` 看關鍵路徑經過哪些元件與連線。

## 燒錄

```sh
iceprog counter.bin
```

沒有板子：網頁 IDE 的 ⚡ 虛擬板跑的就是這個位元流解碼回來的電路（第 12 章），也可以把任何 iCE40UP5K 的 `.bin` 拖到虛擬板上。

## 把程式放進 block RAM（`--program`）

對於程式存在 block RAM 的 CPU（例如本專案的 `RvBoard`，第 10 章），`--program PROG.bin` 從位址 0 把二進位檔填進記憶體：

```sh
v2c cc -o hello.bin examples/c/hello.c
v2c fpga --top RvBoard --pnr veryl --pcf examples/rvsoc.pcf --program hello.bin --bin soc.bin \
    examples/src/rv32i.veryl examples/src/sync_ram.veryl examples/src/uart.veryl examples/src/rvsoc.veryl
iceprog soc.bin
```

整顆 SoC（約 4200 個邏輯單元、20 塊 block RAM）的佈局繞線約需一分鐘，Fmax 約 13–14 MHz。

只換程式的話不需要重新合成與佈局繞線（網頁 IDE 換 C 程式時就是直接改寫位元流裡的記憶體內容）。

## 限制

只支援 UP5K；沒有 SPRAM（`SB_SPRAM256KA`）、PLL、`inout`；非同步讀取的記憶體不會變成 block RAM；
自己的佈局繞線不做 LUT 輸入腳交換。
