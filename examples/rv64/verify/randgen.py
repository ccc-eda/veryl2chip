#!/usr/bin/env python3
"""Random instruction tests for Rv64Core: an assembly program of random RV64IMAC + Zicsr
instructions (with misaligned accesses, illegal encodings and system instructions that
trap) whose commit log is compared with spike's (verify/random.sh).

  randgen.py SEED [N] [MODE] > prog.S   N instructions (default 2000), MODE m (default), s or u

In S and U mode the program runs on Sv39 page tables: the code and data are one 2 MB page
mapped to themselves, and s0 points into a window of four 4 KB pages (VA 0x4000_0000..) on the
data buffer whose V / R / W / X / U / A / D bits are random, so loads, stores and AMOs take every
kind of page fault; menvcfg.ADUE (hardware A / D updates), SUM and MXR are random too. Traps go
to the M-mode handler, which skips the instruction and returns to S / U.

Registers: x8 (s0) points into a 8 KB random data buffer and is never written; x31 is the
scratch for AMO addresses; the trap handler (it skips the trapping instruction) uses
x29..x31. Branches and jumps only go forward, so every program ends.
"""
import random
import sys

seed = int(sys.argv[1])
N = int(sys.argv[2]) if len(sys.argv) > 2 else 2000
MODE = sys.argv[3] if len(sys.argv) > 3 else "m"
r = random.Random(seed * 3 + "msu".index(MODE))

# destinations / sources: everything but x0? (x0 is fine as a destination), s0 and the handler's x29..x31
DST = [i for i in range(0, 29) if i != 8]
SRC = [i for i in range(0, 29)]

def rd():
    return f"x{r.choice(DST)}"

def rs():
    return f"x{r.choice(SRC)}"

def imm12():
    return r.choice([0, 1, -1, 2047, -2048, r.randint(-2048, 2047), r.randint(-16, 16)])

def shamt(bits):
    return r.choice([0, 1, bits - 1, r.randint(0, bits - 1)])

def mem_off(size):
    # inside the buffer (s0 = buffer + 4096); mostly aligned
    o = r.randint(-2048, 2047 - size)
    if r.random() < 0.8:
        o &= ~(size - 1)
    return o

ALU_R = ["add", "sub", "sll", "slt", "sltu", "xor", "srl", "sra", "or", "and",
         "mul", "mulh", "mulhsu", "mulhu", "div", "divu", "rem", "remu"]
ALU_RW = ["addw", "subw", "sllw", "srlw", "sraw", "mulw", "divw", "divuw", "remw", "remuw"]
ALU_I = ["addi", "slti", "sltiu", "xori", "ori", "andi"]
LOADS = [("lb", 1), ("lh", 2), ("lw", 4), ("ld", 8), ("lbu", 1), ("lhu", 2), ("lwu", 4)]
STORES = [("sb", 1), ("sh", 2), ("sw", 4), ("sd", 8)]
AMOS = ["amoswap", "amoadd", "amoxor", "amoand", "amoor", "amomin", "amomax", "amominu", "amomaxu"]
BRANCH = ["beq", "bne", "blt", "bge", "bltu", "bgeu"]
# CSRs both models implement the same way (no counters: their values differ), and some that do not exist
CSR_RW = ["mscratch", "sscratch", "stvec", "mtval", "stval", "scause", "sepc", "mcause", "medeleg",
          "mideleg", "mcounteren", "scounteren", "mcountinhibit"] + (["sstatus"] if MODE != "m" else [])
# read only: writes trap (addresses 0xF1x); misa is only read (spike lets software turn extensions off)
CSR_RO = ["mhartid", "mvendorid", "mimpid"]  # (marchid: spike says 5)
CSR_BAD = ["0x7c0", "0x5c0", "0x600", "0xfc0", "0x8c0", "0x3a1", "0x3a3"]

def illegal_word():
    """an encoding that must trap: wrong funct fields, F/D opcodes, reserved formats"""
    k = r.randint(0, 7)
    rd_, rs1_, rs2_ = r.randint(0, 31), r.randint(0, 31), r.randint(0, 31)
    if k == 0:   # OP with an unused funct7
        f7 = r.choice([0x02, 0x04, 0x10, 0x21, 0x40, 0x7f])
        return (f7 << 25) | (rs2_ << 20) | (rs1_ << 15) | (r.randint(0, 7) << 12) | (rd_ << 7) | 0x33
    if k == 1:   # LOAD with funct3 = 7
        return (r.randint(0, 4095) << 20) | (rs1_ << 15) | (7 << 12) | (rd_ << 7) | 0x03
    if k == 2:   # STORE with funct3 >= 4
        return (rs2_ << 20) | (rs1_ << 15) | (r.randint(4, 7) << 12) | 0x23
    if k == 3:   # F / D instructions (no F, D)
        return (r.randint(0, 0x1ffffff) << 7) | r.choice([0x07, 0x27, 0x43, 0x47, 0x4b, 0x4f, 0x53])
    if k == 4:   # SYSTEM funct3 = 4
        return (r.randint(0, 0xfff) << 20) | (rs1_ << 15) | (4 << 12) | (rd_ << 7) | 0x73
    if k == 5:   # OP-32 with funct7 / funct3 combinations that do not exist
        f3, f7 = r.choice([(2, 0), (3, 0), (4, 0), (6, 0), (7, 0), (1, 0x20), (2, 1), (3, 1)])
        return (f7 << 25) | (rs2_ << 20) | (rs1_ << 15) | (f3 << 12) | (rd_ << 7) | 0x3b
    if k == 6:   # shifts with a bad funct6 / funct7
        return (r.choice([0x01, 0x20, 0x3f]) << 26) | (rs1_ << 15) | (r.choice([1, 5]) << 12) | (rd_ << 7) | 0x13
    return 0x00000000 if r.random() < 0.5 else 0xffffffff

def illegal_half():
    """a reserved 16-bit encoding"""
    return r.choice([
        0x0000,                                            # all zero
        0x8000 | (r.randint(0, 0x3ff) << 2),               # quadrant 0, funct3 = 100
        0x2000 | (r.randint(0, 0x7ff) << 2),               # c.fld (no D)
        0x6001 | (r.randint(1, 31) << 7),                  # c.lui with immediate 0 (rd != 0, 2)
        0x4002 | (r.randint(0, 0x1f) << 2),                # c.lwsp rd = 0
        0x8002,                                            # c.jr x0
        0x9c41 | (r.randint(0, 7) << 7) | (r.randint(0, 7) << 2) & 0xffbf,  # c.subw / c.addw area with funct2 10 / 11
    ]) & 0xffff

def gen():
    out = []
    labels_needed = {}
    n = 0
    body = []
    while n < N:
        k = r.random()
        if k < 0.25:
            op = r.choice(ALU_R + ALU_RW)
            body.append(f"{op} {rd()}, {rs()}, {rs()}")
        elif k < 0.40:
            op = r.choice(ALU_I + ["addiw"])
            body.append(f"{op} {rd()}, {rs()}, {imm12()}")
        elif k < 0.46:
            op = r.choice(["slli", "srli", "srai", "slliw", "srliw", "sraiw"])
            body.append(f"{op} {rd()}, {rs()}, {shamt(32 if op.endswith('w') else 64)}")
        elif k < 0.49:
            body.append(r.choice([f"lui {rd()}, {r.randint(0, 0xfffff)}", f"auipc {rd()}, {r.randint(0, 0xfffff)}"]))
        elif k < 0.60:
            op, size = r.choice(LOADS)
            body.append(f"{op} {rd()}, {mem_off(size)}(s0)")
        elif k < 0.69:
            op, size = r.choice(STORES)
            body.append(f"{op} {rs()}, {mem_off(size)}(s0)")
        elif k < 0.75:
            w = r.choice(["w", "d"])
            size = 4 if w == "w" else 8
            off = mem_off(size)
            # the address and the AMO are one entry: a branch never lands between them
            kind = r.random()
            if kind < 0.6:
                amo = f"{r.choice(AMOS)}.{w} {rd()}, {rs()}, (x31)"
            elif kind < 0.8:
                amo = f"lr.{w} {rd()}, (x31)"
            else:
                amo = f"sc.{w} {rd()}, {rs()}, (x31)"
            body.append(f"addi x31, s0, {off}\n    {amo}")
        elif k < 0.83:
            dist = r.randint(1, 6)
            op = r.choice(BRANCH + ["jal"])
            lbl = f"L{len(body) + dist}"
            labels_needed[len(body) + dist] = True
            if op == "jal":
                body.append(f"jal {rd()}, {lbl}")
            else:
                body.append(f"{op} {rs()}, {rs()}, {lbl}")
        elif k < 0.85:
            dist = r.randint(1, 6)
            lbl = f"L{len(body) + dist}"
            labels_needed[len(body) + dist] = True
            body.append(f"la x31, {lbl}\n    jalr {rd()}, 0(x31)")
        elif k < 0.91:
            op = r.choice(["csrrw", "csrrs", "csrrc", "csrrwi", "csrrsi", "csrrci"])
            which = r.random()
            csr = r.choice(CSR_RW) if which < 0.7 else r.choice(CSR_RO) if which < 0.85 else r.choice(CSR_BAD)
            src = str(r.randint(0, 31)) if op.endswith("i") else rs()
            if r.random() < 0.1:
                body.append(f"csrr {rd()}, misa")
            else:
                body.append(f"{op} {rd()}, {csr}, {src}")
        elif k < 0.95:
            if r.random() < 0.5:
                body.append(f".word 0x{illegal_word():08x}")
            else:
                body.append(f".hword 0x{illegal_half():04x}")
        elif k < 0.97:
            body.append(r.choice(["ecall", "ebreak", "c.ebreak", "fence", "fence.i", "fence rw, rw", "nop", "c.nop", "sfence.vma", "sfence.vma x0, x0"]))
        else:
            # values the arithmetic finds interesting
            v = r.choice([0, -1, 1, 0x7fffffffffffffff, -0x8000000000000000, 0x80000000, 0xffffffff, 0x7fffffff, -0x80000000])
            body.append(f"li {rd()}, {v}")
        n += 1
    return body, labels_needed

def main():
    body, labels = gen()
    out = []
    out.append("# random test, seed %d" % seed)
    out.append("    .section .text.init")
    out.append("    .globl _start")
    out.append("_start:")
    out.append("    la t0, trap_handler")
    out.append("    csrw mtvec, t0")
    if MODE == "m":
        out.append("    la s0, buffer + 4096")
    else:
        # Sv39: root[2] -> l1a, l1a[0] = 2 MB page 0x8000_0000 (code, data, page tables);
        #       root[1] -> l1b, l1b[0] -> l0, l0[0..3] = the buffer's pages with random bits
        ubit = 0x10 if MODE == "u" else 0
        out.append("    la t0, pt_root")
        for slot, table in ((2, "pt_l1a"), (1, "pt_l1b")):
            out.append(f"    la t1, {table}")
            out.append("    srli t1, t1, 12")
            out.append("    slli t1, t1, 10")
            out.append("    ori t1, t1, 1")
            out.append(f"    sd t1, {slot * 8}(t0)")
        out.append("    la t1, pt_l1a")
        out.append(f"    li t2, {(0x80000000 >> 12 << 10) | 0xcf | ubit}  # V R W X A D")
        out.append("    sd t2, 0(t1)")
        out.append("    la t1, pt_l1b")
        out.append("    la t2, pt_l0")
        out.append("    srli t2, t2, 12")
        out.append("    slli t2, t2, 10")
        out.append("    ori t2, t2, 1")
        out.append("    sd t2, 0(t1)")
        out.append("    la t1, pt_l0")
        out.append("    la t2, buffer")
        for i in range(4):
            v = 1 if r.random() < 0.9 else 0
            rr = 1 if r.random() < 0.8 else 0
            ww = 1 if r.random() < 0.6 else 0
            xx = 1 if r.random() < 0.3 else 0
            uu = (1 if r.random() < 0.85 else 0) if MODE == "u" else (1 if r.random() < 0.3 else 0)
            aa = 1 if r.random() < 0.6 else 0
            dd = 1 if r.random() < 0.5 else 0
            flags = v | rr << 1 | ww << 2 | xx << 3 | uu << 4 | aa << 6 | dd << 7
            out.append(f"    srli t3, t2, 12")
            out.append(f"    slli t3, t3, 10")
            out.append(f"    ori t3, t3, {flags}")
            out.append(f"    sd t3, {i * 8}(t1)")
            out.append(f"    addi t2, t2, 2047")
            out.append(f"    addi t2, t2, 2047")
            out.append(f"    addi t2, t2, 2")
        out.append("    la t0, pt_root")
        out.append("    srli t0, t0, 12")
        out.append("    li t1, 8 << 60")
        out.append("    or t0, t0, t1")
        out.append("    csrw satp, t0")
        out.append("    sfence.vma")
        adue = r.random() < 0.5
        out.append(f"    li t0, {(1 << 61) if adue else 0}  # menvcfg.ADUE")
        out.append("    csrw menvcfg, t0")
        mpp = 1 if MODE == "s" else 0
        sum_ = 1 if r.random() < 0.5 else 0
        mxr = 1 if r.random() < 0.5 else 0
        out.append("    li t0, 3 << 11")
        out.append("    csrc mstatus, t0")
        out.append(f"    li t0, {(mpp << 11) | (sum_ << 18) | (mxr << 19)}  # MPP SUM MXR")
        out.append("    csrs mstatus, t0")
        out.append("    la t0, L0")
        out.append("    csrw mepc, t0")
        out.append("    li s0, 0x40002000")
    for i in range(1, 32):
        if i in (8,):
            continue
        out.append(f"    li x{i}, 0x{r.getrandbits(64):016x}")
    if MODE != "m":
        out.append("    mret")
    for i, line in enumerate(body):
        out.append(f"L{i}:")
        out.append(f"    {line}")
    # labels past the end
    for i in range(len(body), len(body) + 8):
        out.append(f"L{i}:")
        out.append("    nop")
    out.append("done:")
    out.append("    li x31, 1")
    out.append("    la x30, tohost")
    out.append("    sd x31, 0(x30)")
    out.append("1:  j 1b")
    out.append("")
    out.append("    .balign 4")
    out.append("trap_handler:          # skip the trapping instruction (2 or 4 bytes)")
    out.append("    csrr x31, mepc")
    out.append("    lhu x30, 0(x31)")
    out.append("    andi x30, x30, 3")
    out.append("    addi x31, x31, 2")
    out.append("    addi x30, x30, -3")
    out.append("    bnez x30, 2f")
    out.append("    addi x31, x31, 2")
    out.append("2:  csrw mepc, x31")
    out.append("    csrr x30, mcause")
    out.append("    csrr x29, mtval")
    out.append("    mret")
    out.append("")
    out.append("    .section .tohost, \"aw\", @progbits")
    out.append("    .balign 64")
    out.append("    .globl tohost")
    out.append("tohost: .dword 0")
    out.append("    .balign 64")
    out.append("    .globl fromhost")
    out.append("fromhost: .dword 0")
    out.append("")
    out.append("    .data")
    if MODE != "m":
        for t in ("pt_root", "pt_l1a", "pt_l1b", "pt_l0"):
            out.append("    .balign 4096")
            out.append(f"{t}: .zero 4096")
    out.append("    .balign 4096")
    out.append("buffer:")
    for i in range(0, 8192, 8):
        out.append(f"    .dword 0x{r.getrandbits(64):016x}")
    print("\n".join(out))

main()
