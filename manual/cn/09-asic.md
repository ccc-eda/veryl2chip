# 9. ASIC：`v2c asic`

```
v2c asic [--top MODULE] [--pdk vlib|sky130|sky130:DIR] [--seed N]
         [--verilog OUT.v] [--def OUT.def] [--gds OUT.gds] [--map-only] [-v] FILE.veryl...
```

把设计做成「标准单元芯片」：单元对应 → 行式布局 → 时钟树 → 全局与详细布线 → 静态时序 → 功耗与 IR drop；
用 SKY130 时再加上设计规则检查（DRC）、版图与电路比对（LVS）、天线规则、GDSII 版图与 SPICE 网表。

## 两种单元库

| | `--pdk vlib`（默认） | `--pdk sky130` |
|---|---|---|
| 是什么 | 本项目自己定的教学单元库，数字是「大约 130 nm」的假设值 | SkyWater 的开源制程 SKY130、`sky130_fd_sc_hd` 标准单元库、典型角落 `tt_025C_1v80` |
| 行高 / site | 4.0 µm / 0.5 µm | 2.72 µm / 0.46 µm（`unithd`） |
| 布线层 | M2–M5（M1 是单元引脚） | met1–met4（单元引脚在 li1）；电源轨 met1、电源带 met4 |
| 时序 | 本征延迟 + 每扇出负载 | Liberty 的 NLDM 查表（依输入斜率与负载电容），斜率沿路径传递 |
| 存储器 | 同步读取的变成 SRAM 宏 | 维持触发器（没有 SRAM 宏） |
| DRC、LVS、天线规则、GDSII、SPICE | 无 | 有 |
| 适合 | 看懂流程、快速比较 | 真实制程的结果、拿去给其他工具 |

需要的 SKY130 单元已经随 `v2c` 附上，不用另外下载。`--pdk sky130:目錄` 改读完整的 PDK 文件（见本章最后）。

## 读懂输出

```
asic: technology sky130_fd_sc_hd (2.72 µm rows, 0.46 µm sites)
  cells: 14
    sky130_fd_sc_hd__and2_1 2
    sky130_fd_sc_hd__dfrtp_1 4
    ...
asic: area 187.7 µm² (cells), die 17.9 × 19.0 µm, 7 rows, utilization 55%, ...
asic: wirelength 186 µm, 71 vias, overflow 0 after 1 routing iterations
power: 0.057 mW at 752.6 MHz = dynamic 0.057 + leakage 0.0000; ...
asic: power grid 8 rails, 2 straps, 8 via stacks; 31 filler cells
asic: DRC 2022 shapes: 0 shorts, 0 spacing, 0 min-area, 0 opens; 11 taps (0 sites too far)
asic: LVS 19 nets, 170 terminals, 14 devices: 0 opens, 0 shorts, 0 device errors, layout matches the netlist (19 pieces, 0 floating)
asic: antenna 197 pieces with gates checked: 0 violations (worst 11% of its limit); 0 diodes inserted
asic: detailed routing 267 µm (met1 56 / met2 132 / met3 51 / met4 29), 142 vias, 0 conflicts, 0 opens after 3 iterations
asic: clock tree 0 buffers (), insertion 0.000 ns, skew 0.000 ns; hold: worst slack 0.341 ns, 0 delay buffers
asic: extraction 17 nets from the detailed routing: 0.018 pF of wire, the longest wire delay 0.2 ps
timing: critical path 1.329 ns, Fmax 752.6 MHz (8 endpoints; ideal clock 756.3 MHz, wirelength-only placement 751.1 MHz)
```

| 行 | 意思 |
|---|---|
| `cells` | 每种标准单元用了几个（SKY130 显示单元库的真实名称） |
| `area / die` | 单元面积、裸片大小、列数、利用率（单元占裸片的比例） |
| `wirelength … overflow` | 全局布线：总线长、via 数；`overflow` 必须是 0 |
| `power` | 在 Fmax 下的功耗（随机输入仿真得到的翻转率）与最差 IR drop |
| `power grid` | 电源轨、电源带、via 堆栈、填充单元数（SKY130 至少一对电源带，把每一列的电源轨接在一起） |
| `DRC` | （SKY130）短路、间距、最小面积、断路都应该是 0；well tap 数与离 tap 太远的 site |
| `LVS` | （SKY130）只从版图的几何重建接线，和网表比对：断路、短路、单元不符都应该是 0，最后一句是 `layout matches the netlist` |
| `antenna` | （SKY130）天线规则：检查了几块接到门极的金属、违规数（应该是 0）、最接近上限的一块是上限的百分之几、插了几个 diode |
| `detailed routing` | 每层的线长；`conflicts` 与 `opens` 都应该是 0 |
| `clock tree` | 时钟树缓冲器数、插入延迟、skew；hold 最差余裕与修正用的延迟缓冲器 |
| `extraction` | （SKY130）从详细布线实际画出的线算 RC：几条网络、总线电容、最长的线延迟；最后的时序用它 |
| `timing` | 关键路径与 Fmax；也列出理想时钟下与只看线长的布局下的 Fmax，看得出时序导向与时钟树的影响 |

`-v` 另外打印关键路径的每一级（单元延迟、线延迟）与 DRC 违规的例子；LVS 有错时一定会列出例子。

### LVS（v2.33）

LVS（layout versus schematic）回答「版图接起来的，真的是网表说的电路吗？」。布线器在每块金属上记了它属于哪个网络，
但 LVS 不看这些记号（不然只是拿布线器检查自己）：它把所有金属、via、单元的引脚形状当成导体，同一层碰在一起的是同一块，
via 接起上下两层，重建出一块一块的导体；再看每块导体碰到哪些单元的引脚、哪些 IO 标签：

- 断路（open）：网表里的一个网络分散在好几块导体上
- 短路（short）：一块导体碰到两个网络的引脚
- 单元不符：版图上的单元和网表的单元类型不同

电源也一样：每个单元的 VPWR 必须连成一块、VGND 一块，而且两块不相连。版图的 VPWR、VGND 标签写在第一条电源带上。
`cargo test` 除了要求 LVS 干净，还故意把好的版图弄坏（拿掉一个网络的布线、多画一条把两个网络接起来的线、对调两个 IO 标签、
换掉一个单元），确定 LVS 每一种都抓得到。

### 天线规则（v2.34）

芯片是一层一层做上去的：蚀刻某一层金属时，上面的层还不存在。一条之后才会经由上层接到驱动它的单元的线，在那段时间里
只接着晶体管的门极；制程中累积的电荷会打穿很薄的门极氧化层。所以 PDK 规定：每一层「那时候连在一起的一块金属」，
它的侧面积（周长 × 厚度；via 层看面积）除以它接到的门极面积，不能超过上限。接到扩散区（驱动单元的输出、或专门的
diode）时电荷有地方去，上限就大很多（SKY130：没有扩散区 400，有的话 2609 以上）。门极与扩散区面积来自单元 LEF
的 `ANTENNAGATEAREA` / `ANTENNADIFFAREA`，上限来自 tech LEF 的 `ANTENNADIFFSIDEAREARATIO` 表。

违规的门极旁边会插一个 `sky130_fd_sc_hd__diode_2`（只是一块接在那个网络上的扩散区，没有逻辑功能），重新布线，再检查；
布线若因此变差，就把 diode 换到别的空位再试（最多三处），最多十二轮（每次重新布线会让一些线移动，可能有新的违规）。
例如 Ram 不修时 met2 / met3 有 7 块违规，插 15 个 diode 后是 0，时序几乎不变；rv32i 的 Alu 2 块、插 11 个后是 0。
例外是 Wide（200 位的操作数直接来自 800 多支 IO 引脚，网络在芯片里没有驱动单元）：从 82 块降到 2 块；以及很密的 RiscvSoc：
它的 8 块每次插 diode 都让详细布线多出冲突，流程宁可保留干净的布线（不拿短路换天线），这 8 块就照实报告。
布线器把 diode 接上网络时有时走较高的层，那时 diode 还不在门极那一块上；要完全解决，得让布线器用低层把 diode 直接接到门极引脚。
`VERYL_EDA_ANTENNA_FIX=0` 可以关掉修正，看原本的违规。

`tools/antenna_check.py` 用 KLayout 从 GDS 独立再算一次：门极面积用单元版图里真正的 poly 与扩散区重叠，金属用合并后的多边形，
一层一层盖上去检查（`python3 tools/antenna_check.py counter.gds`）。两边的结果一致于「veryl2chip 不会比较宽松」：
不修的 Wide，KLayout 在 met2 / met3 / met4 找到 3 / 2 / 67 块，veryl2chip 找到 4 / 5 / 73 块（它把重叠形状的周长直接加总，略为保守）。

### 时序约束（v2.35）

没有约束时，STA 只回答「最快能跑多少 MHz」（Fmax）。给了时序约束，它回答的是「在我要的频率下，每条路径还差多少」：

```sh
v2c asic --pdk sky130 --clock 300 uart.veryl          # 一個 300 MHz 的時脈，套用到全部
v2c asic --pdk sky130 --sdc uart.sdc uart.veryl       # 完整的約束檔
```

`uart.sdc`（SDC 的常用子集，时间单位 ns）：

```
create_clock -name clk -period 2 [get_ports i_clk]
set_input_delay 0.5 -clock clk [all_inputs]
set_output_delay 0.5 -clock clk [all_outputs]
set_false_path -from [get_ports i_rst]
```

报告多一行：

```
timing: constraints clk 2.000 ns (500.0 MHz, 61 endpoints): WNS -1.752 ns, TNS -38.383 ns, 61 of 72 endpoints failing (worst: DFFR D (c380))
```

- **余裕（slack）** = 要求的时间 − 实际到达的时间；负的就是没达成。触发器的要求是「接收时钟 + 周期 − setup」，输出引脚是「周期 − 输出延迟」。
- **WNS**（worst negative slack）：最差的那个端点；**TNS**（total）：所有负余裕加总，看得出问题是一条路径还是一大片。
- `set_input_delay` 让输入晚一点才到（外面的电路用掉的时间）；`set_output_delay` 让输出早一点要交（外面还需要的时间）。
- `set_false_path -from` 的输入不算时序（例如异步的 reset 按钮）；`-to` 的输出不检查。
  `set_multicycle_path N -from/-to` 给那些路径 N 个周期。
- 每个触发器依它的时钟引脚追回 `create_clock` 指定的引脚（经过时钟树的缓冲器），用那个时钟的周期；没有引脚的 `create_clock` 是给 IO 用的虚拟时钟。

限制：例外（false path、multicycle）只能指定输入引脚、输出引脚。综合与对应之后的网表已经摊平、改了名字，没有寄存器名称可以指定寄存器之间的路径。

### 时序收敛（v2.36）

**寄生萃取**：详细布线之后，每条网络依实际画出的线（每一段的层、长度，每个 via）算出电阻与电容（LEF 的每层 R/□、面积电容、
边缘电容，via 的接触电阻），从驱动端到每个负载用 Elmore 延迟（沿路每段电阻 × 它下游的全部电容）。最后的时序用这些数字，
不再用依距离的估计（`extraction` 那一行）。

**时序修正**：有约束而且没达成（WNS < 0）时，流程会试着修：

- 关键路径上的单元换成驱动力较强的版本（例如 `nand2_1` → `nand2_2` → `nand2_4`，同一列旁边有空位才换）；
- 关键路径上负载很多的网络，把不在关键路径上的负载移到一个新的缓冲器后面，让关键路径推的负载变轻。

较强的单元输入电容也较大，会让前一级变慢，所以不是每个改动都有用：每个改动单独试，实际布线、萃取、算时序后有改善才保留
（很大的设计改用全局布线的估计），每一轮结束再确认布线没有变差。例如 Ram 在 450 MHz：

```
timing: constraints clk 2.222 ns (450.0 MHz, 128 endpoints): WNS +0.098 ns, TNS 0.000 ns, 0 of 136 endpoints failing, met
timing: repair 10 cells made stronger, 2 buffers: WNS -0.240 -> +0.098 ns
```

修不了的路径主要是逻辑太深（例如 UartLoop 在 300 MHz 只从 −0.422 改善到 −0.382 ns）：那要改电路本身，例如加一级寄存器。
没有给约束时流程不做修正，结果和以前一样。

## 流程做了什么

1. **对应**：在多扇出点把网表切成树，以最小面积覆盖（反相器并入 NAND / NOR / AOI / OAI…）；SKY130 还会用
   3 输入门、AOI22 / OAI22、AO21 / OA21；扇出超过 12 的线插入缓冲器树。
2. **布局**：依利用率决定裸片大小，IO 引脚放在四周（输入：左、上；输出：右、下），模拟退火最小化线长加上密度惩罚；
   接着依关键路径做时序导向的第二轮。SKY130 每列每 20 µm 放一个 well tap，空位放填充单元。
3. **时钟树**：时钟（与异步 reset）的负载依位置递归对半分，每群一个时钟缓冲器。
4. **全局布线**、**hold 修正**、**电源网格**、**详细布线**（每个格点只属于一条线，所以不会短路；SKY130 另外遵守它的金属规则）。
5. **时序与功耗**：以实际布好的线长计算。

太挤布不通时，流程会自动放大裸片（降低利用率）重来；SKY130 详细布线不干净时最多重试四次，每次换新的布局种子。
所以 SKY130 的利用率常落在 30–55 %，大设计也比 vlib 慢（几万个单元要数分钟）。

## 输出档

| 选项 | 内容 |
|---|---|
| `--verilog OUT.v` | 标准单元网表：单元与引脚用单元库的名称（SKY130：`sky130_fd_sc_hd__a21oi_1 … .A1(...)`），档尾附上单元的行为模型（SKY130 的由 Liberty 函数产生），iverilog 可以直接仿真 |
| `--def OUT.def` | DEF：裸片、列、单元位置与方向、填充单元与 tap、IO 引脚、电源网络、每条线每一段与 via |
| `--gds OUT.gds` | （SKY130）GDSII 版图：PDK 的单元版图 + 布线、via、电源、IO 引脚与标签 |
| `--spice OUT.sp` | （SKY130）SPICE 网表：设计的子电路，每个单元调用 PDK 的单元子电路（`.INCLUDE` PDK 的 `sky130hd.cdl`，有完整文件时）；给 KLayout 的 LVS，或配上 PDK 的晶体管模型给 ngspice |
| `--map-only` | 只做单元对应，不布局布线（很大的设计只想要网表时） |

## 看芯片版图

```sh
v2c asic --pdk sky130 --gds counter.gds counter.veryl
klayout counter.gds
```

GDS 用的是 SKY130 的层号：li1 67/20、met1 68/20、via 68/44、met2 69/20、via2 69/44、met3 70/20、via3 70/44、met4 71/20、
IO 引脚在 met4（引脚形 71/16、标签 71/5）。网页 IDE 的 ASIC · SKY130 也可以直接下载 `.gds`。

想自己再检查一次 GDS（需要 `pip install klayout`）：

```sh
python3 tools/gds_check.py counter.gds Counter 62 555 7
```

后面三个数字是 `v2c` 写 GDS 时打印的「cell instances、shapes、labels」。它用 KLayout 读回，检查顶层、单元数、
单元不重叠，并跑 KLayout 自己对 li1、met1–met4 与各 cut 层的宽度 / 间距检查。

用 KLayout 再做一次独立的 LVS（需要完整 SKY130 文件里的 `sky130hd.cdl`，见下一节）：

```sh
v2c asic --pdk sky130 --gds counter.gds --spice counter.sp counter.veryl
python3 tools/lvs_check.py counter.gds counter.sp
# KLayout LVS Counter: 14 cell instances, 19 nets extracted from the GDS: match
```

KLayout 从 GDS 的几何与标签（li1、met1–met5 与它们之间的 contact / via）自己抽出接线，和 SPICE 网表逐个网络比对。
标准单元当成黑盒子，只比它们的引脚（单元内部的晶体管是 SkyWater 验证过的）；比的是 veryl2chip 自己做的部分：单元之间的布线。

## 用完整的 SKY130 文件

```sh
tools/sky130.sh ~/sky130hd                 # 下載 Liberty、tech LEF、cell LEF、GDS、元件的 SPICE 子電路（Apache-2.0）
export VERYL_EDA_SKY130=~/sky130hd
v2c pdk                                     # 讀檔、列出各層與元件綁定
v2c asic --pdk sky130:$VERYL_EDA_SKY130 counter.veryl
```

`v2c pdk` 也是检查工具：流程用到的每个单元，都会拿 Liberty 里的函数比对真值表（触发器比对时钟边缘、下一状态、clear / preset），
不一致就拒绝使用。

## 限制

SKY130：只有典型一个角落；没有 SRAM 宏（存储器很大的设计会很慢、很大）；没有宽金属间距表；LVS 只比单元之间的接线（单元内部是 PDK 的）；天线规则只算 OXIDE1（一般的门极）；
DRC 与 `gds_check.py` 检查的是宽度、间距、短路、断路与最小面积，不是完整的 SKY130 规则档。
要真的投片，请再用 Magic / KLayout 的官方规则档与 OpenROAD 的流程确认。
