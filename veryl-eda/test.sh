#!/usr/bin/env bash
# veryl-eda regression:
#   1. cargo test: synthesize the examples, run their testbenches on the gate netlist
#   2. synthesize every example design and load the JSON back into yosys (check -assert)
#   3. FPGA flow (fpga/flow.sh): iCE40 mapping, nextpnr, icepack, and the
#      RISC-V SoC simulated from the mapped netlist and from the routed bitstream
#   4. formal equivalence against the SystemVerilog emitted by `veryl build`
#      (needs a yosys with the slang frontend, e.g. oss-cad-suite; set YOSYS_SLANG)
set -euo pipefail
cd "$(dirname "$0")"
ROOT=$(pwd)
EX=$ROOT/../examples
OUT=${OUT:-$(mktemp -d)}
mkdir -p "$OUT"
YOSYS=${YOSYS:-yosys}
YOSYS_SLANG=${YOSYS_SLANG:-/Users/Shared/ccc/oss-cad-suite/bin/yosys}

cargo test --release -q
cargo build --release -q
BIN=$ROOT/target/release/veryl-eda

# file:Module:mode   mode = comb (full proof) | ind (k-induction) | bmcN (N-cycle bounded check)
DESIGNS="adder:Adder:comb max3:Max3:comb alu_pkg:AluUnit:comb gen_rev:BitRev:comb gen_rev:GrayConv:comb
rv32i:Alu:comb seq101:Seq101:ind pkt_reg:PktReg:ind ram:Ram:bmc8 rv32i:RegFile:bmc2 rv32i:RiscvCore:bmc2
features:Shifter:comb features:Funcs:comb features:Ranges:comb features:Counter:ind features:Top:bmc20
soc:ProgRom:comb soc:RiscvSoc:bmc80 rv32i_rom:RiscvTestRom:comb"
src() { if [ -f "$EX/src/$1.veryl" ]; then echo "$EX/src/$1.veryl"; else echo "$ROOT/examples/$1.veryl"; fi; }

echo "== synthesis (outputs in $OUT)"
for d in $DESIGNS; do
    IFS=: read -r f m mode <<< "$d"
    files="$(src "$f")"
    [ "$f" = soc ] && files="$EX/src/rv32i.veryl $files"
    "$BIN" --top "$m" -o "$OUT/$m.json" --verilog "$OUT/$m.v" $files | grep -E "^===|cells:" | tr '\n' ' '
    "$YOSYS" -q -p "read_json $OUT/$m.json; check -assert" && echo "| yosys read_json ok"
done

if command -v nextpnr-ice40 > /dev/null && command -v icebox_vlog > /dev/null; then
    echo "== FPGA flow (iCE40)"
    ./fpga/flow.sh | grep -E "LC:|Max frequency|PASS|FAIL|bitstream"
else
    echo "== skipping FPGA flow: nextpnr-ice40 / icestorm not installed"
fi

if ! "$YOSYS_SLANG" -m slang -p "help read_slang" > /dev/null 2>&1; then
    echo "== skipping equivalence check: no yosys with slang at $YOSYS_SLANG"
    exit 0
fi

echo "== formal equivalence vs. veryl build"
mkdir -p "$OUT/gold"
cp -r "$EX/Veryl.toml" "$EX/Veryl.lock" "$EX/src" "$OUT/gold/"
cp "$ROOT"/examples/*.veryl "$OUT/gold/src/"
(cd "$OUT/gold" && veryl build > /dev/null 2>&1)
fail=0
for d in $DESIGNS; do
    IFS=: read -r f m mode <<< "$d"
    case $mode in
        comb) prove="sat -verify -prove-asserts miter" ;;
        ind)  prove="sat -verify -prove-asserts -set-init-zero -tempinduct -seq 1 miter" ;;
        bmc*) prove="sat -verify -prove-asserts -set-init-zero -seq ${mode#bmc} miter" ;;
    esac
    gold="$OUT/gold/target/$f.sv"
    [ "$f" = soc ] && gold="$OUT/gold/target/rv32i.sv $gold"
    cat > "$OUT/eq_$m.ys" <<EOF
read_slang $gold --top examples_$m
proc; flatten; memory; opt_clean; async2sync
rename examples_$m gold
design -stash gold
read_json $OUT/$m.json
async2sync
rename $m gate
design -stash gate
design -copy-from gold -as gold gold
design -copy-from gate -as gate gate
miter -equiv -flatten -make_assert -ignore_gold_x gold gate miter
hierarchy -top miter
$prove
EOF
    printf "%-10s %-6s " "$m" "$mode"; t0=$SECONDS
    if "$YOSYS_SLANG" -m slang -q "$OUT/eq_$m.ys" > "$OUT/eq_$m.log" 2>&1; then echo "equivalent ($((SECONDS - t0))s)"; else echo "FAILED (see $OUT/eq_$m.log)"; fail=1; fi
done
exit $fail
