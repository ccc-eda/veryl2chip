// C 實驗 7：VGA 文字模式 —— RvVgaBoard（rvvga.veryl）把 40 × 30 個字元送到 VGA 螢幕
// 開機時程式把字型載入字型 RAM（vga_init），之後寫字元就會出現在畫面上。
// 畫面顯示開機後經過的時間和按鈕；在 🖥 USB 終端機打的字會出現在畫面下半部。

void box(int x, int y, int w, int h) {
    int i;
    vga_goto(x, y);          vga_putc('+'); for (i = 0; i < w - 2; i++) vga_putc('-'); vga_putc('+');
    for (i = 1; i < h - 1; i++) { vga_goto(x, y + i); vga_putc('|'); vga_goto(x + w - 1, y + i); vga_putc('|'); }
    vga_goto(x, y + h - 1); vga_putc('+'); for (i = 0; i < w - 2; i++) vga_putc('-'); vga_putc('+');
}

int main(void) {
    int col = 1, row = 16;
    unsigned last = 0xffffffff;
    vga_init();
    vga_color(0xff0, 0x00a);              // 黃字、深藍底
    box(0, 0, 40, 14);
    vga_goto(4, 2);  vga_puts("RISC-V in Veryl: VGA text mode");
    vga_goto(4, 4);  vga_puts("40 x 30 characters, 8 x 8 font");
    vga_goto(4, 6);  vga_puts("C program -> block RAM -> CPU");
    vga_goto(2, 15); vga_puts("Type on the USB terminal:");
    printf("Type here: the text appears on the VGA monitor.\n");
    while (1) {
        unsigned s = millis() / 1000;
        if (s != last) {
            last = s;
            vga_goto(4, 9);
            vga_printf("uptime %02d:%02d   buttons %d%d%d", s / 60, s % 60, BUTTONS & 1, (BUTTONS >> 1) & 1, (BUTTONS >> 2) & 1);
            LED = s;
        }
        if (kbhit()) {
            int c = getchar();
            if (c == '\r') { col = 1; row++; }
            else { vga_goto(col, row); vga_putc(c); if (++col == 39) { col = 1; row++; } }
            if (row == 29) row = 16;
            putchar(c == '\r' ? '\n' : c);
        }
    }
}
