# RV32IMA + Zicsr 指令測試（給 examples/src/rvsoc.veryl 的 RvCore）：M 擴充、A 擴充、
# CSR 指令與 machine mode 陷阱。結果依序寫到 DATA 起的「簽章」區（x31 指向下一格），
# build.sh 用 spike（RISC-V 參考模擬器）跑同一個程式，期望值就是 spike 的簽章。
#ifndef DATA
#define DATA 0
#endif
#define PUT(r) sw r, 0(x31); addi x31, x31, 4
    .text
    .globl _start
_start:
    lui   x31, %hi(DATA)         # 固定兩個指令：spike 和 SoC 的程式位址一樣
    addi  x31, x31, %lo(DATA)
    la    x1, trap
    csrw  mtvec, x1

    # ---------- M：乘法 ----------
    li    x1, 123456789
    li    x2, -987654
    mul   x3, x1, x2
    PUT(x3)
    mulh  x3, x1, x2
    PUT(x3)
    mulhu x3, x1, x2
    PUT(x3)
    mulhsu x3, x2, x1
    PUT(x3)
    li    x4, -1
    mulh  x3, x4, x4         # (-1)(-1) 的高半 = 0
    PUT(x3)
    mulhu x3, x4, x4         # 0xffffffff^2 的高半 = 0xfffffffe
    PUT(x3)
    li    x5, 0x80000000
    mulh  x3, x5, x5         # 2^62 的高半 = 0x40000000
    PUT(x3)
    mulhsu x3, x5, x4
    PUT(x3)
    # ---------- M：除法 ----------
    li    x1, 1000003
    li    x2, -97
    div   x3, x1, x2
    PUT(x3)
    rem   x3, x1, x2
    PUT(x3)
    divu  x3, x1, x2
    PUT(x3)
    remu  x3, x1, x2
    PUT(x3)
    div   x3, x2, x1
    PUT(x3)
    rem   x3, x2, x1
    PUT(x3)
    div   x3, x1, x0         # 除以 0：-1
    PUT(x3)
    rem   x3, x2, x0         # 除以 0：被除數
    PUT(x3)
    divu  x3, x1, x0
    PUT(x3)
    remu  x3, x2, x0
    PUT(x3)
    li    x6, -1
    div   x3, x5, x6         # 溢位：0x80000000
    PUT(x3)
    rem   x3, x5, x6         # 溢位：0
    PUT(x3)

    # ---------- A：LR / SC 與 AMO（用簽章區後面的一格當記憶體）----------
    lui   x10, %hi(DATA + 0x200)
    addi  x10, x10, %lo(DATA + 0x200)
    li    x1, 100
    sw    x1, 0(x10)
    lr.w  x3, (x10)
    PUT(x3)
    li    x2, 7
    sc.w  x3, x2, (x10)      # 有保留：成功（0）
    PUT(x3)
    sc.w  x3, x2, (x10)      # 保留已經用掉：失敗（非 0）
    snez  x3, x3
    PUT(x3)
    lw    x3, 0(x10)
    PUT(x3)
    li    x2, 5
    amoadd.w  x3, x2, (x10)  # 舊值 7，新值 12
    PUT(x3)
    li    x2, 0x0f
    amoxor.w  x3, x2, (x10)
    PUT(x3)
    li    x2, 0x6
    amoand.w  x3, x2, (x10)
    PUT(x3)
    li    x2, 0x30
    amoor.w   x3, x2, (x10)
    PUT(x3)
    li    x2, -3
    amomin.w  x3, x2, (x10)
    PUT(x3)
    li    x2, 50
    amomax.w  x3, x2, (x10)
    PUT(x3)
    li    x2, -1
    amominu.w x3, x2, (x10)
    PUT(x3)
    li    x2, -1
    amomaxu.w x3, x2, (x10)
    PUT(x3)
    li    x2, 0x1234
    amoswap.w x3, x2, (x10)
    PUT(x3)
    lw    x3, 0(x10)
    PUT(x3)

    # ---------- Zicsr（mscratch）----------
    li    x1, 0x5a5a
    csrrw x3, mscratch, x1
    csrrs x3, mscratch, x0   # 只讀
    PUT(x3)
    li    x1, 0x0f0
    csrrs x3, mscratch, x1   # 讀舊值、設位元
    PUT(x3)
    csrrc x3, mscratch, x1
    PUT(x3)
    csrrwi x3, mscratch, 17
    PUT(x3)
    csrrsi x3, mscratch, 8
    PUT(x3)
    csrrci x3, mscratch, 1
    PUT(x3)
    csrr  x3, mscratch
    PUT(x3)

    # ---------- 陷阱：ecall、ebreak、非法指令、mret 與 MIE / MPIE ----------
    li    x29, 0             # 陷阱處理程式數陷入的次數
    csrsi mstatus, 8         # MIE = 1（沒有致能任何中斷）
    ecall
    csrr  x3, mstatus
    andi  x3, x3, 0x88       # mret 之後：MIE = MPIE = 1
    PUT(x3)
    ebreak
    .word 0x00000000         # 非法指令
    csrr  x3, 0x7c0          # 不存在的 CSR：非法指令
    csrw  0xc00, x0          # 寫唯讀的 cycle：非法指令
    PUT(x29)

    # ---------- 結束 ----------
    li    x1, 1
    PUT(x1)
#ifdef SPIKE
    # 參考模擬：結束 spike 並輸出簽章（DATA .. DATA+0x100）
    .globl begin_signature, end_signature
    .equ  begin_signature, DATA
    .equ  end_signature, DATA + 0x100
    la    t0, tohost
    li    t1, 1
    sw    t1, 0(t0)
#endif
halt:
    j     halt

# 陷阱處理程式：記下 mcause、陷入位置（相對 _start）、陷入時的 MIE / MPIE，跳過那個指令
trap:
    csrr  x26, mcause
    PUT(x26)
    csrr  x26, mepc
    la    x27, _start
    sub   x26, x26, x27
    PUT(x26)
    csrr  x26, mstatus
    andi  x26, x26, 0x88     # 陷入時 MIE = 0，MPIE = 之前的 MIE
    PUT(x26)
    csrr  x26, mepc
    addi  x26, x26, 4
    csrw  mepc, x26
    addi  x29, x29, 1
    mret
#ifdef SPIKE
    .data
    .align 6
    .globl tohost, fromhost
tohost:   .word 0, 0
fromhost: .word 0, 0
#endif
