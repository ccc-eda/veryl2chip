//! An RV32I instruction-set simulator with the memory map of RvSoc
//! (examples/src/rvsoc.veryl): the reference that compiled programs and the
//! RTL are checked against. It counts clock cycles like RvCore (2 per
//! instruction, 3 per load, 1 after reset), so the timer reads alike.

use std::collections::VecDeque;

pub const IO_BASE: u32 = 0x1000_0000;
pub const LED: u32 = IO_BASE;
pub const BTN: u32 = IO_BASE + 4;
pub const UART: u32 = IO_BASE + 8;
pub const UART_ST: u32 = IO_BASE + 12;
pub const TIMER: u32 = IO_BASE + 16;
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
    pub cycles: u64,
    pub instret: u64,
    /// clock cycles to send one byte (0: at once); the status register says busy meanwhile
    pub tx_cycles: u64,
    tx_busy_until: u64,
    /// VgaText's memories: 40 × 30 characters (2048 entries), the font (128 × 8 rows), fg | bg << 16
    pub vram: Vec<u8>,
    pub font: Vec<u8>,
    pub colors: u32,
}

impl Iss {
    /// `mem_size` bytes of RAM holding `image` from address 0
    pub fn new(image: &[u8], mem_size: usize) -> Iss {
        let mut mem = vec![0u8; mem_size];
        mem[..image.len().min(mem_size)].copy_from_slice(&image[..image.len().min(mem_size)]);
        Iss { pc: 0, x: [0; 32], mem, led: 0, btn: 0, tx: vec![], rx: VecDeque::new(), cycles: 1, instret: 0, tx_cycles: 0, tx_busy_until: 0, vram: vec![0; 2048], font: vec![0; 1024], colors: 0xfff }
    }

    /// the reset button: the CPU and the peripherals start over, the memory keeps its contents
    pub fn reset(&mut self) {
        self.pc = 0;
        self.x = [0; 32];
        self.led = 0;
        self.cycles = 1;
        self.tx_busy_until = 0;
        self.colors = 0xfff;
    }

    fn word_addr(&self, a: u32) -> usize { (a as usize) & (self.mem.len() - 1) & !3 }

    fn load_word(&mut self, a: u32) -> u32 {
        if a & IO_BASE != 0 {
            return match (a >> 2) & 7 {
                0 => self.led & 0xff,
                1 => self.btn & 0xff07,
                2 => self.rx.pop_front().map(|b| b as u32).unwrap_or(0),
                3 => (!self.rx.is_empty() as u32) << 1 | (self.cycles < self.tx_busy_until) as u32,
                4 => self.cycles as u32,
                _ => 0,
            };
        }
        let i = self.word_addr(a);
        u32::from_le_bytes([self.mem[i], self.mem[i + 1], self.mem[i + 2], self.mem[i + 3]])
    }

    fn store(&mut self, a: u32, v: u32, strb: u32) {
        if a & IO_BASE != 0 {
            match (a >> 13) & 7 {
                0 => {}
                1 => { self.vram[((a >> 2) & 2047) as usize] = v as u8; return; }
                2 => { self.font[((a >> 2) & 1023) as usize] = v as u8; return; }
                3 => { self.colors = v; return; }
                _ => return,
            }
            match (a >> 2) & 7 {
                0 => self.led = v & 0xff,
                2 => { self.tx.push(v as u8); self.tx_busy_until = self.cycles + self.tx_cycles; }
                _ => {}
            }
            return;
        }
        let i = self.word_addr(a);
        for k in 0..4 { if strb >> k & 1 == 1 { self.mem[i + k] = (v >> (8 * k)) as u8; } }
    }

    /// one instruction; Err for an instruction RvCore does not have (it would be a nop there)
    pub fn step(&mut self) -> Result<(), String> {
        let inst = self.load_word(self.pc & !(IO_BASE));
        let op = inst & 0x7f;
        let rd = ((inst >> 7) & 31) as usize;
        let f3 = (inst >> 12) & 7;
        let rs1 = self.x[((inst >> 15) & 31) as usize];
        let rs2 = self.x[((inst >> 20) & 31) as usize];
        let f7 = inst >> 25;
        let imm_i = (inst as i32 >> 20) as u32;
        let imm_s = ((inst as i32 >> 25) << 5) as u32 | ((inst >> 7) & 31);
        let imm_b = ((inst as i32 >> 31) << 12) as u32 | ((inst >> 7) & 1) << 11 | ((inst >> 25) & 0x3f) << 5 | ((inst >> 8) & 0xf) << 1;
        let imm_j = ((inst as i32 >> 31) << 20) as u32 | (inst & 0xff000) | ((inst >> 20) & 1) << 11 | ((inst >> 21) & 0x3ff) << 1;
        let mut next = self.pc.wrapping_add(4);
        let mut wb: Option<u32> = None;
        self.cycles += 2;
        match op {
            0x37 => wb = Some(inst & 0xffff_f000),
            0x17 => wb = Some(self.pc.wrapping_add(inst & 0xffff_f000)),
            0x6f => { wb = Some(next); next = self.pc.wrapping_add(imm_j); }
            0x67 => { wb = Some(next); next = rs1.wrapping_add(imm_i) & !1; }
            0x63 => {
                let t = match f3 { 0 => rs1 == rs2, 1 => rs1 != rs2, 4 => (rs1 as i32) < rs2 as i32, 5 => rs1 as i32 >= rs2 as i32, 6 => rs1 < rs2, 7 => rs1 >= rs2, _ => false };
                if t { next = self.pc.wrapping_add(imm_b); }
            }
            0x03 => {
                // the timer reads its value from the cycle the load is issued
                let a = rs1.wrapping_add(imm_i);
                let w = self.load_word(a) >> (8 * (a & 3));
                self.cycles += 1;
                wb = Some(match f3 { 0 => w as u8 as i8 as i32 as u32, 1 => w as u16 as i16 as i32 as u32, 4 => w & 0xff, 5 => w & 0xffff, _ => w });
            }
            0x23 => {
                let a = rs1.wrapping_add(imm_s);
                let sh = 8 * (a & 3);
                match f3 { 0 => self.store(a, (rs2 & 0xff) << sh, 1 << (a & 3)), 1 => self.store(a, (rs2 & 0xffff) << sh, 3 << (a & 3)), _ => self.store(a, rs2, 15) }
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
            _ => return Err(format!("unsupported instruction {:08x} at {:04x}", inst, self.pc)),
        }
        if let (Some(v), true) = (wb, rd != 0) { self.x[rd] = v; }
        self.pc = next;
        self.instret += 1;
        Ok(())
    }

    /// run until `pc` stays put (a `j .` halt loop) or `max` instructions
    pub fn run(&mut self, max: u64) -> Result<bool, String> {
        for _ in 0..max {
            let pc = self.pc;
            self.step()?;
            if self.pc == pc { return Ok(true); }
        }
        Ok(false)
    }
}
