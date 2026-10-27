#!/bin/sh
# Count presses of the board's button (GPIO 2) and show the count's lowest bit on the
# USER LED: sh button.sh (Ctrl-C ends it)
B=$(cat /sys/class/gpio/gpiochip*/base)
P=/sys/class/gpio/gpio$((B + 2))
[ -d $P ] || echo $((B + 2)) > /sys/class/gpio/export
n=0
last=0
while true; do
    v=$(cat $P/value)
    if [ $v = 1 ] && [ $last = 0 ]; then
        n=$((n + 1))
        echo "pressed $n"
        echo $((n % 2)) > /sys/class/leds/user/brightness
    fi
    last=$v
done
