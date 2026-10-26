// C 實驗 6：開關 —— PMOD1B 的 8 個開關（SWITCHES）顯示在 PMOD1A 的 8 顆 LED，
// 開關一變就在終端機印出它的二進位、十六進位和十進位

int main(void) {
    unsigned last = 256;
    while (1) {
        unsigned s = SWITCHES;
        LED = s;
        if (s != last) {
            int i;
            printf("switches ");
            for (i = 7; i >= 0; i--) putchar(s & (1 << i) ? '1' : '0');
            printf(" = 0x%02x = %d\n", s, s);
            last = s;
        }
    }
}
