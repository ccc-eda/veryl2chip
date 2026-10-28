"""Independent LVS of a veryl2chip SKY130 layout with KLayout: the GDS
(v2c asic --pdk sky130 --gds) against the SPICE netlist (--spice).

KLayout extracts the connectivity from the GDS geometry and its labels alone
(li1, met1-met5 and their contacts / vias), hierarchically: each standard cell
is a black box whose pins are its labelled shapes, the cells themselves being
the PDK's (verified by SkyWater). The top level, the routing between the
cells that veryl2chip made, is compared net by net with the netlist, whose
cells are the PDK's CDL subcircuits (also black boxes here). The wells (VPB,
VNB) are not extracted: they are tied to VPWR / VGND inside the cells.

  python tools/lvs_check.py DESIGN.gds DESIGN.sp [TOP]
  (a Python with KLayout's module: pip install klayout; exit status 1 on a mismatch)
"""
import sys

import klayout.db as db

gds, spice = sys.argv[1], sys.argv[2]
ly = db.Layout()
ly.read(gds)
top = ly.cell(sys.argv[3]) if len(sys.argv) > 3 else ly.top_cell()

lvs = db.LayoutVsSchematic(db.RecursiveShapeIterator(ly, top, []))
# SKY130 GDS layers: (layer, drawing datatype); labels are datatype 5, pin shapes datatype 16
CONDUCTORS = [("li1", 67), ("met1", 68), ("met2", 69), ("met3", 70), ("met4", 71), ("met5", 72)]
CUTS = [("mcon", 67, 44), ("via", 68, 44), ("via2", 69, 44), ("via3", 70, 44), ("via4", 71, 44)]
metal, text = [], []
for name, l in CONDUCTORS:
    m = lvs.make_polygon_layer(ly.layer(l, 20), name) + lvs.make_polygon_layer(ly.layer(l, 16), name + "_pin")
    lvs.register(m, name + "_all")
    metal.append(m)
    t = lvs.make_text_layer(ly.layer(l, 5), name + "_txt")
    text.append(t)
cuts = [lvs.make_polygon_layer(ly.layer(l, d), n) for n, l, d in CUTS]
for m, t in zip(metal, text):
    lvs.connect(m)
    lvs.connect(m, t)
for i, c in enumerate(cuts):
    lvs.connect(c)
    lvs.connect(metal[i], c)
    lvs.connect(c, metal[i + 1])
lvs.extract_netlist()
extracted = lvs.netlist()

# the reference: the design's subcircuit calling the PDK's cells
ref = db.Netlist()
ref.read(spice, db.NetlistSpiceReader())
lvs.reference = ref

ref_top = ref.circuit_by_name(top.name.upper()) or ref.circuit_by_name(top.name)
if ref_top is None:
    sys.exit(f"{spice}: no subcircuit {top.name}")
# the cells the netlist uses; the layout's others (fillers, taps: no transistors, no signal pins)
# are flattened into the top, the library's unused cells dropped
used = {sc.circuit_ref().name.upper() for sc in ref_top.each_subcircuit()}
for c in list(extracted.each_circuit()):
    if c.name.upper() not in used and c.name != top.name:
        extracted.flatten_circuit(c)
for c in list(ref.each_circuit()):
    if c.name.upper() not in used and c is not ref_top:
        ref.remove(c)
# the standard cells are black boxes on both sides: only their pins count; the wells (VNB, VPB) are
# not extracted, so they leave the reference cells (the netlist ties them to VGND / VPWR anyway)
for c in list(ref.each_circuit()):
    if c is ref_top:
        continue
    for name in ("VNB", "VPB"):
        p = c.pin_by_name(name)
        if p is None:
            continue
        for sc in c.each_ref():
            sc.disconnect_pin(p)
        c.remove_pin(p.id())
for nl in (extracted, ref):
    for c in nl.each_circuit():
        if c.name.upper() != top.name.upper():
            c.blank()

comp = db.NetlistComparer()
ok = lvs.compare(comp)
xref = lvs.xref()
bad = []
for cp in xref.each_circuit_pair():
    if cp.status() not in (db.NetlistCrossReference.Match, db.NetlistCrossReference.MatchWithWarning):
        bad.append(f"circuit {cp.first().name if cp.first() else '-'} / {cp.second().name if cp.second() else '-'}: {cp.status()}")
    for np_ in xref.each_net_pair(cp):
        if np_.status() not in (db.NetlistCrossReference.Match, db.NetlistCrossReference.MatchWithWarning):
            bad.append(f"  net {np_.first().expanded_name() if np_.first() else '-'} / {np_.second().expanded_name() if np_.second() else '-'}: {np_.status()}")
t = extracted.circuit_by_name(top.name)
nets = sum(1 for _ in t.each_net()) if t else 0
insts = sum(1 for _ in t.each_subcircuit()) if t else 0
print(f"KLayout LVS {top.name}: {insts} cell instances, {nets} nets extracted from the GDS: {'match' if ok else 'MISMATCH'}")
for b in bad[:20]:
    print(b)
sys.exit(0 if ok else 1)
