#!/usr/bin/env bash
# Rv64Fpga → ECP5（LFE5U-85F，ULX3S 的腳位）：veryl-eda 合成與對應（v2c fpga --arch ecp5，記憶體是 DP16KD），
# nextpnr-ecp5 佈局繞線（--write：繞線後的網表，給 sim/build_fpga.sh routed 模擬），ecppack 產生位元流。
#   fpga/ecp5.sh            → build/rv64fpga_ecp5.json、build/rv64fpga_routed.json、build/rv64fpga.bit
set -euo pipefail
cd "$(dirname "$0")/.."
[ -d /Users/Shared/ccc/oss-cad-suite/bin ] && export PATH=/Users/Shared/ccc/oss-cad-suite/bin:$PATH
V2C=${V2C:-../../veryl-eda/target/release/v2c}
mkdir -p build
"$V2C" fpga --arch ecp5 --top Rv64Fpga -o build/rv64fpga_ecp5.json --verilog build/rv64fpga_ecp5.v src/rv64core.veryl src/rv64fpga.veryl \
    | grep -E "cells:|LUT4|CCU2C|TRELLIS_FF|DP16KD"
nextpnr-ecp5 --85k --package CABGA381 --json build/rv64fpga_ecp5.json --lpf fpga/ulx3s.lpf --lpf-allow-unconstrained \
    --write build/rv64fpga_routed.json --textcfg build/rv64fpga.config --report build/rv64fpga_report.json \
    --threads 4 --timing-allow-fail ${SEED:+--seed $SEED} > build/rv64fpga_pnr.log 2>&1 || { tail -20 build/rv64fpga_pnr.log; exit 1; }
grep -E "TRELLIS_COMB:|TRELLIS_FF:|DP16KD:|Max frequency for clock" build/rv64fpga_pnr.log | sed 's/^Info: *//' | tail -5
ecppack --compress build/rv64fpga.config build/rv64fpga.bit
echo "wrote build/rv64fpga.bit"
