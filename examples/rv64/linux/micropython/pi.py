# pi: the RV64 development board's GPIO for MicroPython, in the style of gpiozero.
# Frozen into /bin/micropython (linux/build.sh). GPIO 0 and 1 are the board's ACT and
# USER LEDs (/sys/class/leds), GPIO 2 its button, GPIO 3-15 the header pins; the other
# pins go through /sys/class/gpio. Screen draws on the board's 320 x 240 screen (/dev/fb0)
# with framebuf.
#
#   from pi import LED, Button, sleep
#   led = LED(5)
#   while True:
#       led.toggle()
#       sleep(0.5)

import framebuf
import os
import time

sleep = time.sleep
sleep_ms = time.sleep_ms

_LEDS = {0: "act", 1: "user"}
_base = None


def _write(path, s):
    with open(path, "w") as f:
        f.write(s)


def _read(path):
    with open(path) as f:
        return f.read().strip()


def _exists(path):
    try:
        os.stat(path)
        return True
    except OSError:
        return False


def _gpio(n):
    # /sys/class/gpio/gpioN of pin n (exported on first use)
    global _base
    if _base is None:
        for d in os.listdir("/sys/class/gpio"):
            if d.startswith("gpiochip"):
                _base = int(_read("/sys/class/gpio/" + d + "/base"))
        if _base is None:
            raise OSError("no GPIO controller")
    p = "/sys/class/gpio/gpio%d" % (_base + n)
    if not _exists(p):
        _write("/sys/class/gpio/export", str(_base + n))
    return p


class Pin:
    """A GPIO pin: Pin(n, Pin.OUT) / Pin(n, Pin.IN); value(), value(v), on(), off()"""

    IN = "in"
    OUT = "out"

    def __init__(self, n, mode=IN, value=None):
        if not 0 <= n < 16:
            raise ValueError("GPIO 0..15")
        self.n = n
        self._led = _LEDS.get(n)
        if self._led:
            self._path = "/sys/class/leds/" + self._led
            _write(self._path + "/trigger", "none")
        else:
            self._path = _gpio(n)
            if mode == Pin.OUT:
                _write(self._path + "/direction", "high" if value else "low")
            else:
                _write(self._path + "/direction", "in")
        if value is not None and self._led:
            self.value(value)

    def value(self, v=None):
        if v is None:
            if self._led:
                return 1 if int(_read(self._path + "/brightness")) else 0
            return int(_read(self._path + "/value"))
        _write(self._path + ("/brightness" if self._led else "/value"), "1" if v else "0")

    def on(self):
        self.value(1)

    def off(self):
        self.value(0)

    def __call__(self, v=None):
        return self.value(v)

    def __repr__(self):
        return "Pin(%d)" % self.n


class LED:
    """An LED on pin n (0 = ACT, 1 = USER, else a GPIO driving it high = lit)"""

    def __init__(self, n, initial_value=False):
        self.pin = Pin(n, Pin.OUT, 1 if initial_value else 0)

    def on(self):
        self.pin.value(1)

    def off(self):
        self.pin.value(0)

    def toggle(self):
        self.pin.value(1 - self.pin.value())

    @property
    def value(self):
        return self.pin.value()

    @value.setter
    def value(self, v):
        self.pin.value(v)

    @property
    def is_lit(self):
        return self.pin.value() == 1

    def blink(self, on_time=1, off_time=1, n=1):
        """blink n times (this waits: MicroPython here has no threads)"""
        for _ in range(n):
            self.on()
            sleep(on_time)
            self.off()
            sleep(off_time)

    def __repr__(self):
        return "LED(%d)" % self.pin.n


class Button:
    """A button on pin n that reads 1 when pressed (the board's button is GPIO 2)"""

    def __init__(self, n=2, active_high=True):
        self.pin = Pin(n, Pin.IN)
        self.active_high = active_high

    @property
    def is_pressed(self):
        return self.pin.value() == (1 if self.active_high else 0)

    @property
    def value(self):
        return 1 if self.is_pressed else 0

    def wait_for_press(self, timeout=None):
        return self._wait(True, timeout)

    def wait_for_release(self, timeout=None):
        return self._wait(False, timeout)

    def _wait(self, pressed, timeout):
        t0 = time.ticks_ms()
        while self.is_pressed != pressed:
            if timeout is not None and time.ticks_diff(time.ticks_ms(), t0) > timeout * 1000:
                return False
            sleep_ms(10)
        return True

    def __repr__(self):
        return "Button(%d)" % self.pin.n


def rgb(r, g, b):
    """a color for Screen (RGB565) from 0..255 red, green, blue"""
    return (r & 0xF8) << 8 | (g & 0xFC) << 3 | b >> 3


BLACK, WHITE, RED, GREEN, BLUE, YELLOW = 0, 0xFFFF, 0xF800, 0x07E0, 0x001F, 0xFFE0


class Screen(framebuf.FrameBuffer):
    """The board's screen, 320 x 240: framebuf drawing (fill, pixel, hline, vline, line,
    rect, fill_rect, ellipse, text, blit, scroll) in memory, then show() puts it on /dev/fb0"""

    WIDTH = 320
    HEIGHT = 240

    def __init__(self):
        self.buf = bytearray(self.WIDTH * self.HEIGHT * 2)
        super().__init__(self.buf, self.WIDTH, self.HEIGHT, framebuf.RGB565)

    def show(self):
        with open("/dev/fb0", "wb") as f:
            f.write(self.buf)

    def big_text(self, s, x, y, c, scale=2):
        """text with letters scale times as large (8 x 8 each normally)"""
        t = framebuf.FrameBuffer(bytearray(8 * 8 * 2), 8, 8, framebuf.RGB565)
        for k, ch in enumerate(s):
            t.fill(0)
            t.text(ch, 0, 0, 1)
            for j in range(8):
                for i in range(8):
                    if t.pixel(i, j):
                        self.fill_rect(x + (k * 8 + i) * scale, y + j * scale, scale, scale, c)
