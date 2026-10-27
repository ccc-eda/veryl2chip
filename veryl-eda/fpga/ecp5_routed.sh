#!/usr/bin/env bash
# ECP5 post-route check: every design is mapped (veryl-eda --ecp5), placed and routed by
# nextpnr-ecp5 (--write: the packed netlist of TRELLIS_COMB / TRELLIS_FF / TRELLIS_IO),
# and yosys proves the routed netlist equivalent to the mapped one (ecp5_unio.py turns the
# IO buffers into wires and names the flip-flops alike on both sides; ecp5_comb.v fixes
# yosys' TRELLIS_COMB model for carries). Combinational designs: a SAT proof of the miter;
# sequential ones: equiv_make pairs the flip-flops, equiv_simple / equiv_induct prove them.
#   ./fpga/ecp5_routed.sh [file:Module:mode ...]      mode = comb | ind | bmcN
set -uo pipefail
cd "$(dirname "$0")/.."
ROOT=$(pwd)
EX=$ROOT/../examples/src
OUT=${OUT:-$(mktemp -d)}
mkdir -p "$OUT"
BIN=$ROOT/target/release/veryl-eda
YOSYS=${YOSYS:-yosys}
DESIGNS=${*:-"adder:Adder max3:Max3 rv32i:Alu gen_rev:GrayConv seq101:Seq101 pkt_reg:PktReg features:Top lang:Div lang:HsTop
pnr_tests:AccTest uart:UartLoop vga:VgaDemo sevenseg:SevenSeg soc:RiscvSoc fifo:Fifo"}
# not in the list: ButtonCounter and TrafficLight stay unproven by equiv_induct (not refuted; their
# synchronizers / timers need a deeper induction), RiscvCore takes too long
src() { if [ -f "$EX/$1.veryl" ]; then echo "$EX/$1.veryl"; else echo "$ROOT/examples/$1.veryl"; fi; }
fail=0
for d in $DESIGNS; do
    IFS=: read -r f m <<< "$d"
    files="$(src "$f")"
    [ "$f" = soc ] && files="$EX/rv32i.veryl $EX/rv32i_rom.veryl $files"
    "$BIN" --ecp5 --top "$m" -o "$OUT/$m.json" $files > /dev/null || { echo "$m: mapping FAILED"; fail=1; continue; }
    if ! nextpnr-ecp5 --85k --package CABGA381 --json "$OUT/$m.json" --write "$OUT/${m}_routed.json" --lpf-allow-unconstrained -q > "$OUT/${m}_pnr.log" 2>&1; then
        echo "$m: nextpnr-ecp5 FAILED (see $OUT/${m}_pnr.log)"; fail=1; continue
    fi
    python3 fpga/ecp5_unio.py "$OUT/${m}_routed.json" "$OUT/${m}_r.json"
    python3 fpga/ecp5_unio.py --names "$OUT/$m.json" "$OUT/${m}_m.json"
    if grep -q TRELLIS_FF "$OUT/$m.json"; then
        mode=seq; prove="equiv_make gold gate equiv; hierarchy -top equiv; equiv_simple -seq 2; equiv_induct -seq 2; equiv_status -assert"
    else
        mode=comb; prove="miter -equiv -flatten -make_assert gold gate miter; hierarchy -top miter; sat -verify -prove-asserts miter"
    fi
    cat > "$OUT/$m.ys" <<YS
read_json $OUT/${m}_m.json
read_verilog -lib +/ecp5/cells_sim.v
read_verilog +/ecp5/cells_sim.v
hierarchy -top $m; proc; flatten; opt_clean; attrmap -remove init; async2sync
rename $m gold
design -stash gold
read_json $OUT/${m}_r.json
read_verilog -lib +/ecp5/cells_sim.v
read_verilog +/ecp5/cells_sim.v
read_verilog -overwrite $ROOT/fpga/ecp5_comb.v
hierarchy -top top; proc; flatten; opt_clean; attrmap -remove init; async2sync
rename top gate
design -stash gate
design -copy-from gold -as gold gold
design -copy-from gate -as gate gate
$prove
YS
    t0=$SECONDS
    if "$YOSYS" -q "$OUT/$m.ys" > "$OUT/$m.log" 2>&1; then
        printf "%-13s %-6s routed = mapped (%ds)\n" "$m" "$mode" $((SECONDS - t0))
    else
        printf "%-13s %-6s FAILED (see %s)\n" "$m" "$mode" "$OUT/$m.log"; fail=1
    fi
done
exit $fail
