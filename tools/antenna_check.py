"""Independent antenna check of a veryl2chip SKY130 layout with KLayout.

veryl2chip's own check (asic/antenna.rs) uses the gate areas from the cells'
LEF abstracts and adds up its shapes' perimeters. This one starts from the GDS:
the gates are the transistors' real poly over diffusion, the metal its merged
polygons. The layout is built up layer by layer (li1, met1, ... met5, each
with the contacts / vias below it), and at each layer every piece of that
layer reaching gates but no source / drain diffusion is checked against the
SKY130 limit of its side area (perimeter x thickness) per gate area: 75 for
li1, 400 for metal (the technology LEF's ANTENNADIFFSIDEAREARATIO at zero
diffusion). A piece reaching diffusion (a driver's output, a diode) is not
checked here: its limit is at least 2609, far above anything a router makes.

  python tools/antenna_check.py DESIGN.gds [TOP]
  (a Python with KLayout's module; exit status 1 when a piece breaks the rule)
"""
import sys

import klayout.db as db

gds = sys.argv[1]
ly = db.Layout()
ly.read(gds)
top = ly.cell(sys.argv[2]) if len(sys.argv) > 2 else ly.top_cell()

# SKY130 GDS layers (drawing; pin shapes are datatype 16) and thickness (µm)
METALS = [("li1", 67, 0.1, 75.0), ("met1", 68, 0.35, 400.0), ("met2", 69, 0.35, 400.0), ("met3", 70, 0.8, 400.0), ("met4", 71, 0.8, 400.0), ("met5", 72, 1.2, 400.0)]
CUTS = [(67, 44), (68, 44), (69, 44), (70, 44), (71, 44)]   # mcon, via, via2, via3, via4: below met1 .. met5

total = 0
report = []
for stage in range(len(METALS)):
    l2n = db.LayoutToNetlist(db.RecursiveShapeIterator(ly, top, []))
    poly = l2n.make_polygon_layer(ly.layer(66, 20), "poly")
    diff = l2n.make_polygon_layer(ly.layer(65, 20), "diff")
    licon = l2n.make_polygon_layer(ly.layer(66, 44), "licon")
    gate = poly & diff
    sd = diff - poly
    l2n.register(gate, "gate")
    l2n.register(sd, "sd")
    metals = []
    for name, l, t, r in METALS[: stage + 1]:
        m = l2n.make_polygon_layer(ly.layer(l, 20), name) + l2n.make_polygon_layer(ly.layer(l, 16), name + "_pin")
        l2n.register(m, name + "_all")
        metals.append(m)
    cuts = [l2n.make_polygon_layer(ly.layer(l, d), f"cut{l}") for l, d in CUTS[:stage]]
    # the gates through the poly, the source / drain diffusion and the poly up through licon to li1
    for a, b in ((gate, poly), (poly, licon), (sd, licon), (licon, metals[0])):
        l2n.connect(a)
        l2n.connect(a, b)
    l2n.connect(metals[0])
    for i, c in enumerate(cuts):
        l2n.connect(c)
        l2n.connect(metals[i], c)
        l2n.connect(c, metals[i + 1])
        l2n.connect(metals[i + 1])
    l2n.extract_netlist()
    name, _, thick, ratio = METALS[stage]
    # side area of this layer's piece / gate area; a piece with any source / drain diffusion is exempt
    bad = l2n.antenna_check(gate, 1.0, 0.0, metals[stage], 0.0, thick, ratio, [[sd, 1e9]])
    # the pieces (nets) the violating polygons belong to
    nets = set()
    for p in bad.each():
        c = p.bbox().center()
        pt = c if p.inside(c) else next(p.each_point_hull())
        net = l2n.probe_net(metals[stage], db.DPoint(pt.x * ly.dbu, pt.y * ly.dbu))
        nets.add(net.cluster_id if net else ("?", pt.x, pt.y))
    n = len(nets)
    total += n
    report.append(f"{name} {n}")
print(f"KLayout antenna {top.name}: {total} pieces over the limit ({', '.join(report)})")
sys.exit(1 if total else 0)
