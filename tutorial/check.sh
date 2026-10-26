#!/usr/bin/env bash
# Runs the tutorial's whole flow on both lessons: simulation, gate-level
# simulation on the three netlists, and place & route to an iCEBreaker
# bitstream with veryl-eda's own P&R (needs the IceStorm chipdb, see
# VERYL_EDA_CHIPDB). Uses the official veryl CLI too when it is installed.
set -euo pipefail
cd "$(dirname "$0")"
SIM=../veryl-sim/target/release/veryl-sim
EDA=../veryl-eda/target/release/veryl-eda
mkdir -p build
if command -v veryl > /dev/null; then
    veryl check > /dev/null 2>&1 || veryl check
    out=$(veryl test 2>&1)
    grep -E "Succeeded|Failed" <<< "$out"
    if grep -q Failed <<< "$out"; then exit 1; fi
fi
for d in blinky:Blinky knight:KnightRider; do
    f=${d%%:*}; m=${d##*:}
    $SIM "src/$f.veryl" | tail -1
    for k in opt ice40 asic; do
        $EDA --top "$m" --gatesim $k "src/$f.veryl" | grep -E "PASS" | sed "s/$/ ($k)/"
    done
    $EDA --top "$m" --ice40 --pnr veryl --pcf icebreaker.pcf --bin "build/$f.bin" "src/$f.veryl" | grep -E "Fmax|wrote"
done
