# RV32I 指令測試程式（給 examples/src/rv32i.veryl 的 TestRiscvCore）
# 每個結果寫到資料記憶體的「簽章」區 word[0..47]（位址 0x00-0xbf），
# 0xc0 之後是 load/store 的暫存區；TestRiscvCore 逐字 $assert 檢查。
# 重新產生 ROM：./build.sh（輸出 ../src/rv32i_rom.veryl）
# 資料都以 x31 = DATA 為基底存取：在 RiscvCore 上 DATA = 0；用 spike 參考模擬時
# 程式與資料放在 0x80000000 之後（spike 不允許位址 0），結果才能逐字比對。
#ifndef DATA
#define DATA 0
#endif
    .text
    .globl _start
_start:
#if DATA > 0 && DATA < 0x800
    addi  x31, x0, DATA           # a small base (RvSoc's testbench memory is 1 KB)
#else
    lui   x31, %hi(DATA)
#endif
    # ---------- U-type: lui / auipc ----------
    lui   x1, 0x12345
    addi  x1, x1, 0x678          # x1 = 0x12345678
    sw    x1, 0(x31)              # [0]  = 0x12345678
    auipc x2, 0                  # (at 0x10)
    sw    x2, 4(x31)              # [1]  = 0x00000010 (= address of the auipc)
    lui   x2, 0xfffff
    srai  x2, x2, 12
    sw    x2, 8(x31)              # [2]  = 0xffffffff

    # ---------- R / I arithmetic, logic, shifts, compares ----------
    addi  x3, x0, -8             # x3 = 0xfffffff8
    addi  x4, x0, 3              # x4 = 3
    add   x5, x3, x4
    sw    x5, 12(x31)             # [3]  = 0xfffffffb
    sub   x5, x4, x3
    sw    x5, 16(x31)             # [4]  = 0x0000000b
    sll   x5, x3, x4
    sw    x5, 20(x31)             # [5]  = 0xffffffc0
    srl   x5, x3, x4
    sw    x5, 24(x31)             # [6]  = 0x1fffffff
    sra   x5, x3, x4
    sw    x5, 28(x31)             # [7]  = 0xffffffff
    slli  x5, x4, 30
    sw    x5, 32(x31)             # [8]  = 0xc0000000
    srli  x5, x3, 28
    sw    x5, 36(x31)             # [9]  = 0x0000000f
    srai  x5, x3, 1
    sw    x5, 40(x31)             # [10] = 0xfffffffc
    xor   x5, x1, x3
    sw    x5, 44(x31)             # [11] = 0xedcba980
    xori  x5, x4, -1
    sw    x5, 48(x31)             # [12] = 0xfffffffc
    or    x5, x1, x4
    sw    x5, 52(x31)             # [13] = 0x1234567b
    ori   x5, x4, 0x7f0
    sw    x5, 56(x31)             # [14] = 0x000007f3
    and   x5, x1, x3
    sw    x5, 60(x31)             # [15] = 0x12345678
    andi  x5, x1, 0xff
    sw    x5, 64(x31)             # [16] = 0x00000078
    slt   x5, x3, x4
    sw    x5, 68(x31)             # [17] = 1   (-8 < 3)
    sltu  x5, x3, x4
    sw    x5, 72(x31)             # [18] = 0   (0xfffffff8 < 3 unsigned: no)
    slti  x5, x4, -1
    sw    x5, 76(x31)             # [19] = 0
    sltiu x5, x4, -1
    sw    x5, 80(x31)             # [20] = 1
    addi  x6, x0, 33
    sll   x5, x4, x6             # shift amount is rs2[4:0] = 1
    sw    x5, 84(x31)             # [21] = 6

    # ---------- branches: a bit is set when the branch is NOT taken ----------
    addi  x7, x0, 0
    addi  x8, x0, 0
    beq   x4, x4, 1f
    ori   x7, x7, 1
1:  beq   x3, x4, 1f
    ori   x7, x7, 2
1:  bne   x3, x4, 1f
    ori   x7, x7, 4
1:  bne   x4, x4, 1f
    ori   x7, x7, 8
1:  blt   x3, x4, 1f
    ori   x7, x7, 16
1:  blt   x4, x3, 1f
    ori   x7, x7, 32
1:  bge   x4, x3, 1f
    ori   x7, x7, 64
1:  bge   x3, x4, 1f
    ori   x7, x7, 128
1:  bge   x4, x4, 1f
    ori   x7, x7, 256
1:  bltu  x4, x3, 1f
    ori   x8, x8, 1
1:  bltu  x3, x4, 1f
    ori   x8, x8, 2
1:  bgeu  x3, x4, 1f
    ori   x8, x8, 4
1:  bgeu  x4, x3, 1f
    ori   x8, x8, 8
1:  bgeu  x4, x4, 1f
    ori   x8, x8, 16
1:  sw    x7, 88(x31)             # [22] = 0x000000aa
    sw    x8, 92(x31)             # [23] = 0x0000000a
    addi  x9, x0, 0              # backward branch: 5 + 4 + 3 + 2 + 1
    addi  x10, x0, 5
2:  add   x9, x9, x10
    addi  x10, x10, -1
    bne   x10, x0, 2b
    sw    x9, 96(x31)             # [24] = 15

    # ---------- jal / jalr ----------
    addi  x7, x0, 0
    jal   x11, 1f                # x11 = address of the next instruction
    ori   x7, x7, 1              # skipped
1:  auipc x12, 0                 # x12 = A
    jalr  x13, 17(x12)           # target (A + 17) & ~1 = A + 16, x13 = A + 8
    ori   x7, x7, 2              # skipped
    ori   x7, x7, 4              # skipped
    sub   x14, x13, x12
    sub   x15, x11, x12
    sw    x7, 100(x31)            # [25] = 0
    sw    x14, 104(x31)           # [26] = 8
    sw    x15, 108(x31)           # [27] = 0xfffffffc

    # ---------- byte / halfword loads and stores ----------
    sw    x1, 0xc0(x31)           # 0xc0: 78 56 34 12
    sw    x3, 0xc4(x31)           # 0xc4: f8 ff ff ff
    lb    x5, 0xc0(x31)
    sw    x5, 112(x31)            # [28] = 0x00000078
    lb    x5, 0xc3(x31)
    sw    x5, 116(x31)            # [29] = 0x00000012
    lb    x5, 0xc4(x31)
    sw    x5, 120(x31)            # [30] = 0xfffffff8
    lbu   x5, 0xc4(x31)
    sw    x5, 124(x31)            # [31] = 0x000000f8
    lh    x5, 0xc2(x31)
    sw    x5, 128(x31)            # [32] = 0x00001234
    lh    x5, 0xc4(x31)
    sw    x5, 132(x31)            # [33] = 0xfffffff8
    lhu   x5, 0xc6(x31)
    sw    x5, 136(x31)            # [34] = 0x0000ffff
    lhu   x5, 0xc0(x31)
    sw    x5, 140(x31)            # [35] = 0x00005678
    sb    x4, 0xc1(x31)           # 0xc0: 78 03 34 12
    sb    x3, 0xc2(x31)           # 0xc0: 78 03 f8 12
    sh    x4, 0xc6(x31)           # 0xc4: f8 ff 03 00
    lw    x5, 0xc0(x31)
    sw    x5, 144(x31)            # [36] = 0x12f80378
    lw    x5, 0xc4(x31)
    sw    x5, 148(x31)            # [37] = 0x0003fff8
    sw    x0, 0xc8(x31)
    sh    x1, 0xc8(x31)
    sh    x1, 0xca(x31)
    lw    x5, 0xc8(x31)
    sw    x5, 152(x31)            # [38] = 0x56785678

    # ---------- x0 stays zero ----------
    addi  x0, x0, 5
    sw    x0, 156(x31)            # [39] = 0

    addi  x5, x0, 1
    sw    x5, 188(x31)            # [47] = 1 (done)
halt:
#ifdef SPIKE
    # 參考模擬：結束 spike 並輸出簽章（DATA .. DATA+0xc0）
    .globl begin_signature, end_signature
    .equ  begin_signature, DATA
    .equ  end_signature, DATA + 0xc0
    la    t0, tohost
    li    t1, 1
    sw    t1, 0(t0)
#endif
    jal   x0, halt
#ifdef SPIKE
    .data
    .align 6
    .globl tohost, fromhost
tohost:   .word 0, 0
fromhost: .word 0, 0
#endif
