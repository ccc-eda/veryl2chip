#!/usr/bin/env bash
# 官方 riscv-tests（tools 外另外下載：git clone --recursive https://github.com/riscv-software-src/riscv-tests，
# 在 isa/ 執行 make XLEN=64 rv64ui rv64um rv64ua rv64si rv64mi）在 Rv64Soc 上跑一遍。
#   sim/riscv_tests.sh [PATTERN]     例：sim/riscv_tests.sh 'rv64si-*'
# OBJ：模擬器的目錄（預設 sim/obj）；SIM：另一個模擬器（例：SIM=sim/obj_fpga_rtl/rv64fpga）
# RISCV_TESTS：riscv-tests 的目錄（預設 /Users/Shared/ccc/riscv-tests 或 ~/riscv-tests）
set -uo pipefail
cd "$(dirname "$0")/.."
DIR=${RISCV_TESTS:-/Users/Shared/ccc/riscv-tests}
[ -d "$DIR" ] || DIR=$HOME/riscv-tests
PAT=${1:-'rv64*-[pv]-*'}
pass=0; fail=0; failed=()
for t in $DIR/isa/$PAT; do
    case $t in *.dump) continue ;; esac
    # ma_data 要硬體支援沒對齊的存取；Rv64Core 對沒對齊的存取發出例外（規格允許，OpenSBI 會模擬）
    case $t in *-ma_data) continue ;; esac
    n=$(basename "$t")
    if r=$(${SIM:-./${OBJ:-sim/obj}/rv64sim} -m 5000000 "$t" 2>&1 < /dev/null); then
        pass=$((pass + 1))
    else
        fail=$((fail + 1)); failed+=("$n: $(tail -1 <<< "$r")")
    fi
done
printf '%s\n' "${failed[@]+"${failed[@]}"}"
echo "riscv-tests: $pass passed, $fail failed"
[ $fail = 0 ]
