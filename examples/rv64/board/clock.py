# A clock on the board's screen: the hands and the time (since the board booted).
# On the board: micropython clock.py (Ctrl-C stops it)
import math
import time
from pi import Screen, rgb, BLACK, WHITE, RED, YELLOW

scr = Screen()
CX, CY, R = 160, 104, 90


def hand(angle, length, color):
    a = (angle - 90) * math.pi / 180
    scr.line(CX, CY, CX + int(length * math.cos(a)), CY + int(length * math.sin(a)), color)


last = -1
while True:
    t = time.localtime()
    h, m, s = t[3], t[4], t[5]
    if s == last:
        time.sleep_ms(100)
        continue
    last = s
    scr.fill(rgb(0, 0, 64))
    scr.ellipse(CX, CY, R, R, WHITE)
    for k in range(12):
        a = k * math.pi / 6
        scr.fill_rect(CX + int((R - 8) * math.sin(a)) - 2, CY - int((R - 8) * math.cos(a)) - 2, 4, 4, YELLOW)
    hand((h % 12) * 30 + m / 2, 50, WHITE)
    hand(m * 6, 75, WHITE)
    hand(s * 6, 82, RED)
    scr.big_text("%02d:%02d:%02d" % (h, m, s), 96, 206, YELLOW, 2)
    scr.show()
