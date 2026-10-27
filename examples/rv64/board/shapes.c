// Drawing on the board's screen from C: color bars, shapes, text, a bouncing ball.
// ▶ Run in the IDE compiles it; on the board: ./shapes (Ctrl-C stops it)
#include <screen.h>

int main(void) {
    int i, x = 40, y = 150, dx = 3, dy = 2;
    int colors[8] = { WHITE, YELLOW, CYAN, GREEN, MAGENTA, RED, BLUE, BLACK };
    if (!fb_init()) { printf("no screen (/dev/fb0)\n"); return 1; }
    fb_clear(BLACK);
    for (i = 0; i < 8; i++) fb_rect(i * 40, 0, 40, 60, colors[i]);
    fb_text(8, 70, "Hello from C", WHITE, 3);
    fb_line(0, 100, 319, 100, YELLOW);
    fb_circle(270, 170, 40, RGB(255, 128, 0), 1);
    fb_circle(270, 170, 46, WHITE, 0);
    printf("drawn; a ball bounces (Ctrl-C stops it)\n");
    while (1) {
        fb_circle(x, y, 8, BLACK, 1);
        x += dx;
        y += dy;
        if (x < 10 || x > 210) dx = -dx;
        if (y < 112 || y > 228) dy = -dy;
        fb_circle(x, y, 8, GREEN, 1);
        delay_ms(40);
    }
}
