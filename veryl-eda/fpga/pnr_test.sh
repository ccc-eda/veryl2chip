#!/usr/bin/env bash
# veryl-eda's own place & route (--pnr veryl): for every design, place and
# route it, pack the bitstream, turn it back into Verilog (icebox_vlog) and
# co-simulate it against the iCE40-mapped netlist with random inputs.
set -euo pipefail
cd "$(dirname "$0")"
B=build/pnr
mkdir -p $B
EX=../../examples/src
(cd .. && cargo build --release -q)
BIN=../target/release/veryl-eda
# file:Module[:clock:reset:active]
DESIGNS=${DESIGNS:-"adder:Adder max3:Max3 alu_pkg:AluUnit gen_rev:BitRev gen_rev:GrayConv
seq101:Seq101:i_clk:i_rst:0 pkt_reg:PktReg:i_clk:i_rst:0 ram:Ram:i_clk:i_rst:0"}
fail=0
for d in $DESIGNS; do
    IFS=: read -r f m clk rst act <<< "$d"
    src="$EX/$f.veryl"; [ -f "$src" ] || src="../examples/$f.veryl"
    $BIN --top "$m" --ice40 -o $B/$m.json --verilog $B/$m.v "$src" > /dev/null
    info=$($BIN --top "$m" --ice40 --pnr veryl --asc $B/$m.asc --bin $B/$m.bin "$src" | grep "veryl pnr" | sed 's/^ *veryl pnr: //')
    args=()
    [ -n "${clk:-}" ] && args+=(--clock "$clk")
    [ -n "${rst:-}" ] && args+=(--reset "$rst:$act")
    printf "%-10s %-40s " "$m" "$info"
    if res=$(python3 cosim.py $B/$m.json $B/$m.v $B/$m.asc $B/$m.pcf ${args[@]+"${args[@]}"} --cycles 1000 2>&1 | tail -1) && [[ $res == PASS* ]]; then
        echo "$res"
    else
        echo "FAIL: $res"; fail=1
    fi
done
exit $fail
