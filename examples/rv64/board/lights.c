// The traffic light of traffic.py in C: red GPIO 5, yellow GPIO 12, green GPIO 13 on the
// breadboard; the button on GPIO 6 ends the green light early. On the board: ./lights
#include <gpio.h>

#define RED    5
#define YELLOW 12
#define GREEN  13

void light(int on, int ms) {
    int t;
    gpio_write(RED, on == RED);
    gpio_write(YELLOW, on == YELLOW);
    gpio_write(GREEN, on == GREEN);
    printf("%s\n", on == RED ? "red" : on == YELLOW ? "yellow" : "green");
    for (t = 0; t < ms; t += 100) {
        if (on == GREEN && gpio_read(6)) { printf("button: crossing soon\n"); return; }
        delay_ms(100);
    }
}

int main(void) {
    while (1) {
        light(GREEN, 4000);
        light(YELLOW, 1000);
        light(RED, 3000);
    }
}
