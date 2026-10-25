#!/usr/bin/env bash
# Veryl -> iCE40 bitstream for the RISC-V SoC, with two gate-level simulations:
#   1. veryl-eda: synthesis + iCE40 mapping, nextpnr-ice40 place & route, icepack
#   2. simulate the mapped netlist (yosys iCE40 cell models)
#   3. turn the routed bitstream back into Verilog (icebox_vlog) and simulate it
# Program a board with: iceprog build/soc.bin
set -euo pipefail
cd "$(dirname "$0")"
B=build
mkdir -p $B
EX=../../examples/src
PCF=${PCF:-../examples/icebreaker.pcf}

(cd .. && cargo build --release -q)
../target/release/veryl-eda --top RiscvSoc --ice40 --pcf "$PCF" \
    -o $B/soc.json --verilog $B/soc_mapped.v --asc $B/soc.asc --bin $B/soc.bin \
    $EX/rv32i.veryl ../examples/soc.veryl | grep -v "^  port"

echo "== gate-level simulation of the mapped netlist"
iverilog -o $B/map.vvp -DNO_ICE40_DEFAULT_ASSIGNMENTS tb_soc.v $B/soc_mapped.v "$(yosys-config --datdir)/ice40/cells_sim.v"
vvp -n $B/map.vvp | grep -E "PASS|FAIL"

echo "== simulation of the routed bitstream (icebox_vlog)"
icebox_vlog -d sg48 -p "$PCF" -n chip $B/soc.asc > $B/chip_raw.v
# icebox_vlog re-declares output ports as regs; make that legal for iverilog
perl -0pe 'my %p; ($h)=/^(module chip \(.*?\);)/m; while($h=~/output (\\\S+) /g){$p{$1}=1}
    s/output (\\\S+) /output reg $1 /g; s/^reg (\\\S+) = 0 ;/exists $p{$1} ? "initial $1 = 0;" : $&/gme' $B/chip_raw.v > $B/chip.v
iverilog -o $B/chip.vvp tb_chip.v $B/chip.v
out=$(vvp -n $B/chip.vvp | grep -E "PASS|FAIL")
echo "$out"
[[ $out == PASS* ]]
echo "bitstream: $B/soc.bin  (iceprog $B/soc.bin)"
