// The runtime library of veryl-eda's C compiler for RvSoc (examples/src/rvsoc.veryl)
// and, with __linux__, for programs on the RV64 board's Linux (examples/rv64).
// It is always compiled with the program; only the functions the program uses are kept.

#ifndef __linux__
// ---- the SoC's peripherals (memory mapped) ----
#define LED         (*(volatile unsigned *)0x10000000)  // 8 LEDs (PMOD1A), read / write
#define BUTTONS     (*(volatile unsigned *)0x10000004 & 7)         // bit 0..2 = BTN1..BTN3 (1 = pressed)
#define SWITCHES    ((*(volatile unsigned *)0x10000004 >> 8) & 255) // the 8 switches on PMOD1B
#define UART_DATA   (*(volatile unsigned *)0x10000008)  // write: send a byte; read: the received byte
#define UART_STATUS (*(volatile unsigned *)0x1000000c)  // bit 0 = sending, bit 1 = a byte was received
#define TIMER       (*(volatile unsigned *)0x10000010)  // clock cycles since reset (12 MHz) = mtime
#define MTIME       (*(volatile unsigned *)0x10000010)
#define MTIMECMP    (*(volatile unsigned *)0x10000018)  // timer interrupt when MTIME >= MTIMECMP
#define MSIP        (*(volatile unsigned *)0x10000020)  // 1: software interrupt
#define CLOCK_HZ    12000000
// VGA text mode (RvVgaBoard, examples/src/rvvga.veryl): 40 x 30 characters
#define VGA_TEXT    ((volatile unsigned *)0x10002000)       // character of cell row * 40 + column
#define VGA_FONT    ((volatile unsigned *)0x10004000)       // font: character * 8 + row
#define VGA_COLOR   (*(volatile unsigned *)0x10006000)      // foreground | background << 16 (0xRGB each)
#define VGA_COLS    40
#define VGA_ROWS    30
#endif

#define NULL ((void *)0)

// variable arguments: the arguments are consecutive words after the last named one
#define va_list int *
#define va_start(ap, last) ((ap) = (int *)&(last) + 1)
#define va_arg(ap, type) ((type)*(ap)++)
#define va_end(ap)

// ---- RV32I without M: multiply / divide in software (RvCore has M: the compiler uses mul / div) ----
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

#ifdef __linux__
// ---- Linux system calls (ecall, the number in a7): the program is an RV64 process ----
int __syscall(int n, int a, int b, int c, int d) { asm("mv a7, a0\n mv a0, a1\n mv a1, a2\n mv a2, a3\n mv a3, a4\n ecall\n ret"); }

#define O_RDONLY 0
#define O_WRONLY 1
#define O_RDWR   2
#define O_CREAT  64
#define O_TRUNC  512
#define O_APPEND 1024
#define EOF      (-1)

// open a file (O_CREAT makes it with mode 0644, a third argument is ignored); a file descriptor, or a negative error
int open(char *path, int flags, ...) { return __syscall(56, -100, (int)path, flags, 0644); }
int read(int fd, void *buf, int n) { return __syscall(63, fd, (int)buf, n, 0); }
int write(int fd, void *buf, int n) { return __syscall(64, fd, (int)buf, n, 0); }
int close(int fd) { return __syscall(57, fd, 0, 0, 0); }
int lseek(int fd, int off, int whence) { return __syscall(62, fd, off, whence, 0); }
int unlink(char *path) { return __syscall(35, -100, (int)path, 0, 0); }
int getpid(void) { return __syscall(172, 0, 0, 0, 0); }

// standard output is buffered: a line at a time
char __obuf[256];
int __on;
void __flush(void) { if (__on) { write(1, __obuf, __on); __on = 0; } }
#define stdout 1
int fflush(int f) { __flush(); return 0; }

void exit(int code) { __flush(); __syscall(94, code, 0, 0, 0); }

int putchar(int c) {
    __obuf[__on++] = c;
    if (c == '\n' || __on == 256) __flush();
    return c;
}

// the next byte of standard input (the terminal gives a line at a time), EOF at the end
int getchar(void) {
    char c;
    __flush();
    if (read(0, &c, 1) != 1) return EOF;
    return c;
}

// memory: grows the program's break (free does nothing)
char *__brk;
void *malloc(int n) {
    char *p;
    if (!__brk) __brk = (char *)__syscall(214, 0, 0, 0, 0);
    n = (n + 7) & ~7;
    if (__syscall(214, (int)(__brk + n), 0, 0, 0) != (int)(__brk + n)) return NULL;
    p = __brk;
    __brk = __brk + n;
    return p;
}
void free(void *p) {}
#else
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
#endif

int puts(char *s) {
    while (*s) putchar(*s++);
    putchar('\n');
    return 0;
}

void __emit(int c);
static void __pnum(unsigned v, int base, int neg, int width, int zero, int upper) {
    char buf[12];
    int n = 0;
    char *digits = upper ? "0123456789ABCDEF" : "0123456789abcdef";
    do {
        buf[n++] = digits[v % base];
        v = v / base;
    } while (v);
    if (neg) {
        if (zero) { __emit('-'); width--; } else buf[n++] = '-';
    }
    while (n < width) { __emit(zero ? '0' : ' '); width--; }
    while (n > 0) __emit(buf[--n]);
}

// where the formatted characters go: the serial port, or a string (sprintf)
char *__sbuf;
void __emit(int c) { if (__sbuf) *__sbuf++ = c; else putchar(c); }

// %d %i %u %x %X %c %s %%, with a width (%5d) and zero padding (%08x)
int __vprintf(char *fmt, int *ap) {
    int c;
    while ((c = *fmt++)) {
        if (c != '%') { __emit(c); continue; }
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
        else if (c == 'c') __emit(va_arg(ap, int));
        else if (c == 's') {
            char *s = va_arg(ap, char *);
            int n = 0;
            while (s[n]) n++;
            while (n < width) { __emit(' '); width--; }
            while (*s) __emit(*s++);
        } else if (c == 0) break;
        else __emit(c);
    }
    return 0;
}

int printf(char *fmt, ...) {
    va_list ap;
    va_start(ap, fmt);
    __sbuf = 0;
    return __vprintf(fmt, ap);
}

// like printf, into buf; the length
int sprintf(char *buf, char *fmt, ...) {
    va_list ap;
    int n;
    va_start(ap, fmt);
    __sbuf = buf;
    __vprintf(fmt, ap);
    *__sbuf = 0;
    n = __sbuf - buf;
    __sbuf = 0;
    return n;
}

#ifdef __linux__
// read a line from standard input (the terminal echoes it) into buf, without the newline; its length (-1 at the end)
int read_line(char *buf, int size) {
    int n = 0, c;
    while ((c = getchar()) != '\n') {
        if (c == EOF) { if (n == 0) return -1; break; }
        if (n < size - 1) buf[n++] = c;
    }
    buf[n] = 0;
    return n;
}

// ---- time ----
int __ts[4];
// milliseconds since boot
unsigned millis(void) { __syscall(113, 1, (int)__ts, 0, 0); return __ts[0] * 1000 + __ts[2] / 1000000; }

int usleep(int us) {
    __flush();
    __ts[0] = us / 1000000;
    __ts[1] = 0;
    __ts[2] = us % 1000000 * 1000;
    __ts[3] = 0;
    return __syscall(101, (int)__ts, 0, 0, 0);
}
unsigned sleep(unsigned s) {
    __flush();
    __ts[0] = s;
    __ts[1] = 0;
    __ts[2] = 0;
    __ts[3] = 0;
    __syscall(101, (int)__ts, 0, 0, 0);
    return 0;
}
void delay_ms(int ms) { usleep(ms * 1000); }
void delay_us(int us) { usleep(us); }
#else
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
#endif

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

int strncmp(char *a, char *b, int n) {
    while (n > 0 && *a && *a == *b) { a++; b++; n--; }
    return n == 0 ? 0 : *a - *b;
}

char *strcat(char *d, char *s) {
    char *r = d;
    while (*d) d++;
    while ((*d++ = *s++)) ;
    return r;
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

// the 5 x 7 font of ASCII 32-126 (tools/font5x7.py): 8 rows a character, bit 6 = the left column
unsigned char __font[760] = {
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x10, 0x10, 0x10, 0x10, 0x10, 0x00, 0x10, 0x00,
    0x28, 0x28, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x28, 0x28, 0x7c, 0x28, 0x7c, 0x28, 0x28, 0x00,
    0x10, 0x3c, 0x50, 0x38, 0x14, 0x78, 0x10, 0x00, 0x60, 0x64, 0x08, 0x10, 0x20, 0x4c, 0x0c, 0x00,
    0x20, 0x50, 0x50, 0x20, 0x54, 0x48, 0x34, 0x00, 0x10, 0x10, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x08, 0x10, 0x20, 0x20, 0x20, 0x10, 0x08, 0x00, 0x20, 0x10, 0x08, 0x08, 0x08, 0x10, 0x20, 0x00,
    0x00, 0x10, 0x54, 0x38, 0x54, 0x10, 0x00, 0x00, 0x00, 0x10, 0x10, 0x7c, 0x10, 0x10, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x30, 0x10, 0x20, 0x00, 0x00, 0x00, 0x00, 0x7c, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x30, 0x30, 0x00, 0x00, 0x04, 0x08, 0x10, 0x20, 0x40, 0x00, 0x00,
    0x38, 0x44, 0x4c, 0x54, 0x64, 0x44, 0x38, 0x00, 0x10, 0x30, 0x10, 0x10, 0x10, 0x10, 0x38, 0x00,
    0x38, 0x44, 0x04, 0x08, 0x10, 0x20, 0x7c, 0x00, 0x7c, 0x08, 0x10, 0x08, 0x04, 0x44, 0x38, 0x00,
    0x08, 0x18, 0x28, 0x48, 0x7c, 0x08, 0x08, 0x00, 0x7c, 0x40, 0x78, 0x04, 0x04, 0x44, 0x38, 0x00,
    0x18, 0x20, 0x40, 0x78, 0x44, 0x44, 0x38, 0x00, 0x7c, 0x04, 0x08, 0x10, 0x20, 0x20, 0x20, 0x00,
    0x38, 0x44, 0x44, 0x38, 0x44, 0x44, 0x38, 0x00, 0x38, 0x44, 0x44, 0x3c, 0x04, 0x08, 0x30, 0x00,
    0x00, 0x30, 0x30, 0x00, 0x30, 0x30, 0x00, 0x00, 0x00, 0x30, 0x30, 0x00, 0x30, 0x10, 0x20, 0x00,
    0x08, 0x10, 0x20, 0x40, 0x20, 0x10, 0x08, 0x00, 0x00, 0x00, 0x7c, 0x00, 0x7c, 0x00, 0x00, 0x00,
    0x20, 0x10, 0x08, 0x04, 0x08, 0x10, 0x20, 0x00, 0x38, 0x44, 0x04, 0x08, 0x10, 0x00, 0x10, 0x00,
    0x38, 0x44, 0x04, 0x34, 0x54, 0x54, 0x38, 0x00, 0x38, 0x44, 0x44, 0x7c, 0x44, 0x44, 0x44, 0x00,
    0x78, 0x44, 0x44, 0x78, 0x44, 0x44, 0x78, 0x00, 0x38, 0x44, 0x40, 0x40, 0x40, 0x44, 0x38, 0x00,
    0x70, 0x48, 0x44, 0x44, 0x44, 0x48, 0x70, 0x00, 0x7c, 0x40, 0x40, 0x78, 0x40, 0x40, 0x7c, 0x00,
    0x7c, 0x40, 0x40, 0x78, 0x40, 0x40, 0x40, 0x00, 0x38, 0x44, 0x40, 0x5c, 0x44, 0x44, 0x3c, 0x00,
    0x44, 0x44, 0x44, 0x7c, 0x44, 0x44, 0x44, 0x00, 0x38, 0x10, 0x10, 0x10, 0x10, 0x10, 0x38, 0x00,
    0x1c, 0x08, 0x08, 0x08, 0x08, 0x48, 0x30, 0x00, 0x44, 0x48, 0x50, 0x60, 0x50, 0x48, 0x44, 0x00,
    0x40, 0x40, 0x40, 0x40, 0x40, 0x40, 0x7c, 0x00, 0x44, 0x6c, 0x54, 0x54, 0x44, 0x44, 0x44, 0x00,
    0x44, 0x44, 0x64, 0x54, 0x4c, 0x44, 0x44, 0x00, 0x38, 0x44, 0x44, 0x44, 0x44, 0x44, 0x38, 0x00,
    0x78, 0x44, 0x44, 0x78, 0x40, 0x40, 0x40, 0x00, 0x38, 0x44, 0x44, 0x44, 0x54, 0x48, 0x34, 0x00,
    0x78, 0x44, 0x44, 0x78, 0x50, 0x48, 0x44, 0x00, 0x3c, 0x40, 0x40, 0x38, 0x04, 0x04, 0x78, 0x00,
    0x7c, 0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x00, 0x44, 0x44, 0x44, 0x44, 0x44, 0x44, 0x38, 0x00,
    0x44, 0x44, 0x44, 0x44, 0x44, 0x28, 0x10, 0x00, 0x44, 0x44, 0x44, 0x54, 0x54, 0x54, 0x28, 0x00,
    0x44, 0x44, 0x28, 0x10, 0x28, 0x44, 0x44, 0x00, 0x44, 0x44, 0x28, 0x10, 0x10, 0x10, 0x10, 0x00,
    0x7c, 0x04, 0x08, 0x10, 0x20, 0x40, 0x7c, 0x00, 0x38, 0x20, 0x20, 0x20, 0x20, 0x20, 0x38, 0x00,
    0x00, 0x40, 0x20, 0x10, 0x08, 0x04, 0x00, 0x00, 0x38, 0x08, 0x08, 0x08, 0x08, 0x08, 0x38, 0x00,
    0x10, 0x28, 0x44, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x7c, 0x00,
    0x20, 0x10, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x38, 0x04, 0x3c, 0x44, 0x3c, 0x00,
    0x40, 0x40, 0x58, 0x64, 0x44, 0x44, 0x78, 0x00, 0x00, 0x00, 0x38, 0x40, 0x40, 0x44, 0x38, 0x00,
    0x04, 0x04, 0x34, 0x4c, 0x44, 0x44, 0x3c, 0x00, 0x00, 0x00, 0x38, 0x44, 0x7c, 0x40, 0x38, 0x00,
    0x18, 0x24, 0x20, 0x70, 0x20, 0x20, 0x20, 0x00, 0x00, 0x00, 0x3c, 0x44, 0x44, 0x3c, 0x04, 0x38,
    0x40, 0x40, 0x58, 0x64, 0x44, 0x44, 0x44, 0x00, 0x10, 0x00, 0x30, 0x10, 0x10, 0x10, 0x38, 0x00,
    0x08, 0x00, 0x18, 0x08, 0x08, 0x08, 0x48, 0x30, 0x40, 0x40, 0x48, 0x50, 0x60, 0x50, 0x48, 0x00,
    0x30, 0x10, 0x10, 0x10, 0x10, 0x10, 0x38, 0x00, 0x00, 0x00, 0x68, 0x54, 0x54, 0x44, 0x44, 0x00,
    0x00, 0x00, 0x58, 0x64, 0x44, 0x44, 0x44, 0x00, 0x00, 0x00, 0x38, 0x44, 0x44, 0x44, 0x38, 0x00,
    0x00, 0x00, 0x78, 0x44, 0x44, 0x78, 0x40, 0x40, 0x00, 0x00, 0x3c, 0x44, 0x44, 0x3c, 0x04, 0x04,
    0x00, 0x00, 0x58, 0x64, 0x40, 0x40, 0x40, 0x00, 0x00, 0x00, 0x3c, 0x40, 0x38, 0x04, 0x78, 0x00,
    0x20, 0x20, 0x70, 0x20, 0x20, 0x24, 0x18, 0x00, 0x00, 0x00, 0x44, 0x44, 0x44, 0x4c, 0x34, 0x00,
    0x00, 0x00, 0x44, 0x44, 0x44, 0x28, 0x10, 0x00, 0x00, 0x00, 0x44, 0x44, 0x54, 0x54, 0x28, 0x00,
    0x00, 0x00, 0x44, 0x28, 0x10, 0x28, 0x44, 0x00, 0x00, 0x00, 0x44, 0x44, 0x44, 0x3c, 0x04, 0x38,
    0x00, 0x00, 0x7c, 0x08, 0x10, 0x20, 0x7c, 0x00, 0x08, 0x10, 0x10, 0x20, 0x10, 0x10, 0x08, 0x00,
    0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x00, 0x20, 0x10, 0x10, 0x08, 0x10, 0x10, 0x20, 0x00,
    0x00, 0x00, 0x20, 0x54, 0x08, 0x00, 0x00, 0x00,
};

#ifdef __linux__
// ---- files: a whole string into a file, a number from a file ----
int write_file(char *path, char *s) {
    int fd = open(path, O_WRONLY);
    if (fd < 0) return fd;
    write(fd, s, strlen(s));
    return close(fd);
}
int read_int(char *path) {
    char b[24];
    int fd = open(path, O_RDONLY), n;
    if (fd < 0) return fd;
    n = read(fd, b, 23);
    close(fd);
    if (n < 0) return n;
    b[n] = 0;
    return atoi(b);
}

// ---- the board's GPIO (gpio.h): pins 0 and 1 are the ACT and USER LEDs, 2 the button,
// 3-15 the header; the others go through /sys/class/gpio (exported on first use) ----
#define INPUT  0
#define OUTPUT 1
int __gpio_base = -1;
int __gpio_dir[16];

// the GPIO controller's first number (/sys/class/gpio/gpiochipN)
int gpio_base(void) {
    char buf[1024];
    int fd, n, i = 0;
    if (__gpio_base >= 0) return __gpio_base;
    fd = open("/sys/class/gpio", 65536);
    if (fd < 0) return fd;
    n = __syscall(61, fd, (int)buf, 1024, 0);
    close(fd);
    while (i < n) {
        if (strncmp(buf + i + 19, "gpiochip", 8) == 0) { __gpio_base = atoi(buf + i + 27); break; }
        i += buf[i + 16] | buf[i + 17] << 8;
    }
    return __gpio_base;
}

char __gpio_path[64];
char *__gpio_file(int pin, char *what) {
    if (pin < 2) sprintf(__gpio_path, "/sys/class/leds/%s/%s", pin ? "user" : "act", what);
    else sprintf(__gpio_path, "/sys/class/gpio/gpio%d/%s", gpio_base() + pin, what);
    return __gpio_path;
}

// make a pin an input or an output (output starts at 0)
void pin_mode(int pin, int mode) {
    char num[12];
    if (pin < 0 || pin > 15) return;
    if (pin < 2) { write_file(__gpio_file(pin, "trigger"), "none"); __gpio_dir[pin] = OUTPUT + 1; return; }
    if (read_int(__gpio_file(pin, "value")) < 0) { sprintf(num, "%d", gpio_base() + pin); write_file("/sys/class/gpio/export", num); }
    write_file(__gpio_file(pin, "direction"), mode == OUTPUT ? "low" : "in");
    __gpio_dir[pin] = mode + 1;
}

// set an output pin (the first write makes it an output)
void gpio_write(int pin, int value) {
    if (pin < 0 || pin > 15) return;
    if (__gpio_dir[pin] != OUTPUT + 1) pin_mode(pin, OUTPUT);
    write_file(__gpio_file(pin, pin < 2 ? "brightness" : "value"), value ? "1" : "0");
}

// read a pin: 0 or 1 (the first read of a pin nobody exported makes it an input; an output reads its level)
int gpio_read(int pin) {
    int v;
    if (pin < 0 || pin > 15) return -1;
    if (pin < 2) return read_int(__gpio_file(pin, "brightness")) != 0;
    if (__gpio_dir[pin]) return read_int(__gpio_file(pin, "value"));
    v = read_int(__gpio_file(pin, "value"));
    if (v < 0) { pin_mode(pin, INPUT); v = read_int(__gpio_file(pin, "value")); }
    else __gpio_dir[pin] = INPUT + 1;
    return v;
}
// ---- the screen (/dev/fb0): 320 x 240 pixels, RGB565, mapped at 0x40000000 (below 2 GB) ----
#define SCREEN_W 320
#define SCREEN_H 240
#define RGB(r, g, b) ((((r) & 0xf8) << 8) | (((g) & 0xfc) << 3) | ((b) >> 3))
#define BLACK  0x0000
#define WHITE  0xffff
#define RED    0xf800
#define GREEN  0x07e0
#define BLUE   0x001f
#define YELLOW 0xffe0
#define CYAN   0x07ff
#define MAGENTA 0xf81f
int __syscall6(int n, int a, int b, int c, int d, int e, int f) { asm("mv a7, a0\n mv a0, a1\n mv a1, a2\n mv a2, a3\n mv a3, a4\n mv a4, a5\n mv a5, a6\n ecall\n ret"); }
unsigned short *screen;

// map the screen (the first drawing call does it); its pixels, NULL without a screen
unsigned short *fb_init(void) {
    int fd;
    if (screen) return screen;
    fd = open("/dev/fb0", O_RDWR);
    if (fd < 0) return NULL;
    // mmap(0x40000000, size, read | write, shared | fixed, fd, 0)
    if (__syscall6(222, 0x40000000, SCREEN_W * SCREEN_H * 2, 3, 0x11, fd, 0) == 0x40000000) screen = (unsigned short *)0x40000000;
    close(fd);
    return screen;
}

void fb_pixel(int x, int y, int c) {
    if (!screen && !fb_init()) return;
    if (x >= 0 && x < SCREEN_W && y >= 0 && y < SCREEN_H) screen[y * SCREEN_W + x] = c;
}

void fb_rect(int x, int y, int w, int h, int c) {
    int i, j;
    if (!screen && !fb_init()) return;
    if (x < 0) { w += x; x = 0; }
    if (y < 0) { h += y; y = 0; }
    if (x + w > SCREEN_W) w = SCREEN_W - x;
    if (y + h > SCREEN_H) h = SCREEN_H - y;
    for (j = 0; j < h; j++) {
        unsigned short *p = screen + (y + j) * SCREEN_W + x;
        for (i = 0; i < w; i++) p[i] = c;
    }
}

void fb_clear(int c) { fb_rect(0, 0, SCREEN_W, SCREEN_H, c); }

void fb_line(int x0, int y0, int x1, int y1, int c) {
    int dx = abs(x1 - x0), dy = -abs(y1 - y0);
    int sx = x0 <= x1 ? 1 : -1, sy = y0 <= y1 ? 1 : -1, e = dx + dy;
    while (1) {
        fb_pixel(x0, y0, c);
        if (x0 == x1 && y0 == y1) break;
        if (2 * e >= dy) { e += dy; x0 += sx; }
        if (2 * e <= dx) { e += dx; y0 += sy; }
    }
}

// a circle's outline (fill: a filled disc)
void fb_circle(int cx, int cy, int r, int c, int fill) {
    int x = r, y = 0, e = 1 - r;
    while (x >= y) {
        if (fill) {
            fb_rect(cx - x, cy + y, 2 * x + 1, 1, c); fb_rect(cx - x, cy - y, 2 * x + 1, 1, c);
            fb_rect(cx - y, cy + x, 2 * y + 1, 1, c); fb_rect(cx - y, cy - x, 2 * y + 1, 1, c);
        } else {
            fb_pixel(cx + x, cy + y, c); fb_pixel(cx - x, cy + y, c); fb_pixel(cx + x, cy - y, c); fb_pixel(cx - x, cy - y, c);
            fb_pixel(cx + y, cy + x, c); fb_pixel(cx - y, cy + x, c); fb_pixel(cx + y, cy - x, c); fb_pixel(cx - y, cy - x, c);
        }
        y++;
        if (e < 0) e += 2 * y + 1; else { x--; e += 2 * (y - x) + 1; }
    }
}

// text in the 5 x 7 font, 6 x 8 pixels a character times scale; the x after it
int fb_text(int x, int y, char *s, int c, int scale) {
    int r, k;
    if (scale < 1) scale = 1;
    for (; *s; s++, x += 6 * scale) {
        int ch = *s;
        if (ch < 32 || ch > 126) ch = '?';
        for (r = 0; r < 8; r++) {
            int bits = __font[(ch - 32) * 8 + r];
            for (k = 0; k < 5; k++) if (bits >> (6 - k) & 1) fb_rect(x + k * scale, y + r * scale, scale, scale, c);
        }
    }
    return x;
}
#else
// ---- VGA text mode (RvVgaBoard): 40 x 30 characters, the cursor moves like a terminal's ----
// (the screen memory cannot be read back, so the text wraps to the top instead of scrolling)
int __vga_x, __vga_y;

void vga_clear(void) {
    int i;
    for (i = 0; i < VGA_COLS * VGA_ROWS; i++) VGA_TEXT[i] = ' ';
    __vga_x = 0;
    __vga_y = 0;
}

// load the font (ASCII 32-126) and clear the screen
void vga_init(void) {
    int i;
    for (i = 0; i < 760; i++) VGA_FONT[256 + i] = __font[i];
    vga_clear();
}

// colors are 0xRGB (4 bits each), e.g. 0xfff white, 0x00a dark blue
void vga_color(int fg, int bg) { VGA_COLOR = (bg << 16) | fg; }

void vga_goto(int col, int row) { __vga_x = col; __vga_y = row; }

void vga_putc(int c) {
    if (c == '\n') { __vga_x = 0; __vga_y++; }
    else if (c == '\r') __vga_x = 0;
    else {
        VGA_TEXT[__vga_y * VGA_COLS + __vga_x] = c;
        if (++__vga_x == VGA_COLS) { __vga_x = 0; __vga_y++; }
    }
    if (__vga_y >= VGA_ROWS) __vga_y = 0;
}

void vga_puts(char *s) { while (*s) vga_putc(*s++); }

int vga_printf(char *fmt, ...) {
    va_list ap;
    char buf[128];
    va_start(ap, fmt);
    __sbuf = buf;
    __vprintf(fmt, ap);
    *__sbuf = 0;
    __sbuf = 0;
    vga_puts(buf);
    return 0;
}

// ---- machine mode (RvCore: RV32IMA + Zicsr): interrupts, CSRs ----
// Functions with only asm in them are "naked": the assembly is the whole function.
#define MIE_MSIE 0x8      // software interrupt   (mcause 0x80000003)
#define MIE_MTIE 0x80     // timer interrupt      (mcause 0x80000007)
#define MIE_MEIE 0x800    // external: a received byte (mcause 0x8000000b)

void interrupts_on(void) { asm("csrsi mstatus, 8\n ret"); }
void interrupts_off(void) { asm("csrci mstatus, 8\n ret"); }
// interrupts off; the old state for irq_restore
unsigned irq_save(void) { asm("csrrci a0, mstatus, 8\n andi a0, a0, 8\n ret"); }
void irq_restore(unsigned s) { asm("csrs mstatus, a0\n ret"); }
void wfi(void) { asm("wfi\n ret"); }
void set_mtvec(void *handler) { asm("csrw mtvec, a0\n ret"); }
void set_mie(unsigned bits) { asm("csrw mie, a0\n ret"); }
unsigned read_mcause(void) { asm("csrr a0, mcause\n ret"); }
unsigned read_mepc(void) { asm("csrr a0, mepc\n ret"); }
void write_mepc(unsigned v) { asm("csrw mepc, a0\n ret"); }
unsigned read_mstatus(void) { asm("csrr a0, mstatus\n ret"); }
unsigned read_mip(void) { asm("csrr a0, mip\n ret"); }
unsigned read_minstret(void) { asm("csrr a0, minstret\n ret"); }
unsigned read_mscratch(void) { asm("csrr a0, mscratch\n ret"); }
void write_mscratch(unsigned v) { asm("csrw mscratch, a0\n ret"); }
#endif

// atomic read-modify-write (A extension): each returns the old value
int atomic_swap(volatile int *p, int v) { asm("amoswap.w a0, a1, (a0)\n ret"); }
int atomic_add(volatile int *p, int v) { asm("amoadd.w a0, a1, (a0)\n ret"); }
int atomic_and(volatile int *p, int v) { asm("amoand.w a0, a1, (a0)\n ret"); }
int atomic_or(volatile int *p, int v) { asm("amoor.w a0, a1, (a0)\n ret"); }
int atomic_xor(volatile int *p, int v) { asm("amoxor.w a0, a1, (a0)\n ret"); }
// compare and swap with LR / SC: *p = desired if *p == expected; the old value
int atomic_cas(volatile int *p, int expected, int desired) {
    asm("__cas_retry:\n lr.w t0, (a0)\n bne t0, a1, __cas_done\n sc.w t1, a2, (a0)\n bnez t1, __cas_retry\n__cas_done:\n mv a0, t0\n ret");
}

// a spinlock: 0 = free
void spin_lock(volatile int *l) { while (atomic_swap(l, 1)) ; }
void spin_unlock(volatile int *l) { atomic_swap(l, 0); }
