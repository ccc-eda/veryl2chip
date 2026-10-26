// C 實驗 5：音樂 —— 蜂鳴器接在 PMOD1A 腳 1（LED 暫存器的 bit 0）：
// 一個頻率 f 的方波，就是每 1/(2f) 秒把腳位反相一次。

void tone(int freq, int ms) {
    unsigned half = CLOCK_HZ / 2 / freq;   // 半個週期的時脈數
    unsigned end = TIMER + ms * 12000;
    unsigned t = TIMER;
    while (TIMER < end) {
        while (TIMER - t < half) ;
        t += half;
        LED = LED ^ 1;
    }
    LED = 0;
}

int main(void) {
    // 小星星：C C G G A A G, F F E E D D C
    int notes[] = {262, 262, 392, 392, 440, 440, 392, 0, 349, 349, 330, 330, 294, 294, 262, 0};
    int i;
    printf("Twinkle, twinkle...\n");
    for (i = 0; i < 16; i++) {
        if (notes[i]) tone(notes[i], 300); else delay_ms(300);
        delay_ms(50);
    }
    printf("done\n");
    return 0;
}
