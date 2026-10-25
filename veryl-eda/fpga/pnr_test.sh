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
CHIPDB=${VERYL_EDA_CHIPDB:-}
for c in /usr/local/share/icebox/chipdb-5k.txt /usr/share/icebox/chipdb-5k.txt /Users/Shared/ccc/oss-cad-suite/share/icebox/chipdb-5k.txt "$HOME/oss-cad-suite/share/icebox/chipdb-5k.txt"; do
    [ -z "$CHIPDB" ] && [ -f "$c" ] && CHIPDB=$c
done
# file:Module[:clock:reset:active]
DESIGNS=${DESIGNS:-"adder:Adder max3:Max3 alu_pkg:AluUnit gen_rev:BitRev gen_rev:GrayConv
seq101:Seq101:i_clk:i_rst:0 pkt_reg:PktReg:i_clk:i_rst:0 ram:Ram:i_clk:i_rst:0
features:Shifter features:Ranges features:Counter:i_clk:i_rst:1 features:Top:i_clk:i_rst:1
pnr_tests:AccTest:i_clk:i_rst:0 rv32i+soc:RiscvSoc:i_clk:i_rst:0
sync_ram:SyncRam:i_clk sync_ram+bram_tests:Bram2048x2:i_clk sync_ram+bram_tests:BramMix:i_clk:i_rst:0"}
fail=0
for d in $DESIGNS; do
    IFS=: read -r f m clk rst act <<< "$d"
    srcs=()
    for part in ${f//+/ }; do
        if [ -f "$EX/$part.veryl" ]; then srcs+=("$EX/$part.veryl"); else srcs+=("../examples/$part.veryl"); fi
    done
    pcf=()
    [ "$m" = RiscvSoc ] && pcf=(--pcf ../examples/icebreaker.pcf)
    $BIN --top "$m" --ice40 -o $B/$m.json --verilog $B/$m.v "${srcs[@]}" > /dev/null
    info=$($BIN --top "$m" --ice40 --pnr veryl ${pcf[@]+"${pcf[@]}"} --asc $B/$m.asc --bin $B/$m.bin "${srcs[@]}" | grep "veryl pnr" | sed 's/^ *veryl pnr: //')
    args=()
    [ -n "${clk:-}" ] && args+=(--clock "$clk")
    [ -n "${rst:-}" ] && args+=(--reset "$rst:$act")
    fmax=""
    if [ -n "$CHIPDB" ] && command -v icetime > /dev/null; then
        fmax=$(icetime -C "$CHIPDB" -d up5k -P sg48 -p $B/$m.pcf -t $B/$m.asc 2>/dev/null | sed -n 's/^Total path delay: .*(\(.*\) MHz)/\1 MHz/p')
    fi
    # our .bin (own icepack port) must equal icepack's
    if command -v icepack > /dev/null; then
        icepack $B/$m.asc $B/$m.icepack.bin
        cmp -s $B/$m.bin $B/$m.icepack.bin || { echo "$m: .bin differs from icepack"; fail=1; }
    fi
    printf "%-10s %-38s %-11s " "$m" "$info" "$fmax"
    if res=$(python3 cosim.py $B/$m.json $B/$m.v $B/$m.asc $B/$m.pcf ${args[@]+"${args[@]}"} --cycles 1000 2>&1 | tail -1) && [[ $res == PASS* ]]; then
        echo "$res"
    else
        echo "FAIL: $res"; fail=1
    fi
done
exit $fail
