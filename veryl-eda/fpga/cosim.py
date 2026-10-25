#!/usr/bin/env python3
"""Random co-simulation of a routed bitstream against its source netlist.

  cosim.py MAPPED.json MAPPED.v CHIP.asc CHIP.pcf [--clock PORT] [--reset PORT:ACTIVE] [--cycles N]

CHIP.asc is turned back into Verilog with icebox_vlog (the IceStorm decoder),
MAPPED.v is veryl-eda's iCE40-mapped netlist simulated with yosys' cell
models. Both get the same random inputs; every output is compared before
each clock edge. Prints PASS / FAIL and exits non-zero on a mismatch.
"""
import json, os, re, subprocess, sys, tempfile

def main():
    a = sys.argv[1:]
    if len(a) < 4:
        sys.exit(__doc__)
    mjson, mv, asc, pcf = a[:4]
    opts = {"--clock": None, "--reset": None, "--cycles": "300", "--seed": "1"}
    i = 4
    while i < len(a):
        opts[a[i]] = a[i + 1]
        i += 2
    clock = opts["--clock"]
    reset, ractive = (opts["--reset"].split(":") + ["0"])[:2] if opts["--reset"] else (None, "0")
    cycles = int(opts["--cycles"])

    mod = json.load(open(mjson))["modules"]
    top, m = next(iter(mod.items()))
    ports = [(n, p["direction"], len(p["bits"])) for n, p in m["ports"].items()]
    pins = {}
    for l in open(pcf):
        p = l.split()
        if len(p) >= 3 and p[0] == "set_io":
            pins[p[1]] = p[2]

    tmp = tempfile.mkdtemp()
    raw = subprocess.run(["icebox_vlog", "-d", "sg48", "-p", pcf, "-n", "chip", asc], capture_output=True, text=True, check=True).stdout
    # icebox_vlog re-declares output ports as regs; make that legal for iverilog
    head = re.search(r"^module chip \((.*?)\);", raw, re.M | re.S).group(1)
    outs = set(re.findall(r"output (\\\S+|\w+)", head))
    regs = set(x for x in re.findall(r"^reg (\\\S+|\w+) = 0 ?;", raw, re.M) if x in outs)
    ports_h = set(re.findall(r"(?:input|output) (\\\S+|\w+)", head))
    raw = re.sub(r"^wire (\\\S+|\w+) ?;\n", lambda x: "" if x.group(1) in ports_h else x.group(0), raw, flags=re.M)
    raw = re.sub(r"output (\\\S+|\w+)", lambda x: ("output reg " if x.group(1) in regs else "output ") + x.group(1), raw)
    raw = re.sub(r"^reg (\\\S+|\w+) = 0 ?;", lambda x: ("initial %s = 0;" % x.group(1)) if x.group(1) in regs else x.group(0), raw, flags=re.M)
    open(os.path.join(tmp, "chip.v"), "w").write(raw)

    def bitname(n, w, k):
        return n if w == 1 else "%s[%d]" % (n, k)
    def esc(s):
        return s if re.fullmatch(r"\w+", s) else "\\" + s + " "
    tb = ["`timescale 1ns/1ps", "module tb;", "integer errors = 0, cyc = 0;"]
    conn_c, conn_g = [], []
    for n, d, w in ports:
        tb.append("%s [%d:0] %s_c;" % ("reg" if d == "input" else "wire", w - 1, n) if d == "input" else "wire [%d:0] %s_c, %s_g;" % (w - 1, n, n))
        for k in range(w):
            b = bitname(n, w, k)
            if b in pins:
                conn_c.append(".%s(%s_c[%d])" % (esc(b), n, k))
        conn_g.append(".%s(%s)" % (esc(n), "%s_c" % n if d == "input" else "%s_g" % n))
    tb.append("chip c(%s);" % ", ".join(conn_c))
    tb.append("%s g(%s);" % (esc(top), ", ".join(conn_g)))
    ins = [(n, w) for n, d, w in ports if d == "input" and n != clock]
    outs_p = [(n, w) for n, d, w in ports if d == "output"]
    rnd = "\n".join("    %s_c = {%s};" % (n, ", ".join(["$random(seed)"] * ((w + 31) // 32))) for n, w in ins if n != reset)
    cmp = "\n".join(
        '    if (%s_c !== %s_g) begin errors = errors + 1; if (errors < 10) $display("cycle %%0d: %s chip=%%h netlist=%%h", cyc, %s_c, %s_g); end'
        % (n, n, n, n, n) for n, w in outs_p)
    tb.append("integer seed = %s;" % opts["--seed"])
    tb.append("initial begin")
    if clock:
        tb.append("  %s_c = 0;" % clock)
    if reset:
        tb.append("  %s_c = %s;" % (reset, ractive))
    tb.append(rnd)
    tb.append("  repeat (%d) begin" % cycles)
    tb.append("    #10;")
    tb.append(cmp)
    if clock:
        tb.append("    %s_c = 1; #10; %s_c = 0;" % (clock, clock))
    if reset:
        tb.append("    if (cyc == 2) %s_c = !%s;" % (reset, ractive))
    tb.append(rnd)
    tb.append("    cyc = cyc + 1;")
    tb.append("  end")
    tb.append('  if (errors == 0) $display("PASS: %0d cycles, outputs identical", cyc); else $display("FAIL: %0d mismatches", errors);')
    tb.append("  $finish;")
    tb.append("end")
    tb.append("endmodule")
    open(os.path.join(tmp, "tb.v"), "w").write("\n".join(tb) + "\n")
    cells = subprocess.run(["yosys-config", "--datdir"], capture_output=True, text=True).stdout.strip() + "/ice40/cells_sim.v"
    vvp = os.path.join(tmp, "sim.vvp")
    r = subprocess.run(["iverilog", "-o", vvp, "-DNO_ICE40_DEFAULT_ASSIGNMENTS", os.path.join(tmp, "tb.v"), os.path.join(tmp, "chip.v"), mv, cells], capture_output=True, text=True)
    if r.returncode:
        sys.exit(r.stderr[-3000:])
    out = subprocess.run(["vvp", "-n", vvp], capture_output=True, text=True).stdout
    lines = [l for l in out.splitlines() if not l.startswith("VCD") and "$finish" not in l]
    print("\n".join(lines))
    sys.exit(0 if any(l.startswith("PASS") for l in lines) else 1)

main()
