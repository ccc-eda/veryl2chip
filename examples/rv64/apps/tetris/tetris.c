// Tetris on the board's screen, played with the four buttons on the breadboard (or the keyboard:
// click the board, then ← →  move, ↑ rotates, ↓ drops faster): left GPIO 6, right GPIO 13,
// rotate GPIO 5, down GPIO 12. Full rows disappear; the game speeds up every 10 rows.
// ▶ Run in the IDE compiles it; on the board: ./tetris (Ctrl-C stops it)
#include <gpio.h>
#include <screen.h>

#define W 10            // the well: 10 cells across, 20 down
#define H 20
#define CELL 11
#define X0 20           // where the well is on the screen
#define Y0 9
#define LEFT 6          // the buttons' GPIO pins
#define RIGHT 13
#define ROTATE 5
#define DOWN 12

// the seven pieces in their four rotations: 4 x 4 cells, a bit each (the top-left cell is bit 15)
int shapes[28] = {
    0x0F00, 0x2222, 0x00F0, 0x4444,     // I
    0x44C0, 0x8E00, 0x6440, 0x0E20,     // J
    0x4460, 0x0E80, 0xC440, 0x2E00,     // L
    0xCC00, 0xCC00, 0xCC00, 0xCC00,     // O
    0x06C0, 0x8C40, 0x6C00, 0x4620,     // S
    0x0E40, 0x4C40, 0x4E00, 0x4640,     // T
    0x0C60, 0x4C80, 0xC600, 0x2640,     // Z
};
int colors[8];
int well[W * H];        // 0 = empty, else the piece's number + 1
int piece, rot, px, py, next;
int score, rows, level, best;
int was[4];             // the buttons a moment ago: left, right, rotate, down

int filled(int shape, int r, int c) { return (shape >> (15 - r * 4 - c)) & 1; }

void cell(int x, int y, int color) {
    fb_rect(X0 + x * CELL + 1, Y0 + y * CELL + 1, CELL - 2, CELL - 2, color);
}

// does the piece fit with its corner at (x, y)?
int fits(int p, int r, int x, int y) {
    int i, j, s = shapes[p * 4 + r];
    for (i = 0; i < 4; i++)
        for (j = 0; j < 4; j++)
            if (filled(s, i, j)) {
                if (x + j < 0 || x + j >= W || y + i >= H) return 0;
                if (y + i >= 0 && well[(y + i) * W + x + j]) return 0;
            }
    return 1;
}

// draw the falling piece (show = 1) or the well under it (show = 0)
void draw_piece(int show) {
    int i, j, s = shapes[piece * 4 + rot];
    for (i = 0; i < 4; i++)
        for (j = 0; j < 4; j++)
            if (filled(s, i, j) && py + i >= 0)
                cell(px + j, py + i, show ? colors[piece + 1] : colors[0]);
}

void draw_well(void) {
    int x, y;
    for (y = 0; y < H; y++)
        for (x = 0; x < W; x++) cell(x, y, colors[well[y * W + x]]);
}

void draw_side(void) {
    char s[32];
    int i, j, sh = shapes[next * 4];
    fb_rect(150, 0, 170, SCREEN_H, BLACK);
    fb_text(156, 10, "TETRIS", YELLOW, 3);
    sprintf(s, "SCORE %d", score);
    fb_text(156, 50, s, WHITE, 2);
    sprintf(s, "ROWS  %d", rows);
    fb_text(156, 72, s, WHITE, 2);
    sprintf(s, "LEVEL %d", level);
    fb_text(156, 94, s, WHITE, 2);
    sprintf(s, "BEST  %d", best);
    fb_text(156, 116, s, RGB(150, 150, 150), 2);
    fb_text(156, 146, "NEXT", WHITE, 2);
    for (i = 0; i < 4; i++)
        for (j = 0; j < 4; j++)
            if (filled(sh, i, j)) fb_rect(160 + j * CELL + 1, 166 + i * CELL + 1, CELL - 2, CELL - 2, colors[next + 1]);
}

// a new piece at the top; 0 when it does not fit (the game is over)
int new_piece(void) {
    piece = next;
    next = rand() % 7;
    rot = 0;
    px = 3;
    py = -1;
    draw_side();
    if (!fits(piece, rot, px, py)) return 0;
    draw_piece(1);
    return 1;
}

// the piece stays where it is; full rows go
void lock(void) {
    int i, j, y, x, n = 0, s = shapes[piece * 4 + rot];
    for (i = 0; i < 4; i++)
        for (j = 0; j < 4; j++)
            if (filled(s, i, j) && py + i >= 0) well[(py + i) * W + px + j] = piece + 1;
    for (y = H - 1; y >= 0; y--) {
        int full = 1;
        for (x = 0; x < W; x++) if (!well[y * W + x]) full = 0;
        if (!full) continue;
        // move everything above down a row, look at this row again
        for (i = y; i > 0; i--)
            for (x = 0; x < W; x++) well[i * W + x] = well[(i - 1) * W + x];
        for (x = 0; x < W; x++) well[x] = 0;
        n++;
        y++;
    }
    if (n) {
        int points[5] = { 0, 100, 300, 500, 800 };
        score += points[n] * level;
        rows += n;
        level = rows / 10 + 1;
        draw_well();
    }
}

// try to move or turn the falling piece
int move(int dx, int dy, int dr) {
    int r = (rot + dr) % 4;
    if (!fits(piece, r, px + dx, py + dy)) return 0;
    draw_piece(0);
    px += dx;
    py += dy;
    rot = r;
    draw_piece(1);
    return 1;
}

void new_game(void) {
    int i;
    for (i = 0; i < W * H; i++) well[i] = 0;
    score = rows = 0;
    level = 1;
    fb_clear(BLACK);
    fb_rect(X0 - 2, Y0 - 2, W * CELL + 4, H * CELL + 4, RGB(90, 90, 90));
    fb_rect(X0, Y0, W * CELL, H * CELL, BLACK);
    draw_well();
    next = rand() % 7;
    new_piece();
}

int pressed(int k, int now) { int p = now && !was[k]; was[k] = now; return p; }

// show a message (two lines, centered in the well) and wait for any button
void wait_button(char *line1, char *line2) {
    fb_rect(X0, 92, W * CELL, 44, BLACK);
    fb_text(X0 + (W * CELL - strlen(line1) * 12) / 2, 98, line1, YELLOW, 2);
    fb_text(X0 + (W * CELL - strlen(line2) * 12) / 2, 118, line2, YELLOW, 2);
    while (!gpio_read(LEFT) && !gpio_read(RIGHT) && !gpio_read(ROTATE) && !gpio_read(DOWN)) delay_ms(30);
    while (gpio_read(LEFT) || gpio_read(RIGHT) || gpio_read(ROTATE) || gpio_read(DOWN)) delay_ms(30);
    fb_rect(X0, 92, W * CELL, 44, BLACK);
    was[0] = was[1] = was[2] = was[3] = 0;
}

int main(void) {
    int t = 0, held = 0, l, r, u, d;
    if (!fb_init()) { printf("no screen (/dev/fb0)\n"); return 1; }
    colors[0] = BLACK; colors[1] = CYAN; colors[2] = BLUE; colors[3] = RGB(255, 140, 0); colors[4] = YELLOW;
    colors[5] = GREEN; colors[6] = MAGENTA; colors[7] = RED;
    srand(millis());
    printf("tetris: GPIO 6 left, GPIO 13 right, GPIO 5 rotate, GPIO 12 down\n");
    new_game();
    wait_button("PRESS", "A BUTTON");
    draw_well();
    draw_piece(1);
    while (1) {
        // every 20 ms: the buttons
        delay_ms(20);
        l = gpio_read(LEFT);
        r = gpio_read(RIGHT);
        u = gpio_read(ROTATE);
        d = gpio_read(DOWN);
        // left and right move once, then again every 120 ms while held
        if (pressed(0, l)) { move(-1, 0, 0); held = 0; }
        else if (l && ++held % 6 == 0) move(-1, 0, 0);
        if (pressed(1, r)) { move(1, 0, 0); held = 0; }
        else if (r && ++held % 6 == 0) move(1, 0, 0);
        if (pressed(2, u)) { if (!move(0, 0, 1) && !move(-1, 0, 1)) move(1, 0, 1); }
        was[3] = d;
        // falling: faster at higher levels, fast while down is held
        t += 20;
        if (t < (d ? 40 : 600 - level * 50 > 100 ? 600 - level * 50 : 100)) continue;
        t = 0;
        if (move(0, 1, 0)) continue;
        lock();
        if (d) score += 1;
        if (!new_piece()) {
            printf("game over: score %d, rows %d\n", score, rows);
            if (score > best) best = score;
            draw_side();
            wait_button("GAME", "OVER");
            new_game();
        }
    }
}
