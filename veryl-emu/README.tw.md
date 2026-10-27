[English](README.md) | [繁體中文](README.tw.md)

# veryl-emu

把 Veryl 設計編譯成 **WebAssembly** 模組，做快速、以週期為單位、2 態的模擬，概念上像 Verilator。
WebAssembly 能跑的地方它都能跑：命令列用 Node，或在瀏覽器裡（瀏覽器的引擎再把它編成機器碼）。
用一小段 JavaScript 測試平台驅動它的腳位。

veryl-emu 是獨立的 crate，[veryl-sim](../veryl-sim/) 完全不動：veryl-emu 把 veryl-sim 的 IR（運算式、敘述、數值）
和輔助函式當函式庫用，展開（`src/elab.rs`）是自己的一份，唯一的差別是陣列做成一個訊號（一塊記憶體），
不拆成每個元素一個訊號，所以 256 MB 的 RAM 也沒問題。

```sh
cargo build --release
target/release/veryl-emu --top Rv64Soc --stop o_tx_valid,o_finish -o soc.wasm core.veryl soc.veryl
# → soc.wasm 與 soc.json（每個訊號的位元組位置、寬度、大小）
tests/check.sh            # 和 veryl-sim 的差分測試（需要 Node）
```

```js
import { loadFiles } from './js/emu.mjs';
const emu = await loadFiles('soc.wasm');
const rst = emu.sig('i_rst'), tx = emu.sig('o_tx_valid');
rst.set(0); emu.settle(); emu.posedge(); rst.set(1); emu.settle();
const n = emu.run(1_000_000);   // 跑到某個 --stop 訊號不是 0 為止（每個時脈邊緣前檢查）
```

## 做法

| 步驟 | |
|---|---|
| 展開 | `src/elab.rs`：把模組階層攤平成 veryl-sim 的 IR（`Proc::Comb`、`Proc::Ff`、訊號） |
| 定型 | `src/ir.rs`：每個運算式的寬度與正負號在編譯時決定，規則和 veryl-sim 的 `Sim::eval` 在執行時用的一樣（算術依前後文決定寬度、比較用較寬的運算元、移位用左運算元的寬度、有號數符號延伸）；`case` / `switch` 變成 `if` 鏈；2 態（x / z 當 0，除以 0 這類 x 的結果也是 0） |
| 排程 | `src/gen.rs`：組合邏輯依相依關係排序（Tarjan），自己依賴自己的一群反覆算到輸出不再變；經由埠連接傳進子模組的時脈追到同一個時脈 |
| 非阻塞 | 某個 `always_ff` 也會讀的暫存器寫到影子區、時脈邊緣後再寫回；某個 `always_ff` 會讀的陣列元素經過寫入佇列；其他直接寫 |
| 產生碼 | `src/gen.rs` + `src/wasm.rs`（最小的 WebAssembly 編碼器，沒有相依套件）：每個值是 i64 local 裡的 64 位元字組（64 位元以內一個，最多 256 位元四個），進位、多字組移位與比較都內嵌；訊號放在線性記憶體 |

匯出：`settle()`（組合邏輯）、`posedge()`（`always_ff`，然後 `settle()`）、`run(n)`（最多 `n` 拍，
某個 `--stop` 訊號不是 0 時在時脈邊緣前停下；`emu.mute(名稱, true)` 可以關掉一個），以及記憶體 `mem`。

## 驗證與速度

- `tests/check.sh`：`tests/check.veryl`（128 位元運算、變數移位與部分選取、有號除法與 `>>>`、函式、case 範圍、迴圈、
  `always_ff` 會讀的暫存器與陣列）在 veryl-sim 與 veryl-emu 上各跑 300 拍，21 個輸出每一拍都要相同。
- `examples/rv64/emu/`：RV64 SoC（Rv64Core + Rv64Soc，256 MB RAM）通過 196 支 riscv-tests、和 spike 逐指令比對的隨機程式、
  中斷測試，並開 Linux 到 busybox 的 shell。

| Linux 開機到 shell（2.3 億拍） | 每秒拍數 |
|---|---|
| Verilator（C++、`-O3`） | 720 萬 |
| veryl-emu（WebAssembly，Node 24） | 220 萬 |
| veryl-sim（解譯、4 態） | 幾千 |

## 限制

- 只有一個時脈（正緣）；非同步重設在時脈邊緣生效。
- 沒有測試平台的語法（`initial`、`clk.next()`、`$display`、`$assert`）：由測試平台驅動腳位。
- 超過 64 位元的乘除法；寬度不固定的 `[hi:lo]`（請用 `[lo +: w]`）。
- 沒有 x：和 Verilator 一樣是 2 態。
