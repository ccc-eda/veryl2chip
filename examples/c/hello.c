// C 實驗 1：Hello —— 序列埠印字、LED 計數、把收到的字元回傳
// 這個 C 程式跑在 RvSoc（rvsoc.veryl）的 RISC-V CPU 上：⚡ 虛擬板會先編譯它，
// 再把機器碼放進 SoC 的 block RAM。打開 🖥 USB 終端機就能和它對話。

int main(void) {
    int n = 0;
    unsigned next = 0;
    printf("Hello from C on a RISC-V you built in Veryl!\n");
    printf("Type something: I will send it back in upper case.\n");
    while (1) {
        // LED 每 200 ms 加一（用計時器，不用 delay，這樣同時還能收字）
        if ((int)(TIMER - next) >= 0) {
            LED = n++;
            next = TIMER + 200 * 12000;
        }
        if (kbhit()) {
            int c = getchar();
            if (c >= 'a' && c <= 'z') c = c - 'a' + 'A';
            putchar(c == '\r' ? '\n' : c);
        }
    }
}
