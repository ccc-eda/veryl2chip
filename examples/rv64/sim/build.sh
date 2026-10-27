#!/usr/bin/env bash
# veryl build（Veryl → SystemVerilog）+ Verilator（→ C++ 模擬器 sim/obj/rv64sim）
#   sim/build.sh            需要官方 veryl 與 verilator（OSS CAD Suite）
set -euo pipefail
OBJ=${OBJ:-sim/obj}   # 輸出目錄（另一個目錄：不打擾正在跑的模擬）
cd "$(dirname "$0")/.."
[ -d /Users/Shared/ccc/oss-cad-suite/bin ] && export PATH=/Users/Shared/ccc/oss-cad-suite/bin:$PATH
veryl build > /dev/null 2>&1 || { veryl build 2>&1 | grep -v "^\[INFO"; exit 1; }
verilator --cc --exe --build -j 0 -O3 --x-assign fast --x-initial fast --noassert -CFLAGS -std=c++17 \
    -Wno-fatal -Wno-WIDTHEXPAND -Wno-WIDTHTRUNC -Wno-UNUSEDSIGNAL -Wno-UNUSEDPARAM \
    --top-module rv64_Rv64Soc --Mdir "$OBJ" -o rv64sim \
    target/rv64core.sv target/rv64soc.sv sim/main.cpp > "$OBJ.log" 2>&1 || { tail -40 "$OBJ.log"; exit 1; }
grep -E "%Warning|%Error" "$OBJ.log" | head -20 || true
echo "built $OBJ/rv64sim"
