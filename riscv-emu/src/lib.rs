//! riscv-emu: an instruction-set emulator of veryl2chip's RV64 board (Rv64Soc in
//! examples/rv64/src/rv64soc.veryl). It runs the same programs as the hardware
//! (riscv-tests, OpenSBI + Linux, xv6) without simulating the circuit, so it is many
//! times faster than veryl-emu or Verilator; the Veryl design itself is verified with those.
//!
//!   cpu.rs  the hart (RV64IMAC, M / S / U, Sv39, interrupts)
//!   bus.rs  the SoC's devices (CLINT, PLIC, UART, GPIO, finisher) and the RAM
//!   jit.rs  hot blocks translated to WebAssembly (run by wasm32 hosts)
//!   wasm.rs the WebAssembly interface for the IDE (wasm32 only)

pub mod bus;
pub mod cpu;
pub mod jit;
#[cfg(target_arch = "wasm32")]
pub mod wasm;

pub use bus::RAM_BASE;
pub use cpu::{Machine, Stop, Trap};

/// RAM size of Rv64Soc (MEM_BITS = 28)
pub const RAM_SIZE: usize = 256 << 20;

/// PT_LOAD segments of an ELF64 file (None: not an ELF64 file) and its tohost symbol
pub fn elf_segments(f: &[u8]) -> Option<(Vec<(u64, Vec<u8>)>, Option<u64>)> {
    if f.len() < 64 || &f[..4] != b"\x7fELF" || f[4] != 2 { return None; }
    let u16_at = |o: usize| u16::from_le_bytes([f[o], f[o + 1]]) as usize;
    let u32_at = |o: usize| u32::from_le_bytes(f[o..o + 4].try_into().unwrap());
    let u64_at = |o: usize| u64::from_le_bytes(f[o..o + 8].try_into().unwrap());
    let (phoff, phent, phnum) = (u64_at(32) as usize, u16_at(54), u16_at(56));
    let mut segs = vec![];
    for i in 0..phnum {
        let p = phoff + i * phent;
        if u32_at(p) != 1 { continue; }
        let (off, paddr, filesz, memsz) = (u64_at(p + 8) as usize, u64_at(p + 24), u64_at(p + 32) as usize, u64_at(p + 40) as usize);
        if memsz == 0 { continue; }
        let mut seg = vec![0u8; memsz];
        seg[..filesz].copy_from_slice(&f[off..off + filesz]);
        segs.push((paddr, seg));
    }
    // the symbol table: tohost (riscv-tests)
    let mut tohost = None;
    let (shoff, shent, shnum) = (u64_at(40) as usize, u16_at(58), u16_at(60));
    for i in 0..shnum {
        let s = shoff + i * shent;
        if s + 64 > f.len() || u32_at(s + 4) != 2 { continue; }
        let (off, size, link) = (u64_at(s + 24) as usize, u64_at(s + 32) as usize, u32_at(s + 40) as usize);
        let strs = u64_at(shoff + link * shent + 24) as usize;
        for k in 0..size / 24 {
            let e = off + k * 24;
            let name = &f[strs + u32_at(e) as usize..];
            if name.starts_with(b"tohost\0") { tohost = Some(u64_at(e + 8)); }
        }
    }
    Some((segs, tohost))
}

impl Machine {
    /// put bytes into the RAM at a physical address
    pub fn load(&mut self, addr: u64, bytes: &[u8]) -> Result<(), String> {
        if !self.bus.in_ram(addr, bytes.len() as u64) { return Err(format!("0x{:x} ({} bytes) is outside the RAM", addr, bytes.len())); }
        let o = (addr - RAM_BASE) as usize;
        self.bus.ram[o..o + bytes.len()].copy_from_slice(bytes);
        if self.jit.on { let mut p = o & !0xfff; while p < o + bytes.len() { if self.jit.has_code(p) { self.jit.invalidate_page(p); } p += 4096; } }
        Ok(())
    }

    /// a program: an ELF file by its segments (and its tohost), anything else at the RAM's start
    pub fn load_program(&mut self, f: &[u8]) -> Result<(), String> {
        match elf_segments(f) {
            Some((segs, tohost)) => { for (a, b) in segs { self.load(a, &b)?; } self.bus.tohost = tohost; Ok(()) }
            None => self.load(RAM_BASE, f),
        }
    }

    /// set the GPIO inputs (a bit per pin)
    pub fn set_gpio(&mut self, bits: u32) { self.bus.gpio.pins_in = bits; self.bus.gpio_update(); self.wake(); }

    /// bytes typed into the UART
    pub fn input(&mut self, bytes: &[u8]) { self.bus.rx.extend(bytes.iter().copied()); self.wake(); }

    /// the GPIO outputs (pins with their output enabled), as the SoC drives them
    pub fn gpio_out(&self) -> (u32, u32) { (self.bus.gpio_out(), self.bus.gpio.output_en & 0xffff) }

    /// bytes the UART sent since the last call
    pub fn take_output(&mut self) -> Vec<u8> { std::mem::take(&mut self.bus.tx) }
}
