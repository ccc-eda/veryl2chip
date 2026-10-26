// C 實驗 2：跑馬燈 —— 和教學第 2 課的硬體跑馬燈比一比：同樣的事，這次用軟體做
// BTN1 加快、BTN2 變慢；按鈕要「按一下算一次」，所以記住上一次的狀態（軟體的上升緣偵測）

int main(void) {
    int pos = 0, dir = 1;
    int wait = 100;
    unsigned prev = 0;
    while (1) {
        LED = 1 << pos;
        pos += dir;
        if (pos == 7 || pos == 0) dir = -dir;
        // 等 wait ms，期間一直看按鈕
        unsigned start = millis();
        while (millis() - start < wait) {
            unsigned b = BUTTONS;
            unsigned pressed = b & ~prev;   // 這次是 1、上次是 0：剛按下
            prev = b;
            if ((pressed & 1) && wait > 20) wait -= 20;
            if ((pressed & 2) && wait < 400) wait += 20;
        }
    }
}
