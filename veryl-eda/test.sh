#!/usr/bin/env bash
# veryl-eda regression:
#   1. cargo test: synthesize the examples, run their testbenches on the gate netlist
#   2. synthesize every example design and load the JSON back into yosys (check -assert)
#   3. FPGA flow (fpga/flow.sh): iCE40 mapping, nextpnr, icepack, and the
#      RISC-V SoC simulated from the mapped netlist and from the routed bitstream
#   4. formal equivalence against the SystemVerilog emitted by `veryl build`,
#      for the gate netlist, its vlib standard-cell mapping (--asic), its SKY130
#      mapping (--pdk sky130, the cells read from the PDK's Liberty file) and, for
#      the block RAM designs, the iCE40 netlist (yosys' SB_RAM40_4K model)
#      (needs a yosys with the slang frontend, e.g. oss-cad-suite; set YOSYS_SLANG)
set -euo pipefail
cd "$(dirname "$0")"
ROOT=$(pwd)
EX=$ROOT/../examples
OUT=${OUT:-$(mktemp -d)}
mkdir -p "$OUT"
YOSYS=${YOSYS:-yosys}
YOSYS_SLANG=${YOSYS_SLANG:-/Users/Shared/ccc/oss-cad-suite/bin/yosys}

fail=0
cargo test --release -q
cargo build --release -q
BIN=$ROOT/target/release/veryl-eda

# file:Module:mode   mode = comb (full proof) | ind (k-induction) | bmcN (N-cycle bounded check)
DESIGNS="adder:Adder:comb max3:Max3:comb alu_pkg:AluUnit:comb gen_rev:BitRev:comb gen_rev:GrayConv:comb
rv32i:Alu:comb seq101:Seq101:ind pkt_reg:PktReg:ind ram:Ram:bmc8 rv32i:RegFile:bmc2 rv32i:RiscvCore:bmc2
features:Shifter:comb features:Funcs:comb features:Ranges:comb features:Counter:ind features:Top:bmc20
soc:ProgRom:comb soc:RiscvSoc:bmc80 rv32i_rom:RiscvTestRom:comb
sync_ram:SyncRam:bmc4 bram_tests:Bram2048x2:bmc4 bram_tests:BramMix:bmc12
lang:Div:comb lang:HsTop:bmc24 lang:Wide:comb
fifo:Fifo:bmc6 uart:UartLoop:bmc24 vga:VgaTiming:bmc8 vga:VgaDemo:bmc8 sevenseg:SevenSeg:bmc8 gates:Gates:comb
button_counter:ButtonCounter:bmc8 traffic:TrafficLight:bmc8 rvsoc_small:RvSocSmall:bmc6"
# SKY130 has no SRAM macros yet: memories become flip-flops; these get only the
# mapping (the formal check), not the whole flow, and the biggest no gate-level simulation
SKY130_MAP_ONLY=" Bram2048x2 BramMix SyncRam Fifo RvSocSmall RiscvCore RegFile RiscvSoc "
SKY130_SKIP=" BramMix "
# designs whose iCE40 netlist (with SB_RAM40_4K) is also proven equivalent, using yosys' cell models
FPGA_EQ="SyncRam Bram2048x2 BramMix Fifo"
src() { if [ -f "$EX/src/$1.veryl" ]; then echo "$EX/src/$1.veryl"; else echo "$ROOT/examples/$1.veryl"; fi; }

echo "== synthesis (outputs in $OUT)"
for d in $DESIGNS; do
    IFS=: read -r f m mode <<< "$d"
    files="$(src "$f")"
    [ "$f" = soc ] && files="$EX/src/rv32i.veryl $files"
    [ "$f" = bram_tests ] && files="$EX/src/sync_ram.veryl $files"
    [ "$f" = rvsoc_small ] && files="$EX/src/rv32i.veryl $EX/src/sync_ram.veryl $EX/src/uart.veryl $EX/src/rvsoc.veryl $files"
    "$BIN" --top "$m" -o "$OUT/$m.json" --verilog "$OUT/$m.v" $files | grep -E "^===|cells:" | tr '\n' ' '
    "$YOSYS" -q -p "read_json $OUT/$m.json; check -assert" && printf "| yosys read_json ok | "
    "$BIN" --asic --top "$m" --verilog "$OUT/${m}_asic.v" $files | grep -E "^timing"
    # SKY130: the netlist without veryl-eda's cell models (the formal check reads the Liberty file instead)
    # SKY130: the whole flow on the smaller designs, the mapping alone on the big memories (flip-flops here)
    if [[ "$SKY130_MAP_ONLY" == *" $m "* ]]; then sky_opt=--map-only; else sky_opt=; fi
    "$BIN" --asic --pdk sky130 $sky_opt --top "$m" --verilog "$OUT/${m}_sky130.v" $files | grep -E "^timing" | sed 's/^/  sky130 /' || true
    sed -i.bak '/behavioural models from the Liberty functions/,$d' "$OUT/${m}_sky130.v" && rm -f "$OUT/${m}_sky130.v.bak"
    [[ " $FPGA_EQ " == *" $m "* ]] && "$BIN" --ice40 --top "$m" -o "$OUT/${m}_ice40.json" $files | grep -E "SB_RAM40_4K" 
done

echo "== gate-level simulation: the RTL testbenches on the synthesized netlists"
# top:files (the module replaced by its netlist; its file's #[test] modules run)
GATESIM="Adder:adder Max3:max3 AluUnit:alu_pkg GrayConv:gen_rev Seq101:seq101 PktReg:pkt_reg Ram:ram SyncRam:sync_ram
Top:features BramMix:sync_ram+bram_tests HsTop:lang RiscvCore:rv32i+rv32i_rom Fifo:fifo UartLoop:uart VgaTiming:vga SevenSeg:sevenseg Gates:gates ButtonCounter:button_counter TrafficLight:traffic
RvSoc:rv32i+rv32i_rom+sync_ram+uart+rvsoc_rom+rvsoc+rvsoc_ima_test VgaText:vga+sync_ram+rvvga"
for d in $GATESIM; do
    IFS=: read -r m f <<< "$d"
    files=""
    for part in ${f//+/ }; do files="$files $(src "$part")"; done
    for kind in opt ice40 asic sky130; do
        [ $kind = sky130 ] && [[ "$SKY130_SKIP" == *" $m "* ]] && continue
        if r=$("$BIN" --gatesim $kind --top "$m" $files 2>&1) && ! grep -q "failure" <<< "$r"; then
            printf "%-10s %-6s PASS\n" "$m" "$kind"
        else
            printf "%-10s %-6s FAILED\n" "$m" "$kind"; echo "$r" | tail -5; fail=1
        fi
    done
done

if command -v nextpnr-ice40 > /dev/null && command -v icebox_vlog > /dev/null; then
    echo "== FPGA flow (iCE40)"
    ./fpga/flow.sh | grep -E "LC:|Max frequency|PASS|FAIL|bitstream"
    echo "== own place & route (--pnr veryl): routed bitstream vs netlist"
    ./fpga/pnr_test.sh
    PNR=veryl ./fpga/flow.sh | grep -E "veryl pnr|PASS|FAIL"
else
    echo "== skipping FPGA flow: nextpnr-ice40 / icestorm not installed"
fi

if ! "$YOSYS_SLANG" -m slang -p "help read_slang" > /dev/null 2>&1; then
    echo "== skipping equivalence check: no yosys with slang at $YOSYS_SLANG"
    exit $fail
fi

echo "== formal equivalence vs. veryl build"
mkdir -p "$OUT/gold"
cp -r "$EX/Veryl.toml" "$EX/Veryl.lock" "$EX/src" "$OUT/gold/"
cp "$ROOT"/examples/*.veryl "$OUT/gold/src/"
(cd "$OUT/gold" && veryl build > /dev/null 2>&1)
for kind in gate asic sky130 fpga; do
for d in $DESIGNS; do
    IFS=: read -r f m mode <<< "$d"
    [ $kind = fpga ] && [[ " $FPGA_EQ " != *" $m "* ]] && continue
    case $mode in
        comb) prove="sat -verify -prove-asserts miter" ;;
        ind)  prove="sat -verify -prove-asserts -set-init-zero -tempinduct -seq 1 miter" ;;
        bmc*) prove="sat -verify -prove-asserts -set-init-zero -seq ${mode#bmc} miter" ;;
    esac
    gold="$OUT/gold/target/$f.sv"
    [ "$f" = soc ] && gold="$OUT/gold/target/rv32i.sv $gold"
    [ "$f" = bram_tests ] && gold="$OUT/gold/target/sync_ram.sv $gold"
    [ "$f" = rvsoc_small ] && gold="$OUT/gold/target/rv32i.sv $OUT/gold/target/sync_ram.sv $OUT/gold/target/uart.sv $OUT/gold/target/rvsoc.sv $gold"
    cat > "$OUT/eq_$m.ys" <<EOF
read_slang $gold --top examples_$m
proc; flatten; memory; opt_clean; async2sync
rename examples_$m gold
design -stash gold
$(case $kind in
    (gate) echo "read_json $OUT/$m.json" ;;
    (asic) echo "read_verilog $OUT/${m}_asic.v; hierarchy -top $m; proc; flatten; memory; opt_clean" ;;
    (sky130) echo "read_liberty $ROOT/pdk/sky130hd/sky130_fd_sc_hd__tt_025C_1v80.lib; read_verilog $OUT/${m}_sky130.v; hierarchy -top $m; proc; flatten; memory; opt_clean" ;;
    (fpga) echo "read_json $OUT/${m}_ice40.json; read_verilog -lib -specify +/ice40/cells_sim.v; read_verilog -DNO_ICE40_DEFAULT_ASSIGNMENTS +/ice40/cells_sim.v; hierarchy -top $m; proc; flatten; memory; opt_clean" ;;
esac)
async2sync
rename $m gate
design -stash gate
design -copy-from gold -as gold gold
design -copy-from gate -as gate gate
miter -equiv -flatten -make_assert -ignore_gold_x gold gate miter
hierarchy -top miter
$prove
EOF
    printf "%-5s %-12s %-6s " "$kind" "$m" "$mode"; t0=$SECONDS
    if "$YOSYS_SLANG" -m slang -q "$OUT/eq_$m.ys" > "$OUT/eq_${kind}_$m.log" 2>&1; then echo "equivalent ($((SECONDS - t0))s)"; else echo "FAILED (see $OUT/eq_${kind}_$m.log)"; fail=1; fi
done
done
exit $fail
