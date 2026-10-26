//! An RV32IMA + Zicsr instruction-set simulator with the memory map of RvSoc
//! (examples/src/rvsoc.veryl): the reference that compiled programs and the
//! RTL are checked against. It counts clock cycles exactly like RvCore —
//! 2 per instruction, 3 per load / LR / AMO, 35 per multiply / divide, 3 for a
//! trap, `wfi` until an interrupt is pending, 1 after reset — and samples
//! interrupts in the same cycle, so timer-driven programs run alike.

use std::collections::VecDeque;

pub const IO_BASE: u32 = 0x1000_0000;
pub const LED: u32 = IO_BASE;
pub const BTN: u32 = IO_BASE + 4;
pub const UART: u32 = IO_BASE + 8;
pub const UART_ST: u32 = IO_BASE + 12;
pub const TIMER: u32 = IO_BASE + 16;
pub const MTIMECMP: u32 = IO_BASE + 0x18;
pub const MSIP: u32 = IO_BASE + 0x20;
/// VgaText (examples/src/rvvga.veryl): characters, font rows, colors
pub const VGA_TEXT: u32 = IO_BASE + 0x2000;
pub const VGA_FONT: u32 = IO_BASE + 0x4000;
pub const VGA_COLOR: u32 = IO_BASE + 0x6000;

pub struct Iss {
    pub pc: u32,
    pub x: [u32; 32],
    pub mem: Vec<u8>,
    pub led: u32,
    /// bit 2..0 = BTN3..BTN1, bit 15..8 = the switches
    pub btn: u32,
    /// bytes the program sent / will receive on the serial port
    pub tx: Vec<u8>,
    pub rx: VecDeque<u8>,
    /// the clock cycle the next instruction is decoded in (mtime runs with it)
    pub cycles: u64,
    pub instret: u64,
    /// clock cycles to send one byte (0: at once); the status register says busy meanwhile
    pub tx_cycles: u64,
    tx_busy_until: u64,
    /// VgaText's memories: 40 × 30 characters (2048 entries), the font (128 × 8 rows), fg | bg << 16
    pub vram: Vec<u8>,
    pub font: Vec<u8>,
    pub colors: u32,
    // ---- machine mode ----
    pub mie_bit: bool,
    pub mpie: bool,
    /// mie: MSIE (bit 3), MTIE (7), MEIE (11)
    pub mie: u32,
    pub mtvec: u32,
    pub mscratch: u32,
    pub mepc: u32,
    /// {interrupt, code}
    pub mcause: u32,
    pub minstret: u32,
    resv: Option<u32>,
    // ---- the SoC's timer (32 bit): mtime = cycle + offset ----
    mtime_off: u32,
    pub mtimecmp: u32,
    pub msip: bool,
    /// asleep in wfi
    pub wfi: bool,
}

/// the instruction is legal for RvCore (the CSR address is checked separately)
fn legal(inst: u32) -> bool {
    let (op, f3, f7, f5) = (inst & 0x7f, (inst >> 12) & 7, inst >> 25, inst >> 27);
    match op {
        0x37 | 0x17 | 0x6f => true,
        0x67 => f3 == 0,
        0x63 => f3 != 2 && f3 != 3,
        0x03 => !matches!(f3, 3 | 6 | 7),
        0x23 => f3 < 3,
        0x13 => match f3 { 1 => f7 == 0, 5 => f7 == 0 || f7 == 0x20, _ => true },
        0x33 => f7 == 0 || f7 == 1 || (f7 == 0x20 && (f3 == 0 || f3 == 5)),
        0x0f => f3 < 2,
        0x73 => if f3 == 0 { matches!(inst, 0x73 | 0x0010_0073 | 0x3020_0073 | 0x1050_0073) } else { f3 != 4 },
        0x2f => f3 == 2 && matches!(f5, 0b00010 | 0b00011 | 0b00001 | 0b00000 | 0b00100 | 0b01100 | 0b01000 | 0b10000 | 0b10100 | 0b11000 | 0b11100),
        _ => false,
    }
}

impl Iss {
    /// `mem_size` bytes of RAM holding `image` from address 0
    pub fn new(image: &[u8], mem_size: usize) -> Iss {
        let mut mem = vec![0u8; mem_size];
        mem[..image.len().min(mem_size)].copy_from_slice(&image[..image.len().min(mem_size)]);
        Iss {
            pc: 0, x: [0; 32], mem, led: 0, btn: 0, tx: vec![], rx: VecDeque::new(), cycles: 1, instret: 0, tx_cycles: 0, tx_busy_until: 0,
            vram: vec![0; 2048], font: vec![0; 1024], colors: 0xfff,
            mie_bit: false, mpie: false, mie: 0, mtvec: 0, mscratch: 0, mepc: 0, mcause: 0, minstret: 0, resv: None,
            mtime_off: 0, mtimecmp: 0xffff_ffff, msip: false, wfi: false,
        }
    }

    /// the reset button: the CPU and the peripherals start over, the memories keep their contents
    pub fn reset(&mut self) {
        let mut fresh = Iss::new(&[], 4);
        fresh.mem = std::mem::take(&mut self.mem);
        fresh.vram = std::mem::take(&mut self.vram);
        fresh.font = std::mem::take(&mut self.font);
        fresh.rx = std::mem::take(&mut self.rx);
        fresh.tx_cycles = self.tx_cycles;
        *self = fresh;
    }

    /// mtime in clock cycle `t`
    fn mtime_at(&self, t: u64) -> u32 { (t as u32).wrapping_add(self.mtime_off) }

    /// mip in clock cycle `t`: MEIP (a received byte), MTIP, MSIP
    fn mip_at(&self, t: u64) -> u32 {
        ((!self.rx.is_empty() as u32) << 11) | ((self.mtime_at(t) >= self.mtimecmp) as u32) << 7 | (self.msip as u32) << 3
    }

    fn word_addr(&self, a: u32) -> usize { (a as usize) & (self.mem.len() - 1) & !3 }

    /// a word read in clock cycle `t` (the Exec of the load)
    fn load_word(&mut self, a: u32, t: u64) -> u32 {
        if a & IO_BASE != 0 {
            return match (a >> 2) & 15 {
                0 => self.led & 0xff,
                1 => self.btn & 0xff07,
                2 => self.rx.pop_front().map(|b| b as u32).unwrap_or(0),
                3 => (!self.rx.is_empty() as u32) << 1 | (t < self.tx_busy_until) as u32,
                4 => self.mtime_at(t),
                6 => self.mtimecmp,
                8 => self.msip as u32,
                _ => 0,
            };
        }
        let i = self.word_addr(a);
        u32::from_le_bytes([self.mem[i], self.mem[i + 1], self.mem[i + 2], self.mem[i + 3]])
    }

    /// a store in clock cycle `t`
    fn store(&mut self, a: u32, v: u32, strb: u32, t: u64) {
        if a & IO_BASE != 0 {
            match (a >> 13) & 7 {
                0 => {}
                1 => { self.vram[((a >> 2) & 2047) as usize] = v as u8; return; }
                2 => { self.font[((a >> 2) & 1023) as usize] = v as u8; return; }
                3 => { self.colors = v; return; }
                _ => return,
            }
            match (a >> 2) & 15 {
                0 => self.led = v & 0xff,
                2 => { self.tx.push(v as u8); self.tx_busy_until = t + self.tx_cycles; }
                // mtime = v from the next cycle on
                4 => self.mtime_off = v.wrapping_sub((t + 1) as u32),
                6 => self.mtimecmp = v,
                8 => self.msip = v & 1 == 1,
                _ => {}
            }
            return;
        }
        let i = self.word_addr(a);
        for k in 0..4 { if strb >> k & 1 == 1 { self.mem[i + k] = (v >> (8 * k)) as u8; } }
    }

    /// a CSR read in clock cycle `t`: None for an unknown CSR
    fn csr_read(&self, n: u32, t: u64) -> Option<u32> {
        Some(match n {
            0x300 => 3 << 11 | (self.mpie as u32) << 7 | (self.mie_bit as u32) << 3,
            0x301 => 0x4000_1101,
            0x304 => self.mie,
            0x305 => self.mtvec,
            0x340 => self.mscratch,
            0x341 => self.mepc,
            0x342 => (self.mcause >> 4) << 31 | (self.mcause & 15),
            0x343 => 0,
            0x344 => self.mip_at(t),
            0xb00 | 0xc00 | 0xc01 => self.mtime_at(t),
            0xb02 | 0xc02 => self.minstret,
            0xb80 | 0xc80 | 0xc81 | 0xb82 | 0xc82 | 0xf11 | 0xf12 | 0xf13 | 0xf14 => 0,
            _ => return None,
        })
    }

    fn csr_write(&mut self, n: u32, v: u32) {
        match n {
            0x300 => { self.mie_bit = v >> 3 & 1 == 1; self.mpie = v >> 7 & 1 == 1; }
            0x304 => self.mie = v & 0x888,
            0x305 => self.mtvec = v & !3,
            0x340 => self.mscratch = v,
            0x341 => self.mepc = v & !3,
            0x342 => self.mcause = (v >> 31) << 4 | (v & 15),
            _ => {}
        }
    }

    fn trap(&mut self, cause: u32) {
        self.mepc = self.pc;
        self.mcause = cause;
        self.mpie = self.mie_bit;
        self.mie_bit = false;
        self.resv = None;
        self.pc = self.mtvec & !3;
        self.cycles += 3; // Decode, Exec, Fetch of the handler
    }

    /// one instruction (asleep in wfi: until the next interrupt)
    pub fn step(&mut self) -> Result<(), String> { self.step_until(u64::MAX) }

    /// one instruction; asleep in wfi, sleep at most until cycle `limit`
    pub fn step_until(&mut self, limit: u64) -> Result<(), String> {
        if self.wfi {
            // wake in the first cycle an enabled interrupt is pending, decode one cycle later
            let mut t = self.cycles;
            loop {
                if self.mip_at(t) & self.mie != 0 { self.wfi = false; self.cycles = t + 1; return Ok(()); }
                // only the timer changes by itself: jump to it (bounded by the caller's limit)
                let to_cmp = self.mtimecmp.wrapping_sub(self.mtime_at(t)) as u64;
                let next = if self.mie & 0x80 != 0 && to_cmp > 0 { t + to_cmp } else { u64::MAX };
                if next >= limit {
                    if limit == u64::MAX { return Err("wfi with no interrupt that can wake it".into()); }
                    self.cycles = limit.max(t);
                    return Ok(());
                }
                t = next;
            }
        }
        let e = self.cycles + 1; // the Exec cycle
        let inst = { let i = self.word_addr(self.pc); u32::from_le_bytes([self.mem[i], self.mem[i + 1], self.mem[i + 2], self.mem[i + 3]]) };
        let op = inst & 0x7f;
        let rd = ((inst >> 7) & 31) as usize;
        let f3 = (inst >> 12) & 7;
        let rs1n = (inst >> 15) & 31;
        let rs1 = self.x[rs1n as usize];
        let rs2 = self.x[((inst >> 20) & 31) as usize];
        let f7 = inst >> 25;
        let f5 = inst >> 27;
        let imm_i = (inst as i32 >> 20) as u32;
        let imm_s = ((inst as i32 >> 25) << 5) as u32 | ((inst >> 7) & 31);
        let imm_b = ((inst as i32 >> 31) << 12) as u32 | ((inst >> 7) & 1) << 11 | ((inst >> 25) & 0x3f) << 5 | ((inst >> 8) & 0xf) << 1;
        let imm_j = ((inst as i32 >> 31) << 20) as u32 | (inst & 0xff000) | ((inst >> 20) & 1) << 11 | ((inst >> 21) & 0x3ff) << 1;

        // ---- traps, in RvCore's priority ----
        let pending = self.mip_at(e) & self.mie;
        if self.mie_bit && pending != 0 {
            let code = if pending & 0x800 != 0 { 11 } else if pending & 8 != 0 { 3 } else { 7 };
            self.trap(16 | code);
            return Ok(());
        }
        let is_csr = op == 0x73 && f3 != 0 && f3 != 4;
        let csr_n = inst >> 20;
        let csr_writes = f3 & 3 == 1 || rs1n != 0;
        let csr_bad = is_csr && (self.csr_read(csr_n, e).is_none() || (csr_n >> 10 == 3 && csr_writes));
        if !legal(inst) || csr_bad { self.trap(2); return Ok(()); }
        if inst == 0x73 { self.trap(11); return Ok(()); }
        if inst == 0x0010_0073 { self.trap(3); return Ok(()); }
        let amo = op == 0x2f;
        let addr = match op { 0x03 => rs1.wrapping_add(imm_i), 0x23 => rs1.wrapping_add(imm_s), 0x2f => rs1, _ => 0 };
        let mis_load = (op == 0x03 && ((f3 & 3 == 2 && addr & 3 != 0) || (f3 & 3 == 1 && addr & 1 != 0))) || (amo && f5 == 2 && addr & 3 != 0);
        let mis_store = (op == 0x23 && ((f3 == 2 && addr & 3 != 0) || (f3 == 1 && addr & 1 != 0))) || (amo && f5 != 2 && addr & 3 != 0);
        if mis_load { self.trap(4); return Ok(()); }
        if mis_store { self.trap(6); return Ok(()); }
        let bad_jal = (op == 0x6f && imm_j & 2 != 0) || (op == 0x67 && rs1.wrapping_add(imm_i) & 2 != 0);
        if bad_jal { self.trap(0); return Ok(()); }
        let take = op == 0x63 && match f3 { 0 => rs1 == rs2, 1 => rs1 != rs2, 4 => (rs1 as i32) < rs2 as i32, 5 => rs1 as i32 >= rs2 as i32, 6 => rs1 < rs2, _ => rs1 >= rs2 };
        if take && imm_b & 2 != 0 { self.trap(0); return Ok(()); }

        // ---- the instruction ----
        let mut next = self.pc.wrapping_add(4);
        let mut wb: Option<u32> = None;
        let mut cyc = 2;
        match op {
            0x37 => wb = Some(inst & 0xffff_f000),
            0x17 => wb = Some(self.pc.wrapping_add(inst & 0xffff_f000)),
            0x6f => { wb = Some(next); next = self.pc.wrapping_add(imm_j); }
            0x67 => { wb = Some(next); next = rs1.wrapping_add(imm_i) & !1; }
            0x63 => if take { next = self.pc.wrapping_add(imm_b); },
            0x03 => {
                let w = self.load_word(addr, e) >> (8 * (addr & 3));
                cyc = 3;
                wb = Some(match f3 { 0 => w as u8 as i8 as i32 as u32, 1 => w as u16 as i16 as i32 as u32, 4 => w & 0xff, 5 => w & 0xffff, _ => w });
            }
            0x23 => {
                let sh = 8 * (addr & 3);
                match f3 { 0 => self.store(addr, (rs2 & 0xff) << sh, 1 << (addr & 3), e), 1 => self.store(addr, (rs2 & 0xffff) << sh, 3 << (addr & 3), e), _ => self.store(addr, rs2, 15, e) }
            }
            0x33 if f7 == 1 => {
                cyc = 35;
                let (a, b) = (rs1, rs2);
                wb = Some(match f3 {
                    0 => a.wrapping_mul(b),
                    1 => ((a as i32 as i64 * b as i32 as i64) >> 32) as u32,
                    2 => ((a as i32 as i64 * b as u64 as i64) >> 32) as u32,
                    3 => ((a as u64 * b as u64) >> 32) as u32,
                    4 => if b == 0 { u32::MAX } else if a == 0x8000_0000 && b == u32::MAX { a } else { (a as i32 / b as i32) as u32 },
                    5 => if b == 0 { u32::MAX } else { a / b },
                    6 => if b == 0 { a } else if a == 0x8000_0000 && b == u32::MAX { 0 } else { (a as i32 % b as i32) as u32 },
                    _ => if b == 0 { a } else { a % b },
                });
            }
            0x13 | 0x33 => {
                let b = if op == 0x33 { rs2 } else { imm_i };
                let alt = f7 & 0x20 != 0 && (op == 0x33 || f3 == 5);
                wb = Some(match f3 {
                    0 => if alt { rs1.wrapping_sub(b) } else { rs1.wrapping_add(b) },
                    1 => rs1 << (b & 31),
                    2 => ((rs1 as i32) < b as i32) as u32,
                    3 => (rs1 < b) as u32,
                    4 => rs1 ^ b,
                    5 => if alt { ((rs1 as i32) >> (b & 31)) as u32 } else { rs1 >> (b & 31) },
                    6 => rs1 | b,
                    _ => rs1 & b,
                });
            }
            0x0f => {}
            0x73 => {
                if inst == 0x3020_0073 {
                    next = self.mepc;
                    self.mie_bit = self.mpie;
                    self.mpie = true;
                } else if inst == 0x1050_0073 {
                    if pending == 0 { self.wfi = true; }
                } else {
                    let old = self.csr_read(csr_n, e).unwrap();
                    let src = if f3 >= 5 { rs1n } else { rs1 };
                    if csr_writes { self.csr_write(csr_n, match f3 & 3 { 1 => src, 2 => old | src, _ => old & !src }); }
                    wb = Some(old);
                }
            }
            0x2f => match f5 {
                2 => { wb = Some(self.load_word(addr, e)); self.resv = Some(addr); cyc = 3; }
                3 => {
                    let ok = self.resv == Some(addr);
                    if ok { self.store(addr, rs2, 15, e); }
                    self.resv = None;
                    wb = Some(!ok as u32);
                }
                _ => {
                    let old = self.load_word(addr, e);
                    let lt = if f5 & 8 != 0 { old < rs2 } else { (old as i32) < rs2 as i32 };
                    let new = match f5 {
                        1 => rs2, 0 => old.wrapping_add(rs2), 4 => old ^ rs2, 12 => old & rs2, 8 => old | rs2,
                        _ => if lt != (f5 & 4 != 0) { old } else { rs2 },
                    };
                    // the write happens in the Mem cycle
                    self.store(addr, new, 15, e + 1);
                    wb = Some(old);
                    cyc = 3;
                }
            },
            _ => unreachable!(),
        }
        if let (Some(v), true) = (wb, rd != 0) { self.x[rd] = v; }
        self.pc = next;
        self.minstret = self.minstret.wrapping_add(1);
        self.instret += 1;
        self.cycles += cyc;
        // asleep from the cycle after the Exec: the wake-up check starts there
        if self.wfi { self.cycles = e + 1; }
        Ok(())
    }

    /// run until `pc` stays put with no interrupt to wake it (a `j .` halt loop), or `max` instructions
    pub fn run(&mut self, max: u64) -> Result<bool, String> {
        for _ in 0..max {
            let pc = self.pc;
            self.step()?;
            if self.pc == pc && !self.wfi && (!self.mie_bit || self.mie == 0) { return Ok(true); }
        }
        Ok(false)
    }
}
