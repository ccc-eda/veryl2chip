#!/usr/bin/env bash
# Random instruction tests (verify/randgen.py) on Rv64Soc (Verilator), each compared with
# spike instruction by instruction (privilege, pc, instruction, register written).
#   verify/random.sh [FIRST_SEED] [COUNT] [N] [MODES]   default: seeds 1..50, 2000 instructions,
#                                                       modes "m s u" (M mode; S / U on Sv39)
# A failing seed keeps its files in verify/out/ (prog.S, the two logs).
# OBJ: the Verilator build (default sim/obj); SIM: another simulator (e.g. SIM=emu/rv64emu).
set -uo pipefail
cd "$(dirname "$0")/.."
[ -d /Users/Shared/ccc/oss-cad-suite/bin ] && export PATH=/Users/Shared/ccc/oss-cad-suite/bin:$PATH
OBJ=${OBJ:-sim/obj}
FIRST=${1:-1}; COUNT=${2:-50}; N=${3:-2000}; MODES=${4:-m s u}
OUT=verify/out
mkdir -p "$OUT"
pass=0; fail=0
for ((s = FIRST; s < FIRST + COUNT; s++)); do
  for mode in $MODES; do
    D="$OUT/$s$mode"; mkdir -p "$D"
    python3 verify/randgen.py "$s" "$N" "$mode" > "$D/prog.S"
    riscv64-unknown-elf-gcc -march=rv64imac_zicsr_zifencei -mabi=lp64 -nostdlib -static -T verify/link.ld -o "$D/prog.elf" "$D/prog.S" 2> "$D/as.log" \
        || { echo "seed $s$mode: does not assemble"; cat "$D/as.log" | head -3; fail=$((fail + 1)); continue; }
    # time and line limits: a program that does not end must not fill the disk
    timeout 60 spike -l --log-commits --isa=rv64imac_zicsr_zicntr_zifencei_sstc_svadu "$D/prog.elf" 2>&1 | head -n $((N * 40 + 10000)) \
        | grep -E '^core +0: [0-3] 0x' | awk 'go || $4 ~ /^0x000000008/ { go = 1; print }' \
        | sed -E 's/^(core +0: [0-3] 0x[0-9a-f]+ \(0x[0-9a-f]+\))( x[0-9 ]+ 0x[0-9a-f]+)?.*/\1\2/' > "$D/spike.log"
    ${SIM:-$OBJ/rv64sim} -t -m $((N * 200)) "$D/prog.elf" 2> "$D/rtl.err" | head -n $((N * 40 + 10000)) | grep -E '^core' > "$D/rtl.log"
    grep -q PASS "$D/rtl.err" || echo "seed $s$mode: did not finish ($(tail -1 "$D/rtl.err"))"
    n=$(wc -l < "$D/rtl.log")
    if [ "$n" -gt 100 ] && cmp -s "$D/rtl.log" <(head -n "$n" "$D/spike.log"); then
        pass=$((pass + 1)); rm -rf "$D"
    else
        fail=$((fail + 1))
        echo "seed $s$mode: differs (rtl $n instructions)"
        diff <(head -n "$n" "$D/spike.log") "$D/rtl.log" | head -4
    fi
  done
done
echo "random tests: $pass passed, $fail failed"
[ $fail = 0 ]
