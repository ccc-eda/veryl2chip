// C 實驗 8：多執行緒 —— 一個小小的搶佔式作業系統核心
// RvCore 有 machine mode 的陷阱（計時器中斷、ecall）與原子指令，足夠做執行緒切換：
//   計時器每 10 ms 中斷一次 → trap_entry 把暫存器存到目前執行緒的堆疊 → kernel_trap
//   選下一個執行緒、傳回它的堆疊 → trap_entry 從那個堆疊載回暫存器、mret 回到它中斷的地方
// 三個執行緒各自閃 LED 並在終端機印訊息；第三個是不讓出 CPU 的計算迴圈，靠搶佔照樣輪得到別人。
// printf 用互斥鎖（amoswap）保護，LED 的共用變數用關中斷保護。

#define NTHREADS 4          // 執行緒 0 是 main（閒置時 wfi）
#define SLICE    120000     // 時間片：10 ms（12 MHz）
#define STACK    192        // 每個執行緒的堆疊（字；最深用到約 560 bytes，含中斷的暫存器框）

unsigned *thread_sp[NTHREADS];      // 存起來的堆疊指標（指向暫存器框）
unsigned wake_at[NTHREADS];         // 睡到 mtime 的這個時刻
int alive[NTHREADS];
int current;
int nthreads = 1;
unsigned switches;                  // 切換了幾次

// ---- 陷阱入口：存 x1、x3..x31 與 mepc（32 個字的框，frame[i] = xi，frame[0] = mepc）----
void trap_entry(void);
asm("trap_entry:\n"
    " addi sp, sp, -128\n"
    " sw x1, 4(sp)\n sw x3, 12(sp)\n sw x4, 16(sp)\n sw x5, 20(sp)\n sw x6, 24(sp)\n sw x7, 28(sp)\n"
    " sw x8, 32(sp)\n sw x9, 36(sp)\n sw x10, 40(sp)\n sw x11, 44(sp)\n sw x12, 48(sp)\n sw x13, 52(sp)\n"
    " sw x14, 56(sp)\n sw x15, 60(sp)\n sw x16, 64(sp)\n sw x17, 68(sp)\n sw x18, 72(sp)\n sw x19, 76(sp)\n"
    " sw x20, 80(sp)\n sw x21, 84(sp)\n sw x22, 88(sp)\n sw x23, 92(sp)\n sw x24, 96(sp)\n sw x25, 100(sp)\n"
    " sw x26, 104(sp)\n sw x27, 108(sp)\n sw x28, 112(sp)\n sw x29, 116(sp)\n sw x30, 120(sp)\n sw x31, 124(sp)\n"
    " csrr t0, mepc\n sw t0, 0(sp)\n"
    " mv a0, sp\n"
    " call kernel_trap\n"          // 傳回要切換過去的框
    " mv sp, a0\n"
    " lw t0, 0(sp)\n csrw mepc, t0\n"
    " lw x1, 4(sp)\n lw x3, 12(sp)\n lw x4, 16(sp)\n lw x5, 20(sp)\n lw x6, 24(sp)\n lw x7, 28(sp)\n"
    " lw x8, 32(sp)\n lw x9, 36(sp)\n lw x10, 40(sp)\n lw x11, 44(sp)\n lw x12, 48(sp)\n lw x13, 52(sp)\n"
    " lw x14, 56(sp)\n lw x15, 60(sp)\n lw x16, 64(sp)\n lw x17, 68(sp)\n lw x18, 72(sp)\n lw x19, 76(sp)\n"
    " lw x20, 80(sp)\n lw x21, 84(sp)\n lw x22, 88(sp)\n lw x23, 92(sp)\n lw x24, 96(sp)\n lw x25, 100(sp)\n"
    " lw x26, 104(sp)\n lw x27, 108(sp)\n lw x28, 112(sp)\n lw x29, 116(sp)\n lw x30, 120(sp)\n lw x31, 124(sp)\n"
    " addi sp, sp, 128\n"
    " mret");

// 系統呼叫：a7 = 號碼，a0 = 參數，ecall 進入核心
void yield(void) { asm("li a7, 1\n ecall\n ret"); }
void sleep_ms(int ms) { asm("li a7, 2\n ecall\n ret"); }
void thread_exit(void) { asm("li a7, 3\n ecall"); }

unsigned *kernel_trap(unsigned *frame) {
    unsigned cause = read_mcause();
    unsigned now = MTIME;
    int i, next;
    if (cause == 0x80000007) {              // 計時器：排下一次
        MTIMECMP = now + SLICE;
    } else if (cause == 11) {               // ecall
        frame[0] += 4;                      // 回到 ecall 的下一個指令
        if (frame[17] == 2) wake_at[current] = now + frame[10] * 12000;
        if (frame[17] == 3) alive[current] = 0;
    } else {
        printf("\ntrap: mcause %x mepc %x\n", cause, frame[0]);
        alive[current] = 0;
    }
    thread_sp[current] = frame;
    // 輪流：從下一個開始找醒著的執行緒；都在睡就回到 main（閒置）
    next = 0;
    for (i = 1; i <= nthreads; i++) {
        int t = (current + i) % nthreads;
        if (t && alive[t] && (int)(now - wake_at[t]) >= 0) { next = t; break; }
    }
    if (next != current) switches++;
    current = next;
    return thread_sp[next];
}

// 新執行緒的堆疊頂端放一個框：mret 跳到 fn，fn 傳回時進入 thread_exit
int thread_create(void *fn, unsigned *stack) {
    unsigned *f = stack + STACK - 32;
    int t = nthreads;
    memset(f, 0, 128);
    f[0] = (unsigned)fn;
    f[1] = (unsigned)thread_exit;
    thread_sp[t] = f;
    wake_at[t] = MTIME;
    alive[t] = 1;
    nthreads++;
    return t;
}

void os_start(void) {
    set_mtvec(trap_entry);
    MTIMECMP = MTIME + SLICE;
    set_mie(MIE_MTIE);
    interrupts_on();
}

// ---- 同步 ----
volatile int print_lock;                // 互斥鎖：0 = 沒人用
void lock(volatile int *l) { while (atomic_swap(l, 1)) yield(); }
void unlock(volatile int *l) { atomic_swap(l, 0); }

unsigned leds;
void led_toggle(unsigned bit) {
    unsigned s = irq_save();            // 讀–改–寫 LED 時不能被切走
    leds ^= bit;
    LED = leds;
    irq_restore(s);
}

// ---- 執行緒 ----
void blinker(int bit, int ms, char *name) {
    int n = 0;
    while (1) {
        led_toggle(bit);
        if (++n % 8 == 0) { lock(&print_lock); printf("%s: %d\n", name, n); unlock(&print_lock); }
        sleep_ms(ms);
    }
}
void thread_a(void) { blinker(1, 100, "A"); }
void thread_b(void) { blinker(2, 170, "B"); }

// 不讓出 CPU 的計算：找質數。時間片用完就被計時器切走
void thread_primes(void) {
    int n = 2, count = 0;
    while (1) {
        int d = 2, prime = 1;
        while (d * d <= n) { if (n % d == 0) { prime = 0; break; } d++; }
        if (prime && ++count % 200 == 0) {
            led_toggle(128);
            lock(&print_lock);
            printf("primes: #%d = %d (%d switches)\n", count, n, switches);
            unlock(&print_lock);
        }
        n++;
    }
}

unsigned stack_a[STACK], stack_b[STACK], stack_p[STACK];

int main(void) {
    printf("threads: 3 threads, 10 ms time slice\n");
    alive[0] = 1;
    thread_create(thread_a, stack_a);
    thread_create(thread_b, stack_b);
    thread_create(thread_primes, stack_p);
    os_start();
    while (1) wfi();                    // 執行緒 0：閒置
}
