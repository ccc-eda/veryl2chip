#!/usr/bin/env bash
# Rv64Core regression on Verilator: riscv-tests, random tests vs spike, the interrupt tests,
# riscv-tests on veryl-emu (the design compiled to WebAssembly, run in Node),
# Linux (when linux/build exists), the FPGA system Rv64Fpga (RTL; with --fpga also its ECP5 netlist and,
# after nextpnr-ecp5, the routed netlist: about 20 minutes more) and, with --xv6, xv6 (a few minutes more).
#   ./test.sh [--xv6] [--fpga] [--seeds N]
set -uo pipefail
cd "$(dirname "$0")"
[ -d /Users/Shared/ccc/oss-cad-suite/bin ] && export PATH=/Users/Shared/ccc/oss-cad-suite/bin:$PATH
XV6=false; FPGA=false; SEEDS=30
while [ $# -gt 0 ]; do
    case $1 in --xv6) XV6=true ;; --fpga) FPGA=true ;; --seeds) SEEDS=$2; shift ;; *) echo "usage: $0 [--xv6] [--fpga] [--seeds N]"; exit 2 ;; esac
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
step "veryl-emu (WebAssembly): build + riscv-tests" bash -c 'set -o pipefail; ./emu/build.sh 2>&1 | tail -1 && SIM=emu/rv64emu ./sim/riscv_tests.sh | tail -1'
if [ -f linux/build/opensbi/platform/generic/firmware/fw_payload.bin ]; then
    step "Linux" bash -c 'set -o pipefail; ./linux/test.sh | tail -2'
else
    echo "== Linux: skipped (linux/build.sh first)"
fi
step "Rv64Fpga (RTL)" bash -c 'set -o pipefail; ./sim/build_fpga.sh rtl > /dev/null && SIM=sim/obj_fpga_rtl/rv64fpga ./sim/riscv_tests.sh "rv64*-p-*" | tail -1'
if $FPGA; then
    step "Rv64Fpga (ECP5 netlist)" bash -c 'set -o pipefail; ./sim/build_fpga.sh ecp5 > /dev/null && SIM=sim/obj_fpga_ecp5/rv64fpga ./sim/riscv_tests.sh "rv64*-p-*" | tail -1'
    step "Rv64Fpga (nextpnr-ecp5, routed netlist)" bash -c 'set -o pipefail; ./fpga/ecp5.sh && ./sim/build_fpga.sh routed > /dev/null && SIM=sim/obj_fpga_routed/rv64fpga ./sim/riscv_tests.sh "rv64*-p-*" | tail -1'
fi
if $XV6; then step "xv6" bash -c 'set -o pipefail; ./xv6/test.sh | tail -2'; fi
[ $fail = 0 ] && echo "== all passed" || echo "== FAILED"
exit $fail
