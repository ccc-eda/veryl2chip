#!/bin/sh
# /init of the initramfs (busybox): mount the pseudo file systems, show what we run on,
# start a shell on the console (cttyhack gives it a controlling tty, so Ctrl-C works);
# when the shell exits, power off, which ends the simulation.
mount -t proc proc /proc
mount -t sysfs sysfs /sys
mount -t devtmpfs devtmpfs /dev 2>/dev/null
mount -t tmpfs tmpfs /tmp 2>/dev/null
echo
echo "Hello from busybox on Rv64Core"
cat /proc/version
grep -E "^(isa|mmu)" /proc/cpuinfo
export HOME=/root PATH=/bin:/sbin:/usr/bin:/usr/sbin PS1='rv64:\w$ '
cd /root
setsid cttyhack sh
poweroff -f
