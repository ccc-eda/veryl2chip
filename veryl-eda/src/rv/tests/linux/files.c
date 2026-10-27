// Linux system calls through the runtime library: files, the heap, strings, exit code
int main(void) {
    char buf[64];
    char *p, *q;
    int fd, n, i, sum = 0;
    fd = open("veryl_cc_test.txt", O_WRONLY | O_CREAT | O_TRUNC, 0644);
    printf("open for writing: %s\n", fd >= 0 ? "ok" : "failed");
    for (i = 1; i <= 3; i++) {
        n = sprintf(buf, "line %d of %d\n", i, 3);
        write(fd, buf, n);
    }
    close(fd);
    fd = open("veryl_cc_test.txt", O_RDONLY);
    n = read(fd, buf, 63);
    close(fd);
    buf[n] = 0;
    printf("read %d bytes:\n%s", n, buf);
    printf("unlink: %d, open again: %s\n", unlink("veryl_cc_test.txt"), open("veryl_cc_test.txt", O_RDONLY) < 0 ? "gone" : "still there");
    p = malloc(1000);
    q = malloc(16);
    for (i = 0; i < 1000; i++) p[i] = i;
    for (i = 0; i < 1000; i++) sum += p[i];
    strcpy(q, "heap");
    strcat(q, " + ok");
    printf("%s, sum %d\n", q, sum);
    printf("strncmp %d %d\n", strncmp("gpiochip512", "gpiochip", 8) == 0, strncmp("abc", "abd", 3) < 0);
    putchar('x');
    fflush(stdout);
    putchar('\n');
    return 0;
}
