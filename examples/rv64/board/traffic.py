# A traffic light on the breadboard: red GPIO 5, yellow GPIO 12, green GPIO 13.
# The button on GPIO 6 asks to cross: the green light ends early.
# On the board: micropython traffic.py (Ctrl-C stops it)
from pi import LED, Button, sleep

red, yellow, green = LED(5), LED(12), LED(13)
walk = Button(6)


def light(on, seconds):
    for led in (red, yellow, green):
        led.value = led is on
    print({red: "red", yellow: "yellow", green: "green"}[on])
    t = 0
    while t < seconds:
        if on is green and walk.is_pressed:
            print("button: crossing soon")
            return
        sleep(0.1)
        t += 0.1


while True:
    light(green, 4)
    light(yellow, 1)
    light(red, 3)
