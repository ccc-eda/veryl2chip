# Blink the LED on GPIO 5 (the breadboard) and the board's USER LED in turn.
# On the board: micropython main.py (Ctrl-C stops it)
from pi import LED, sleep

red = LED(5)
user = LED(1)
n = 0
while True:
    red.on()
    user.off()
    sleep(0.5)
    red.off()
    user.on()
    sleep(0.5)
    n += 1
    print("blink", n)
