#!/bin/sh
# Count to N, one number a second (default 10): a small program to run in the background.
#   sh count.sh 5            in the foreground (Ctrl-C stops it)
#   sh count.sh 100 > n.txt &    in the background; jobs, ps, kill %1, cat n.txt
n=${1:-10}
i=1
while [ $i -le $n ]; do
    echo $i
    sleep 1
    i=$((i + 1))
done
