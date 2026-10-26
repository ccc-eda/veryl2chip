// C 實驗 3：猜數字 —— 在 🖥 USB 終端機上玩；用「等你按鍵的時間」當亂數種子

int main(void) {
    char line[16];
    printf("Guess my number (1-100). Press Enter to start.\n");
    unsigned t = TIMER;
    getchar();
    srand(TIMER - t);
    while (1) {
        int secret = rand() % 100 + 1, tries = 0;
        printf("\nI have a number.\n");
        while (1) {
            printf("Your guess: ");
            read_line(line, sizeof line);
            int g = atoi(line);
            tries++;
            LED = tries;
            if (g < secret) printf("%d is too small\n", g);
            else if (g > secret) printf("%d is too big\n", g);
            else { printf("Right! %d tries.\n", tries); break; }
        }
    }
}
