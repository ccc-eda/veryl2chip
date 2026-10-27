#!/usr/bin/env bash
# Boot Linux on Rv64Soc: OpenSBI -> Linux -> /init (linux/init.sh) -> a busybox shell; a few
# commands are typed at its prompt (rv64sim -s), including the GPIO: the board's LEDs
# (/sys/class/leds), a pin exported as an output, the button on GPIO 2 pressed by the
# script (!gpio 2=1) and read back, an edge interrupt through the PLIC, a file put in the
# exchange area (0x8F00_0000) read into /root by getfiles at boot; then poweroff ends
# the simulation. Needs sim/build.sh (or SIM=emu/rv64emu after emu/build.sh) and linux/build.sh.
set -uo pipefail
cd "$(dirname "$0")/.."
SIM=${SIM:-${OBJ:-sim/obj}/rv64sim}
OUT=$(mktemp)
SCRIPT=$(mktemp)
AREA=$(mktemp)
# the exchange area: "VERYLFS <bytes>" in a 512-byte block, then a tar with hello.txt
python3 - "$AREA" <<'P'
import io, sys, tarfile
b = io.BytesIO()
with tarfile.open(fileobj=b, mode='w', format=tarfile.USTAR_FORMAT) as t:
    data = b'hello from the test bench\n'
    i = tarfile.TarInfo('hello.txt'); i.size = len(data); t.addfile(i, io.BytesIO(data))
tar = b.getvalue()
open(sys.argv[1], 'wb').write(('VERYLFS %d\n' % len(tar)).encode().ljust(512, b'\0') + tar)
P
cat > "$SCRIPT" <<'S'
uname -a
echo $((6 * 7))
cat /proc/cpuinfo | grep mmu
echo none > /sys/class/leds/act/trigger; echo 1 > /sys/class/leds/user/brightness
B=$(cat /sys/class/gpio/gpiochip*/base); echo $((B+5)) > /sys/class/gpio/export; echo out > /sys/class/gpio/gpio$((B+5))/direction; echo 1 > /sys/class/gpio/gpio$((B+5))/value
echo $((B+2)) > /sys/class/gpio/export; echo both > /sys/class/gpio/gpio$((B+2))/edge; echo button $(cat /sys/class/gpio/gpio$((B+2))/value)
!gpio 2=1
echo button $(cat /sys/class/gpio/gpio$((B+2))/value); grep sifive-gpio /proc/interrupts
cat /root/hello.txt
poweroff -f
S
$SIM -m 3000000000 -s "$SCRIPT" -l 0x8F000000:"$AREA" linux/build/opensbi/platform/generic/firmware/fw_payload.bin < /dev/null 2>&1 | tee "$OUT"
ok=1
for want in "OpenSBI" "Boot HART ISA Extensions *: sstc" "Linux version 6.12" "Run /init as init process" \
            "Hello from busybox on Rv64Core" "Linux .* riscv64 GNU/Linux" "^42" "mmu.*sv39" \
            "\[gpio\] out=0x0022" "^button 0" "^button 1" " 1 *sifive-gpio *2 Edge" "^hello from the test bench" "reboot: Power down" "^PASS after"; do
    grep -q "$want" "$OUT" || { echo "MISSING: $want"; ok=0; }
done
rm -f "$OUT" "$SCRIPT" "$AREA"
[ $ok = 1 ] && echo "linux test: PASS" || { echo "linux test: FAIL"; exit 1; }
