// The runtime library of veryl-eda's C compiler for RvSoc (examples/src/rvsoc.veryl).
// It is always compiled with the program; only the functions the program uses are kept.

// ---- the SoC's peripherals (memory mapped) ----
#define LED         (*(volatile unsigned *)0x10000000)  // 8 LEDs (PMOD1A), read / write
#define BUTTONS     (*(volatile unsigned *)0x10000004 & 7)         // bit 0..2 = BTN1..BTN3 (1 = pressed)
#define SWITCHES    ((*(volatile unsigned *)0x10000004 >> 8) & 255) // the 8 switches on PMOD1B
#define UART_DATA   (*(volatile unsigned *)0x10000008)  // write: send a byte; read: the received byte
#define UART_STATUS (*(volatile unsigned *)0x1000000c)  // bit 0 = sending, bit 1 = a byte was received
#define TIMER       (*(volatile unsigned *)0x10000010)  // clock cycles since reset (12 MHz)
#define CLOCK_HZ    12000000

#define NULL ((void *)0)

// variable arguments: the arguments are consecutive words after the last named one
#define va_list int *
#define va_start(ap, last) ((ap) = (int *)&(last) + 1)
#define va_arg(ap, type) ((type)*(ap)++)
#define va_end(ap)

// ---- RV32I has no multiply / divide instructions: these do it in software ----
unsigned __mulsi3(unsigned a, unsigned b) {
    unsigned r = 0;
    while (b) {
        if (b & 1) r += a;
        a <<= 1;
        b >>= 1;
    }
    return r;
}

unsigned __udivmod(unsigned n, unsigned d, int want_mod) {
    unsigned q = 0, r = 0;
    int i;
    if (d == 0) return want_mod ? n : 0xffffffff;
    for (i = 31; i >= 0; i--) {
        r = (r << 1) | ((n >> i) & 1);
        if (r >= d) { r -= d; q |= 1u << i; }
    }
    return want_mod ? r : q;
}

unsigned __udivsi3(unsigned n, unsigned d) { return __udivmod(n, d, 0); }
unsigned __umodsi3(unsigned n, unsigned d) { return __udivmod(n, d, 1); }

int __divsi3(int a, int b) {
    int neg = 0;
    unsigned q;
    if (a < 0) { a = -a; neg = !neg; }
    if (b < 0) { b = -b; neg = !neg; }
    q = __udivmod(a, b, 0);
    return neg ? -(int)q : (int)q;
}

int __modsi3(int a, int b) {
    int neg = a < 0;
    unsigned r;
    if (a < 0) a = -a;
    if (b < 0) b = -b;
    r = __udivmod(a, b, 1);
    return neg ? -(int)r : (int)r;
}

// ---- the serial port (USB terminal) ----
int putchar(int c) {
    if (c == '\n') putchar('\r');
    while (UART_STATUS & 1) ;
    UART_DATA = c;
    return c;
}

int getchar(void) {
    while (!(UART_STATUS & 2)) ;
    return UART_DATA;
}

// 1 when a received byte is waiting (getchar will not wait)
int kbhit(void) { return (UART_STATUS & 2) != 0; }

int puts(char *s) {
    while (*s) putchar(*s++);
    putchar('\n');
    return 0;
}

static void __pnum(unsigned v, int base, int neg, int width, int zero, int upper) {
    char buf[12];
    int n = 0;
    char *digits = upper ? "0123456789ABCDEF" : "0123456789abcdef";
    do {
        buf[n++] = digits[v % base];
        v = v / base;
    } while (v);
    if (neg) {
        if (zero) { putchar('-'); width--; } else buf[n++] = '-';
    }
    while (n < width) { putchar(zero ? '0' : ' '); width--; }
    while (n > 0) putchar(buf[--n]);
}

// %d %i %u %x %X %c %s %%, with a width (%5d) and zero padding (%08x)
int printf(char *fmt, ...) {
    va_list ap;
    int c;
    va_start(ap, fmt);
    while ((c = *fmt++)) {
        if (c != '%') { putchar(c); continue; }
        int zero = 0, width = 0;
        c = *fmt++;
        if (c == '0') { zero = 1; c = *fmt++; }
        while (c >= '0' && c <= '9') { width = width * 10 + c - '0'; c = *fmt++; }
        if (c == 'l') c = *fmt++;
        if (c == 'd' || c == 'i') {
            int v = va_arg(ap, int);
            if (v < 0) __pnum(-v, 10, 1, width, zero, 0); else __pnum(v, 10, 0, width, zero, 0);
        } else if (c == 'u') __pnum(va_arg(ap, unsigned), 10, 0, width, zero, 0);
        else if (c == 'x' || c == 'X') __pnum(va_arg(ap, unsigned), 16, 0, width, zero, c == 'X');
        else if (c == 'c') putchar(va_arg(ap, int));
        else if (c == 's') {
            char *s = va_arg(ap, char *);
            int n = 0;
            while (s[n]) n++;
            while (n < width) { putchar(' '); width--; }
            while (*s) putchar(*s++);
        } else if (c == 0) break;
        else putchar(c);
    }
    va_end(ap);
    return 0;
}

// read a line from the terminal (echoed, backspace works) into buf; its length
int read_line(char *buf, int size) {
    int n = 0;
    while (1) {
        int c = getchar();
        if (c == '\r' || c == '\n') { putchar('\n'); break; }
        if ((c == 8 || c == 127) && n > 0) { n--; putchar(8); putchar(' '); putchar(8); continue; }
        if (c >= ' ' && n < size - 1) { buf[n++] = c; putchar(c); }
    }
    buf[n] = 0;
    return n;
}

// ---- time ----
unsigned millis(void) { return TIMER / 12000; }

void delay_ms(int ms) {
    unsigned start = TIMER;
    unsigned n = ms * 12000;
    while (TIMER - start < n) ;
}

void delay_us(int us) {
    unsigned start = TIMER;
    unsigned n = us * 12;
    while (TIMER - start < n) ;
}

// ---- small helpers from the C library ----
unsigned __rand_state = 1;
int rand(void) {
    __rand_state = __rand_state * 1103515245 + 12345;
    return (__rand_state >> 16) & 0x7fff;
}
void srand(unsigned seed) { __rand_state = seed; }

int abs(int x) { return x < 0 ? -x : x; }

int strlen(char *s) {
    int n = 0;
    while (s[n]) n++;
    return n;
}

int strcmp(char *a, char *b) {
    while (*a && *a == *b) { a++; b++; }
    return *a - *b;
}

char *strcpy(char *d, char *s) {
    char *r = d;
    while ((*d++ = *s++)) ;
    return r;
}

void *memset(void *p, int v, int n) {
    char *c = (char *)p;
    while (n-- > 0) *c++ = v;
    return p;
}

void *memcpy(void *d, void *s, int n) {
    char *a = (char *)d;
    char *b = (char *)s;
    while (n-- > 0) *a++ = *b++;
    return d;
}

int atoi(char *s) {
    int n = 0, neg = 0;
    while (*s == ' ') s++;
    if (*s == '-') { neg = 1; s++; }
    while (*s >= '0' && *s <= '9') n = n * 10 + *s++ - '0';
    return neg ? -n : n;
}
