// Directed interrupt tests for Rv64Soc (they check themselves: tohost = 1 when all pass,
// else (test << 1) | 1). Interrupt timing differs from spike, so these are not compared.
//   2  M timer (CLINT mtimecmp)            3  M software (CLINT msip)
//   4  wfi wakes up with interrupts globally off, mip.MTIP seen
//   5  S timer (Sstc stimecmp), delegated  6  S software (mip.SSIP), delegated
//   7  M timer taken while in U mode with mstatus.MIE = 0
//   8  M external: UART THRE -> PLIC context 0 (claim 10, complete)
//   9  S external: UART THRE -> PLIC context 1, delegated
//  10  priority: MSI and MTI pending together -> MSI first

#define CLINT      0x02000000
#define MSIP       (CLINT + 0x0)
#define MTIMECMP   (CLINT + 0x4000)
#define MTIME      (CLINT + 0xbff8)
#define PLIC       0x0c000000
#define UART       0x10000000
#define TIMEOUT    200000

// s1 = interrupt seen (set by a handler), s2 = its cause, s3 = continuation in M after an ecall
    .section .text.init
    .globl _start
_start:
    la t0, mtrap
    csrw mtvec, t0
    la t0, strap
    csrw stvec, t0
    li t0, -1
    li t1, MTIMECMP
    sd t0, 0(t1)

// ---- 2: M timer
    li gp, 2
    li s1, 0
    li t0, MTIME
    ld t1, 0(t0)
    addi t1, t1, 300
    li t0, MTIMECMP
    sd t1, 0(t0)
    li t0, 0x80                 # mie.MTIE
    csrw mie, t0
    csrsi mstatus, 8            # MIE
    call wait_irq
    csrci mstatus, 8
    li t0, (1 << 63) | 7
    bne s2, t0, fail

// ---- 3: M software
    li gp, 3
    li s1, 0
    li t0, 0x08                 # mie.MSIE
    csrw mie, t0
    li t0, MSIP
    li t1, 1
    sw t1, 0(t0)
    csrsi mstatus, 8
    call wait_irq
    csrci mstatus, 8
    li t0, (1 << 63) | 3
    bne s2, t0, fail

// ---- 4: wfi with mstatus.MIE = 0: wakes up, no trap, mip.MTIP is set
    li gp, 4
    li s1, 0
    li t0, 0x80
    csrw mie, t0
    li t0, MTIME
    ld t1, 0(t0)
    addi t1, t1, 200
    li t0, MTIMECMP
    sd t1, 0(t0)
    wfi
    csrr t0, mip
    andi t0, t0, 0x80
    beqz t0, fail
    bnez s1, fail               # no trap was taken
    li t0, -1
    li t1, MTIMECMP
    sd t0, 0(t1)
    csrw mie, zero

// ---- 5: S timer through Sstc, delegated to S
    li gp, 5
    li t0, 1 << 63              # menvcfg.STCE
    csrs menvcfg, t0
    li t0, 2                    # mcounteren.TM
    csrs mcounteren, t0
    li t0, 0x222                # delegate SSI STI SEI
    csrw mideleg, t0
    la s3, after5
    la a0, s_timer
    j enter_s
s_timer:                        # in S mode
    li s1, 0
    li t0, 0x20                 # sie.STIE
    csrw sie, t0
    csrr t1, time
    addi t1, t1, 300
    csrw stimecmp, t1
    csrsi sstatus, 2            # SIE
    call wait_irq
    csrci sstatus, 2
    ecall
after5:
    li t0, (1 << 63) | 5
    bne s2, t0, fail

// ---- 6: S software interrupt (mip.SSIP set from M), delegated
    li gp, 6
    li t0, 0x02
    csrs mip, t0                # SSIP
    la s3, after6
    la a0, s_soft
    j enter_s
s_soft:
    li s1, 0
    li t0, 0x02                 # sie.SSIE
    csrw sie, t0
    csrsi sstatus, 2
    call wait_irq
    csrci sstatus, 2
    ecall
after6:
    li t0, (1 << 63) | 1
    bne s2, t0, fail

// ---- 7: M timer while in U mode (mstatus.MIE = 0: M interrupts are on below M)
    li gp, 7
    csrw mideleg, zero
    li t0, 0x80
    csrw mie, t0
    li s1, 0
    li t0, MTIME
    ld t1, 0(t0)
    addi t1, t1, 300
    li t0, MTIMECMP
    sd t1, 0(t0)
    la s3, after7
    la a0, u_wait
    j enter_u
u_wait:
    call wait_irq
    ecall
after7:
    li t0, (1 << 63) | 7
    bne s2, t0, fail
    csrr t0, mstatus            # the timer trap came from U: MPP was U before the ecall's trap
    csrw mie, zero

// ---- 8: M external: UART THRE interrupt through PLIC context 0
    li gp, 8
    li t0, PLIC + 10 * 4        # priority of source 10
    li t1, 1
    sw t1, 0(t0)
    li t0, PLIC + 0x2000        # context 0 enables
    li t1, 1 << 10
    sw t1, 0(t0)
    li t0, PLIC + 0x200000      # context 0 threshold
    sw zero, 0(t0)
    li t0, 0x800                # mie.MEIE
    csrw mie, t0
    li s1, 0
    csrsi mstatus, 8
    li t0, UART + 1
    li t1, 2                    # IER: THRE interrupt
    sb t1, 0(t0)
    call wait_irq
    csrci mstatus, 8
    li t0, (1 << 63) | 11
    bne s2, t0, fail
    li t0, 10
    bne s4, t0, fail            # claimed source
    csrw mie, zero
    li t0, PLIC + 0x2000
    sw zero, 0(t0)

// ---- 9: S external: the same through PLIC context 1, delegated
    li gp, 9
    li t0, 0x222
    csrw mideleg, t0
    li t0, PLIC + 0x2080        # context 1 enables
    li t1, 1 << 10
    sw t1, 0(t0)
    li t0, PLIC + 0x201000      # context 1 threshold
    sw zero, 0(t0)
    la s3, after9
    la a0, s_ext
    j enter_s
s_ext:
    li s1, 0
    li t0, 0x200                # sie.SEIE
    csrw sie, t0
    csrsi sstatus, 2
    li t0, UART + 1
    li t1, 2
    sb t1, 0(t0)
    call wait_irq
    csrci sstatus, 2
    ecall
after9:
    li t0, (1 << 63) | 9
    bne s2, t0, fail
    li t0, 10
    bne s4, t0, fail

// ---- 10: MSI and MTI pending together: MSI is taken first
    li gp, 10
    csrci mstatus, 8            # (the ecall from S came back with MIE = MPIE = 1)
    li s1, 0
    csrw mideleg, zero
    li t0, MTIME
    ld t1, 0(t0)
    li t0, MTIMECMP
    sd t1, 0(t0)                # MTIP now
    li t0, MSIP
    li t1, 1
    sw t1, 0(t0)                # MSIP now
    li t0, 0x88
    csrw mie, t0
    csrsi mstatus, 8
    call wait_irq               # the first interrupt clears its own source
    csrci mstatus, 8
    li t0, (1 << 63) | 3
    bne s2, t0, fail
    li t0, -1
    li t1, MTIMECMP
    sd t0, 0(t1)

pass:
    li t0, 1
    la t1, tohost
    sd t0, 0(t1)
1:  j 1b

fail:
    slli t0, gp, 1
    ori t0, t0, 1
    la t1, tohost
    sd t0, 0(t1)
1:  j 1b

// wait (in any mode) until a handler sets s1
wait_irq:
    li t2, TIMEOUT
1:  bnez s1, 2f
    addi t2, t2, -1
    bnez t2, 1b
    j fail
2:  ret

// mret to a0 in S / U mode
enter_s:
    li t0, 3 << 11
    csrc mstatus, t0
    li t0, 1 << 11
    csrs mstatus, t0
    csrw mepc, a0
    mret
enter_u:
    li t0, 3 << 11
    csrc mstatus, t0
    csrw mepc, a0
    mret

// ---- M-mode trap handler
    .balign 4
mtrap:
    csrr t5, mcause
    bltz t5, m_irq
    li t6, 8
    blt t5, t6, fail            # exceptions other than ecall are not expected
    li t6, 9
    bgt t5, t6, fail
    # ecall from U / S: continue in M at s3
    li t6, 3 << 11
    csrs mstatus, t6            # MPP = M
    csrw mepc, s3
    mret
m_irq:
    bnez s1, 1f                 # only the first interrupt's cause is recorded
    mv s2, t5
1:  li s1, 1
    andi t5, t5, 0x3f
    li t6, 7
    beq t5, t6, m_timer
    li t6, 3
    beq t5, t6, m_soft
    li t6, 11
    beq t5, t6, m_ext
    j fail
m_timer:
    li t5, -1
    li t6, MTIMECMP
    sd t5, 0(t6)
    mret
m_soft:
    li t6, MSIP
    sw zero, 0(t6)
    mret
m_ext:
    li t6, PLIC + 0x200004
    lw s4, 0(t6)                # claim
    li t5, UART + 1
    sb zero, 0(t5)              # IER = 0
    li t5, UART + 2
    lb zero, 0(t5)              # read IIR
    sw s4, 0(t6)                # complete
    csrw mie, zero
    mret

// ---- S-mode trap handler
    .balign 4
strap:
    csrr t5, scause
    bgez t5, fail
    mv s2, t5
    li s1, 1
    andi t5, t5, 0x3f
    li t6, 5
    beq t5, t6, s_tmr
    li t6, 1
    beq t5, t6, s_sw
    li t6, 9
    beq t5, t6, s_ex
    j fail
s_tmr:
    li t5, -1
    csrw stimecmp, t5
    sret
s_sw:
    csrci sip, 2
    sret
s_ex:
    li t6, PLIC + 0x201004
    lw s4, 0(t6)
    li t5, UART + 1
    sb zero, 0(t5)
    li t5, UART + 2
    lb zero, 0(t5)
    sw s4, 0(t6)
    csrw sie, zero
    sret

    .section .tohost, "aw", @progbits
    .balign 64
    .globl tohost
tohost: .dword 0
    .balign 64
    .globl fromhost
fromhost: .dword 0
