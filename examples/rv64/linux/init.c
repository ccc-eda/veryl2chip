// /init of the Linux test for Rv64Soc: the first and only user program, without a C
// library (raw system calls through ecall). It mounts /proc, prints a greeting,
// /proc/version and /proc/cpuinfo, and powers the machine off (the simulation ends).

#define SYS_mount  40
#define SYS_openat 56
#define SYS_close  57
#define SYS_read   63
#define SYS_write  64
#define SYS_reboot 142
#define AT_FDCWD   -100

static long syscall4(long n, long a, long b, long c, long d) {
  register long a0 asm("a0") = a;
  register long a1 asm("a1") = b;
  register long a2 asm("a2") = c;
  register long a3 asm("a3") = d;
  register long a7 asm("a7") = n;
  asm volatile("ecall" : "+r"(a0) : "r"(a1), "r"(a2), "r"(a3), "r"(a7) : "memory");
  return a0;
}

static long len(const char *s) {
  long n = 0;
  while (s[n]) n++;
  return n;
}

static void puts(const char *s) { syscall4(SYS_write, 1, (long)s, len(s), 0); }

static void cat(const char *path) {
  static char buf[512];
  long fd = syscall4(SYS_openat, AT_FDCWD, (long)path, 0, 0);
  if (fd < 0) {
    puts("cannot open ");
    puts(path);
    puts("\n");
    return;
  }
  long n;
  while ((n = syscall4(SYS_read, fd, (long)buf, sizeof buf, 0)) > 0) syscall4(SYS_write, 1, (long)buf, n, 0);
  syscall4(SYS_close, fd, 0, 0, 0);
}

void _start(void) {
  puts("\nHello from user space on Rv64Core, a RISC-V processor written in Veryl!\n\n");
  syscall4(SYS_mount, (long)"proc", (long)"/proc", (long)"proc", 0);
  puts("$ cat /proc/version\n");
  cat("/proc/version");
  puts("$ cat /proc/cpuinfo\n");
  cat("/proc/cpuinfo");
  puts("powering off\n");
  // reboot(LINUX_REBOOT_MAGIC1, LINUX_REBOOT_MAGIC2, LINUX_REBOOT_CMD_POWER_OFF)
  syscall4(SYS_reboot, 0xfee1dead, 672274793, 0x4321fedc, 0);
  for (;;) {
  }
}
