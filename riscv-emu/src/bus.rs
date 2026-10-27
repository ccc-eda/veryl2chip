//! Rv64Soc's devices (examples/rv64/src/rv64soc.veryl), register for register:
//!
//!   0x0010_0000  finisher (sifive,test0): a write of a non-zero low half ends the run (0x5555 = pass)
//!   0x0200_0000  CLINT: msip (+0), mtimecmp (+0x4000), mtime (+0xBFF8)
//!   0x0C00_0000  PLIC: priorities, pending, enables / thresholds / claims of context 0 (M) and 1 (S)
//!   0x1000_0000  UART: a 16550 subset (THR always empty, a one-byte receive buffer), PLIC source 10
//!   0x1006_0000  GPIO: 16 pins, SiFive GPIO registers, pin k = PLIC source 16 + k
//!   0x8000_0000  RAM
//!
//! Anything else is an access fault. Devices answer 8-byte registers to 4-byte accesses
//! (address bit 2 picks the half) like the SoC does.

pub const RAM_BASE: u64 = 0x8000_0000;

pub struct Uart {
    ier: u8, lcr: u8, mcr: u8, scr: u8, fcr: bool, dll: u8, dlm: u8,
    rx_full: bool, rx_byte: u8, thre_pend: bool,
}

pub struct Gpio {
    pub input_en: u32, pub output_en: u32, pub out_val: u32, pue: u32, ds: u32,
    rise_ie: u32, rise_ip: u32, fall_ie: u32, fall_ip: u32, high_ie: u32, high_ip: u32, low_ie: u32, low_ip: u32,
    iof_en: u32, iof_sel: u32, pub out_xor: u32,
    /// the pins' values as last seen (input enable applied)
    iv: u32,
    /// what the outside drives (a bit per pin)
    pub pins_in: u32,
}

pub struct Plic { prio: [u8; 32], en: [u32; 2], thr: [u8; 2], claimed: u32 }

pub struct Bus {
    pub ram: Vec<u8>,
    pub mtime: u64,
    pub mtimecmp: u64,
    pub msip: bool,
    pub uart: Uart,
    pub gpio: Gpio,
    plic: Plic,
    /// bytes the UART sent, not taken yet
    pub tx: Vec<u8>,
    /// bytes waiting to be received
    pub rx: std::collections::VecDeque<u8>,
    /// the finisher's code when the program asked to end
    pub finished: Option<u32>,
    /// riscv-tests: the address of tohost and the value written there
    pub tohost: Option<u64>,
    pub tohost_val: u64,
}

impl Bus {
    pub fn new(ram_size: usize) -> Bus {
        Bus {
            ram: vec![0; ram_size],
            mtime: 0, mtimecmp: u64::MAX, msip: false,
            uart: Uart { ier: 0, lcr: 0, mcr: 0, scr: 0, fcr: false, dll: 0, dlm: 0, rx_full: false, rx_byte: 0, thre_pend: false },
            gpio: Gpio { input_en: 0, output_en: 0, out_val: 0, pue: 0, ds: 0, rise_ie: 0, rise_ip: 0, fall_ie: 0, fall_ip: 0, high_ie: 0, high_ip: 0,
                low_ie: 0, low_ip: 0, iof_en: 0, iof_sel: 0, out_xor: 0, iv: 0, pins_in: 0 },
            plic: Plic { prio: [0; 32], en: [0; 2], thr: [0; 2], claimed: 0 },
            tx: vec![], rx: Default::default(), finished: None, tohost: None, tohost_val: 0,
        }
    }

    /// devices back to their reset state (the RAM is kept)
    pub fn reset(&mut self) {
        let ram = std::mem::take(&mut self.ram);
        let pins = self.gpio.pins_in;
        *self = Bus::new(0);
        self.ram = ram;
        self.gpio.pins_in = pins;
    }

    #[inline]
    pub fn in_ram(&self, a: u64, n: u64) -> bool { a >= RAM_BASE && a - RAM_BASE + n <= self.ram.len() as u64 }

    /// the UART's receive buffer takes the next byte (the SoC does it in the cycle the byte comes)
    pub fn poll_rx(&mut self) {
        if !self.uart.rx_full {
            if let Some(b) = self.rx.pop_front() { self.uart.rx_full = true; self.uart.rx_byte = b; }
        }
    }

    // ---- GPIO ----
    pub fn gpio_out(&self) -> u32 { (self.gpio.out_val ^ self.gpio.out_xor) & 0xffff }
    /// the pins: driven by the SoC where the output is enabled, else from outside
    pub fn gpio_pins(&self) -> u32 { (self.gpio.output_en & self.gpio_out()) | (!self.gpio.output_en & self.gpio.pins_in & 0xffff) }
    /// look at the pins (after a write or an input change): edges and levels into the pending bits
    pub fn gpio_update(&mut self) {
        let g = &mut self.gpio;
        let pins = (g.output_en & ((g.out_val ^ g.out_xor) & 0xffff)) | (!g.output_en & g.pins_in & 0xffff);
        let iv = pins & g.input_en & 0xffff;
        g.rise_ip |= iv & !g.iv;
        g.fall_ip |= !iv & g.iv & 0xffff;
        g.high_ip |= iv;
        g.low_ip |= !iv & g.input_en & 0xffff;
        g.iv = iv;
    }
    fn gpio_irq(&self) -> u32 {
        let g = &self.gpio;
        (g.rise_ip & g.rise_ie) | (g.fall_ip & g.fall_ie) | (g.high_ip & g.high_ie) | (g.low_ip & g.low_ie)
    }

    // ---- interrupts ----
    fn uart_irq(&self) -> bool { (self.uart.ier & 1 != 0 && self.uart.rx_full) || (self.uart.ier & 2 != 0 && self.uart.thre_pend) }
    fn plic_src(&self) -> u32 { (self.gpio_irq() & 0xffff) << 16 | (self.uart_irq() as u32) << 10 }
    /// the highest-priority pending source of a context, and its priority
    fn plic_best(&self, ctx: usize) -> (u32, u8) {
        let pend = self.plic_src() & !self.plic.claimed & self.plic.en[ctx];
        let (mut best, mut bp) = (0, 0);
        let mut p = pend & !1;
        while p != 0 {
            let i = p.trailing_zeros();
            if self.plic.prio[i as usize] > bp { best = i; bp = self.plic.prio[i as usize]; }
            p &= p - 1;
        }
        (best, bp)
    }
    /// external interrupts: (M, S)
    pub fn eip(&self) -> (bool, bool) {
        if self.plic_src() == 0 { return (false, false); }
        (self.plic_best(0).1 > self.plic.thr[0], self.plic_best(1).1 > self.plic.thr[1])
    }

    // ---- device registers ----
    /// read a device (size: 1, 2, 4, 8 bytes); None: no device there
    pub fn dev_read(&mut self, a: u64, size: u32) -> Option<u64> {
        let hi = a & 4 != 0;
        let half = |v: u64| if size == 8 { v } else if hi { v >> 32 } else { v & 0xffff_ffff };
        if a >> 16 == 0x200 {
            let off = a & 0xffff;
            return Some(if off >> 3 == 0x17ff { half(self.mtime) } else if off >> 3 == 0x800 { half(self.mtimecmp) } else if off == 0 { self.msip as u64 } else { 0 });
        }
        if a >> 26 == 3 {
            let off = a & 0x3ff_ffff;
            return Some(if off >> 7 == 0 { self.plic.prio[(off >> 2 & 31) as usize] as u64 }
                else if off == 0x1000 { (self.plic_src() & !self.plic.claimed) as u64 }
                else if off == 0x2000 { self.plic.en[0] as u64 } else if off == 0x2080 { self.plic.en[1] as u64 }
                else if off == 0x20_0000 { self.plic.thr[0] as u64 } else if off == 0x20_1000 { self.plic.thr[1] as u64 }
                else if off == 0x20_0004 || off == 0x20_1004 {
                    let (b, _) = self.plic_best(if off == 0x20_0004 { 0 } else { 1 });
                    if b != 0 { self.plic.claimed |= 1 << b; }
                    b as u64
                } else { 0 });
        }
        if a >> 8 == 0x10_0000 {
            let u = &mut self.uart;
            let dlab = u.lcr & 0x80 != 0;
            let rx_int = u.ier & 1 != 0 && u.rx_full;
            let tx_int = u.ier & 2 != 0 && u.thre_pend;
            let v = match a & 7 {
                0 => if dlab { u.dll } else { u.rx_full = false; u.rx_byte },
                1 => if dlab { u.dlm } else { u.ier },
                2 => {
                    if !rx_int && tx_int { u.thre_pend = false; }
                    (if u.fcr { 0xc0 } else { 0 }) | if rx_int { 4 } else if tx_int { 2 } else { 1 }
                }
                3 => u.lcr, 4 => u.mcr, 5 => 0x60 | u.rx_full as u8, 6 => 0, _ => u.scr,
            };
            if a & 7 == 0 && !dlab { self.poll_rx(); }
            return Some(v as u64);
        }
        if a >> 12 == 0x10060 {
            let g = &self.gpio;
            return Some(match (a & 0xff) >> 2 {
                0 => g.iv, 1 => g.input_en, 2 => g.output_en, 3 => g.out_val, 4 => g.pue, 5 => g.ds, 6 => g.rise_ie, 7 => g.rise_ip,
                8 => g.fall_ie, 9 => g.fall_ip, 10 => g.high_ie, 11 => g.high_ip, 12 => g.low_ie, 13 => g.low_ip, 14 => g.iof_en,
                15 => g.iof_sel, 16 => g.out_xor, _ => 0,
            } as u64);
        }
        if a >> 12 == 0x100 { return Some(0); }
        None
    }

    /// write a device; false: no device there
    pub fn dev_write(&mut self, a: u64, size: u32, v: u64) -> bool {
        let hi = a & 4 != 0;
        let set = |r: &mut u64| if size == 8 { *r = v } else if hi { *r = (*r & 0xffff_ffff) | v << 32 } else { *r = (*r & !0xffff_ffff) | (v & 0xffff_ffff) };
        if a >> 16 == 0x200 {
            let off = a & 0xffff;
            if off >> 3 == 0x800 { set(&mut self.mtimecmp) } else if off >> 3 == 0x17ff { set(&mut self.mtime) } else if off == 0 { self.msip = v & 1 != 0 }
            return true;
        }
        if a >> 26 == 3 {
            let off = a & 0x3ff_ffff;
            if off >> 7 == 0 { self.plic.prio[(off >> 2 & 31) as usize] = (v & 7) as u8 }
            else if off == 0x2000 { self.plic.en[0] = v as u32 } else if off == 0x2080 { self.plic.en[1] = v as u32 }
            else if off == 0x20_0000 { self.plic.thr[0] = (v & 7) as u8 } else if off == 0x20_1000 { self.plic.thr[1] = (v & 7) as u8 }
            else if off == 0x20_0004 || off == 0x20_1004 { self.plic.claimed &= !(1 << (v & 31)) }
            return true;
        }
        if a >> 8 == 0x10_0000 {
            let u = &mut self.uart;
            let dlab = u.lcr & 0x80 != 0;
            let b = v as u8;
            match a & 7 {
                0 => if dlab { u.dll = b } else { self.tx.push(b); u.thre_pend = true },
                1 => if dlab { u.dlm = b } else { if b & 2 != 0 && u.ier & 2 == 0 { u.thre_pend = true; } u.ier = b & 15 },
                2 => u.fcr = b & 1 != 0,
                3 => u.lcr = b, 4 => u.mcr = b, 7 => u.scr = b,
                _ => {}
            }
            return true;
        }
        if a >> 12 == 0x10060 {
            let w = (v as u32) & 0xffff;
            let g = &mut self.gpio;
            match (a & 0xff) >> 2 {
                1 => g.input_en = w, 2 => g.output_en = w, 3 => g.out_val = w, 4 => g.pue = w, 5 => g.ds = w, 6 => g.rise_ie = w,
                7 => g.rise_ip &= !w, 8 => g.fall_ie = w, 9 => g.fall_ip &= !w, 10 => g.high_ie = w, 11 => g.high_ip &= !w,
                12 => g.low_ie = w, 13 => g.low_ip &= !w, 14 => g.iof_en = w, 15 => g.iof_sel = w, 16 => g.out_xor = w,
                _ => {}
            }
            self.gpio_update();
            return true;
        }
        if a >> 12 == 0x100 {
            if a & 0xfff == 0 && v & 0xffff != 0 { self.finished = Some(v as u32); }
            return true;
        }
        false
    }
}
