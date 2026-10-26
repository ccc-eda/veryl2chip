// C 實驗 4：七段顯示器 —— 兩位數 00–99，每 0.25 秒加一，BTN1 歸零
// 七段模組接在 PMOD1A：LED 暫存器的 bit 0–6 = 段 a–g，bit 7 選位數（0 = 個位）。
// 兩個位數共用 a–g，所以程式要「多工掃描」：快速輪流點亮個位和十位。

unsigned char digits[10] = {0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f};

int main(void) {
    int n = 0;
    unsigned next = millis() + 250;
    while (1) {
        LED = digits[n % 10];              // 個位
        delay_ms(2);
        LED = digits[n / 10] | 0x80;       // 十位
        delay_ms(2);
        if (BUTTONS & 1) n = 0;
        if (millis() >= next) {
            next += 250;
            n = (n + 1) % 100;
        }
    }
}
