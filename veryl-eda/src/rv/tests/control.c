// loops, break / continue, switch, logical operators, recursion
int calls;
int f(int x) { calls++; return x; }

int hanoi(int n, int from, int to, int via) {
    if (n == 0) return 0;
    return hanoi(n - 1, from, via, to) + 1 + hanoi(n - 1, via, to, from);
}

int queens(int n, int row, int *col, int *d1, int *d2) {
    int c, count = 0;
    if (row == n) return 1;
    for (c = 0; c < n; c++) {
        if (col[c] || d1[row + c] || d2[row - c + n - 1]) continue;
        col[c] = d1[row + c] = d2[row - c + n - 1] = 1;
        count += queens(n, row + 1, col, d1, d2);
        col[c] = d1[row + c] = d2[row - c + n - 1] = 0;
    }
    return count;
}

char *name(int d) {
    switch (d) {
    case 0: return "zero";
    case 1:
    case 2: return "small";
    case 10: return "ten";
    default: return "other";
    }
}

int main(void) {
    int i, sum = 0;
    for (i = 0; i < 100; i++) {
        if (i % 3 == 0) continue;
        if (i > 50) break;
        sum += i;
    }
    printf("sum %d\n", sum);
    i = 0;
    do { i += 7; } while (i < 100);
    printf("do %d\n", i);
    while (1) { if (++i > 120) break; }
    printf("while %d\n", i);
    calls = 0;
    if (f(0) && f(1)) printf("no\n");
    if (f(1) || f(2)) printf("yes %d\n", calls);
    printf("%d %d %d %d\n", f(0) || f(0), f(3) && f(4), !(f(1) && f(0)), calls);
    for (i = -1; i <= 11; i += 3) printf("%s ", name(i));
    printf("\n");
    int s = 0;
    for (i = 0; i < 20; i++) {
        switch (i & 3) {
        case 0: s += 1;
        case 1: s += 10; break;
        case 2: { int t = i * 2; s += t; break; }
        default: s -= 1;
        }
    }
    printf("switch %d\n", s);
    printf("hanoi %d\n", hanoi(10, 1, 3, 2));
    int col[8], d1[15], d2[15];
    for (i = 0; i < 8; i++) col[i] = 0;
    for (i = 0; i < 15; i++) d1[i] = d2[i] = 0;
    printf("queens %d\n", queens(8, 0, col, d1, d2));
    int n = 0;
    for (i = 0; i < 5; i++) { int j; for (j = 0; j < 5; j++) { if (j == i) break; n++; } }
    printf("nested %d\n", n);
    return 0;
}
