#!/bin/sh
# Blink the LED on GPIO 5 (the breadboard) five times: sh blink.sh
B=$(cat /sys/class/gpio/gpiochip*/base)
P=/sys/class/gpio/gpio$((B + 5))
[ -d $P ] || echo $((B + 5)) > /sys/class/gpio/export
echo out > $P/direction
for i in 1 2 3 4 5; do
    echo 1 > $P/value
    sleep 1
    echo 0 > $P/value
    sleep 1
done
echo "blinked 5 times"
