#!/bin/sh
# /init of the initramfs (busybox): mount the pseudo file systems, show what we run on,
# start a shell on the console (cttyhack gives it a controlling tty, so Ctrl-C works);
# when the shell exits, power off, which ends the simulation. getfiles / savefiles move
# files between /root and the IDE (the last 16 MB of the RAM).
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
# the project's files, when the IDE (or the test bench) put them in the exchange area
getfiles > /dev/null
setsid cttyhack sh
poweroff -f
