// pointers, arrays (2-D too), strings, globals
int g[10];
int grid[4][5];
char text[32] = "hello";
char *words[] = {"alpha", "beta", "gamma"};
int counter = 42;
int *pc = &counter;

void fill(int *p, int n, int v) { while (n--) *p++ = v++; }
int sum(int *p, int n) { int s = 0; int *e = p + n; while (p < e) s += *p++; return s; }
void reverse(char *s) { char *e = s + strlen(s) - 1; while (s < e) { char t = *s; *s++ = *e; *e-- = t; } }
void swap(int *a, int *b) { int t = *a; *a = *b; *b = t; }

void sort(int *a, int n) {
    int i, j;
    for (i = 1; i < n; i++) for (j = i; j > 0 && a[j - 1] > a[j]; j--) swap(&a[j], &a[j - 1]);
}

int main(void) {
    int i, j;
    fill(g, 10, 5);
    printf("%d %d %d\n", g[0], g[9], sum(g, 10));
    for (i = 0; i < 4; i++) for (j = 0; j < 5; j++) grid[i][j] = i * 10 + j;
    int *p = &grid[1][2];
    printf("%d %d %d %d\n", *p, p[3], *(p - 1), grid[3][4]);
    printf("%d %d\n", (int)(&grid[2][0] - &grid[0][0]), (int)sizeof grid[1]);
    reverse(text);
    printf("%s %d\n", text, strlen(text));
    strcpy(text, "abc");
    printf("%s %d %d\n", text, strcmp(text, "abd") < 0, strcmp("b", "a") > 0);
    for (i = 0; i < 3; i++) printf("%s:%c ", words[i], words[i][1]);
    printf("\n");
    *pc += 1;
    printf("%d\n", counter);
    int a[8] = {5, 3, 9, 1, 7, 2, 8, 6};
    sort(a, 8);
    for (i = 0; i < 8; i++) printf("%d", a[i]);
    printf("\n");
    char buf[16];
    memset(buf, 'x', 15);
    buf[15] = 0;
    memcpy(buf + 2, "AB", 2);
    printf("%s\n", buf);
    char local[] = "local";
    char *q = local;
    while (*q) { *q = *q - 32; q++; }
    printf("%s %d\n", local, (int)sizeof local);
    int m[3][3] = {{1, 2, 3}, {4, 5, 6}, {7, 8, 9}};
    int t = 0;
    for (i = 0; i < 3; i++) t += m[i][i] * m[i][2 - i];
    printf("%d %d\n", t, atoi("-1234") + atoi("34"));
    unsigned char bytes[4];
    unsigned *w = (unsigned *)bytes;
    *w = 0x11223344;
    printf("%x %x\n", bytes[0], bytes[3]);
    return 0;
}
