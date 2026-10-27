#!/usr/bin/env bash
# Rv64Fpga（FPGA 的系統，src/rv64fpga.veryl）在 Verilator 上：只用腳位的測試平台 sim/fpga.cpp
#   sim/build_fpga.sh [KIND]     KIND: rtl（預設）、ecp5（veryl-eda 的 ECP5 網表：LUT4、CCU2C、TRELLIS_FF、DP16KD）、
#                                routed（nextpnr-ecp5 佈局繞線後的網表：TRELLIS_COMB、TRELLIS_FF、DP16KD；先跑 fpga/ecp5.sh）
#   -> sim/obj_fpga_KIND/rv64fpga [-m CYCLES] [-b CPB] PROG.elf；OBJ=dir 換目錄
set -euo pipefail
cd "$(dirname "$0")/.."
[ -d /Users/Shared/ccc/oss-cad-suite/bin ] && export PATH=/Users/Shared/ccc/oss-cad-suite/bin:$PATH
KIND=${1:-rtl}
OBJ=${OBJ:-sim/obj_fpga_$KIND}
veryl build > /dev/null 2>&1 || { veryl build 2>&1 | grep -v "^\[INFO"; exit 1; }
V2C=${V2C:-../../veryl-eda/target/release/v2c}
# ECP5 的元件模型：yosys 的 cells_sim.v，但 DP16KD 只有宣告（換成 veryl-eda/fpga/ecp5_dp16kd.v），
# TRELLIS_COMB 的進位輸出有問題（換成 veryl-eda/fpga/ecp5_comb.v）
ecp5_models() {
    local d f; d=$(dirname "$(dirname "$(command -v yosys)")")/share/yosys/ecp5
    mkdir -p build/ecp5
    for f in "$d"/cells_sim.v "$d"/*.vh; do
        awk '/^module (DP16KD|TRELLIS_COMB)[ (]/{skip=1} !skip{print} skip&&/^endmodule/{skip=0}' "$f" > "build/ecp5/$(basename "$f")"
    done
    MODELS=(-Ibuild/ecp5 build/ecp5/cells_sim.v ../../veryl-eda/fpga/ecp5_dp16kd.v ../../veryl-eda/fpga/ecp5_comb.v)
}
mkdir -p build
case $KIND in
    rtl) SRC=(target/rv64core.sv target/rv64fpga.sv) ;;
    ecp5)
        "$V2C" fpga --arch ecp5 --top Rv64Fpga --verilog build/rv64fpga_ecp5.v -o build/rv64fpga_ecp5.json src/rv64core.veryl src/rv64fpga.veryl \
            | grep -E "cells:|LUT4|CCU2C|TRELLIS_FF|DP16KD"
        sed -E 's/^module Rv64Fpga /module rv64_Rv64Fpga /' build/rv64fpga_ecp5.v > build/rv64fpga_ecp5_sim.v
        ecp5_models; SRC=(build/rv64fpga_ecp5_sim.v "${MODELS[@]}") ;;
    routed)
        [ -f build/rv64fpga_routed.json ] || { echo "build/rv64fpga_routed.json: run fpga/ecp5.sh first"; exit 1; }
        # IO 緩衝器與時脈緩衝器變成導線、沒接的 LUT 輸入讀 1（和 veryl-eda/fpga/ecp5_routed.sh 的等價檢查相同）
        python3 ../../veryl-eda/fpga/ecp5_unio.py build/rv64fpga_routed.json build/rv64fpga_routed_sim.json
        yosys -q -p "read_json build/rv64fpga_routed_sim.json; rename top rv64_Rv64Fpga; write_verilog -noattr build/rv64fpga_routed_sim.v"
        ecp5_models; SRC=(build/rv64fpga_routed_sim.v "${MODELS[@]}") ;;
    *) echo "unknown kind $KIND"; exit 2 ;;
esac
verilator --cc --exe --build -j 0 -O3 --x-assign fast --x-initial fast --noassert -CFLAGS -std=c++17 \
    -Wno-fatal -Wno-WIDTHEXPAND -Wno-WIDTHTRUNC -Wno-UNUSEDSIGNAL -Wno-UNUSEDPARAM -Wno-PINCONNECTEMPTY -Wno-UNOPTFLAT \
    -Wno-SPECIFYIGN -Wno-MULTIDRIVEN -Wno-COMBDLY -Wno-CASEINCOMPLETE -Wno-LATCH -Wno-IMPLICIT -Wno-PINMISSING \
    --top-module rv64_Rv64Fpga --Mdir "$OBJ" -o rv64fpga \
    "${SRC[@]}" sim/fpga.cpp > "$OBJ.log" 2>&1 || { tail -30 "$OBJ.log"; exit 1; }
echo "built $OBJ/rv64fpga (Rv64Fpga, $KIND)"
