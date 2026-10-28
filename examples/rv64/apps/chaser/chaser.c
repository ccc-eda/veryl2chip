// Eight LEDs chase each other on the breadboard (GPIO 3, 4, 5, 7, 8, 9, 10, 11), like chaser.py.
// The button on GPIO 6 changes the speed, the one on GPIO 13 the direction.
// ▶ Run in the IDE compiles it; on the board: ./chaser (Ctrl-C stops it)
#include <gpio.h>

int main(void) {
    int leds[8] = { 3, 4, 5, 7, 8, 9, 10, 11 };
    int speeds[4] = { 400, 200, 100, 50 };
    int speed = 1, step = 1, pos = 0, i, t;
    int was_speed = 0, was_dir = 0, now_speed, now_dir;
    printf("chaser (C): GPIO 6 = speed, GPIO 13 = direction\n");
    while (1) {
        for (i = 0; i < 8; i++) gpio_write(leds[i], i == pos);
        // wait in short steps so that a short press is not missed
        for (t = 0; t < speeds[speed]; t += 20) {
            now_speed = gpio_read(6);
            now_dir = gpio_read(13);
            if (now_speed && !was_speed) {
                speed = (speed + 1) % 4;
                printf("speed %d of 4\n", speed + 1);
            }
            if (now_dir && !was_dir) {
                step = -step;
                printf("direction %s\n", step > 0 ? "right" : "left");
            }
            was_speed = now_speed;
            was_dir = now_dir;
            delay_ms(20);
        }
        pos = (pos + step + 8) % 8;
    }
}
