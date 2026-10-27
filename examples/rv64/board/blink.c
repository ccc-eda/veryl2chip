// Blink the LED on GPIO 5 (the breadboard) and the board's USER LED in turn, like main.py.
// ▶ Run in the IDE compiles it for the board's Linux; on the board: ./blink (Ctrl-C stops it)
#include <gpio.h>

int main(void) {
    int n = 0;
    while (1) {
        gpio_write(5, 1);
        gpio_write(1, 0);
        delay_ms(500);
        gpio_write(5, 0);
        gpio_write(1, 1);
        delay_ms(500);
        printf("blink %d\n", ++n);
    }
}
