# 9. ASIC: `v2c asic`

```
v2c asic [--top MODULE] [--pdk vlib|sky130|sky130:DIR] [--seed N]
         [--verilog OUT.v] [--def OUT.def] [--gds OUT.gds] [--map-only] [-v] FILE.veryl...
```

Turn the design into a "standard-cell chip": cell mapping → row-based placement → clock tree → global and detailed routing → static timing → power and IR drop;
with SKY130 this adds design rule checking (DRC), layout versus schematic (LVS), antenna rules, a GDSII layout and a SPICE netlist.

## Two cell libraries

| | `--pdk vlib` (default) | `--pdk sky130` |
|---|---|---|
| What it is | The tutorial cell library defined by this project; its numbers are assumptions of "roughly 130 nm" | SkyWater's open-source process SKY130, the `sky130_fd_sc_hd` standard-cell library, the typical corner `tt_025C_1v80` |
| Row height / site | 4.0 µm / 0.5 µm | 2.72 µm / 0.46 µm (`unithd`) |
| Routing layers | M2–M5 (M1 is the cell pins) | met1–met4 (cell pins on li1); power rails on met1, power straps on met4 |
| Timing | Intrinsic delay + load per fanout | Liberty NLDM lookup tables (by input slew and load capacitance), slew propagated along the path |
| Memories | Those with synchronous reads become SRAM macros | Kept as flip-flops (no SRAM macros) |
| DRC, LVS, antenna rules, GDSII, SPICE | None | Yes |
| Good for | Understanding the flow, quick comparisons | Results on a real process, feeding other tools |

The SKY130 cells the flow needs ship with `v2c`; nothing else to download. `--pdk sky130:DIR` reads the full PDK files instead (see the end of this chapter).

## Reading the output

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

| Line | Meaning |
|---|---|
| `cells` | How many of each standard cell were used (SKY130 shows the library's real names) |
| `area / die` | Cell area, die size, number of rows, utilization (fraction of the die occupied by cells) |
| `wirelength … overflow` | Global routing: total wirelength, via count; `overflow` must be 0 |
| `power` | Power at Fmax (toggle rates from a random-input simulation) and the worst IR drop |
| `power grid` | Rails, straps, via stacks, filler cell count (SKY130 has at least one pair of straps joining every row's rails) |
| `DRC` | (SKY130) shorts, spacing, min-area and opens should all be 0; the tap count and sites too far from a tap |
| `LVS` | (SKY130) Rebuilds connectivity from the layout geometry alone and compares it with the netlist: opens, shorts and device mismatches should all be 0, and the last sentence should be `layout matches the netlist` |
| `antenna` | (SKY130) Antenna rules: how many pieces of gate-connected metal were checked, the violation count (should be 0), how close the worst piece is to its limit, how many diodes were inserted |
| `detailed routing` | Wirelength per layer; `conflicts` and `opens` should both be 0 |
| `clock tree` | Clock-tree buffer count, insertion delay, skew; the worst hold slack and the delay buffers used to fix it |
| `extraction` | (SKY130) Computes RC from the actual routed wires: how many nets, total wire capacitance, the longest wire delay; the final timing uses it |
| `timing` | The critical path and Fmax; also lists the Fmax with an ideal clock and with wirelength-only placement, so you can see the effect of timing-driven placement and the clock tree |

`-v` additionally prints every stage of the critical path (cell delays, wire delays) and examples of DRC violations; when LVS fails, examples are always printed.

### LVS (v2.33)

LVS (layout versus schematic) answers the question "is what the layout connects really the circuit the netlist describes?". The router records on every piece of metal which net it belongs to,
but LVS ignores those marks (otherwise it would just be checking the router against itself): it treats all metal, vias and cell pin shapes as conductors — pieces touching on the same layer are one conductor,
a via joins the layer below to the one above — and rebuilds the conductors from geometry; then it looks at which cell pins and which IO labels each conductor touches:

- Open: a net of the netlist is spread over several conductors
- Short: one conductor touches the pins of two nets
- Device mismatch: a device in the layout differs in type from the netlist's

Power works the same way: every cell's VPWR must form one connected piece, likewise VGND, and the two must not touch. The layout's VPWR / VGND labels are written on the first power strap.
Besides requiring a clean LVS, `cargo test` deliberately breaks the good layout in several ways (removing one net's routing, drawing an extra wire joining two nets, swapping two IO labels,
replacing one cell) to make sure LVS catches every one of them.

### Antenna rules (v2.34)

A chip is built layer by layer: when a metal layer is etched, the layers above it do not exist yet. A wire that only later gets connected to its driver through a higher layer
is, during that time, attached only to transistor gates; the charge accumulated during the process can punch through the thin gate oxide. So the PDK requires: for each "piece of metal connected together at that time" on a layer,
its side area (perimeter × thickness; for via layers, the area) divided by the gate area it connects to must not exceed a limit. When the metal also connects to a diffusion area (a driver cell's output, or a dedicated
diode) the charge has somewhere to go, and the limit is much larger (SKY130: 400 without a diffusion area, 2609 or more with one). The gate and diffusion areas come from the cell LEF's
`ANTENNAGATEAREA` / `ANTENNADIFFAREA`; the limits come from the tech LEF's `ANTENNADIFFSIDEAREARATIO` tables.

Next to a violating gate the flow inserts a `sky130_fd_sc_hd__diode_2` (just a diffusion area attached to that net, no logic function), reroutes and checks again;
if the routing got worse because of it, the diode is moved to another free spot and tried again (up to three spots), for at most twelve rounds (each reroute moves some wires, which may create new violations).
For example Ram un-fixed has 7 violating pieces on met2 / met3; after inserting 15 diodes there are 0, and timing is almost unchanged; rv32i's Alu has 2 pieces, 11 diodes bring it to 0.
The exceptions are Wide (its 200-bit operands come straight from more than 800 IO pins, the nets have no driver cell in the chip): from 82 pieces down to 2; and the very dense RiscvSoc:
each of its 8 pieces, when a diode is inserted, makes detailed routing produce conflicts, so the flow prefers to keep the routing clean (it will not trade shorts for antenna), and those 8 pieces are reported as they are.
When the router connects a diode to its net it sometimes uses higher layers, where the diode is not yet on the gate's conductor; to fix this completely, the router would have to connect the diode to the gate pin directly on low layers.
`VERYL_EDA_ANTENNA_FIX=0` turns the fixing off so you can see the original violations.

`tools/antenna_check.py` recomputes everything independently from the GDS with KLayout: gate areas from the real poly / diffusion overlaps inside the cell layouts, metal as merged polygons
built up layer by layer (`python3 tools/antenna_check.py counter.gds`). The two agree on the invariant "veryl2chip is not more lenient":
for the un-fixed Wide, KLayout finds 3 / 2 / 67 pieces on met2 / met3 / met4 where veryl2chip finds 4 / 5 / 73 (it sums the perimeters of overlapping shapes directly, which is slightly conservative).

### Timing constraints (v2.35)

Without constraints, STA only answers "how many MHz is the fastest it can run" (Fmax). Given timing constraints, it answers "at the frequency I want, how far off is each path":

```sh
v2c asic --pdk sky130 --clock 300 uart.veryl          # one 300 MHz clock, applied to everything
v2c asic --pdk sky130 --sdc uart.sdc uart.veryl       # a full constraint file
```

`uart.sdc` (a common subset of SDC, time unit ns):

```
create_clock -name clk -period 2 [get_ports i_clk]
set_input_delay 0.5 -clock clk [all_inputs]
set_output_delay 0.5 -clock clk [all_outputs]
set_false_path -from [get_ports i_rst]
```

One extra report line:

```
timing: constraints clk 2.000 ns (500.0 MHz, 61 endpoints): WNS -1.752 ns, TNS -38.383 ns, 61 of 72 endpoints failing (worst: DFFR D (c380))
```

- **Slack** = required time − actual arrival time; negative means the requirement was not met. For a flip-flop the requirement is "capture clock + period − setup", for an output pin "period − output delay".
- **WNS** (worst negative slack): the worst endpoint; **TNS** (total): the sum of all negative slacks, showing whether the problem is one path or a large area.
- `set_input_delay` makes inputs arrive later (time spent by the outside circuitry); `set_output_delay` makes outputs due earlier (time still needed by the outside circuitry).
- Inputs in `set_false_path -from` are not timed (e.g. an asynchronous reset button); outputs in `-to` are not checked.
  `set_multicycle_path N -from/-to` gives those paths N cycles.
- Each flip-flop is traced back through its clock pin (through the clock-tree buffers) to the pin named by `create_clock`, and uses that clock's period; a `create_clock` without a pin is a virtual clock for IO.

Limits: exceptions (false path, multicycle) can only name input pins and output pins. The netlist after synthesis and mapping is flattened and renamed, so there are no register names to name register-to-register paths.

### Timing closure (v2.36)

**Parasitic extraction**: after detailed routing, each net's resistance and capacitance are computed from the actual routed wires (the layer and length of each segment, every via; the LEF's per-layer R/sq, area capacitance,
fringe capacitance, and the vias' contact resistance), with Elmore delay from the driver to every load (each segment's resistance × all capacitance downstream of it). The final timing uses these numbers,
no longer the distance-based estimate (the `extraction` line).

**Timing repair**: when there are constraints and they are not met (WNS < 0), the flow tries to fix it:

- Cells on the critical path are swapped for stronger drives (e.g. `nand2_1` → `nand2_2` → `nand2_4`, only if a free spot is next door in the same row);
- Nets on the critical path with many loads get the loads not on the critical path moved behind a new buffer, so the critical path drives less.

Stronger cells also have larger input capacitance, which slows the previous stage, so not every change helps: each change is tried alone, and kept only if, after actually routing, extracting and timing it, the WNS improves
(very large designs use the global-routing estimate instead), and at the end of each round the routing is confirmed to be no worse. For example Ram at 450 MHz:

```
timing: constraints clk 2.222 ns (450.0 MHz, 128 endpoints): WNS +0.098 ns, TNS 0.000 ns, 0 of 136 endpoints failing, met
timing: repair 10 cells made stronger, 2 buffers: WNS -0.240 -> +0.098 ns
```

Paths that cannot be repaired are mostly logic that is simply too deep (e.g. UartLoop at 300 MHz only improves from −0.422 to −0.382 ns): those need a circuit change, such as adding a register stage.
Without constraints the flow does no repair, and the results are the same as before.

## What the flow does

1. **Mapping**: the netlist is cut into trees at high-fanout points and covered with minimum area (inverters folded into NAND / NOR / AOI / OAI…); on SKY130 it also uses
   3-input gates, AOI22 / OAI22, AO21 / OA21; nets with fanout over 12 get buffer trees inserted.
2. **Placement**: the die size follows the utilization; IO pins go on the edges (inputs: left, top; outputs: right, bottom); simulated annealing minimizes wirelength plus a density penalty;
   then a timing-driven second round follows the critical path. On SKY130 one well tap every 20 µm per row, and filler cells in the gaps.
3. **Clock tree**: the loads of the clock (and the asynchronous reset) are recursively halved by position, one clock buffer per group.
4. **Global routing**, **hold fixing**, **power grid**, **detailed routing** (each track point belongs to only one wire, so no shorts; on SKY130 it additionally obeys its metal rules).
5. **Timing and power**: computed from the actual routed wirelengths.

When it is too crowded to route, the flow automatically enlarges the die (lowering the utilization) and retries; if SKY130 detailed routing is not clean it retries up to four times, each time with a new placement seed.
That is why SKY130 utilization usually lands at 30–55 %, and large designs are slower than vlib (tens of thousands of cells take several minutes).

## Output files

| Option | Contents |
|---|---|
| `--verilog OUT.v` | Standard-cell netlist: cells and pins use the library's names (SKY130: `sky130_fd_sc_hd__a21oi_1 … .A1(...)`), with behavioral models of the cells appended at the end (SKY130's generated from the Liberty functions), so iverilog can simulate it directly |
| `--def OUT.def` | DEF: die, rows, cell positions and orientations, filler cells and taps, IO pins, power nets, and every wire segment and via |
| `--gds OUT.gds` | (SKY130) GDSII layout: the PDK's cell layouts + routing, vias, power, IO pins and labels |
| `--spice OUT.sp` | (SKY130) SPICE netlist: the design as a subcircuit, each cell calling the PDK's cell subcircuit (`.INCLUDE` the PDK's `sky130hd.cdl`, when the full files are present); for KLayout's LVS, or with the PDK's transistor models for ngspice |
| `--map-only` | Cell mapping only, no place & route (when you only want the netlist of a very large design) |

## Looking at the chip layout

```sh
v2c asic --pdk sky130 --gds counter.gds counter.veryl
klayout counter.gds
```

The GDS uses SKY130's layer numbers: li1 67/20, met1 68/20, via 68/44, met2 69/20, via2 69/44, met3 70/20, via3 70/44, met4 71/20;
IO pins on met4 (pin shape 71/16, label 71/5). The web IDE's ASIC · SKY130 can also download the `.gds` directly.

To double-check the GDS yourself (needs `pip install klayout`):

```sh
python3 tools/gds_check.py counter.gds Counter 62 555 7
```

The last three numbers are the "cell instances, shapes, labels" that `v2c` prints when it writes the GDS. It reads it back with KLayout, checks the top cell, the cell count,
that cells do not overlap, and runs KLayout's own width / spacing checks on li1, met1–met4 and the cut layers.

To do an independent LVS again with KLayout (needs the `sky130hd.cdl` from the full SKY130 files, see the next section):

```sh
v2c asic --pdk sky130 --gds counter.gds --spice counter.sp counter.veryl
python3 tools/lvs_check.py counter.gds counter.sp
# KLayout LVS Counter: 14 cell instances, 19 nets extracted from the GDS: match
```

KLayout extracts the connectivity itself from the GDS geometry and labels (li1, met1–met5 and the contacts / vias between them) and compares it net by net with the SPICE netlist.
Standard cells are black boxes; only their pins are compared (the transistors inside them are verified by SkyWater); what is compared is the part veryl2chip made itself: the routing between the cells.

## Using the full SKY130 files

```sh
tools/sky130.sh ~/sky130hd                 # downloads Liberty, tech LEF, cell LEF, GDS, cell SPICE subcircuits (Apache-2.0)
export VERYL_EDA_SKY130=~/sky130hd
v2c pdk                                     # reads the files, lists the layers and cell bindings
v2c asic --pdk sky130:$VERYL_EDA_SKY130 counter.veryl
```

`v2c pdk` is also a checking tool: for every cell the flow uses, its truth table is compared against the Liberty function (for flip-flops: clock edge, next state, clear / preset);
on a mismatch the cell is refused.

## Limits

SKY130: only the typical corner; no SRAM macros (designs with a lot of memory are slow and large); no wide-metal spacing tables; LVS compares only the wiring between cells (inside the cells it is the PDK's); antenna rules consider only OXIDE1 (the usual gate oxide);
DRC and `gds_check.py` check width, spacing, shorts, opens and min-area, not the full SKY130 rule deck.
For a real tape-out, please verify again with Magic / KLayout's official rule decks and OpenROAD's flow.
