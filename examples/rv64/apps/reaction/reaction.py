# Reaction time: when the green light comes on, press the button (GPIO 6) as fast as you can.
# Red (GPIO 5) = wait, green (GPIO 13) = go, yellow (GPIO 12) = you pressed too early.
# The best time is kept in best.txt; type savefiles on the board to send it back to the project.
# On the board: micropython reaction.py (Ctrl-C stops it)
import random
import time
from pi import LED, Button, sleep

red, yellow, green = LED(5), LED(12), LED(13)
button = Button(6)
ROUNDS = 5


def best_so_far():
    try:
        with open("best.txt") as f:
            return int(f.read())
    except (OSError, ValueError):
        return None


def wait_release():
    while button.is_pressed:
        sleep(0.01)


best = best_so_far()
print("Reaction time:", ROUNDS, "rounds; best so far:", "%d ms" % best if best else "none")
times = []
for r in range(1, ROUNDS + 1):
    print("Round", r, ": wait for green ...")
    red.on()
    # a random wait; pressing during it is too early
    end = time.ticks_add(time.ticks_ms(), random.randint(1000, 3000))
    early = False
    while time.ticks_diff(end, time.ticks_ms()) > 0:
        if button.is_pressed:
            early = True
            break
        sleep(0.005)
    red.off()
    if early:
        yellow.on()
        print("  too early!")
        wait_release()
        sleep(1)
        yellow.off()
        continue
    green.on()
    t0 = time.ticks_ms()
    while not button.is_pressed and time.ticks_diff(time.ticks_ms(), t0) < 3000:
        sleep(0.002)
    ms = time.ticks_diff(time.ticks_ms(), t0)
    green.off()
    if ms >= 3000:
        print("  no press in 3 s")
    else:
        print("  %d ms" % ms)
        times.append(ms)
    wait_release()
    sleep(0.5)

if times:
    print("average %d ms, fastest %d ms" % (sum(times) // len(times), min(times)))
    if best is None or min(times) < best:
        with open("best.txt", "w") as f:
            f.write(str(min(times)))
        print("a new best! (savefiles sends best.txt to the project)")
