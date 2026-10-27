//! A minimal WebAssembly binary writer: one memory (exported as "mem"), functions
//! of type `() -> ()` or `(i32) -> i32`, exports, and the instructions the code
//! generator uses (i64 arithmetic on locals, loads / stores at constant offsets,
//! structured control flow, `memory.copy`).

pub const I32: u8 = 0x7f;
pub const I64: u8 = 0x7e;

/// function types: 0 = () -> (), 1 = (i32) -> i32
pub const T_VOID: u32 = 0;
pub const T_I32_I32: u32 = 1;

pub fn uleb(out: &mut Vec<u8>, mut v: u64) {
    loop {
        let b = (v & 0x7f) as u8;
        v >>= 7;
        if v == 0 { out.push(b); return; }
        out.push(b | 0x80);
    }
}

pub fn sleb(out: &mut Vec<u8>, mut v: i64) {
    loop {
        let b = (v & 0x7f) as u8;
        v >>= 7;
        if (v == 0 && b & 0x40 == 0) || (v == -1 && b & 0x40 != 0) { out.push(b); return; }
        out.push(b | 0x80);
    }
}

/// the body of one function: its extra locals (after the parameters) and its code
pub struct Func {
    pub ty: u32,
    pub params: u32,
    pub locals: Vec<u8>,
    pub code: Vec<u8>,
}

impl Func {
    pub fn new(ty: u32) -> Self { Func { ty, params: if ty == T_I32_I32 { 1 } else { 0 }, locals: vec![], code: vec![] } }
    /// a new local of type `t`; returns its index
    pub fn local(&mut self, t: u8) -> u32 { self.locals.push(t); self.params + self.locals.len() as u32 - 1 }
    pub fn op(&mut self, b: u8) -> &mut Self { self.code.push(b); self }
    pub fn u(&mut self, v: u64) -> &mut Self { uleb(&mut self.code, v); self }
    pub fn local_get(&mut self, l: u32) -> &mut Self { self.op(0x20).u(l as u64) }
    pub fn local_set(&mut self, l: u32) -> &mut Self { self.op(0x21).u(l as u64) }
    pub fn local_tee(&mut self, l: u32) -> &mut Self { self.op(0x22).u(l as u64) }
    pub fn i32c(&mut self, v: i32) -> &mut Self { self.code.push(0x41); sleb(&mut self.code, v as i64); self }
    pub fn i64c(&mut self, v: u64) -> &mut Self { self.code.push(0x42); sleb(&mut self.code, v as i64); self }
    /// i64.load with the address on the stack plus `off`
    pub fn load64(&mut self, off: u32) -> &mut Self { self.op(0x29).u(3).u(off as u64) }
    pub fn store64(&mut self, off: u32) -> &mut Self { self.op(0x37).u(3).u(off as u64) }
    pub fn load32(&mut self, off: u32) -> &mut Self { self.op(0x28).u(2).u(off as u64) }
    pub fn store32(&mut self, off: u32) -> &mut Self { self.op(0x36).u(2).u(off as u64) }
    pub fn call(&mut self, f: u32) -> &mut Self { self.op(0x10).u(f as u64) }
    pub fn block(&mut self) -> &mut Self { self.op(0x02).op(0x40) }
    pub fn loop_(&mut self) -> &mut Self { self.op(0x03).op(0x40) }
    pub fn if_(&mut self) -> &mut Self { self.op(0x04).op(0x40) }
    pub fn else_(&mut self) -> &mut Self { self.op(0x05) }
    pub fn end(&mut self) -> &mut Self { self.op(0x0b) }
    pub fn br(&mut self, d: u32) -> &mut Self { self.op(0x0c).u(d as u64) }
    pub fn br_if(&mut self, d: u32) -> &mut Self { self.op(0x0d).u(d as u64) }
    pub fn ret(&mut self) -> &mut Self { self.op(0x0f) }
    /// memory.copy (dst, src, len on the stack)
    pub fn memcopy(&mut self) -> &mut Self { self.op(0xfc).u(10).op(0).op(0) }

    fn encode(&self) -> Vec<u8> {
        let mut body = vec![];
        // locals as runs of the same type
        let mut runs: Vec<(u32, u8)> = vec![];
        for &t in &self.locals {
            match runs.last_mut() { Some((n, tt)) if *tt == t => *n += 1, _ => runs.push((1, t)) }
        }
        uleb(&mut body, runs.len() as u64);
        for (n, t) in runs { uleb(&mut body, n as u64); body.push(t); }
        body.extend_from_slice(&self.code);
        body.push(0x0b);
        let mut out = vec![];
        uleb(&mut out, body.len() as u64);
        out.extend(body);
        out
    }
}

// i64 opcodes
pub const I64_EQZ: u8 = 0x50;
pub const I64_EQ: u8 = 0x51;
pub const I64_NE: u8 = 0x52;
pub const I64_LT_S: u8 = 0x53;
pub const I64_LT_U: u8 = 0x54;
pub const I64_GT_S: u8 = 0x55;
pub const I64_GT_U: u8 = 0x56;
pub const I64_LE_S: u8 = 0x57;
pub const I64_LE_U: u8 = 0x58;
pub const I64_GE_S: u8 = 0x59;
pub const I64_GE_U: u8 = 0x5a;
pub const I64_POPCNT: u8 = 0x7b;
pub const I64_ADD: u8 = 0x7c;
pub const I64_SUB: u8 = 0x7d;
pub const I64_MUL: u8 = 0x7e;
pub const I64_DIV_U: u8 = 0x80;
pub const I64_REM_U: u8 = 0x82;
pub const I64_AND: u8 = 0x83;
pub const I64_OR: u8 = 0x84;
pub const I64_XOR: u8 = 0x85;
pub const I64_SHL: u8 = 0x86;
pub const I64_SHR_S: u8 = 0x87;
pub const I64_SHR_U: u8 = 0x88;
// i32
pub const I32_EQZ: u8 = 0x45;
pub const I32_EQ: u8 = 0x46;
pub const I32_NE: u8 = 0x47;
pub const I32_LT_U: u8 = 0x49;
pub const I32_GE_U: u8 = 0x4f;
pub const I32_ADD: u8 = 0x6a;
pub const I32_SUB: u8 = 0x6b;
pub const I32_MUL: u8 = 0x6c;
pub const I32_AND: u8 = 0x71;
pub const I32_OR: u8 = 0x72;
pub const I32_WRAP_I64: u8 = 0xa7;
pub const I64_EXTEND_I32_U: u8 = 0xad;
pub const SELECT: u8 = 0x1b;
pub const DROP: u8 = 0x1a;
pub const UNREACHABLE: u8 = 0x00;

/// A whole module: memory of `pages` 64 KB pages, the functions, the exports
pub fn module(pages: u32, funcs: &[Func], exports: &[(String, u32)]) -> Vec<u8> {
    let mut m = b"\0asm\x01\0\0\0".to_vec();
    let section = |m: &mut Vec<u8>, id: u8, body: Vec<u8>| { m.push(id); uleb(m, body.len() as u64); m.extend(body); };
    // types
    let mut t = vec![];
    uleb(&mut t, 2);
    t.extend([0x60, 0, 0]);
    t.extend([0x60, 1, I32, 1, I32]);
    section(&mut m, 1, t);
    // functions
    let mut f = vec![];
    uleb(&mut f, funcs.len() as u64);
    for fu in funcs { uleb(&mut f, fu.ty as u64); }
    section(&mut m, 3, f);
    // memory
    let mut me = vec![];
    uleb(&mut me, 1);
    me.push(0);
    uleb(&mut me, pages as u64);
    section(&mut m, 5, me);
    // exports
    let mut ex = vec![];
    uleb(&mut ex, exports.len() as u64 + 1);
    let name = |ex: &mut Vec<u8>, s: &str| { uleb(ex, s.len() as u64); ex.extend(s.as_bytes()); };
    name(&mut ex, "mem");
    ex.push(2);
    uleb(&mut ex, 0);
    for (n, i) in exports {
        name(&mut ex, n);
        ex.push(0);
        uleb(&mut ex, *i as u64);
    }
    section(&mut m, 7, ex);
    // code
    let mut c = vec![];
    uleb(&mut c, funcs.len() as u64);
    for fu in funcs { c.extend(fu.encode()); }
    section(&mut m, 10, c);
    m
}
