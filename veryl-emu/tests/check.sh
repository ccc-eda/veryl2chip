#!/usr/bin/env bash
# veryl-emu differential test: tests/check.veryl on veryl-sim (its testbench) and compiled
# by veryl-emu (driven by tests/check.mjs in Node); every printed line must match.
set -euo pipefail
cd "$(dirname "$0")/.."
cargo build --release -q
(cd ../veryl-sim && cargo build --release -q)
OUT=$(mktemp -d)
target/release/veryl-emu --top ExprCheck -o "$OUT/check.wasm" tests/check.veryl 2> "$OUT/emu.log" || { cat "$OUT/emu.log"; exit 1; }
../veryl-sim/target/release/veryl-sim tests/check.veryl | grep -E '^[0-9a-f]+ ' > "$OUT/sim.txt"
n=$(wc -l < "$OUT/sim.txt" | tr -d " ")
node tests/check.mjs "$OUT/check.wasm" "$n" > "$OUT/emu.txt"
if cmp -s "$OUT/sim.txt" "$OUT/emu.txt"; then
    echo "veryl-emu check: $n cycles x 21 outputs identical to veryl-sim"
    rm -rf "$OUT"
else
    echo "veryl-emu check: differs (files in $OUT)"
    diff <(tr ' ' '\n' < "$OUT/sim.txt" | head -2000) <(tr ' ' '\n' < "$OUT/emu.txt" | head -2000) | head -10
    exit 1
fi
