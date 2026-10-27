//! Translation of hot basic blocks to WebAssembly (like QEMU's TCG, or v86): a block (up to
//! 64 instructions in one 4 KB page, ending at a jump or branch, or before an instruction
//! it does not translate) becomes a function `(m: i32) -> i32` of a small module the host
//! compiles; the core calls it through its function table (wasm32: a function pointer is
//! a table index). The function keeps the registers it uses in locals, writes the dirty ones
//! back and the next pc into the machine (`m` points at `Machine`, whose first fields are
//! `x`, `pc`, `jit_fault`), and returns how many instructions it retired.
//!
//! Translated: LUI, AUIPC, JAL, JALR, branches, OP-IMM(-32), OP(-32) with M (multiply-high,
//! divide and remainder through the `ar` helper), loads and stores. A load or store first
//! looks in the translated code's own TLB (a table per privilege of virtual page -> address
//! of the RAM page in the core's memory, filled by the helpers, emptied with the core's TLB
//! and when SUM / MXR / MPRV / MPP change; stores only for pages without translated code);
//! else it calls the `ld` / `st` helper, which translates the address and may trap
//! (`jit_fault` = 1, the pc is then the faulting instruction's; 2 = a store hit translated
//! code: the block stops after it).
//! Everything else (SYSTEM, AMO, FENCE) ends the block and is interpreted.

use crate::cpu::{expand, Machine, Trap};
use std::collections::HashMap;

/// what the core did at a block's start
pub enum Step { Ran, Request, No }

/// executions of a block before it is translated (default)
pub const HOT: u32 = 1000;

/// the translations: by physical and virtual address (the code has virtual pcs in it)
#[derive(Default)]
pub struct State {
    /// translating is on (a host that can compile and call the modules: wasm32 with rv_jit)
    pub on: bool,
    /// executions before a block is translated
    pub hot_at: u32,
    /// the last blocks looked up, by virtual address: (pa, va, slot, instructions)
    cache: Vec<(u64, u64, u32, u32)>,
    /// the next instruction may start a block
    pub at_block: bool,
    blocks: HashMap<(u64, u64), (u32, u32)>,
    counts: HashMap<(u64, u64), u32>,
    /// RAM pages (4 KB) with translated code, and their blocks
    pages: Vec<u64>,
    page_blocks: HashMap<usize, Vec<(u64, u64)>>,
    /// table slots of dropped blocks, to reuse
    pub free: Vec<u32>,
    /// a translation for the host: physical and virtual address, the module, its instructions
    pub request: Option<(u64, u64, Vec<u8>, u32)>,
    /// the trap a helper hit
    pub trap: Option<Trap>,
    /// the translated code's TLBs for loads and stores: [privilege][entry] = (virtual page, host page)
    tlb_r: Vec<u64>,
    tlb_w: Vec<u64>,
    /// a store hit translated code
    pub hit: bool,
    pub blocks_run: u64,
    pub translated: u64,
}

impl State {
    #[inline]
    /// addresses of the two TLBs in the core's memory (stable: allocated once)
    pub fn tlb_addrs(&mut self) -> (u32, u32) {
        if self.tlb_r.is_empty() { self.tlb_r = vec![u64::MAX; 4 * TLB_N * 2]; self.tlb_w = vec![u64::MAX; 4 * TLB_N * 2]; }
        (self.tlb_r.as_ptr() as usize as u32, self.tlb_w.as_ptr() as usize as u32)
    }
    pub fn fill(&mut self, write: bool, prv: u64, va: u64, host: u64) {
        if self.tlb_r.is_empty() { return; }
        let i = ((prv as usize & 3) * TLB_N + ((va >> 12) as usize & (TLB_N - 1))) * 2;
        let t = if write { &mut self.tlb_w } else { &mut self.tlb_r };
        t[i] = va >> 12;
        t[i + 1] = host;
    }
    pub fn flush_tlb(&mut self) {
        for k in (0..self.tlb_r.len()).step_by(2) { self.tlb_r[k] = u64::MAX; self.tlb_w[k] = u64::MAX; }
    }

    #[inline]
    pub fn lookup(&mut self, pa: u64, va: u64) -> Option<(u32, u32)> {
        if self.cache.is_empty() { self.cache = vec![(u64::MAX, 0, 0, 0); CACHE]; }
        let k = (va as usize >> 1) & (CACHE - 1);
        let e = self.cache[k];
        if e.0 == pa && e.1 == va { return Some((e.2, e.3)); }
        let (f, n) = *self.blocks.get(&(pa, va))?;
        self.cache[k] = (pa, va, f, n);
        Some((f, n))
    }
    /// count an execution; true when the block just became hot
    pub fn hot(&mut self, pa: u64, va: u64) -> bool {
        let c = self.counts.entry((pa, va)).or_insert(0);
        *c += 1;
        *c == if self.hot_at == 0 { HOT } else { self.hot_at }
    }
    /// the host compiled the requested block into table slot f
    pub fn install(&mut self, f: u32) {
        let Some((pa, va, _, n)) = self.request.take() else { return };
        let off = (pa - crate::RAM_BASE) as usize;
        let page = off >> 12;
        if self.pages.len() <= page / 64 { self.pages.resize(page / 64 + 1, 0); }
        self.pages[page / 64] |= 1 << (page % 64);
        self.page_blocks.entry(page).or_default().push((pa, va));
        self.blocks.insert((pa, va), (f, n));
        self.translated += 1;
        // stores into that page must go through the helper now (they drop its translations)
        for k in (0..self.tlb_w.len()).step_by(2) { self.tlb_w[k] = u64::MAX; }
    }
    #[inline]
    pub fn has_code(&self, ram_off: usize) -> bool { let p = ram_off >> 12; self.pages.get(p / 64).is_some_and(|w| w >> (p % 64) & 1 != 0) }
    /// the RAM page at this offset changed: drop its blocks (and count their code as cold again)
    pub fn invalidate_page(&mut self, ram_off: usize) {
        let p = ram_off >> 12;
        for e in self.cache.iter_mut() { e.0 = u64::MAX; }
        if let Some(w) = self.pages.get_mut(p / 64) { *w &= !(1 << (p % 64)); }
        for k in self.page_blocks.remove(&p).unwrap_or_default() {
            if let Some((f, _)) = self.blocks.remove(&k) { self.free.push(f); }
            self.counts.remove(&k);
        }
    }
    /// drop every translation (a reset, a new program)
    pub fn clear(&mut self) {
        for (_, (f, _)) in self.blocks.drain() { self.free.push(f); }
        for e in self.cache.iter_mut() { e.0 = u64::MAX; }
        self.counts.clear();
        self.pages.clear();
        self.page_blocks.clear();
        self.request = None;
        self.at_block = true;
        self.flush_tlb();
    }
}

/// call a translated block (wasm32: a function pointer is its table slot)
#[cfg(target_arch = "wasm32")]
pub fn call(f: u32, m: &mut Machine) -> i32 {
    let g: extern "C" fn(*mut Machine) -> i32 = unsafe { std::mem::transmute(f as usize) };
    g(m)
}
#[cfg(not(target_arch = "wasm32"))]
pub fn call(_f: u32, _m: &mut Machine) -> i32 { unreachable!("translated code runs only on wasm32") }

/// the host's helpers (imports): ld(m, va, f3) -> value, st(m, va, value, f3), ar(a, b, kind) -> value
pub const HELP_LD: u32 = 0;
pub const HELP_ST: u32 = 1;
pub const HELP_AR: u32 = 2;
/// offsets in Machine (repr(C)): x[32], pc, jit_fault, prv
pub const OFF_PC: u32 = 256;
pub const OFF_FAULT: u32 = 264;
pub const OFF_PRV: u32 = 272;
/// the translated code's TLB: per privilege 512 entries of (virtual page, host address of the page)
const TLB_N: usize = 512;
pub const MAX_INSNS: usize = 64;
const CACHE: usize = 4096;

fn uleb(o: &mut Vec<u8>, mut v: u64) { loop { let b = (v & 0x7f) as u8; v >>= 7; if v == 0 { o.push(b); return; } o.push(b | 0x80); } }
fn sleb(o: &mut Vec<u8>, mut v: i64) {
    loop {
        let b = (v & 0x7f) as u8;
        v >>= 7;
        if (v == 0 && b & 0x40 == 0) || (v == -1 && b & 0x40 != 0) { o.push(b); return; }
        o.push(b | 0x80);
    }
}

struct Code { c: Vec<u8> }
impl Code {
    fn op(&mut self, b: u8) -> &mut Self { self.c.push(b); self }
    fn get(&mut self, l: u32) -> &mut Self { self.c.push(0x20); uleb(&mut self.c, l as u64); self }
    fn set(&mut self, l: u32) -> &mut Self { self.c.push(0x21); uleb(&mut self.c, l as u64); self }
    fn i64c(&mut self, v: u64) -> &mut Self { self.c.push(0x42); sleb(&mut self.c, v as i64); self }
    fn i32c(&mut self, v: i32) -> &mut Self { self.c.push(0x41); sleb(&mut self.c, v as i64); self }
    fn call(&mut self, f: u32) -> &mut Self { self.c.push(0x10); uleb(&mut self.c, f as u64); self }
    fn load64(&mut self, off: u32) -> &mut Self { self.c.extend([0x29, 3]); uleb(&mut self.c, off as u64); self }
    fn store64(&mut self, off: u32) -> &mut Self { self.c.extend([0x37, 3]); uleb(&mut self.c, off as u64); self }
    fn load32(&mut self, off: u32) -> &mut Self { self.c.extend([0x28, 2]); uleb(&mut self.c, off as u64); self }
}

/// one decoded instruction of a block
struct Insn { pc: u64, w: u32, len: u64 }

/// what a block reads and writes (registers)
fn regs(w: u32) -> (Option<usize>, Option<usize>, Option<usize>) {
    let rd = (w >> 7 & 31) as usize;
    let rs1 = (w >> 15 & 31) as usize;
    let rs2 = (w >> 20 & 31) as usize;
    let nz = |r: usize| if r == 0 { None } else { Some(r) };
    match w & 0x7f {
        0x37 | 0x17 | 0x6f => (nz(rd), None, None),
        0x67 | 0x03 | 0x13 | 0x1b => (nz(rd), nz(rs1), None),
        0x63 | 0x23 => (None, nz(rs1), nz(rs2)),
        _ => (nz(rd), nz(rs1), nz(rs2)),
    }
}

/// is it translated? (and does it end the block)
fn kind(w: u32) -> Option<bool> {
    let f3 = w >> 12 & 7;
    let f7 = w >> 25;
    Some(match w & 0x7f {
        0x37 | 0x17 => false,
        0x6f => true,
        0x67 => { if f3 != 0 { return None; } true }
        0x63 => { if f3 == 2 || f3 == 3 { return None; } true }
        0x03 => { if f3 == 7 { return None; } false }
        0x23 => { if f3 > 3 { return None; } false }
        0x13 => { if (f3 == 1 && w >> 26 != 0) || (f3 == 5 && w >> 26 != 0 && w >> 26 != 0x10) { return None; } false }
        0x1b => { if !(f3 == 0 || (f3 == 1 && f7 == 0) || (f3 == 5 && (f7 == 0 || f7 == 0x20))) { return None; } false }
        0x33 => { if !(f7 == 0 || f7 == 1 || (f7 == 0x20 && (f3 == 0 || f3 == 5))) { return None; } false }
        0x3b => { if !((f7 == 0 && matches!(f3, 0 | 1 | 5)) || (f7 == 0x20 && matches!(f3, 0 | 5)) || (f7 == 1 && matches!(f3, 0 | 4 | 5 | 6 | 7))) { return None; } false }
        _ => return None,
    })
}

/// the instructions of the block at physical `pa` (virtual `va`) from the RAM bytes `page` (the
/// rest of its 4 KB page); None: the first one is not translated
fn decode(va: u64, page: &[u8]) -> Option<Vec<Insn>> {
    let mut v = vec![];
    let mut o = 0usize;
    while v.len() < MAX_INSNS && o + 2 <= page.len() {
        let lo = u16::from_le_bytes([page[o], page[o + 1]]) as u32;
        let (w, len) = if lo & 3 == 3 {
            if o + 4 > page.len() { break; }
            (lo | (u16::from_le_bytes([page[o + 2], page[o + 3]]) as u32) << 16, 4)
        } else {
            match expand(lo) { Some(w) => (w, 2), None => break }
        };
        let Some(end) = kind(w) else { break };
        v.push(Insn { pc: va + o as u64, w, len });
        o += len as usize;
        if end { break; }
    }
    if v.is_empty() { None } else { Some(v) }
}

fn sext(v: u64, bits: u32) -> u64 { (((v << (64 - bits)) as i64) >> (64 - bits)) as u64 }

/// a module with one function (export "b") for the block at virtual address va whose code is
/// `page` (from the block's start to the end of its page); its instruction count
pub fn compile(va: u64, page: &[u8], tlbs: (u32, u32)) -> Option<(Vec<u8>, u32)> {
    let insns = decode(va, page)?;
    // locals: 0 = m (param), 1..=31 = x1..x31, 32 / 33 / 34 = i64 temporaries (address, page, value),
    // 35 = the fault flag, 36 = a TLB entry's address (i32)
    let (tmp, vpn, val, fl, ea) = (32u32, 33u32, 34u32, 35u32, 36u32);
    let mut used = [false; 32];
    let mut dirty = [false; 32];
    for i in &insns {
        let (d, a, b) = regs(i.w);
        for r in [d, a, b].into_iter().flatten() { used[r] = true; }
        if let Some(d) = d { dirty[d] = true; }
    }
    let mut c = Code { c: vec![] };
    // registers into locals
    for r in 1..32 { if used[r] { c.get(0).load64(8 * r as u32).set(r as u32); } }
    let wb = |c: &mut Code| { for r in 1..32 { if dirty[r] { c.get(0).get(r as u32).store64(8 * r as u32); } } };
    let rget = |c: &mut Code, r: usize| { if r == 0 { c.i64c(0); } else { c.get(r as u32); } };
    let n = insns.len();
    let mut ended = false;
    for (k, i) in insns.iter().enumerate() {
        let w = i.w;
        let rd = (w >> 7 & 31) as usize;
        let rs1 = (w >> 15 & 31) as usize;
        let rs2 = (w >> 20 & 31) as usize;
        let f3 = w >> 12 & 7;
        let f7 = w >> 25;
        let imm_i = sext((w >> 20) as u64, 12);
        let next = i.pc.wrapping_add(i.len);
        // the value on the stack into rd (dropped for x0)
        let setrd = |c: &mut Code| { if rd != 0 { c.set(rd as u32); } else { c.op(0x1a); } };
        // after a helper: leave on a fault (1: at this instruction, 2: after it)
        let check = |c: &mut Code| {
            c.get(0).load32(OFF_FAULT).set(fl).get(fl).op(0x04).op(0x40);
            wb(c);
            c.get(0).i64c(i.pc).i64c(next).get(fl).i32c(1).op(0x46).op(0x1b).store64(OFF_PC);
            c.i32c(k as i32).i32c(k as i32 + 1).get(fl).i32c(1).op(0x46).op(0x1b).op(0x0f);
            c.op(0x0b);
        };
        match w & 0x7f {
            0x37 => { c.i64c(sext((w & 0xffff_f000) as u64, 32)); setrd(&mut c); }
            0x17 => { c.i64c(i.pc.wrapping_add(sext((w & 0xffff_f000) as u64, 32))); setrd(&mut c); }
            0x13 => {
                let sh = (w >> 20 & 63) as u64;
                rget(&mut c, rs1);
                match f3 {
                    0 => { c.i64c(imm_i).op(0x7c); }
                    2 => { c.i64c(imm_i).op(0x53).op(0xad); }
                    3 => { c.i64c(imm_i).op(0x54).op(0xad); }
                    4 => { c.i64c(imm_i).op(0x85); }
                    6 => { c.i64c(imm_i).op(0x84); }
                    7 => { c.i64c(imm_i).op(0x83); }
                    1 => { c.i64c(sh).op(0x86); }
                    _ => { c.i64c(sh).op(if w >> 26 == 0x10 { 0x87 } else { 0x88 }); }
                }
                setrd(&mut c);
            }
            0x1b => {
                let sh = (w >> 20 & 31) as i32;
                rget(&mut c, rs1);
                match f3 {
                    0 => { c.i64c(imm_i).op(0x7c).op(0xa7); }
                    1 => { c.op(0xa7).i32c(sh).op(0x74); }
                    _ => { c.op(0xa7).i32c(sh).op(if f7 == 0x20 { 0x75 } else { 0x76 }); }
                }
                c.op(0xac);
                setrd(&mut c);
            }
            0x33 => {
                if f7 == 1 && f3 != 0 {
                    // mulh*, div*, rem*: the helper (kind = f3)
                    rget(&mut c, rs1); rget(&mut c, rs2); c.i32c(f3 as i32).call(HELP_AR);
                } else {
                    rget(&mut c, rs1); rget(&mut c, rs2);
                    match (f7, f3) {
                        (1, _) => { c.op(0x7e); }
                        (0x20, 0) => { c.op(0x7d); }
                        (0, 0) => { c.op(0x7c); }
                        (0, 1) => { c.op(0x86); }
                        (0, 2) => { c.op(0x53).op(0xad); }
                        (0, 3) => { c.op(0x54).op(0xad); }
                        (0, 4) => { c.op(0x85); }
                        (0, 5) => { c.op(0x88); }
                        (0x20, _) => { c.op(0x87); }
                        (0, 6) => { c.op(0x84); }
                        _ => { c.op(0x83); }
                    }
                }
                setrd(&mut c);
            }
            0x3b => {
                if f7 == 1 && f3 != 0 {
                    rget(&mut c, rs1); rget(&mut c, rs2); c.i32c(8 + f3 as i32).call(HELP_AR);
                } else {
                    rget(&mut c, rs1); c.op(0xa7); rget(&mut c, rs2); c.op(0xa7);
                    match (f7, f3) {
                        (1, _) => { c.op(0x6c); }
                        (0x20, 0) => { c.op(0x6b); }
                        (0, 0) => { c.op(0x6a); }
                        (0, 1) => { c.op(0x74); }
                        (0, 5) => { c.op(0x76); }
                        _ => { c.op(0x75); }
                    }
                    c.op(0xac);
                }
                setrd(&mut c);
            }
            0x03 | 0x23 => {
                let store = w & 0x7f == 0x23;
                let imm = if store { sext(((w >> 25) << 5 | (w >> 7 & 31)) as u64, 12) } else { imm_i };
                let size = 1u32 << (f3 & 3);
                // the address, its page, the TLB entry of this privilege
                rget(&mut c, rs1); c.i64c(imm).op(0x7c).set(tmp);
                c.get(tmp).i64c(12).op(0x88).set(vpn);
                c.get(vpn).op(0xa7).i32c(TLB_N as i32 - 1).op(0x71);
                c.get(0).load32(OFF_PRV).i32c(9).op(0x74).op(0x6a).i32c(4).op(0x74).i32c((if store { tlbs.1 } else { tlbs.0 }) as i32).op(0x6a).set(ea);
                // a hit (and aligned): the RAM directly
                c.get(ea).load64(0).get(vpn).op(0x51);
                c.get(tmp).op(0xa7).i32c(size as i32 - 1).op(0x71).op(0x45).op(0x71);
                if store {
                    c.op(0x04).op(0x40);
                    c.get(ea).load64(8).op(0xa7).get(tmp).op(0xa7).i32c(0xfff).op(0x71).op(0x6a);
                    rget(&mut c, rs2);
                    let (o, al) = match f3 { 0 => (0x3c, 0), 1 => (0x3d, 1), 2 => (0x3e, 2), _ => (0x37, 3) };
                    c.op(o).op(al).op(0);
                    c.op(0x05);
                    c.get(0).get(tmp); rget(&mut c, rs2); c.i32c(f3 as i32).call(HELP_ST);
                    check(&mut c);
                    c.op(0x0b);
                } else {
                    c.op(0x04).op(0x7e);
                    c.get(ea).load64(8).op(0xa7).get(tmp).op(0xa7).i32c(0xfff).op(0x71).op(0x6a);
                    let (o, al) = match f3 { 0 => (0x30, 0), 1 => (0x32, 1), 2 => (0x34, 2), 3 => (0x29, 3), 4 => (0x31, 0), 5 => (0x33, 1), _ => (0x35, 2) };
                    c.op(o).op(al).op(0);
                    c.op(0x05);
                    c.get(0).get(tmp).i32c(f3 as i32).call(HELP_LD).set(val);
                    check(&mut c);
                    c.get(val);
                    c.op(0x0b);
                    setrd(&mut c);
                }
            }
            0x6f => {
                let imm = sext(((w >> 31) << 20 | (w >> 12 & 0xff) << 12 | (w >> 20 & 1) << 11 | (w >> 21 & 0x3ff) << 1) as u64, 21);
                c.i64c(next); setrd(&mut c);
                wb(&mut c);
                c.get(0).i64c(i.pc.wrapping_add(imm)).store64(OFF_PC);
                ended = true;
            }
            0x67 => {
                rget(&mut c, rs1); c.i64c(imm_i).op(0x7c).i64c(!1).op(0x83).set(tmp);
                c.i64c(next); setrd(&mut c);
                wb(&mut c);
                c.get(0).get(tmp).store64(OFF_PC);
                ended = true;
            }
            0x63 => {
                let imm = sext(((w >> 31) << 12 | (w >> 7 & 1) << 11 | (w >> 25 & 0x3f) << 5 | (w >> 8 & 15) << 1) as u64, 13);
                wb(&mut c);
                c.get(0).i64c(i.pc.wrapping_add(imm)).i64c(next);
                rget(&mut c, rs1); rget(&mut c, rs2);
                c.op(match f3 { 0 => 0x51, 1 => 0x52, 4 => 0x53, 5 => 0x59, 6 => 0x54, _ => 0x5a });
                c.op(0x1b).store64(OFF_PC);
                ended = true;
            }
            _ => unreachable!(),
        }
    }
    if !ended {
        // fell through (the next one is not translated, or the page or the length ended)
        wb(&mut c);
        let last = insns.last().unwrap();
        c.get(0).i64c(last.pc + last.len).store64(OFF_PC);
    }
    c.i32c(n as i32).op(0x0b);

    // the module
    let mut m = vec![0, b'a', b's', b'm', 1, 0, 0, 0];
    let sec = |m: &mut Vec<u8>, id: u8, body: Vec<u8>| { m.push(id); uleb(m, body.len() as u64); m.extend(body); };
    let (i32t, i64t) = (0x7f, 0x7e);
    let mut ty = vec![];
    uleb(&mut ty, 4);
    ty.extend([0x60, 1, i32t, 1, i32t]); // 0: block
    ty.extend([0x60, 3, i32t, i64t, i32t, 1, i64t]); // 1: ld
    ty.extend([0x60, 4, i32t, i64t, i64t, i32t, 0]); // 2: st
    ty.extend([0x60, 3, i64t, i64t, i32t, 1, i64t]); // 3: ar
    sec(&mut m, 1, ty);
    let mut im = vec![];
    uleb(&mut im, 4);
    let name = |v: &mut Vec<u8>, s: &str| { uleb(v, s.len() as u64); v.extend(s.as_bytes()); };
    name(&mut im, "env"); name(&mut im, "mem"); im.extend([2, 0, 1]);
    for (f, t) in [("ld", 1u8), ("st", 2), ("ar", 3)] { name(&mut im, "env"); name(&mut im, f); im.extend([0, t]); }
    sec(&mut m, 2, im);
    sec(&mut m, 3, vec![1, 0]);
    let mut ex = vec![1];
    name(&mut ex, "b");
    ex.extend([0, 3]);
    sec(&mut m, 7, ex);
    let mut body = vec![];
    // locals: 34 i64 (x1..x31, three temporaries), 2 i32 (fault, TLB entry)
    body.extend([2, 34, i64t, 2, i32t]);
    body.extend(c.c);
    let mut code = vec![1];
    uleb(&mut code, body.len() as u64);
    code.extend(body);
    sec(&mut m, 10, code);
    Some((m, n as u32))
}
