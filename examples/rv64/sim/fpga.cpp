// Rv64Fpga 的 Verilator 測試平台：只用 FPGA 的腳位（RTL、合成後或繞線後的網表都一樣）
//
//   rv64fpga [-m CYCLES] [-b CPB] PROG.elf
//
// 載入埠送進 tohost 位址與程式（i_ld = 1，每拍一個位元組），放開 i_ld 之後一拍一拍跑：
//   - o_tx 的序列資料（每位元 CPB 拍，預設 217）解出來印到 stdout；stdin 的輸入從 i_rx 送進去
//   - o_halt：o_code 是 1（tohost）或 0x5555（關機裝置）= 通過，其他 = 失敗
// 結束碼：0 通過，1 失敗，2 超過時脈數。
#include "Vrv64_Rv64Fpga.h"
#include "verilated.h"

#include <chrono>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <deque>
#include <vector>

static const uint64_t RAM_BASE = 0x80000000ull;

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

// ELF（或二進位檔）→ 從 RAM_BASE 開始的連續位元組，與 tohost 的位址
static std::vector<uint8_t> load(const char *path, uint64_t &tohost) {
    std::vector<uint8_t> f = read_file(path), img;
    tohost = 0;
    if (f.size() < 4 || memcmp(f.data(), "\x7f" "ELF", 4)) return f;
    Elf64Ehdr eh;
    memcpy(&eh, f.data(), sizeof eh);
    for (int i = 0; i < eh.phnum; i++) {
        Elf64Phdr ph;
        memcpy(&ph, f.data() + eh.phoff + i * eh.phentsize, sizeof ph);
        if (ph.type != 1 || ph.memsz == 0) continue;
        if (ph.paddr < RAM_BASE) { fprintf(stderr, "segment at 0x%llx is outside RAM\n", (unsigned long long)ph.paddr); exit(2); }
        uint64_t off = ph.paddr - RAM_BASE;
        if (img.size() < off + ph.memsz) img.resize(off + ph.memsz, 0);
        memcpy(img.data() + off, f.data() + ph.offset, ph.filesz);
    }
    for (int i = 0; i < eh.shnum; i++) {
        Elf64Shdr sh;
        memcpy(&sh, f.data() + eh.shoff + i * eh.shentsize, sizeof sh);
        if (sh.type != 2) continue;
        Elf64Shdr strh;
        memcpy(&strh, f.data() + eh.shoff + sh.link * eh.shentsize, sizeof strh);
        for (uint64_t k = 0; k < sh.size / sizeof(Elf64Sym); k++) {
            Elf64Sym s;
            memcpy(&s, f.data() + sh.offset + k * sizeof s, sizeof s);
            if (!strcmp((const char *)f.data() + strh.offset + s.name, "tohost")) tohost = s.value;
        }
    }
    return img;
}

int main(int argc, char **argv) {
    Verilated::commandArgs(argc, argv);
    uint64_t max_cycles = 100000000ull;
    int cpb = 217;
    const char *elf = nullptr;
    for (int i = 1; i < argc; i++) {
        if (!strcmp(argv[i], "-m") && i + 1 < argc) max_cycles = strtoull(argv[++i], nullptr, 0);
        else if (!strcmp(argv[i], "-b") && i + 1 < argc) cpb = atoi(argv[++i]);
        else if (argv[i][0] != '+') elf = argv[i];
    }
    if (!elf) { fprintf(stderr, "usage: rv64fpga [-m CYCLES] [-b CPB] PROG.elf\n"); return 2; }
    if (max_cycles == 0) max_cycles = ~0ull;
    uint64_t tohost;
    std::vector<uint8_t> img = load(elf, tohost);

    Vrv64_Rv64Fpga *top = new Vrv64_Rv64Fpga;
    auto tick = [&]() {
        top->i_clk = 0;
        top->eval();
        top->i_clk = 1;
        top->eval();
    };

    // 重設，然後經過載入埠：tohost 的位址（4 個位元組）、程式
    top->i_rst = 0;
    top->i_ld = 1;
    top->i_ld_valid = 0;
    top->i_rx = 1;
    tick();
    tick();
    top->i_rst = 1;
    tick();
    std::vector<uint8_t> stream;
    for (int k = 0; k < 4; k++) stream.push_back((uint8_t)(tohost >> (8 * k)));
    stream.insert(stream.end(), img.begin(), img.end());
    for (uint8_t b : stream) {
        top->i_ld_valid = 1;
        top->i_ld_data = b;
        tick();
    }
    top->i_ld_valid = 0;
    tick();
    top->i_ld = 0;

    // UART 的兩端（序列）
    int tx_state = -1, tx_cnt = 0, tx_bits = 0, tx_byte = 0; // 收 o_tx
    std::deque<uint8_t> rx;
    int rx_cnt = 0, rx_bit = -1, rx_byte = 0;               // 送 i_rx
    auto t0 = std::chrono::steady_clock::now();
    int code = 2;
    uint64_t cyc = 0;
    for (; cyc < max_cycles; cyc++) {
        tick();
        // o_tx：起始位元的中間開始取樣
        int tx = top->o_tx & 1;
        if (tx_state < 0) {
            if (!tx) { tx_state = 0; tx_cnt = cpb + cpb / 2; tx_bits = 0; tx_byte = 0; }
        } else if (--tx_cnt == 0) {
            if (tx_bits < 8) { tx_byte |= tx << tx_bits; tx_bits++; tx_cnt = cpb; }
            else { putchar(tx_byte); fflush(stdout); tx_state = -1; }
        }
        // i_rx：一個位元組 = 起始、8 個資料、停止
        if (rx_bit < 0 && !rx.empty()) { rx_byte = rx.front(); rx.pop_front(); rx_bit = 0; rx_cnt = cpb; }
        if (rx_bit >= 0) {
            top->i_rx = rx_bit == 0 ? 0 : rx_bit <= 8 ? (rx_byte >> (rx_bit - 1)) & 1 : 1;
            if (--rx_cnt == 0) { rx_cnt = cpb; if (++rx_bit == 10) rx_bit = -1; }
        }
        if (top->o_halt) {
            unsigned v = top->o_code;
            code = (v == 1 || v == 0x5555) ? 0 : 1;
            if (code) fprintf(stderr, "FAIL: code 0x%04x (test %u)\n", v, v >> 1);
            break;
        }
    }
    double sec = std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count();
    if (code == 2) fprintf(stderr, "\nTIMEOUT after %llu cycles (%.1f s)\n", (unsigned long long)cyc, sec);
    else fprintf(stderr, "\n%s after %llu cycles (%.1f s, %.3f MHz)\n", code == 0 ? "PASS" : "FAIL", (unsigned long long)cyc, sec, sec > 0 ? cyc / sec / 1e6 : 0.0);
    delete top;
    return code;
}
