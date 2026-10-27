#!/usr/bin/env bash
# Rv64Core regression on Verilator: riscv-tests, random tests vs spike, the interrupt tests,
# Linux (when linux/build exists) and, with --xv6, xv6 (a few minutes more).
#   ./test.sh [--xv6] [--seeds N]
set -uo pipefail
cd "$(dirname "$0")"
[ -d /Users/Shared/ccc/oss-cad-suite/bin ] && export PATH=/Users/Shared/ccc/oss-cad-suite/bin:$PATH
XV6=false; SEEDS=30
while [ $# -gt 0 ]; do
    case $1 in --xv6) XV6=true ;; --seeds) SEEDS=$2; shift ;; *) echo "usage: $0 [--xv6] [--seeds N]"; exit 2 ;; esac
    shift
done
fail=0
step() { echo "== $1"; shift; "$@" || fail=1; }
step "build (veryl build + Verilator)" ./sim/build.sh
step "riscv-tests" ./sim/riscv_tests.sh
step "random tests vs spike ($SEEDS seeds x M/S/U)" ./verify/random.sh 1 "$SEEDS"
irq() {
    riscv64-unknown-elf-gcc -march=rv64imac_zicsr_zifencei -mabi=lp64 -nostdlib -static -T verify/link.ld -o sim/obj/irq.elf verify/irq.S &&
    ./sim/obj/rv64sim -m 20000000 sim/obj/irq.elf 2>&1 | tail -1 | tee /dev/stderr | grep -q PASS
}
step "interrupt tests" irq
if [ -f linux/build/opensbi/platform/generic/firmware/fw_payload.bin ]; then
    step "Linux" bash -c './linux/test.sh | tail -2'
else
    echo "== Linux: skipped (linux/build.sh first)"
fi
if $XV6; then step "xv6" bash -c './xv6/test.sh | tail -2'; fi
[ $fail = 0 ] && echo "== all passed" || echo "== FAILED"
exit $fail
