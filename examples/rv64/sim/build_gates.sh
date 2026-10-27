#!/usr/bin/env bash
# Gate-level Rv64Core in the same Verilator test bench: veryl-eda synthesizes Rv64Core into a
# flat netlist (structural Verilog) that replaces the RTL core inside Rv64Soc.
#   sim/build_gates.sh [KIND]     KIND: gate (default, veryl-eda's generic gates),
#                                 ecp5 (LUT4 / CCU2C / TRELLIS_FF, simulated with yosys' ECP5 cell models),
#                                 vlib / sky130 (standard cells after technology mapping; the netlist has the cell models)
#   -> sim/obj_KIND/rv64sim (same options as sim/obj/rv64sim); OBJ=dir picks another directory
set -euo pipefail
cd "$(dirname "$0")/.."
[ -d /Users/Shared/ccc/oss-cad-suite/bin ] && export PATH=/Users/Shared/ccc/oss-cad-suite/bin:$PATH
KIND=${1:-gate}
OBJ=${OBJ:-sim/obj_$KIND}
V2C=${V2C:-../../veryl-eda/target/release/v2c}
mkdir -p build
veryl build > /dev/null 2>&1 || { veryl build 2>&1 | grep -v "^\[INFO"; exit 1; }
case $KIND in
    gate) "$V2C" synth --top Rv64Core --verilog build/rv64core_gate.v src/rv64core.veryl | grep -E "cells:"; MODELS=() ;;
    ecp5) "$V2C" fpga --arch ecp5 --top Rv64Core --verilog build/rv64core_ecp5.v src/rv64core.veryl | grep -E "cells:|LUT4|CCU2C|TRELLIS_FF"
          ECP5=$(dirname "$(dirname "$(command -v yosys)")")/share/yosys/ecp5; MODELS=(-I"$ECP5" "$ECP5/cells_sim.v") ;;
    vlib|sky130) "$V2C" asic --pdk "$KIND" --map-only --top Rv64Core --verilog "build/rv64core_$KIND.v" src/rv64core.veryl | grep -E "cells" | head -3; MODELS=() ;;
    *) echo "unknown netlist kind $KIND"; exit 2 ;;
esac
# the netlist's module takes the RTL module's name (Rv64Soc instantiates rv64_Rv64Core)
sed -E 's/^module Rv64Core /module rv64_Rv64Core /' "build/rv64core_$KIND.v" > "build/rv64core_${KIND}_sim.v"
verilator --cc --exe --build -j 0 -O3 --x-assign fast --x-initial fast --noassert -CFLAGS -std=c++17 \
    -Wno-fatal -Wno-WIDTHEXPAND -Wno-WIDTHTRUNC -Wno-UNUSEDSIGNAL -Wno-UNUSEDPARAM -Wno-PINCONNECTEMPTY -Wno-UNOPTFLAT \
    --top-module rv64_Rv64Soc --Mdir "$OBJ" -o rv64sim \
    -Wno-SPECIFYIGN -Wno-MULTIDRIVEN -Wno-COMBDLY -Wno-CASEINCOMPLETE -Wno-LATCH -Wno-IMPLICIT -Wno-PINMISSING \
    target/rv64soc.sv "build/rv64core_${KIND}_sim.v" ${MODELS[@]+"${MODELS[@]}"} sim/main.cpp > "$OBJ.log" 2>&1 || { tail -30 "$OBJ.log"; exit 1; }
echo "built $OBJ/rv64sim (Rv64Core as a $KIND netlist)"
