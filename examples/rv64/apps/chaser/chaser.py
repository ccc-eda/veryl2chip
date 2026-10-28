# Eight LEDs chase each other on the breadboard (GPIO 3, 4, 5, 7, 8, 9, 10, 11).
# The button on GPIO 6 changes the speed, the one on GPIO 13 the direction.
# On the board: micropython chaser.py (Ctrl-C stops it); chaser.c is the same in C.
from pi import LED, Button, sleep

leds = [LED(n) for n in (3, 4, 5, 7, 8, 9, 10, 11)]
speed_button = Button(6)
dir_button = Button(13)
speeds = [0.4, 0.2, 0.1, 0.05]

speed = 1
step = 1
pos = 0
was = (False, False)
print("chaser: GPIO 6 = speed, GPIO 13 = direction")
while True:
    for i, led in enumerate(leds):
        led.value = i == pos
    # wait in short steps so that a short press is not missed
    t = 0
    while t < speeds[speed]:
        now = (speed_button.is_pressed, dir_button.is_pressed)
        if now[0] and not was[0]:
            speed = (speed + 1) % len(speeds)
            print("speed", speed + 1, "of", len(speeds))
        if now[1] and not was[1]:
            step = -step
            print("direction", "right" if step > 0 else "left")
        was = now
        sleep(0.02)
        t += 0.02
    pos = (pos + step) % len(leds)
