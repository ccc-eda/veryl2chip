// Count presses of the board's button (GPIO 2); the LED on GPIO 5 shows the count's lowest
// bit, like button.py. On the board: ./count (Ctrl-C stops it)
#include <gpio.h>

int main(void) {
    int n = 0, last = 0;
    printf("press the button (GPIO 2)\n");
    while (1) {
        int v = gpio_read(2);
        if (v && !last) {
            n++;
            gpio_write(5, n % 2);
            printf("pressed %d\n", n);
        }
        last = v;
        delay_ms(10);
    }
}
