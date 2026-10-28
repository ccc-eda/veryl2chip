# The SKY130 cells veryl-eda's ASIC flow uses, cut out of the full PDK files
# into veryl-eda/pdk/sky130hd/ (built into the program, also the web page).
#   tools/sky130.sh                 # downloads the full files (OpenROAD-flow-scripts platforms/sky130hd)
#   python3 tools/sky130_subset.py /path/to/sky130hd veryl-eda/pdk/sky130hd
# Liberty: the library header and the listed cells, without power tables
# (internal_power, leakage_power per state) to keep it small. LEF: the tech
# LEF as it is, and the listed MACROs. GDS: the listed cells' structures.
import os, re, struct, sys

CELLS = """inv_1 inv_2 inv_4 buf_1 buf_2 buf_4 buf_8 clkbuf_1 clkbuf_2 clkbuf_4 clkbuf_8 nand2_1 nor2_1 and2_1 or2_1 xor2_1
xnor2_1 a21oi_1 o21ai_1 mux2_1 nand3_1 nor3_1 and3_1 or3_1 a22oi_1 o22ai_1 a21o_1 o21a_1 conb_1 dfxtp_1 dfrtp_1 dfstp_1 dfrtn_1 diode_2 fill_1 fill_2 fill_4 fill_8 tapvpwrvgnd_1
decap_3 decap_4 decap_6 decap_8 decap_12""".split()
PRE = "sky130_fd_sc_hd__"
names = [PRE + c for c in CELLS]
src, dst = sys.argv[1], sys.argv[2]
os.makedirs(dst, exist_ok=True)

def group_end(s, i):
    """index after the '}' closing the group whose '{' is at or after i"""
    i = s.index("{", i)
    depth = 0
    while True:
        c = s[i]
        if c == "{": depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0: return i + 1
        elif c == '"':
            i = s.index('"', i + 1)
        i += 1

def drop_groups(s, kinds):
    out, i = [], 0
    rx = re.compile(r"^\s*(%s)\s*\([^)]*\)\s*\{" % "|".join(kinds), re.M)
    while True:
        m = rx.search(s, i)
        if not m: out.append(s[i:]); break
        out.append(s[i:m.start()])
        i = group_end(s, m.start())
    return "".join(out)

lib = open(os.path.join(src, "sky130_fd_sc_hd__tt_025C_1v80.lib")).read()
first = lib.index('cell ("')
head = lib[:first]
cells = []
for n in names:
    m = re.search(r'^\s*cell \("%s"\)' % n, lib, re.M)
    if not m: continue
    body = lib[m.start():group_end(lib, m.start())]
    cells.append(drop_groups(body, ["internal_power", "leakage_power"]))
out = head + "\n".join(cells) + "\n}\n"
out = re.sub(r"[ \t]+\n", "\n", out)
open(os.path.join(dst, "sky130_fd_sc_hd__tt_025C_1v80.lib"), "w").write(out)

tlef = open(os.path.join(src, "sky130_fd_sc_hd.tlef")).read()
open(os.path.join(dst, "sky130_fd_sc_hd.tlef"), "w").write(tlef)
lef = open(os.path.join(src, "sky130_fd_sc_hd_merged.lef")).read()
blocks = []
for n in names:
    m = re.search(r"^MACRO %s\n.*?^END %s\n" % (n, n), lef, re.M | re.S)
    if m: blocks.append(m.group(0))
hdr = "VERSION 5.7 ;\nBUSBITCHARS \"[]\" ;\nDIVIDERCHAR \"/\" ;\n\n"
open(os.path.join(dst, "sky130_fd_sc_hd.lef"), "w").write(hdr + "\n".join(blocks) + "\nEND LIBRARY\n")

# GDS: header records, then the structures (BGNSTR .. ENDSTR) of the listed cells
gds = open(os.path.join(src, "sky130_fd_sc_hd.gds"), "rb").read()
recs, i = [], 0
while i + 4 <= len(gds):
    ln, rt = struct.unpack(">HH", gds[i:i + 4])
    if ln < 4: break
    recs.append((rt >> 8, gds[i:i + ln]))
    i += ln
outb, k, keep_names = bytearray(), 0, set(names)
while k < len(recs) and recs[k][0] != 0x05: outb += recs[k][1]; k += 1   # HEADER, BGNLIB, LIBNAME, UNITS
while k < len(recs):
    t, raw = recs[k]
    if t == 0x05:  # BGNSTR
        j = k
        while recs[j][0] != 0x07: j += 1  # ENDSTR
        sname = recs[k + 1][1][4:].rstrip(b"\0").decode()
        if sname in keep_names:
            for r in recs[k:j + 1]: outb += r[1]
        k = j + 1
    else:
        if t == 0x04: outb += raw  # ENDLIB
        k += 1
open(os.path.join(dst, "sky130_fd_sc_hd.gds"), "wb").write(bytes(outb))
print("cells", len(cells), "macros", len(blocks), "lib", len(out), "gds", len(outb))
