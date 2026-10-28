#!/bin/sh
# A first shell script: what machine is this? On the board: sh hello.sh
# Then try the exercises in exercises.txt (cat exercises.txt).
echo "Hello from $(uname -s) $(uname -r) on $(uname -m)"
echo "I am user $(id -u) (0 is root, the administrator), in $(pwd)"
echo "The board has been up for $(cut -d. -f1 /proc/uptime) seconds"
echo "CPU:$(grep -m1 '^isa' /proc/cpuinfo | cut -d: -f2)"
echo "Memory: $(grep MemTotal /proc/meminfo | tr -s ' ' | cut -d' ' -f2) kB"
echo "Files here:"
ls -l
