// integer arithmetic, conversions, shifts, comparisons (signed and unsigned)
int add(int a, int b) { return a + b; }
unsigned umix(unsigned a, unsigned b) { return (a * 2654435761u) ^ (b >> 3); }

int main(void) {
    int v[] = {0, 1, -1, 7, -7, 100, -100, 12345, -32768, 2147483647, -2147483647};
    int n = sizeof v / sizeof v[0];
    int i, j;
    unsigned h = 0;
    for (i = 0; i < n; i++) {
        for (j = 0; j < n; j++) {
            int a = v[i], b = v[j];
            h = h * 31 + (unsigned)(a + b);
            h = h * 31 + (unsigned)(a - b);
            h = h * 31 + (unsigned)(a * b);
            if (b != 0 && !(a == -2147483647 - 1 && b == -1)) { h = h * 31 + (unsigned)(a / b); h = h * 31 + (unsigned)(a % b); }
            if (b != 0) { h = h * 31 + (unsigned)a / (unsigned)b; h = h * 31 + (unsigned)a % (unsigned)b; }
            h = h * 31 + (a < b) + 2 * (a <= b) + 4 * (a > b) + 8 * (a >= b) + 16 * (a == b) + 32 * (a != b);
            h = h * 31 + ((unsigned)a < (unsigned)b) + 2 * ((unsigned)a >= (unsigned)b);
            h = h * 31 + (a & b) + (a | b) + (a ^ b);
            h = h * 31 + (unsigned)(a << (b & 31)) + (unsigned)(a >> (b & 31)) + ((unsigned)a >> (b & 31));
        }
    }
    printf("hash %u\n", h);
    printf("%d %d %d %d\n", 17 / 5, -17 / 5, 17 % -5, -17 % -5);
    printf("%d %d %d\n", add(2, 3), add(-2, -3), umix(12345, 678) & 0xffff);
    unsigned char c = 200;
    signed char sc = 100;
    short s = 30000;
    unsigned short us = 65000;
    c += 100; sc += 100; s += 10000; us += 1000;
    printf("%d %d %d %d\n", c, sc, s, us);
    printf("%d %d %d\n", (signed char)0x80, (unsigned char)-1, (short)0x12348000);
    int x = 5;
    x += 3; x -= 1; x *= 6; x /= 4; x %= 7; x <<= 3; x >>= 1; x |= 0x100; x &= 0x1f0; x ^= 0x55;
    printf("x = %d\n", x);
    int k = 0;
    int a = k++ + k++;
    int b = ++k * 10 + --k;
    printf("%d %d %d\n", a, b, k);
    printf("%d %d %d %d\n", !0, !5, ~0, -(-3));
    printf("%d %d\n", 1 ? 2 : 3, 0 ? 2 : 3);
    printf("%u %x %X\n", 4000000000u, 0xdeadbeef, 0xabc);
    return 0;
}
