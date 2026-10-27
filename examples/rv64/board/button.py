# Count presses of the board's button (GPIO 2); the LED on GPIO 5 shows the count's lowest bit.
# On the board: micropython button.py (Ctrl-C stops it)
from pi import LED, Button

button = Button(2)
led = LED(5)
n = 0
while True:
    button.wait_for_press()
    n += 1
    led.value = n % 2
    print("pressed", n)
    button.wait_for_release()
