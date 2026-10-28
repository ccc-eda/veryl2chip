# 9. ASIC：`v2c asic`

```
v2c asic [--top MODULE] [--pdk vlib|sky130|sky130:DIR] [--seed N]
         [--verilog OUT.v] [--def OUT.def] [--gds OUT.gds] [--map-only] [-v] FILE.veryl...
```

把設計做成「標準元件晶片」：元件對應 → 列式佈局 → 時脈樹 → 全域與細部繞線 → 靜態時序 → 功耗與 IR drop；
用 SKY130 時再加上設計規則檢查（DRC）、版圖與電路比對（LVS）、GDSII 版圖與 SPICE 網表。

## 兩種元件庫

| | `--pdk vlib`（預設） | `--pdk sky130` |
|---|---|---|
| 是什麼 | 本專案自己定的教學元件庫，數字是「大約 130 nm」的假設值 | SkyWater 的開源製程 SKY130、`sky130_fd_sc_hd` 標準元件庫、典型角落 `tt_025C_1v80` |
| 列高 / site | 4.0 µm / 0.5 µm | 2.72 µm / 0.46 µm（`unithd`） |
| 繞線層 | M2–M5（M1 是元件腳位） | met1–met4（元件腳位在 li1）；電源軌 met1、電源帶 met4 |
| 時序 | 本徵延遲 + 每扇出負載 | Liberty 的 NLDM 查表（依輸入斜率與負載電容），斜率沿路徑傳遞 |
| 記憶體 | 同步讀取的變成 SRAM 巨集 | 維持正反器（沒有 SRAM 巨集） |
| DRC、LVS、GDSII、SPICE | 無 | 有 |
| 適合 | 看懂流程、快速比較 | 真實製程的結果、拿去給其他工具 |

需要的 SKY130 元件已經隨 `v2c` 附上，不用另外下載。`--pdk sky130:目錄` 改讀完整的 PDK 檔案（見本章最後）。

## 讀懂輸出

```
asic: technology sky130_fd_sc_hd (2.72 µm rows, 0.46 µm sites)
  cells: 14
    sky130_fd_sc_hd__and2_1 2
    sky130_fd_sc_hd__dfrtp_1 4
    ...
asic: area 187.7 µm² (cells), die 17.9 × 19.0 µm, 7 rows, utilization 55%, ...
asic: wirelength 186 µm, 71 vias, overflow 0 after 1 routing iterations
power: 0.057 mW at 750.1 MHz = dynamic 0.057 + leakage 0.0000; ...
asic: power grid 8 rails, 2 straps, 8 via stacks; 31 filler cells
asic: DRC 2022 shapes: 0 shorts, 0 spacing, 0 min-area, 0 opens; 11 taps (0 sites too far)
asic: LVS 19 nets, 170 terminals, 14 devices: 0 opens, 0 shorts, 0 device errors, layout matches the netlist (19 pieces, 0 floating)
asic: detailed routing 267 µm (met1 56 / met2 132 / met3 51 / met4 29), 142 vias, 0 conflicts, 0 opens after 3 iterations
asic: clock tree 0 buffers (), insertion 0.000 ns, skew 0.000 ns; hold: worst slack 0.342 ns, 0 delay buffers
timing: critical path 1.333 ns, Fmax 750.1 MHz (8 endpoints; ideal clock 756.3 MHz, wirelength-only placement 751.1 MHz)
```

| 行 | 意思 |
|---|---|
| `cells` | 每種標準元件用了幾個（SKY130 顯示元件庫的真實名稱） |
| `area / die` | 元件面積、晶粒大小、列數、利用率（元件佔晶粒的比例） |
| `wirelength … overflow` | 全域繞線：總線長、via 數；`overflow` 必須是 0 |
| `power` | 在 Fmax 下的功耗（隨機輸入模擬得到的翻轉率）與最差 IR drop |
| `power grid` | 電源軌、電源帶、via 堆疊、填充元件數（SKY130 至少一對電源帶，把每一列的電源軌接在一起） |
| `DRC` | （SKY130）短路、間距、最小面積、斷路都應該是 0；well tap 數與離 tap 太遠的 site |
| `LVS` | （SKY130）只從版圖的幾何重建接線，和網表比對：斷路、短路、元件不符都應該是 0，最後一句是 `layout matches the netlist` |
| `detailed routing` | 每層的線長；`conflicts` 與 `opens` 都應該是 0 |
| `clock tree` | 時脈樹緩衝器數、插入延遲、skew；hold 最差餘裕與修正用的延遲緩衝器 |
| `timing` | 關鍵路徑與 Fmax；也列出理想時脈下與只看線長的佈局下的 Fmax，看得出時序導向與時脈樹的影響 |

`-v` 另外印出關鍵路徑的每一級（元件延遲、線延遲）與 DRC 違規的例子；LVS 有錯時一定會列出例子。

### LVS（v2.33）

LVS（layout versus schematic）回答「版圖接起來的，真的是網表說的電路嗎？」。繞線器在每塊金屬上記了它屬於哪個網路，
但 LVS 不看這些記號（不然只是拿繞線器檢查自己）：它把所有金屬、via、元件的腳位形狀當成導體，同一層碰在一起的是同一塊，
via 接起上下兩層，重建出一塊一塊的導體；再看每塊導體碰到哪些元件的腳、哪些 IO 標籤：

- 斷路（open）：網表裡的一個網路分散在好幾塊導體上
- 短路（short）：一塊導體碰到兩個網路的腳
- 元件不符：版圖上的元件和網表的元件型別不同

電源也一樣：每個元件的 VPWR 必須連成一塊、VGND 一塊，而且兩塊不相連。版圖的 VPWR、VGND 標籤寫在第一條電源帶上。
`cargo test` 除了要求 LVS 乾淨，還故意把好的版圖弄壞（拿掉一個網路的繞線、多畫一條把兩個網路接起來的線、對調兩個 IO 標籤、
換掉一個元件），確定 LVS 每一種都抓得到。

## 流程做了什麼

1. **對應**：在多扇出點把網表切成樹，以最小面積覆蓋（反相器併入 NAND / NOR / AOI / OAI…）；SKY130 還會用
   3 輸入閘、AOI22 / OAI22、AO21 / OA21；扇出超過 12 的線插入緩衝器樹。
2. **佈局**：依利用率決定晶粒大小，IO 腳放在四周（輸入：左、上；輸出：右、下），模擬退火最小化線長加上密度懲罰；
   接著依關鍵路徑做時序導向的第二輪。SKY130 每列每 20 µm 放一個 well tap，空位放填充元件。
3. **時脈樹**：時脈（與非同步 reset）的負載依位置遞迴對半分，每群一個時脈緩衝器。
4. **全域繞線**、**hold 修正**、**電源網格**、**細部繞線**（每個格點只屬於一條線，所以不會短路；SKY130 另外遵守它的金屬規則）。
5. **時序與功耗**：以實際繞好的線長計算。

太擠繞不通時，流程會自動放大晶粒（降低利用率）重來；SKY130 細部繞線不乾淨時最多重試四次，每次換新的佈局種子。
所以 SKY130 的利用率常落在 30–55 %，大設計也比 vlib 慢（幾萬個元件要數分鐘）。

## 輸出檔

| 選項 | 內容 |
|---|---|
| `--verilog OUT.v` | 標準元件網表：元件與腳位用元件庫的名稱（SKY130：`sky130_fd_sc_hd__a21oi_1 … .A1(...)`），檔尾附上元件的行為模型（SKY130 的由 Liberty 函式產生），iverilog 可以直接模擬 |
| `--def OUT.def` | DEF：晶粒、列、元件位置與方向、填充元件與 tap、IO 腳、電源網路、每條線每一段與 via |
| `--gds OUT.gds` | （SKY130）GDSII 版圖：PDK 的元件版圖 + 繞線、via、電源、IO 腳與標籤 |
| `--spice OUT.sp` | （SKY130）SPICE 網表：設計的子電路，每個元件呼叫 PDK 的元件子電路（`.INCLUDE` PDK 的 `sky130hd.cdl`，有完整檔案時）；給 KLayout 的 LVS，或配上 PDK 的電晶體模型給 ngspice |
| `--map-only` | 只做元件對應，不佈局繞線（很大的設計只想要網表時） |

## 看晶片版圖

```sh
v2c asic --pdk sky130 --gds counter.gds counter.veryl
klayout counter.gds
```

GDS 用的是 SKY130 的層號：li1 67/20、met1 68/20、via 68/44、met2 69/20、via2 69/44、met3 70/20、via3 70/44、met4 71/20、
IO 腳在 met4（腳形 71/16、標籤 71/5）。網頁 IDE 的 ASIC · SKY130 也可以直接下載 `.gds`。

想自己再檢查一次 GDS（需要 `pip install klayout`）：

```sh
python3 tools/gds_check.py counter.gds Counter 62 555 7
```

後面三個數字是 `v2c` 寫 GDS 時印出的「cell instances、shapes、labels」。它用 KLayout 讀回，檢查頂層、元件數、
元件不重疊，並跑 KLayout 自己對 li1、met1–met4 與各 cut 層的寬度 / 間距檢查。

用 KLayout 再做一次獨立的 LVS（需要完整 SKY130 檔案裡的 `sky130hd.cdl`，見下一節）：

```sh
v2c asic --pdk sky130 --gds counter.gds --spice counter.sp counter.veryl
python3 tools/lvs_check.py counter.gds counter.sp
# KLayout LVS Counter: 14 cell instances, 19 nets extracted from the GDS: match
```

KLayout 從 GDS 的幾何與標籤（li1、met1–met5 與它們之間的 contact / via）自己抽出接線，和 SPICE 網表逐個網路比對。
標準元件當成黑盒子，只比它們的腳（元件內部的電晶體是 SkyWater 驗證過的）；比的是 veryl2chip 自己做的部分：元件之間的繞線。

## 用完整的 SKY130 檔案

```sh
tools/sky130.sh ~/sky130hd                 # 下載 Liberty、tech LEF、cell LEF、GDS、元件的 SPICE 子電路（Apache-2.0）
export VERYL_EDA_SKY130=~/sky130hd
v2c pdk                                     # 讀檔、列出各層與元件綁定
v2c asic --pdk sky130:$VERYL_EDA_SKY130 counter.veryl
```

`v2c pdk` 也是檢查工具：流程用到的每個元件，都會拿 Liberty 裡的函式比對真值表（正反器比對時脈邊緣、下一狀態、clear / preset），
不一致就拒絕使用。

## 限制

SKY130：只有典型一個角落；沒有 SRAM 巨集（記憶體很大的設計會很慢、很大）；沒有寬金屬間距表、天線規則；LVS 只比元件之間的接線（元件內部是 PDK 的）；
DRC 與 `gds_check.py` 檢查的是寬度、間距、短路、斷路與最小面積，不是完整的 SKY130 規則檔。
要真的投片，請再用 Magic / KLayout 的官方規則檔與 OpenROAD 的流程確認。
