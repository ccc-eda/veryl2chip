//! The hart: RV64IMAC + Zicsr + Zicntr + Zifencei + Sstc + Svadu, M / S / U, Sv39,
//! behaving like Rv64Core (examples/rv64/src/rv64core.veryl) and spike: misaligned loads and
//! stores trap, PMP registers exist without checks, the A / D bits are set by the hardware
//! only when menvcfg.ADUE is on, mtval gets the faulting address or the instruction.
//!
//! Time: mtime counts instructions (one a step); `wfi` with nothing pending jumps it to the
//! next timer. A small TLB caches Sv39 leaves per 4 KB page; the permission check is done on
//! every access from the cached PTE bits, so caching never changes behavior.

use crate::bus::{Bus, RAM_BASE};

/// a trap: the cause (bit 63 = interrupt) and mtval / stval
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Trap { pub cause: u64, pub tval: u64 }

const INT: u64 = 1 << 63;
fn exc(cause: u64, tval: u64) -> Trap { Trap { cause, tval } }

#[derive(Clone, Copy, PartialEq)]
enum Acc { Fetch, Load, Store }

#[derive(Clone, Copy, Default)]
struct Tlb { tag: u64, page: u64, pte: u64 }

const TLB_N: usize = 512;

// mstatus bits
const SIE: u64 = 1 << 1;
const MIE: u64 = 1 << 3;
const SPIE: u64 = 1 << 5;
const MPIE: u64 = 1 << 7;
const SPP: u64 = 1 << 8;
const MPP: u64 = 3 << 11;
const FS: u64 = 3 << 13;
const MPRV: u64 = 1 << 17;
const SUM: u64 = 1 << 18;
const MXR: u64 = 1 << 19;
const TVM: u64 = 1 << 20;
const TW: u64 = 1 << 21;
const TSR: u64 = 1 << 22;
const MSTATUS_W: u64 = SIE | MIE | SPIE | MPIE | SPP | MPP | FS | MPRV | SUM | MXR | TVM | TW | TSR;
const SSTATUS_W: u64 = SIE | SPIE | SPP | FS | SUM | MXR;
const XLEN_BITS: u64 = 2 << 32 | 2 << 34;
// interrupt bits
const SSIP: u64 = 1 << 1;
const MSIP: u64 = 1 << 3;
const STIP: u64 = 1 << 5;
const MTIP: u64 = 1 << 7;
const SEIP: u64 = 1 << 9;
const MEIP: u64 = 1 << 11;
// menvcfg
const STCE: u64 = 1 << 63;
const ADUE: u64 = 1 << 61;

/// repr(C): translated blocks (jit.rs) find x, pc and jit_fault at fixed offsets
#[repr(C)]
pub struct Machine {
    pub x: [u64; 32],
    pub pc: u64,
    /// set by the translated code's helpers: 1 = a trap (in `jit.trap`), 2 = a store hit translated code
    pub jit_fault: u64,
    pub prv: u64,
    mstatus: u64, medeleg: u64, mideleg: u64, mie: u64, mip_sw: u64,
    mtvec: u64, mepc: u64, mcause: u64, mtval: u64, mscratch: u64, mcounteren: u64, menvcfg: u64,
    stvec: u64, sepc: u64, scause: u64, stval: u64, sscratch: u64, scounteren: u64, senvcfg: u64, satp: u64, stimecmp: u64,
    pmpcfg: [u64; 2], pmpaddr: [u64; 16],
    /// instructions done (minstret, mcycle)
    pub instret: u64,
    /// minstret / mcycle = instret + these (after writes)
    instret_off: u64,
    cycle_off: u64,
    resv: Option<u64>,
    tlb: Vec<Tlb>,
    pub bus: Bus,
    /// look at interrupts before the next instruction
    check: bool,
    /// mtime at which a timer interrupt may start
    timer_next: u64,
    /// in wfi
    pub waiting: bool,
    /// the last register write (commit log): (rd, value)
    pub last_wr: Option<(usize, u64)>,
    /// the instruction last done, its pc and privilege (commit log)
    pub last_insn: u32,
    pub last_pc: u64,
    pub last_prv: u64,
    /// mtime is set by the caller from a clock (else it counts instructions)
    pub realtime: bool,
    /// translation to WebAssembly (wasm32 hosts)
    pub jit: crate::jit::State,
}

/// what `run` stopped for
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Stop { Count, Finished, Idle, Jit }

fn sext(v: u64, bits: u32) -> u64 { (((v << (64 - bits)) as i64) >> (64 - bits)) as u64 }

impl Machine {
    pub fn new(ram_size: usize) -> Machine { Machine { bus: Bus::new(ram_size), ..Machine::blank() } }

    /// the reset: pc = 0x8000_0000 in machine mode, CSRs and devices cleared (the RAM is kept)
    pub fn reset(&mut self) {
        let bus = std::mem::replace(&mut self.bus, Bus::new(0));
        let mut jit = std::mem::take(&mut self.jit);
        jit.clear();
        *self = Machine { bus, jit, ..Machine::blank() };
        self.bus.reset();
    }

    fn blank() -> Machine {
        Machine {
            x: [0; 32], pc: RAM_BASE, prv: 3, mstatus: XLEN_BITS, medeleg: 0, mideleg: 0, mie: 0, mip_sw: 0, mtvec: 0, mepc: 0, mcause: 0, mtval: 0,
            mscratch: 0, mcounteren: 0, menvcfg: 0, stvec: 0, sepc: 0, scause: 0, stval: 0, sscratch: 0, scounteren: 0,
            senvcfg: 0, satp: 0, stimecmp: u64::MAX, pmpcfg: [0; 2], pmpaddr: [0; 16], instret: 0, instret_off: 0, cycle_off: 0, resv: None,
            tlb: vec![Tlb { tag: u64::MAX, page: 0, pte: 0 }; TLB_N], bus: Bus::new(0), check: true, timer_next: 0, waiting: false,
            last_wr: None, last_insn: 0, last_pc: 0, last_prv: 0, realtime: false, jit_fault: 0, jit: Default::default(),
        }
    }

    // ------------------------------------------------------------ interrupts and traps

    fn mip(&self) -> u64 {
        let (meip, seip) = self.bus.eip();
        let mut v = self.mip_sw & (SSIP | SEIP | if self.menvcfg & STCE != 0 { 0 } else { STIP });
        if self.bus.mtime >= self.bus.mtimecmp { v |= MTIP; }
        if self.bus.msip { v |= MSIP; }
        if meip { v |= MEIP; }
        if seip { v |= SEIP; }
        if self.menvcfg & STCE != 0 && self.bus.mtime >= self.stimecmp { v |= STIP; }
        v
    }

    /// when a timer interrupt can start next
    fn timer_update(&mut self) {
        let mut t = self.bus.mtimecmp;
        if self.menvcfg & STCE != 0 { t = t.min(self.stimecmp); }
        self.timer_next = t;
        self.check = true;
    }

    /// the interrupt to take now, if any
    fn interrupt(&self) -> Option<u64> {
        let pend = self.mip() & self.mie;
        if pend == 0 { return None; }
        let m_on = self.prv < 3 || self.mstatus & MIE != 0;
        let s_on = self.prv < 1 || (self.prv == 1 && self.mstatus & SIE != 0);
        let m = if m_on { pend & !self.mideleg } else { 0 };
        let s = if s_on { pend & self.mideleg } else { 0 };
        let pick = if m != 0 { m } else { s };
        if pick == 0 { return None; }
        [11, 3, 7, 9, 1, 5].into_iter().find(|i| pick >> i & 1 != 0)
    }

    pub fn trap(&mut self, t: Trap) {
        self.jit.at_block = true;
        let irq = t.cause & INT != 0;
        let code = t.cause & 63;
        let deleg = if irq { self.mideleg } else { self.medeleg };
        self.resv = None;
        if self.prv <= 1 && deleg >> code & 1 != 0 {
            self.scause = t.cause;
            self.sepc = self.pc;
            self.stval = t.tval;
            let s = self.mstatus;
            self.mstatus = (s & !(SPP | SPIE | SIE)) | if s & SIE != 0 { SPIE } else { 0 } | if self.prv == 1 { SPP } else { 0 };
            self.prv = 1;
            self.pc = (self.stvec & !3) + if irq && self.stvec & 1 != 0 { 4 * code } else { 0 };
        } else {
            self.mcause = t.cause;
            self.mepc = self.pc;
            self.mtval = t.tval;
            let s = self.mstatus;
            self.mstatus = (s & !(MPP | MPIE | MIE)) | if s & MIE != 0 { MPIE } else { 0 } | self.prv << 11;
            self.prv = 3;
            self.pc = (self.mtvec & !3) + if irq && self.mtvec & 1 != 0 { 4 * code } else { 0 };
        }
        self.check = true;
    }

    // ------------------------------------------------------------ memory

    fn flush_tlb(&mut self) { for e in self.tlb.iter_mut() { e.tag = u64::MAX; } self.jit.flush_tlb(); }

    /// may this access use a page with these PTE bits?
    fn perm_ok(&self, pte: u64, acc: Acc, prv: u64) -> bool {
        let (r, w, x, u) = (pte & 2 != 0, pte & 4 != 0, pte & 8 != 0, pte & 16 != 0);
        if prv == 0 && !u { return false; }
        if prv == 1 && u && (acc == Acc::Fetch || self.mstatus & SUM == 0) { return false; }
        match acc { Acc::Fetch => x, Acc::Load => r || (x && self.mstatus & MXR != 0), Acc::Store => w }
    }

    fn page_fault(acc: Acc, va: u64) -> Trap { exc(match acc { Acc::Fetch => 12, Acc::Load => 13, Acc::Store => 15 }, va) }
    fn access_fault(acc: Acc, va: u64) -> Trap { exc(match acc { Acc::Fetch => 1, Acc::Load => 5, Acc::Store => 7 }, va) }

    /// virtual -> physical
    #[inline]
    fn translate(&mut self, va: u64, acc: Acc) -> Result<u64, Trap> {
        let prv = if acc != Acc::Fetch && self.mstatus & MPRV != 0 { self.mstatus >> 11 & 3 } else { self.prv };
        if prv == 3 || self.satp >> 60 == 0 { return Ok(va); }
        let vpn = va >> 12;
        let e = self.tlb[(vpn as usize) & (TLB_N - 1)];
        if e.tag == vpn && e.pte & 0x40 != 0 && (acc != Acc::Store || e.pte & 0x80 != 0) {
            if !self.perm_ok(e.pte, acc, prv) { return Err(Self::page_fault(acc, va)); }
            return Ok(e.page | (va & 0xfff));
        }
        self.walk(va, acc, prv)
    }

    fn walk(&mut self, va: u64, acc: Acc, prv: u64) -> Result<u64, Trap> {
        if sext(va, 39) != va { return Err(Self::page_fault(acc, va)); }
        let mut a = (self.satp & ((1 << 44) - 1)) << 12;
        let mut level = 2i32;
        loop {
            let pa = a + ((va >> (12 + 9 * level as u64)) & 511) * 8;
            if !self.bus.in_ram(pa, 8) { return Err(Self::access_fault(acc, va)); }
            let o = (pa - RAM_BASE) as usize;
            let mut pte = u64::from_le_bytes(self.bus.ram[o..o + 8].try_into().unwrap());
            let (v, r, w, x) = (pte & 1 != 0, pte & 2 != 0, pte & 4 != 0, pte & 8 != 0);
            if !v || (!r && w) || pte >> 54 != 0 { return Err(Self::page_fault(acc, va)); }
            if !r && !x {
                if level == 0 { return Err(Self::page_fault(acc, va)); }
                level -= 1;
                a = (pte >> 10 & ((1 << 44) - 1)) << 12;
                continue;
            }
            // a leaf: superpages must be aligned
            let ppn = pte >> 10 & ((1 << 44) - 1);
            if level > 0 && ppn & ((1 << (9 * level)) - 1) != 0 { return Err(Self::page_fault(acc, va)); }
            if !self.perm_ok(pte, acc, prv) { return Err(Self::page_fault(acc, va)); }
            // accessed / dirty: set by the hardware with Svadu (menvcfg.ADUE), else a page fault
            let need = 0x40 | if acc == Acc::Store { 0x80 } else { 0 };
            if pte & need != need {
                if self.menvcfg & ADUE == 0 { return Err(Self::page_fault(acc, va)); }
                pte |= need;
                self.bus.ram[o..o + 8].copy_from_slice(&pte.to_le_bytes());
            }
            let mask = (1u64 << (12 + 9 * level)) - 1;
            let page = ((ppn << 12) & !mask | (va & mask)) & !0xfff;
            let vpn = va >> 12;
            self.tlb[(vpn as usize) & (TLB_N - 1)] = Tlb { tag: vpn, page, pte: pte & 0xff };
            return Ok(page | (va & 0xfff));
        }
    }

    /// read size bytes at a physical address
    #[inline]
    fn read_pa(&mut self, pa: u64, size: u32, va: u64, acc: Acc) -> Result<u64, Trap> {
        if self.bus.in_ram(pa, size as u64) {
            let o = (pa - RAM_BASE) as usize;
            let r = &self.bus.ram;
            return Ok(match size { 1 => r[o] as u64, 2 => u16::from_le_bytes([r[o], r[o + 1]]) as u64,
                4 => u32::from_le_bytes(r[o..o + 4].try_into().unwrap()) as u64, _ => u64::from_le_bytes(r[o..o + 8].try_into().unwrap()) });
        }
        self.check = true;
        match self.bus.dev_read(pa, size) {
            Some(v) => Ok(v & if size == 8 { u64::MAX } else { (1 << (8 * size)) - 1 }),
            None => Err(Self::access_fault(acc, va)),
        }
    }

    fn write_pa(&mut self, pa: u64, size: u32, v: u64, va: u64) -> Result<(), Trap> {
        if self.bus.in_ram(pa, size as u64) {
            let o = (pa - RAM_BASE) as usize;
            self.bus.ram[o..o + size as usize].copy_from_slice(&v.to_le_bytes()[..size as usize]);
            if Some(pa) == self.bus.tohost && v != 0 { self.bus.tohost_val = v; }
            if self.jit.on && self.jit.has_code(o) { self.jit.invalidate_page(o); self.jit.hit = true; }
            return Ok(());
        }
        self.check = true;
        if self.bus.dev_write(pa, size, v) { if pa >> 16 == 0x200 { self.timer_update(); } Ok(()) } else { Err(exc(7, va)) }
    }

    #[inline]
    fn vload(&mut self, va: u64, size: u32) -> Result<u64, Trap> {
        if va & (size as u64 - 1) != 0 { return Err(exc(4, va)); }
        let pa = self.translate(va, Acc::Load)?;
        self.read_pa(pa, size, va, Acc::Load)
    }

    #[inline]
    fn vstore(&mut self, va: u64, size: u32, v: u64) -> Result<(), Trap> {
        if va & (size as u64 - 1) != 0 { return Err(exc(6, va)); }
        let pa = self.translate(va, Acc::Store)?;
        self.write_pa(pa, size, v, va)
    }

    /// 16 bits of an instruction
    #[inline]
    fn fetch16(&mut self, va: u64) -> Result<u32, Trap> {
        let pa = self.translate(va, Acc::Fetch)?;
        if self.bus.in_ram(pa, 2) {
            let o = (pa - RAM_BASE) as usize;
            return Ok(u16::from_le_bytes([self.bus.ram[o], self.bus.ram[o + 1]]) as u32);
        }
        Err(exc(1, va))
    }

    #[inline]
    fn fetch(&mut self) -> Result<u32, Trap> {
        let pc = self.pc;
        // the whole instruction in one page: one translation
        if pc & 0xfff <= 0xffc {
            let pa = self.translate(pc, Acc::Fetch)?;
            if self.bus.in_ram(pa, 4) {
                let o = (pa - RAM_BASE) as usize;
                let w = u32::from_le_bytes(self.bus.ram[o..o + 4].try_into().unwrap());
                return Ok(if w & 3 == 3 { w } else { w & 0xffff });
            }
            if self.bus.in_ram(pa, 2) {
                let lo = self.fetch16(pc)?;
                if lo & 3 != 3 { return Ok(lo); }
            }
            return Err(exc(1, pc));
        }
        let lo = self.fetch16(pc)?;
        if lo & 3 != 3 { return Ok(lo); }
        let hi = self.fetch16(pc + 2)?;
        Ok(lo | hi << 16)
    }

    // ------------------------------------------------------------ CSRs

    fn counter_ok(&self, n: u64) -> bool {
        let bit = n & 31;
        (self.prv == 3 || self.mcounteren >> bit & 1 != 0) && (self.prv >= 1 || self.scounteren >> bit & 1 != 0)
    }

    fn csr_read(&mut self, n: u64) -> Option<u64> {
        let minstret = self.instret.wrapping_add(self.instret_off);
        let mcycle = self.instret.wrapping_add(self.cycle_off);
        Some(match n {
            0xc00 => { if !self.counter_ok(n) { return None; } mcycle }
            0xc02 => { if !self.counter_ok(n) { return None; } minstret }
            0xc01 => { if !self.counter_ok(n) { return None; } self.bus.mtime }
            0xc03..=0xc1f => { if !self.counter_ok(n) { return None; } 0 }
            0xb00 => mcycle, 0xb02 => minstret,
            0xb03..=0xb1f | 0x323..=0x33f => 0,
            // no debug triggers (tdata1 reads 0), mcountinhibit fixed at 0
            0x7a0..=0x7a3 | 0x320 => 0,
            0x300 => { let s = self.mstatus; s | if s & FS == FS { 1 << 63 } else { 0 } }
            0x301 => 2 << 62 | 1 << 20 | 1 << 18 | 1 << 12 | 1 << 8 | 1 << 2 | 1,
            0x302 => self.medeleg, 0x303 => self.mideleg, 0x304 => self.mie, 0x305 => self.mtvec, 0x306 => self.mcounteren,
            0x30a => self.menvcfg, 0x340 => self.mscratch, 0x341 => self.mepc, 0x342 => self.mcause, 0x343 => self.mtval,
            0x344 => self.mip(),
            0x3a0 => self.pmpcfg[0], 0x3a2 => self.pmpcfg[1], 0x3a1 | 0x3a3 => return None, 0x3a4..=0x3af => 0,
            0x3b0..=0x3bf => self.pmpaddr[(n - 0x3b0) as usize], 0x3c0..=0x3ef => 0,
            0xf11 | 0xf12 | 0xf13 | 0xf14 | 0xf15 => 0,
            0x100 => { let s = self.mstatus & (SSTATUS_W | 3 << 32); s | if s & FS == FS { 1 << 63 } else { 0 } }
            0x104 => self.mie & self.mideleg, 0x105 => self.stvec, 0x106 => self.scounteren, 0x10a => self.senvcfg,
            0x140 => self.sscratch, 0x141 => self.sepc, 0x142 => self.scause, 0x143 => self.stval, 0x144 => self.mip() & self.mideleg,
            0x14d => { if self.prv < 3 && (self.menvcfg & STCE == 0 || self.mcounteren & 2 == 0) { return None; } self.stimecmp }
            0x180 => { if self.prv == 1 && self.mstatus & TVM != 0 { return None; } self.satp }
            _ => return None,
        })
    }

    /// write a CSR (its access was checked); false: no such CSR
    fn csr_write(&mut self, n: u64, v: u64) -> bool {
        self.check = true;
        match n {
            // the writing instruction itself does not count
            0xb00 => self.cycle_off = v.wrapping_sub(self.instret + 1),
            0xb02 => self.instret_off = v.wrapping_sub(self.instret + 1),
            0xb03..=0xb1f | 0x323..=0x33f | 0x7a0..=0x7a3 | 0x320 => {}
            0x300 => {
                let mut v = v;
                if v >> 11 & 3 == 2 { v &= !MPP; }
                if (self.mstatus ^ v) & (MPRV | SUM | MXR) != 0 { /* permissions only: the TLB keeps leaves */ }
                if (self.mstatus ^ v) & (MPRV | SUM | MXR | MPP) != 0 { self.jit.flush_tlb(); }
                self.mstatus = (self.mstatus & !MSTATUS_W) | (v & MSTATUS_W);
            }
            0x301 => {}
            0x302 => self.medeleg = v & 0xb3ff,
            0x303 => self.mideleg = v & (SSIP | STIP | SEIP),
            0x304 => self.mie = v & (SSIP | MSIP | STIP | MTIP | SEIP | MEIP),
            0x305 => self.mtvec = v & !2,
            0x306 => self.mcounteren = v & 7,
            0x30a => { self.menvcfg = v & (STCE | ADUE | 1); self.timer_update(); }
            0x340 => self.mscratch = v, 0x341 => self.mepc = v & !1, 0x342 => self.mcause = v, 0x343 => self.mtval = v,
            0x344 => self.mip_sw = (self.mip_sw & !(SSIP | STIP | SEIP)) | (v & (SSIP | STIP | SEIP)),
            0x3a0 => self.pmpcfg[0] = v, 0x3a2 => self.pmpcfg[1] = v, 0x3a4..=0x3af => {},
            0x3b0..=0x3bf => self.pmpaddr[(n - 0x3b0) as usize] = v & ((1 << 54) - 1), 0x3c0..=0x3ef => {},
            0x100 => {
                if (self.mstatus ^ v) & (SUM | MXR) != 0 { self.jit.flush_tlb(); }
                self.mstatus = (self.mstatus & !SSTATUS_W) | (v & SSTATUS_W);
            }
            0x104 => self.mie = (self.mie & !self.mideleg) | (v & self.mideleg),
            0x105 => self.stvec = v & !2,
            0x106 => self.scounteren = v & 7,
            0x10a => self.senvcfg = v & 1,
            0x140 => self.sscratch = v, 0x141 => self.sepc = v & !1, 0x142 => self.scause = v, 0x143 => self.stval = v,
            0x144 => self.mip_sw = (self.mip_sw & !(SSIP & self.mideleg)) | (v & SSIP & self.mideleg),
            0x14d => { self.stimecmp = v; self.timer_update(); }
            0x180 => {
                let mode = v >> 60;
                if mode == 0 || mode == 8 { self.satp = v; self.flush_tlb(); }
            }
            _ => return false,
        }
        true
    }

    // ------------------------------------------------------------ execution

    /// run up to n instructions; stops early at the finisher or when idle (wfi with nothing to wait for)
    pub fn run(&mut self, n: u64) -> Stop {
        let end = self.instret + n;
        while self.instret < end {
            if self.bus.finished.is_some() || self.bus.tohost_val != 0 { return Stop::Finished; }
            if self.bus.mtime >= self.timer_next { self.timer_next = u64::MAX; self.check = true; }
            if self.check {
                self.check = false;
                if !self.bus.rx.is_empty() { self.bus.poll_rx(); }
                if let Some(i) = self.interrupt() {
                    self.waiting = false;
                    self.trap(exc(INT | i, 0));
                    continue;
                }
            }
            if self.jit.on && self.jit.at_block {
                self.jit.at_block = false;
                match self.jit_block() {
                    crate::jit::Step::Ran => continue,
                    crate::jit::Step::Request => { self.jit.at_block = true; return Stop::Jit; }
                    crate::jit::Step::No => {}
                }
            }
            if self.waiting {
                if self.mip() & self.mie != 0 { self.waiting = false; continue; }
                if !self.bus.rx.is_empty() { self.check = true; continue; }
                // sleep until the next timer
                let t = if self.menvcfg & STCE != 0 { self.bus.mtimecmp.min(self.stimecmp) } else { self.bus.mtimecmp };
                if self.realtime || t == u64::MAX || t <= self.bus.mtime { return Stop::Idle; }
                self.bus.mtime = t;
                continue;
            }
            self.step();
        }
        Stop::Count
    }

    /// one instruction (or its trap)
    pub fn step(&mut self) {
        self.last_wr = None;
        self.last_pc = self.pc;
        self.last_prv = self.prv;
        match self.fetch() {
            Ok(i) => {
                self.last_insn = i;
                let r = if i & 3 == 3 { self.exec(i, 4) } else { match expand(i) { Some(w) => self.exec(w, 2), None => Err(exc(2, i as u64)) } };
                match r {
                    Ok(()) => self.instret += 1,
                    Err(t) => { self.last_wr = None; self.trap(t); }
                }
            }
            Err(t) => self.trap(t),
        }
        if !self.realtime { self.bus.mtime += 1; }
    }

    /// a load for translated code (f3 of the load: size and sign); a RAM page goes into the
    /// translated code's TLB of this privilege
    pub fn jit_load(&mut self, va: u64, f3: u32) -> Result<u64, Trap> {
        let size = 1u32 << (f3 & 3);
        if va & (size as u64 - 1) != 0 { return Err(exc(4, va)); }
        let pa = self.translate(va, Acc::Load)?;
        let v = self.read_pa(pa, size, va, Acc::Load)?;
        if self.bus.in_ram(pa, size as u64) && (self.prv != 3 || self.mstatus & MPRV == 0) {
            let host = self.bus.ram.as_ptr() as u64 + ((pa & !0xfff) - RAM_BASE);
            self.jit.fill(false, self.prv, va, host);
        }
        Ok(match f3 { 0 => sext(v, 8), 1 => sext(v, 16), 2 => sext(v, 32), _ => v })
    }
    pub fn jit_store(&mut self, va: u64, v: u64, f3: u32) -> Result<(), Trap> {
        let size = 1u32 << (f3 & 3);
        if va & (size as u64 - 1) != 0 { return Err(exc(6, va)); }
        let pa = self.translate(va, Acc::Store)?;
        self.write_pa(pa, size, v, va)?;
        let page = pa & !0xfff;
        if self.bus.in_ram(pa, size as u64) && (self.prv != 3 || self.mstatus & MPRV == 0) && !self.jit.has_code((page - RAM_BASE) as usize)
            && self.bus.tohost.map(|t| t & !0xfff) != Some(page) {
            let host = self.bus.ram.as_ptr() as u64 + (page - RAM_BASE);
            self.jit.fill(true, self.prv, va, host);
        }
        Ok(())
    }

    /// at the start of a block: run its translation, or count it (and ask for one when it is hot)
    fn jit_block(&mut self) -> crate::jit::Step {
        use crate::jit::Step;
        let va = self.pc;
        let Ok(pa) = self.translate(va, Acc::Fetch) else { return Step::No };
        if !self.bus.in_ram(pa, 2) { return Step::No; }
        if let Some((f, n)) = self.jit.lookup(pa, va) {
            self.jit_fault = 0;
            self.jit.hit = false;
            let k = crate::jit::call(f, self) as u64;
            let _ = n;
            self.instret += k;
            if !self.realtime { self.bus.mtime += k; }
            if self.jit_fault == 1 { let t = self.jit.trap.take().unwrap(); self.trap(t); }
            self.jit.at_block = true;
            self.jit.blocks_run += 1;
            return Step::Ran;
        }
        if self.jit.hot(pa, va) {
            let o = (pa - RAM_BASE) as usize;
            let end = ((o | 0xfff) + 1).min(self.bus.ram.len());
            let tlbs = self.jit.tlb_addrs();
            if let Some((m, n)) = crate::jit::compile(va, &self.bus.ram[o..end], tlbs) { self.jit.request = Some((pa, va, m, n)); return Step::Request; }
        }
        Step::No
    }

    #[inline]
    fn wr(&mut self, rd: usize, v: u64) { if rd != 0 { self.x[rd] = v; self.last_wr = Some((rd, v)); } }

    fn exec(&mut self, i: u32, len: u64) -> Result<(), Trap> {
        let rd = (i >> 7 & 31) as usize;
        let rs1 = (i >> 15 & 31) as usize;
        let rs2 = (i >> 20 & 31) as usize;
        let f3 = i >> 12 & 7;
        let f7 = i >> 25;
        let a = self.x[rs1];
        let b = self.x[rs2];
        let imm_i = sext((i >> 20) as u64, 12);
        let ill = exc(2, if len == 2 { self.last_insn as u64 } else { i as u64 });
        let pc = self.pc;
        let mut next = pc + len;
        match i & 0x7f {
            0x37 => self.wr(rd, sext((i & 0xffff_f000) as u64, 32)),
            0x17 => self.wr(rd, pc.wrapping_add(sext((i & 0xffff_f000) as u64, 32))),
            0x6f => {
                let imm = sext(((i >> 31) << 20 | (i >> 12 & 0xff) << 12 | (i >> 20 & 1) << 11 | (i >> 21 & 0x3ff) << 1) as u64, 21);
                self.wr(rd, next);
                next = pc.wrapping_add(imm);
            }
            0x67 => {
                if f3 != 0 { return Err(ill); }
                let t = a.wrapping_add(imm_i) & !1;
                self.wr(rd, next);
                next = t;
            }
            0x63 => {
                let imm = sext(((i >> 31) << 12 | (i >> 7 & 1) << 11 | (i >> 25 & 0x3f) << 5 | (i >> 8 & 15) << 1) as u64, 13);
                let take = match f3 { 0 => a == b, 1 => a != b, 4 => (a as i64) < (b as i64), 5 => (a as i64) >= (b as i64), 6 => a < b, 7 => a >= b, _ => return Err(ill) };
                if take { next = pc.wrapping_add(imm); }
            }
            0x03 => {
                let va = a.wrapping_add(imm_i);
                let v = match f3 {
                    0 => sext(self.vload(va, 1)?, 8), 1 => sext(self.vload(va, 2)?, 16), 2 => sext(self.vload(va, 4)?, 32), 3 => self.vload(va, 8)?,
                    4 => self.vload(va, 1)?, 5 => self.vload(va, 2)?, 6 => self.vload(va, 4)?, _ => return Err(ill),
                };
                self.wr(rd, v);
            }
            0x23 => {
                let imm = sext(((i >> 25) << 5 | (i >> 7 & 31)) as u64, 12);
                let va = a.wrapping_add(imm);
                match f3 { 0..=3 => self.vstore(va, 1 << f3, b)?, _ => return Err(ill) }
            }
            0x13 => {
                let sh = (i >> 20 & 63) as u32;
                let v = match f3 {
                    0 => a.wrapping_add(imm_i), 2 => ((a as i64) < (imm_i as i64)) as u64, 3 => (a < imm_i) as u64,
                    4 => a ^ imm_i, 6 => a | imm_i, 7 => a & imm_i,
                    1 => { if i >> 26 != 0 { return Err(ill); } a << sh }
                    _ => match i >> 26 { 0 => a >> sh, 0x10 => ((a as i64) >> sh) as u64, _ => return Err(ill) },
                };
                self.wr(rd, v);
            }
            0x1b => {
                let sh = (i >> 20 & 31) as u32;
                let v = match f3 {
                    0 => (a.wrapping_add(imm_i)) as i32 as i64 as u64,
                    1 => { if f7 != 0 { return Err(ill); } ((a as u32) << sh) as i32 as i64 as u64 }
                    5 => match f7 { 0 => ((a as u32) >> sh) as i32 as i64 as u64, 0x20 => ((a as i32) >> sh) as i64 as u64, _ => return Err(ill) },
                    _ => return Err(ill),
                };
                self.wr(rd, v);
            }
            0x33 => {
                let v = match (f7, f3) {
                    (0, 0) => a.wrapping_add(b), (0x20, 0) => a.wrapping_sub(b), (0, 1) => a << (b & 63), (0, 2) => ((a as i64) < (b as i64)) as u64,
                    (0, 3) => (a < b) as u64, (0, 4) => a ^ b, (0, 5) => a >> (b & 63), (0x20, 5) => ((a as i64) >> (b & 63)) as u64,
                    (0, 6) => a | b, (0, 7) => a & b,
                    (1, 0) => a.wrapping_mul(b),
                    (1, 1) => ((a as i64 as i128 * b as i64 as i128) >> 64) as u64,
                    (1, 2) => ((a as i64 as i128 * b as u128 as i128) >> 64) as u64,
                    (1, 3) => ((a as u128 * b as u128) >> 64) as u64,
                    (1, 4) => if b == 0 { u64::MAX } else if a as i64 == i64::MIN && b as i64 == -1 { a } else { ((a as i64) / (b as i64)) as u64 },
                    (1, 5) => if b == 0 { u64::MAX } else { a / b },
                    (1, 6) => if b == 0 { a } else if a as i64 == i64::MIN && b as i64 == -1 { 0 } else { ((a as i64) % (b as i64)) as u64 },
                    (1, 7) => if b == 0 { a } else { a % b },
                    _ => return Err(ill),
                };
                self.wr(rd, v);
            }
            0x3b => {
                let (x, y) = (a as u32, b as u32);
                let w = |v: u32| v as i32 as i64 as u64;
                let v = match (f7, f3) {
                    (0, 0) => w(x.wrapping_add(y)), (0x20, 0) => w(x.wrapping_sub(y)), (0, 1) => w(x << (y & 31)),
                    (0, 5) => w(x >> (y & 31)), (0x20, 5) => ((x as i32) >> (y & 31)) as i64 as u64,
                    (1, 0) => w(x.wrapping_mul(y)),
                    (1, 4) => if y == 0 { u64::MAX } else if x as i32 == i32::MIN && y as i32 == -1 { w(x) } else { ((x as i32) / (y as i32)) as i64 as u64 },
                    (1, 5) => if y == 0 { u64::MAX } else { w(x / y) },
                    (1, 6) => if y == 0 { w(x) } else if x as i32 == i32::MIN && y as i32 == -1 { 0 } else { ((x as i32) % (y as i32)) as i64 as u64 },
                    (1, 7) => if y == 0 { w(x) } else { w(x % y) },
                    _ => return Err(ill),
                };
                self.wr(rd, v);
            }
            0x0f => match f3 { 0 => {}, 1 => {}, _ => return Err(ill) },
            0x2f => {
                let f5 = i >> 27;
                let size = match f3 { 2 => 4, 3 => 8, _ => return Err(ill) };
                let ext = |v: u64| if size == 4 { v as i32 as i64 as u64 } else { v };
                if f5 == 2 {
                    // lr
                    if rs2 != 0 { return Err(ill); }
                    if a & (size as u64 - 1) != 0 { return Err(exc(4, a)); }
                    let pa = self.translate(a, Acc::Load)?;
                    let v = self.read_pa(pa, size, a, Acc::Load)?;
                    self.resv = Some(pa);
                    self.wr(rd, ext(v));
                } else {
                    if a & (size as u64 - 1) != 0 { return Err(exc(6, a)); }
                    let pa = self.translate(a, Acc::Store)?;
                    if !self.bus.in_ram(pa, size as u64) { return Err(exc(7, a)); }
                    if f5 == 3 {
                        // sc
                        if self.resv == Some(pa) { self.write_pa(pa, size, b, a)?; self.wr(rd, 0); } else { self.wr(rd, 1); }
                        self.resv = None;
                    } else {
                        let old = ext(self.read_pa(pa, size, a, Acc::Store)?);
                        let (o, v) = if size == 4 { (old as i32 as i64, b as i32 as i64) } else { (old as i64, b as i64) };
                        let (uo, uv) = if size == 4 { (old as u32 as u64, b as u32 as u64) } else { (old, b) };
                        let new = match f5 {
                            0 => old.wrapping_add(b), 1 => b, 4 => old ^ b, 8 => old | b, 12 => old & b,
                            16 => if o < v { old } else { b }, 20 => if o > v { old } else { b },
                            24 => if uo < uv { old } else { b }, 28 => if uo > uv { old } else { b },
                            _ => return Err(ill),
                        };
                        self.write_pa(pa, size, new, a)?;
                        self.wr(rd, old);
                    }
                }
            }
            0x73 => {
                if f3 == 0 {
                    match i {
                        0x0000_0073 => return Err(exc(8 + self.prv, 0)),
                        0x0010_0073 => return Err(exc(3, pc)),
                        0x3020_0073 => {
                            if self.prv < 3 { return Err(ill); }
                            let s = self.mstatus;
                            let p = s >> 11 & 3;
                            self.mstatus = (s & !(MPP | MIE)) | MPIE | if s & MPIE != 0 { MIE } else { 0 };
                            if p != 3 { self.mstatus &= !MPRV; }
                            self.prv = p;
                            next = self.mepc;
                            self.check = true;
                        }
                        0x1020_0073 => {
                            if self.prv < 1 || (self.prv == 1 && self.mstatus & TSR != 0) { return Err(ill); }
                            let s = self.mstatus;
                            self.prv = s >> 8 & 1;
                            self.mstatus = (s & !(SPP | SIE | MPRV)) | SPIE | if s & SPIE != 0 { SIE } else { 0 };
                            next = self.sepc;
                            self.check = true;
                        }
                        0x1050_0073 => {
                            if self.prv == 0 || (self.prv == 1 && self.mstatus & TW != 0) { return Err(ill); }
                            if self.mip() & self.mie == 0 { self.waiting = true; }
                        }
                        _ if f7 == 0x09 && rd == 0 => {
                            if self.prv == 0 || (self.prv == 1 && self.mstatus & TVM != 0) { return Err(ill); }
                            self.flush_tlb();
                        }
                        _ => return Err(ill),
                    }
                } else {
                    if f3 == 4 { return Err(ill); }
                    let n = (i >> 20) as u64;
                    let src = if f3 >= 5 { rs1 as u64 } else { a };
                    let write = !(matches!(f3 & 3, 2 | 3) && rs1 == 0);
                    if (n >> 8 & 3) > self.prv || (write && n >> 10 == 3) { return Err(ill); }
                    let old = if f3 & 3 == 1 && rd == 0 {
                        // csrrw without a read: the CSR must still exist
                        match self.csr_read(n) { Some(v) => v, None => return Err(ill) }
                    } else { match self.csr_read(n) { Some(v) => v, None => return Err(ill) } };
                    if write {
                        let v = match f3 & 3 { 1 => src, 2 => old | src, _ => old & !src };
                        if n == 0x180 && self.prv == 1 && self.mstatus & TVM != 0 { return Err(ill); }
                        if !self.csr_write(n, v) { return Err(ill); }
                    }
                    self.wr(rd, old);
                }
            }
            _ => return Err(ill),
        }
        // a jump, a branch, SYSTEM, FENCE, AMO: the next instruction may start a translated block
        if matches!(i & 0x7f, 0x6f | 0x67 | 0x63 | 0x73 | 0x0f | 0x2f) { self.jit.at_block = true; }
        self.pc = next;
        Ok(())
    }

    /// what multiply-high, divide and remainder give (translated code's `ar` helper: kind = f3, + 8 for the W forms)
    pub fn arith(a: u64, b: u64, kind: u32) -> u64 {
        let (x, y) = (a as u32, b as u32);
        let w = |v: u32| v as i32 as i64 as u64;
        match kind {
            1 => ((a as i64 as i128 * b as i64 as i128) >> 64) as u64,
            2 => ((a as i64 as i128 * b as u128 as i128) >> 64) as u64,
            3 => ((a as u128 * b as u128) >> 64) as u64,
            4 => if b == 0 { u64::MAX } else if a as i64 == i64::MIN && b as i64 == -1 { a } else { ((a as i64) / (b as i64)) as u64 },
            5 => if b == 0 { u64::MAX } else { a / b },
            6 => if b == 0 { a } else if a as i64 == i64::MIN && b as i64 == -1 { 0 } else { ((a as i64) % (b as i64)) as u64 },
            7 => if b == 0 { a } else { a % b },
            12 => if y == 0 { u64::MAX } else if x as i32 == i32::MIN && y as i32 == -1 { w(x) } else { ((x as i32) / (y as i32)) as i64 as u64 },
            13 => if y == 0 { u64::MAX } else { w(x / y) },
            14 => if y == 0 { w(x) } else if x as i32 == i32::MIN && y as i32 == -1 { 0 } else { ((x as i32) % (y as i32)) as i64 as u64 },
            _ => if y == 0 { w(x) } else { w(x % y) },
        }
    }

    /// the hart's and the devices' state (not the RAM) as words, and back
    pub fn state(&self) -> Vec<u64> {
        let mut v: Vec<u64> = self.x.to_vec();
        v.extend([self.pc, self.prv, self.mstatus, self.medeleg, self.mideleg, self.mie, self.mip_sw, self.mtvec, self.mepc, self.mcause, self.mtval,
            self.mscratch, self.mcounteren, self.menvcfg, self.stvec, self.sepc, self.scause, self.stval, self.sscratch, self.scounteren, self.senvcfg,
            self.satp, self.stimecmp, self.instret, self.instret_off, self.cycle_off, self.waiting as u64]);
        v.extend(self.pmpcfg);
        v.extend(self.pmpaddr);
        v.extend(self.bus.state());
        v
    }
    pub fn set_state(&mut self, v: &[u64]) -> Result<(), String> {
        let n = self.state().len();
        if v.len() != n { return Err(format!("state of {} words, not {}", v.len(), n)); }
        self.x.copy_from_slice(&v[..32]);
        let r = &v[32..];
        [self.pc, self.prv, self.mstatus, self.medeleg, self.mideleg, self.mie, self.mip_sw, self.mtvec, self.mepc, self.mcause, self.mtval,
            self.mscratch, self.mcounteren, self.menvcfg, self.stvec, self.sepc, self.scause, self.stval, self.sscratch, self.scounteren, self.senvcfg,
            self.satp, self.stimecmp, self.instret, self.instret_off, self.cycle_off] = r[..26].try_into().unwrap();
        self.waiting = r[26] != 0;
        self.pmpcfg.copy_from_slice(&r[27..29]);
        self.pmpaddr.copy_from_slice(&r[29..45]);
        self.bus.set_state(&r[45..]);
        self.resv = None;
        self.flush_tlb();
        self.timer_update();
        Ok(())
    }

    /// look at interrupts again (an input changed)
    pub fn wake(&mut self) { self.check = true; }

    /// the CSR value a debugger would see (tests)
    pub fn csr(&mut self, n: u64) -> Option<u64> { let p = self.prv; self.prv = 3; let v = self.csr_read(n); self.prv = p; v }
}

// ------------------------------------------------------------ RVC: 16-bit instructions as their 32-bit forms

fn r_t(f7: u32, rs2: u32, rs1: u32, f3: u32, rd: u32, op: u32) -> u32 { f7 << 25 | rs2 << 20 | rs1 << 15 | f3 << 12 | rd << 7 | op }
fn i_t(imm: u32, rs1: u32, f3: u32, rd: u32, op: u32) -> u32 { (imm & 0xfff) << 20 | rs1 << 15 | f3 << 12 | rd << 7 | op }
fn s_t(imm: u32, rs2: u32, rs1: u32, f3: u32) -> u32 { (imm >> 5 & 0x7f) << 25 | rs2 << 20 | rs1 << 15 | f3 << 12 | (imm & 31) << 7 | 0x23 }
fn b_t(imm: u32, rs2: u32, rs1: u32, f3: u32) -> u32 {
    (imm >> 12 & 1) << 31 | (imm >> 5 & 0x3f) << 25 | rs2 << 20 | rs1 << 15 | f3 << 12 | (imm >> 1 & 15) << 8 | (imm >> 11 & 1) << 7 | 0x63
}
fn j_t(imm: u32, rd: u32) -> u32 { (imm >> 20 & 1) << 31 | (imm >> 1 & 0x3ff) << 21 | (imm >> 11 & 1) << 20 | (imm >> 12 & 0xff) << 12 | rd << 7 | 0x6f }

/// the 32-bit instruction a compressed one stands for (None: illegal)
pub fn expand(c: u32) -> Option<u32> {
    let b = |hi: u32, lo: u32| (c >> lo) & ((1 << (hi - lo + 1)) - 1);
    let rd = b(11, 7);
    let rs2 = b(6, 2);
    let rdp = b(4, 2) + 8;
    let rs1p = b(9, 7) + 8;
    let sx = |v: u32, bits: u32| ((v << (32 - bits)) as i32 >> (32 - bits)) as u32;
    let imm6 = sx(b(12, 12) << 5 | b(6, 2), 6);
    Some(match (c & 3, b(15, 13)) {
        (0, 0) => {
            let imm = b(12, 11) << 4 | b(10, 7) << 6 | b(6, 6) << 2 | b(5, 5) << 3;
            if imm == 0 { return None; }
            i_t(imm, 2, 0, rdp, 0x13)
        }
        (0, 2) => i_t(b(12, 10) << 3 | b(6, 6) << 2 | b(5, 5) << 6, rs1p, 2, rdp, 0x03),
        (0, 3) => i_t(b(12, 10) << 3 | b(6, 5) << 6, rs1p, 3, rdp, 0x03),
        (0, 6) => s_t(b(12, 10) << 3 | b(6, 6) << 2 | b(5, 5) << 6, rdp, rs1p, 2),
        (0, 7) => s_t(b(12, 10) << 3 | b(6, 5) << 6, rdp, rs1p, 3),
        (1, 0) => i_t(imm6, rd, 0, rd, 0x13),
        (1, 1) => { if rd == 0 { return None; } i_t(imm6, rd, 0, rd, 0x1b) }
        (1, 2) => i_t(imm6, 0, 0, rd, 0x13),
        (1, 3) => {
            if rd == 2 {
                let imm = sx(b(12, 12) << 9 | b(6, 6) << 4 | b(5, 5) << 6 | b(4, 3) << 7 | b(2, 2) << 5, 10);
                if imm == 0 { return None; }
                i_t(imm, 2, 0, 2, 0x13)
            } else {
                if imm6 == 0 { return None; }
                (imm6 << 12) | rd << 7 | 0x37
            }
        }
        (1, 4) => {
            let sh = b(12, 12) << 5 | b(6, 2);
            match b(11, 10) {
                0 => i_t(sh, rs1p, 5, rs1p, 0x13),
                1 => i_t(sh | 0x400, rs1p, 5, rs1p, 0x13),
                2 => i_t(imm6, rs1p, 7, rs1p, 0x13),
                _ => match (b(12, 12), b(6, 5)) {
                    (0, 0) => r_t(0x20, rdp, rs1p, 0, rs1p, 0x33),
                    (0, 1) => r_t(0, rdp, rs1p, 4, rs1p, 0x33),
                    (0, 2) => r_t(0, rdp, rs1p, 6, rs1p, 0x33),
                    (0, 3) => r_t(0, rdp, rs1p, 7, rs1p, 0x33),
                    (1, 0) => r_t(0x20, rdp, rs1p, 0, rs1p, 0x3b),
                    (1, 1) => r_t(0, rdp, rs1p, 0, rs1p, 0x3b),
                    _ => return None,
                },
            }
        }
        (1, 5) => {
            let imm = sx(b(12, 12) << 11 | b(11, 11) << 4 | b(10, 9) << 8 | b(8, 8) << 10 | b(7, 7) << 6 | b(6, 6) << 7 | b(5, 3) << 1 | b(2, 2) << 5, 12);
            j_t(imm, 0)
        }
        (1, 6) | (1, 7) => {
            let imm = sx(b(12, 12) << 8 | b(11, 10) << 3 | b(6, 5) << 6 | b(4, 3) << 1 | b(2, 2) << 5, 9);
            b_t(imm, 0, rs1p, b(13, 13))
        }
        (2, 0) => i_t(b(12, 12) << 5 | b(6, 2), rd, 1, rd, 0x13),
        (2, 2) => { if rd == 0 { return None; } i_t(b(12, 12) << 5 | b(6, 4) << 2 | b(3, 2) << 6, 2, 2, rd, 0x03) }
        (2, 3) => { if rd == 0 { return None; } i_t(b(12, 12) << 5 | b(6, 5) << 3 | b(4, 2) << 6, 2, 3, rd, 0x03) }
        (2, 4) => match (b(12, 12), rd, rs2) {
            (0, 0, 0) => return None,
            (0, _, 0) => i_t(0, rd, 0, 0, 0x67),
            (0, _, _) => r_t(0, rs2, 0, 0, rd, 0x33),
            (1, 0, 0) => 0x0010_0073,
            (1, _, 0) => i_t(0, rd, 0, 1, 0x67),
            _ => r_t(0, rs2, rd, 0, rd, 0x33),
        },
        (2, 6) => s_t(b(12, 9) << 2 | b(8, 7) << 6, rs2, 2, 2),
        (2, 7) => s_t(b(12, 10) << 3 | b(9, 7) << 6, rs2, 2, 3),
        _ => return None,
    })
}
