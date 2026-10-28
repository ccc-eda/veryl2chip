// Snake on the board's screen: the snake moves by itself, the buttons on the breadboard turn it
// left (GPIO 6) or right (GPIO 13). Press a button to start; eat the red food to grow; hitting a wall
// or yourself ends the game, a button starts again. ▶ Run in the IDE compiles it; on the board: ./snake (Ctrl-C stops it)
#include <gpio.h>
#include <screen.h>

#define CELL 10
#define W 32          // cells across (320 / CELL)
#define H 22          // cells down, below the 20-pixel score line
#define TOP 20
#define MAX 400

int sx[MAX], sy[MAX];
int len, dir, fx, fy, score, best;
int dxs[4] = { 1, 0, -1, 0 };   // right, down, left, up
int dys[4] = { 0, 1, 0, -1 };
int was_left, was_right;

void cell(int x, int y, int c) { fb_rect(x * CELL + 1, TOP + y * CELL + 1, CELL - 2, CELL - 2, c); }

int on_snake(int x, int y) {
    int i;
    for (i = 0; i < len; i++) if (sx[i] == x && sy[i] == y) return 1;
    return 0;
}

void place_food(void) {
    do { fx = rand() % W; fy = rand() % H; } while (on_snake(fx, fy));
    cell(fx, fy, RED);
}

void show_score(void) {
    char s[40];
    fb_rect(0, 0, SCREEN_W, TOP - 2, BLACK);
    sprintf(s, "SCORE %d  BEST %d", score, best);
    fb_text(4, 2, s, WHITE, 2);
}

void start(void) {
    int i;
    fb_clear(BLACK);
    fb_rect(0, TOP - 2, SCREEN_W, 1, RGB(80, 80, 80));
    len = 4;
    dir = 0;
    score = 0;
    for (i = 0; i < len; i++) { sx[i] = 8 - i; sy[i] = H / 2; cell(sx[i], sy[i], GREEN); }
    place_food();
    show_score();
}

// show a message and wait for a press of either button
void wait_button(char *msg) {
    fb_text(160 - strlen(msg) * 6, 120, msg, YELLOW, 2);
    while (!gpio_read(6) && !gpio_read(13)) delay_ms(30);
    while (gpio_read(6) || gpio_read(13)) delay_ms(30);
    was_left = was_right = 0;
}

// the buttons: a press (not a hold) turns the snake
void buttons(void) {
    int l = gpio_read(6), r = gpio_read(13);
    if (l && !was_left) dir = (dir + 3) % 4;
    if (r && !was_right) dir = (dir + 1) % 4;
    was_left = l;
    was_right = r;
}

int main(void) {
    int i, nx, ny, t;
    if (!fb_init()) { printf("no screen (/dev/fb0)\n"); return 1; }
    srand(millis());
    printf("snake: GPIO 6 turns left, GPIO 13 turns right\n");
    start();
    wait_button("PRESS A BUTTON");
    start();
    while (1) {
        // a step every 150 ms, the buttons read in between
        for (t = 0; t < 5; t++) { buttons(); delay_ms(30); }
        nx = sx[0] + dxs[dir];
        ny = sy[0] + dys[dir];
        if (nx < 0 || nx >= W || ny < 0 || ny >= H || on_snake(nx, ny)) {
            fb_text(76, 90, "GAME OVER", YELLOW, 3);
            printf("game over: score %d\n", score);
            if (score > best) best = score;
            wait_button("PRESS A BUTTON");
            start();
            continue;
        }
        if (nx == fx && ny == fy) {
            if (len < MAX) len++;
            score++;
            show_score();
        } else cell(sx[len - 1], sy[len - 1], BLACK);
        for (i = len - 1; i > 0; i--) { sx[i] = sx[i - 1]; sy[i] = sy[i - 1]; }
        sx[0] = nx;
        sy[0] = ny;
        cell(nx, ny, GREEN);
        if (nx == fx && ny == fy) place_food();
    }
}
