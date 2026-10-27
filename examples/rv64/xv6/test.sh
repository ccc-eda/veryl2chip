#!/usr/bin/env bash
# xv6 on Rv64Soc (Verilator), driven by a script: boot, a few shell commands, optionally usertests.
#   xv6/test.sh            boot, echo / cat / ls / mkdir / wc
#   xv6/test.sh usertests  + usertests -q (takes a long time in simulation)
# Needs sim/build.sh and xv6/build.sh first. SIM picks another simulator (emu/rv64emu,
# ../../riscv-emu/target/release/rvemu).
set -uo pipefail
cd "$(dirname "$0")/.."
OBJ=${OBJ:-sim/obj}
SIM=${SIM:-$OBJ/rv64sim}
S=$(mktemp)
cat > "$S" <<'SH'
echo hello rv64
echo hi > f.txt
cat f.txt
mkdir d
ls d
wc README
SH
[ "${1:-}" = usertests ] && echo "usertests -q" >> "$S"
OUT=$(mktemp)
"$SIM" -m 0 -s "$S" -l 0x88000000:xv6/build/fs.img xv6/build/kernel/kernel 2>&1 | tee "$OUT"
ok=1
for want in "init: starting sh" "hello rv64" "^hi" "48 336 2441 README"; do
    grep -q "$want" "$OUT" || { echo "MISSING: $want"; ok=0; }
done
[ "${1:-}" = usertests ] && { grep -q "ALL TESTS PASSED" "$OUT" || { echo "MISSING: ALL TESTS PASSED"; ok=0; }; }
rm -f "$S" "$OUT"
[ $ok = 1 ] && echo "xv6 test: PASS" || { echo "xv6 test: FAIL"; exit 1; }
