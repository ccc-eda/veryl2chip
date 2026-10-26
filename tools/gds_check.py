# Read a GDS that veryl-eda wrote (--gds) with KLayout's Python module and
# check it: one top cell named after the design, the expected numbers of
# cell instances / routed shapes / labels, every placed cell defined (with
# its own geometry), and no two instances overlapping in a row (cell
# outlines from the PDK's standard-cell area layer 81/4), and KLayout's own
# width / spacing checks of li1, met1-met4 and the cut layers on the flattened layout.
#   python3 tools/gds_check.py OUT.gds DESIGN INSTANCES SHAPES LABELS
# (pip install klayout)
import sys
import klayout.db as db

path, design, n_inst, n_shapes, n_labels = sys.argv[1], sys.argv[2], *map(int, sys.argv[3:6])
ly = db.Layout()
ly.read(path)
bad = []
tops = [c for c in ly.top_cells()]
if len(tops) != 1 or tops[0].name != design: bad.append("top cells: %s" % [c.name for c in tops])
top = ly.cell(design)
insts = list(top.each_inst())
if len(insts) != n_inst: bad.append("%d instances, expected %d" % (len(insts), n_inst))
for i in insts:
    c = ly.cell(i.cell_index)
    if c.bbox().empty(): bad.append("cell %s has no geometry" % c.name)
# routed shapes (boxes) and labels in the top cell
boxes = texts = 0
for li in ly.layer_indexes():
    for s in top.shapes(li).each():
        if s.is_text(): texts += 1
        elif s.is_box() or s.is_polygon(): boxes += 1
if boxes != n_shapes + n_labels: bad.append("%d shapes, expected %d (+ %d pin shapes)" % (boxes, n_shapes, n_labels))
if texts != n_labels: bad.append("%d labels, expected %d" % (texts, n_labels))
# instances must not overlap (rows abut: compare the placement boxes shrunk by 1 nm)
boxes_i = sorted((i.bbox().left, i.bbox().bottom, i.bbox().right, i.bbox().top) for i in insts)
# cell outline: the standard-cell area layer (areaid.sc, 81/4) when present, else the bounding box
pr = ly.find_layer(81, 4)
def outline(i):
    c = ly.cell(i.cell_index)
    if pr is not None:
        b = c.bbox_per_layer(pr)
        if not b.empty(): return b.transformed(i.cplx_trans)
    return i.bbox()
rows = {}
for i in insts:
    b = outline(i)
    rows.setdefault(b.bottom, []).append((b.left, b.right))
overl = 0
for y, v in rows.items():
    v.sort()
    for a, b in zip(v, v[1:]):
        if b[0] < a[1]: overl += 1
if overl: bad.append("%d overlapping instances" % overl)
# KLayout's own width / spacing checks on the flattened layout (the cells and the routing together)
rules = {(67, 20): ("li1", 170, 170), (68, 20): ("met1", 140, 140), (69, 20): ("met2", 140, 140), (70, 20): ("met3", 300, 300),
         (71, 20): ("met4", 300, 300), (67, 44): ("mcon", 0, 190), (68, 44): ("via", 0, 170), (69, 44): ("via2", 0, 200), (70, 44): ("via3", 0, 200)}
drc = []
for (ln, dt), (name, width, space) in rules.items():
    li = ly.find_layer(ln, dt)
    if li is None: continue
    r = db.Region(top.begin_shapes_rec(li)).merged()
    n = r.space_check(space).count() if space else 0
    w = r.width_check(width).count() if width else 0
    if n or w: drc.append("%s: %d spacing, %d width" % (name, n, w))
if drc: bad.append("KLayout DRC " + ", ".join(drc))
print("gds: %s: %d instances, %d shapes, %d labels, %d rows%s" % (design, len(insts), boxes, texts, len(rows), "" if not bad else ": " + "; ".join(bad)))
sys.exit(1 if bad else 0)
