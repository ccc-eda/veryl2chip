#!/usr/bin/env bash
# Boot Linux on Rv64Soc (Verilator): OpenSBI -> Linux -> /init prints /proc/version and
# /proc/cpuinfo and powers off, which ends the simulation. Needs sim/build.sh and linux/build.sh.
set -uo pipefail
cd "$(dirname "$0")/.."
OBJ=${OBJ:-sim/obj}
OUT=$(mktemp)
"$OBJ"/rv64sim -m 1000000000 linux/build/opensbi/platform/generic/firmware/fw_payload.bin < /dev/null 2>&1 | tee "$OUT"
ok=1
for want in "OpenSBI" "Boot HART ISA Extensions *: sstc" "Linux version 6.12" "Run /init as init process" \
            "Hello from user space on Rv64Core" "mmu.*sv39" "reboot: Power down" "^PASS after"; do
    grep -q "$want" "$OUT" || { echo "MISSING: $want"; ok=0; }
done
rm -f "$OUT"
[ $ok = 1 ] && echo "linux test: PASS" || { echo "linux test: FAIL"; exit 1; }
