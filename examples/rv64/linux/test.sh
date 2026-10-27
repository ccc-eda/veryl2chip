#!/usr/bin/env bash
# Boot Linux on Rv64Soc (Verilator): OpenSBI -> Linux -> /init (linux/init.sh) -> a busybox
# shell; a few commands are typed at its prompt (rv64sim -s), then poweroff ends the
# simulation. Needs sim/build.sh and linux/build.sh.
set -uo pipefail
cd "$(dirname "$0")/.."
OBJ=${OBJ:-sim/obj}
OUT=$(mktemp)
SCRIPT=$(mktemp)
printf '%s\n' 'uname -a' 'echo $((6 * 7))' 'ls /bin | wc -l' 'cat /proc/cpuinfo | grep mmu' 'poweroff -f' > "$SCRIPT"
"$OBJ"/rv64sim -m 2000000000 -s "$SCRIPT" linux/build/opensbi/platform/generic/firmware/fw_payload.bin < /dev/null 2>&1 | tee "$OUT"
ok=1
for want in "OpenSBI" "Boot HART ISA Extensions *: sstc" "Linux version 6.12" "Run /init as init process" \
            "Hello from busybox on Rv64Core" "Linux .* riscv64 GNU/Linux" "^42" "mmu.*sv39" "reboot: Power down" "^PASS after"; do
    grep -q "$want" "$OUT" || { echo "MISSING: $want"; ok=0; }
done
rm -f "$OUT" "$SCRIPT"
[ $ok = 1 ] && echo "linux test: PASS" || { echo "linux test: FAIL"; exit 1; }
