// Breathing LEDs by software PWM: a pin switches on and off quickly, and the share of time it
// is on (the duty cycle) sets how bright the LED looks. Red, yellow and green (GPIO 5, 12, 13)
// breathe one after another. ▶ Run in the IDE compiles it; on the board: ./breathe (Ctrl-C stops it)
#include <gpio.h>

#define LEVELS 32   // brightness levels: a PWM period has LEVELS time slices
#define SLICE 2000  // loop rounds in a time slice
#define HOLD 4      // PWM periods at each level

int fds[3];
int lit[3];
int sink;

// switch LED k (through its open value file: cheaper than opening it every time)
void set(int k, int on) {
    if (lit[k] == on) return;
    lseek(fds[k], 0, 0);
    write(fds[k], on ? "1" : "0", 1);
    lit[k] = on;
}

// wait by counting: the slices must all take the same time
void spin(int n) {
    int i;
    for (i = 0; i < n; i++) sink += i;
}

// up and down: 0, 1, ..., LEVELS, ..., 1, 0, 1, ...
int level(int t) {
    t = t % (2 * LEVELS);
    return t < LEVELS ? t : 2 * LEVELS - t;
}

int main(void) {
    int pins[3] = { 5, 12, 13 };
    int k, s, h, t = 0;
    for (k = 0; k < 3; k++) {
        gpio_write(pins[k], 0);
        fds[k] = open(__gpio_file(pins[k], "value"), O_WRONLY);
    }
    printf("breathing: red, yellow, green (GPIO 5, 12, 13), %d levels\n", LEVELS);
    while (1) {
        for (h = 0; h < HOLD; h++)
            for (s = 0; s < LEVELS; s++) {
                // LED k is on for the first level(...) slices of the period
                for (k = 0; k < 3; k++) set(k, s < level(t + k * LEVELS * 2 / 3));
                spin(SLICE);
            }
        t++;
    }
}
