// Rv64Soc 的 Verilator 測試平台
//
//   rv64sim [-t] [-m CYCLES] [-l ADDR:FILE]... PROG.elf
//
// 把 ELF 的程式段載入 RAM（0x8000_0000 起），放開重設，一拍一拍跑：
//   - UART 送出的位元組印到 stdout；stdin 的輸入送進 UART（xv6 的 console）
//   - 程式寫入 ELF 裡的 tohost 符號（riscv-tests 的慣例）：1 = 通過，其他 = 失敗（值 >> 1 是測試編號）
//   - -t：每個完成的指令印一行，和 `spike -l --log-commits` 的格式相同（可以 diff）
//   - -l ADDR:FILE：另外把一個二進位檔載入 ADDR（例如 xv6 的檔案系統映像）
//   - -m CYCLES：最多跑幾拍（預設 1 億）
// 結束碼：0 通過，1 失敗，2 超過時脈數。
#include "Vrv64_Rv64Soc.h"
#include "verilated.h"

#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <deque>
#include <fcntl.h>
#include <string>
#include <sys/select.h>
#include <termios.h>
#include <unistd.h>
#include <vector>

static const uint64_t RAM_BASE = 0x80000000ull;

// ---------------------------------------------------------------- ELF64（只讀需要的欄位）
struct Elf64Ehdr { unsigned char ident[16]; uint16_t type, machine; uint32_t version; uint64_t entry, phoff, shoff; uint32_t flags; uint16_t ehsize, phentsize, phnum, shentsize, shnum, shstrndx; };
struct Elf64Phdr { uint32_t type, flags; uint64_t offset, vaddr, paddr, filesz, memsz, align; };
struct Elf64Shdr { uint32_t name, type; uint64_t flags, addr, offset, size; uint32_t link, info; uint64_t addralign, entsize; };
struct Elf64Sym { uint32_t name; unsigned char info, other; uint16_t shndx; uint64_t value, size; };

static std::vector<uint8_t> read_file(const char *path) {
    FILE *f = fopen(path, "rb");
    if (!f) { perror(path); exit(1); }
    std::vector<uint8_t> v;
    uint8_t buf[65536];
    size_t n;
    while ((n = fread(buf, 1, sizeof buf, f)) > 0) v.insert(v.end(), buf, buf + n);
    fclose(f);
    return v;
}

// 要載入的位元組：位址 → 值
struct Image {
    std::vector<std::pair<uint64_t, std::vector<uint8_t>>> parts;
    uint64_t tohost = 0;
};

static void load_elf(const char *path, Image &img) {
    std::vector<uint8_t> f = read_file(path);
    if (f.size() < sizeof(Elf64Ehdr) || memcmp(f.data(), "\x7f" "ELF", 4) || f[4] != 2) { fprintf(stderr, "%s: not an ELF64 file\n", path); exit(1); }
    Elf64Ehdr eh;
    memcpy(&eh, f.data(), sizeof eh);
    for (int i = 0; i < eh.phnum; i++) {
        Elf64Phdr ph;
        memcpy(&ph, f.data() + eh.phoff + i * eh.phentsize, sizeof ph);
        if (ph.type != 1 || ph.memsz == 0) continue; // PT_LOAD
        std::vector<uint8_t> seg(ph.memsz, 0);
        memcpy(seg.data(), f.data() + ph.offset, ph.filesz);
        img.parts.push_back({ph.paddr, seg});
    }
    // 符號表裡的 tohost
    for (int i = 0; i < eh.shnum; i++) {
        Elf64Shdr sh;
        memcpy(&sh, f.data() + eh.shoff + i * eh.shentsize, sizeof sh);
        if (sh.type != 2) continue; // SHT_SYMTAB
        Elf64Shdr strh;
        memcpy(&strh, f.data() + eh.shoff + sh.link * eh.shentsize, sizeof strh);
        for (uint64_t k = 0; k < sh.size / sizeof(Elf64Sym); k++) {
            Elf64Sym s;
            memcpy(&s, f.data() + sh.offset + k * sizeof s, sizeof s);
            const char *name = (const char *)f.data() + strh.offset + s.name;
            if (!strcmp(name, "tohost")) img.tohost = s.value;
        }
    }
}

// ---------------------------------------------------------------- 終端機（xv6 的 console 要一個字一個字讀）
static struct termios saved_tio;
static bool raw_mode = false;
static void restore_tty() { if (raw_mode) tcsetattr(0, TCSANOW, &saved_tio); }
static void set_raw_tty() {
    if (!isatty(0)) return;
    tcgetattr(0, &saved_tio);
    struct termios t = saved_tio;
    t.c_lflag &= ~(ICANON | ECHO);
    t.c_cc[VMIN] = 0;
    t.c_cc[VTIME] = 0;
    tcsetattr(0, TCSANOW, &t);
    raw_mode = true;
    atexit(restore_tty);
}

int main(int argc, char **argv) {
    Verilated::commandArgs(argc, argv);
    bool trace = false;
    uint64_t max_cycles = 100000000ull;
    const char *elf = nullptr;
    Image img;
    std::vector<std::pair<uint64_t, std::string>> extra;
    for (int i = 1; i < argc; i++) {
        if (!strcmp(argv[i], "-t")) trace = true;
        else if (!strcmp(argv[i], "-m") && i + 1 < argc) max_cycles = strtoull(argv[++i], nullptr, 0);
        else if (!strcmp(argv[i], "-l") && i + 1 < argc) {
            std::string a = argv[++i];
            size_t c = a.find(':');
            if (c == std::string::npos) { fprintf(stderr, "-l ADDR:FILE\n"); return 2; }
            extra.push_back({strtoull(a.substr(0, c).c_str(), nullptr, 0), a.substr(c + 1)});
        } else if (argv[i][0] == '+') {
            // Verilator 的參數
        } else elf = argv[i];
    }
    if (!elf) { fprintf(stderr, "usage: rv64sim [-t] [-m CYCLES] [-l ADDR:FILE]... PROG.elf\n"); return 2; }
    load_elf(elf, img);
    for (auto &e : extra) img.parts.push_back({e.first, read_file(e.second.c_str())});

    Vrv64_Rv64Soc *top = new Vrv64_Rv64Soc;
    auto tick = [&]() {
        top->i_clk = 0;
        top->eval();
        top->i_clk = 1;
        top->eval();
    };

    // 重設中載入：每個 64 位元字寫一次
    top->i_rst = 0;
    top->i_rx_valid = 0;
    top->i_ld_we = 0;
    tick();
    for (auto &p : img.parts) {
        uint64_t a0 = p.first & ~7ull, a1 = (p.first + p.second.size() + 7) & ~7ull;
        if (p.first < RAM_BASE) { fprintf(stderr, "segment at 0x%llx is outside RAM\n", (unsigned long long)p.first); return 2; }
        for (uint64_t a = a0; a < a1; a += 8) {
            uint64_t w = 0;
            for (int b = 0; b < 8; b++) {
                uint64_t x = a + b;
                if (x >= p.first && x < p.first + p.second.size()) w |= (uint64_t)p.second[x - p.first] << (8 * b);
            }
            top->i_ld_we = 1;
            top->i_ld_addr = (uint32_t)((a - RAM_BASE) >> 3);
            top->i_ld_data = w;
            tick();
        }
    }
    top->i_ld_we = 0;
    tick();
    top->i_rst = 1;

    set_raw_tty();
    std::deque<uint8_t> rx;
    int code = 2;
    uint64_t cyc = 0, insns = 0;
    for (; cyc < max_cycles; cyc++) {
        // 鍵盤輸入（每 4096 拍看一次）
        if ((cyc & 4095) == 0) {
            fd_set fds;
            FD_ZERO(&fds);
            FD_SET(0, &fds);
            struct timeval tv = {0, 0};
            if (select(1, &fds, nullptr, nullptr, &tv) > 0) {
                uint8_t buf[64];
                ssize_t n = read(0, buf, sizeof buf);
                for (ssize_t k = 0; k < n; k++) rx.push_back(buf[k] == '\n' ? '\r' : buf[k]);
            }
        }
        top->i_rx_valid = !rx.empty() && top->o_rx_ready;
        top->i_rx_data = rx.empty() ? 0 : rx.front();
        top->i_clk = 0;
        top->eval();
        // 這一拍的輸出（時脈上升前的值）
        bool rx_taken = top->i_rx_valid;
        if (top->o_ret) {
            insns++;
            if (trace) {
                printf("core   0: %d 0x%016llx (0x%08x)", (int)top->o_ret_prv, (unsigned long long)top->o_ret_pc, (unsigned)top->o_ret_insn);
                if (top->o_ret_we) printf(" x%-2d 0x%016llx", (int)top->o_ret_rd, (unsigned long long)top->o_ret_wdata);
                printf("\n");
            }
        }
        if (top->o_tx_valid) {
            putchar(top->o_tx_data);
            fflush(stdout);
        }
        bool done = false;
        if (top->o_dbg_wr && img.tohost && top->o_dbg_addr == img.tohost) {
            uint64_t v = top->o_dbg_wdata;
            if (v == 1) code = 0;
            else { code = 1; fprintf(stderr, "FAIL: test %llu (tohost = 0x%llx)\n", (unsigned long long)(v >> 1), (unsigned long long)v); }
            done = true;
        }
        top->i_clk = 1;
        top->eval();
        if (rx_taken) rx.pop_front();
        if (done) break;
    }
    if (code == 2) fprintf(stderr, "TIMEOUT after %llu cycles (%llu instructions)\n", (unsigned long long)cyc, (unsigned long long)insns);
    else fprintf(stderr, "%s after %llu cycles, %llu instructions\n", code == 0 ? "PASS" : "FAIL", (unsigned long long)cyc, (unsigned long long)insns);
    delete top;
    return code;
}
