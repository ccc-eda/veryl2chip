# A system monitor on the board's screen, read from Linux's /proc: CPU use (with a history graph),
# memory, the load average, how long the board has been up and how many processes run.
# Run another program at the same time to see the CPU go up, e.g. in the shell:
#   micropython sysmon.py &      then      yes > /dev/null &      (kill %2 stops it)
# On the board: micropython sysmon.py (Ctrl-C stops it)
import os
from pi import Screen, rgb, sleep, BLACK, WHITE, GREEN, YELLOW

GRAY = rgb(90, 90, 90)
s = Screen()


def read(path):
    with open(path) as f:
        return f.read()


def cpu_times():
    # the first line of /proc/stat: cpu user nice system idle iowait irq softirq ...
    v = [int(x) for x in read("/proc/stat").split("\n")[0].split()[1:]]
    return sum(v), v[3] + v[4]


def memory():
    m = {}
    for line in read("/proc/meminfo").split("\n"):
        p = line.split()
        if len(p) >= 2:
            m[p[0].rstrip(":")] = int(p[1])
    return m["MemTotal"], m.get("MemAvailable", m["MemFree"])


def processes():
    return sum(1 for n in os.listdir("/proc") if n.isdigit())


def bar(y, label, frac, color, text):
    s.text(label, 8, y, WHITE)
    s.rect(70, y - 2, 200, 12, GRAY)
    s.fill_rect(71, y - 1, int(198 * frac), 10, color)
    s.text(text, 276, y, WHITE)


history = [0] * 150
total0, idle0 = cpu_times()
print("sysmon: CPU, memory, load, uptime, processes (Ctrl-C stops it)")
n = 0
while True:
    sleep(1)
    total, idle = cpu_times()
    cpu = 0 if total == total0 else 1 - (idle - idle0) / (total - total0)
    total0, idle0 = total, idle
    history = history[1:] + [cpu]
    mem_total, mem_free = memory()
    used = 1 - mem_free / mem_total
    load = read("/proc/loadavg").split()[:3]
    up = int(float(read("/proc/uptime").split()[0]))
    procs = processes()

    s.fill(BLACK)
    s.big_text("SYSTEM MONITOR", 8, 6, YELLOW)
    bar(36, "CPU", cpu, GREEN, "%3d%%" % int(cpu * 100))
    bar(56, "Memory", used, rgb(80, 160, 255), "%3d%%" % int(used * 100))
    s.text("%d of %d MB in use" % ((mem_total - mem_free) // 1024, mem_total // 1024), 70, 72, GRAY)
    s.text("Load     " + " ".join(load), 8, 92, WHITE)
    s.text("Uptime   %d:%02d:%02d" % (up // 3600, up // 60 % 60, up % 60), 8, 108, WHITE)
    s.text("Processes %d" % procs, 8, 124, WHITE)
    # CPU history: one column a second, the last 150 seconds
    s.rect(8, 144, 302, 88, GRAY)
    for i, v in enumerate(history):
        h = int(v * 84)
        if h:
            s.fill_rect(10 + i * 2, 230 - h, 2, h, GREEN)
    s.show()
    if n % 5 == 0:
        print("CPU %3d%%  memory %3d%%  load %s  processes %d" % (int(cpu * 100), int(used * 100), load[0], procs))
    n += 1
