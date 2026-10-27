//! Code generation: the typed IR becomes a WebAssembly module.
//!
//! Memory: every signal is a run of little-endian 64-bit limbs (an array: its
//! elements one after the other), always canonical (bits above the width are 0).
//! Address 0 holds the $finish flag, 4 the write-queue pointer, 16 + 4k the mute
//! flag of stop signal k (non-zero: `run` ignores it); signals start at 64.
//!
//! - `settle()`: the combinational processes in dependency order, each once; a group
//!   that depends on itself (a combinational cycle between processes) repeats until
//!   its outputs stop changing.
//! - `posedge()`: the `always_ff` processes (one clock, rising edge), then `settle()`.
//!   Non-blocking assignment: a register that some `always_ff` also reads is written
//!   to its shadow copy (initialized from the register at the edge, copied back
//!   afterwards); an array element that some `always_ff` reads goes through a write
//!   queue. Everything else is written in place (nothing reads it during the edge).
//! - `run(n)`: up to `n` clock cycles; stops early (before the edge) when one of the
//!   stop signals is non-zero, and returns the number of cycles done.

use crate::ir::*;
use crate::wasm::{self, Func as WFunc, *};
use std::collections::{HashMap, HashSet};
use veryl_sim::sim::Proc;

type R<T> = Result<T, String>;
type V = Vec<u32>;

pub const FINISH: u32 = 0;
pub const QPTR: u32 = 4;
pub const MUTE: u32 = 16;
const BASE: u32 = 64;
const QUEUE_BYTES: u32 = 1 << 20;

pub struct Layout {
    pub off: Vec<u32>,
    /// limbs of one element
    pub nl: Vec<u32>,
    /// shadow offset of a deferred register
    pub shadow: Vec<Option<u32>>,
    /// arrays written through the queue
    pub queued: Vec<bool>,
    pub region: (u32, u32),
    pub shadow_base: u32,
    pub qbase: u32,
    pub qend: u32,
    pub scratch: u32,
    pub size: u32,
}

/// what the module holds, for the harness (JSON)
pub struct Output {
    pub wasm: Vec<u8>,
    pub json: String,
    pub stats: String,
}

struct Cg<'a> {
    lay: &'a Layout,
    lw: &'a Lower<'a>,
    f: WFunc,
    free: Vec<u32>,
    free32: Vec<u32>,
    /// inside an `always_ff` body (non-blocking writes)
    ff: bool,
    /// wasm index of user function i
    fbase: u32,
}

fn mask_bits(w: u32) -> u64 { if w >= 64 { u64::MAX } else { (1u64 << w) - 1 } }

impl<'a> Cg<'a> {
    fn new(lay: &'a Layout, lw: &'a Lower<'a>, ty: u32, ff: bool, fbase: u32) -> Self {
        Cg { lay, lw, f: WFunc::new(ty), free: vec![], free32: vec![], ff, fbase }
    }
    fn l64(&mut self) -> u32 { self.free.pop().unwrap_or_else(|| self.f.local(I64)) }
    fn l32(&mut self) -> u32 { self.free32.pop().unwrap_or_else(|| self.f.local(I32)) }
    fn rel(&mut self, v: V) { self.free.extend(v); }
    fn rel32(&mut self, l: u32) { self.free32.push(l); }
    fn konst(&mut self, x: u64) -> u32 { let l = self.l64(); self.f.i64c(x).local_set(l); l }
    fn zeros(&mut self, n: u32) -> V { (0..n).map(|_| self.konst(0)).collect() }
    fn copy(&mut self, v: &V) -> V { v.iter().map(|&s| { let l = self.l64(); self.f.local_get(s).local_set(l); l }).collect() }
    fn mask_top(&mut self, v: &V, w: u32) {
        let m = top_mask(w);
        if m != u64::MAX { let t = *v.last().unwrap(); self.f.local_get(t).i64c(m).op(I64_AND).local_set(t); }
    }
    /// i32 local: is any limb non-zero
    fn nonzero(&mut self, v: &V) -> u32 {
        let c = self.l32();
        self.f.local_get(v[0]);
        for &x in &v[1..] { self.f.local_get(x).op(I64_OR); }
        self.f.i64c(0).op(I64_NE).local_set(c);
        c
    }
    /// i64 local holding a shift amount / index: limb 0, or all ones if a higher limb is set
    fn amount(&mut self, v: &V) -> u32 {
        let a = self.l64();
        self.f.local_get(v[0]).local_set(a);
        if v.len() > 1 {
            // select(a, MAX, upper limbs all zero)
            self.f.local_get(a).i64c(u64::MAX);
            self.f.local_get(v[1]);
            for &x in &v[2..] { self.f.local_get(x).op(I64_OR); }
            self.f.op(I64_EQZ).op(SELECT).local_set(a);
        }
        a
    }

    fn resize(&mut self, v: V, from: u32, s: bool, to: u32) -> V {
        let (nf, nt) = (limbs(from), limbs(to));
        if to <= from {
            let mut v = v;
            let extra = v.split_off(nt as usize);
            self.rel(extra);
            self.mask_top(&v, to);
            return v;
        }
        let mut v = v;
        if s {
            // fill = 0 - sign bit
            let top = *v.last().unwrap();
            let fill = self.l64();
            self.f.i64c(0).local_get(top).i64c(((from - 1) % 64) as u64).op(I64_SHR_U).i64c(1).op(I64_AND).op(I64_SUB).local_set(fill);
            let m = top_mask(from);
            if m != u64::MAX { self.f.local_get(top).local_get(fill).i64c(!m).op(I64_AND).op(I64_OR).local_set(top); }
            for _ in nf..nt { let l = self.l64(); self.f.local_get(fill).local_set(l); v.push(l); }
            self.rel(vec![fill]);
        } else {
            for _ in nf..nt { let l = self.konst(0); v.push(l); }
        }
        self.mask_top(&v, to);
        v
    }

    /// the address of an array element (i32 local) and the in-range flag (i32 local)
    fn elem_addr(&mut self, sig: usize, idx: &E) -> R<(u32, u32)> {
        let iv = self.ex(idx)?;
        let a = self.amount(&iv);
        self.rel(iv);
        let n = self.lw.sigs[sig].arr.unwrap_or(1) as u64;
        let ok = self.l32();
        self.f.local_get(a).i64c(n).op(I64_LT_U).local_set(ok);
        let addr = self.l32();
        // out of range: element 0 (the read is discarded, the write skipped)
        self.f.local_get(a).op(I32_WRAP_I64).i32c((self.lay.nl[sig] * 8) as i32).op(I32_MUL).i32c(0).local_get(ok).op(SELECT).local_set(addr);
        self.rel(vec![a]);
        Ok((addr, ok))
    }

    fn load(&mut self, off: u32, n: u32, addr: Option<u32>) -> V {
        (0..n).map(|k| {
            let l = self.l64();
            match addr { Some(a) => self.f.local_get(a), None => self.f.i32c(0) };
            self.f.load64(off + 8 * k).local_set(l);
            l
        }).collect()
    }

    fn store(&mut self, off: u32, v: &V, addr: Option<u32>) {
        for (k, &x) in v.iter().enumerate() {
            match addr { Some(a) => self.f.local_get(a), None => self.f.i32c(0) };
            self.f.local_get(x).store64(off + 8 * k as u32);
        }
    }

    // ---- shifts ----
    fn shr_const(&mut self, v: &V, c: u64, fill: Option<u32>, nout: u32) -> V {
        let n = v.len();
        let (k, r) = ((c / 64) as usize, (c % 64) as u32);
        let src = |i: usize| -> Option<u32> { if i < n { Some(v[i]) } else { None } };
        (0..nout as usize).map(|i| {
            let o = self.l64();
            match (src(i + k), fill) { (Some(x), _) => { self.f.local_get(x); } (None, Some(f)) => { self.f.local_get(f); } (None, None) => { self.f.i64c(0); } }
            if r > 0 {
                self.f.i64c(r as u64).op(I64_SHR_U);
                match (src(i + k + 1), fill) { (Some(x), _) => { self.f.local_get(x); } (None, Some(f)) => { self.f.local_get(f); } (None, None) => { self.f.i64c(0); } }
                self.f.i64c(64 - r as u64).op(I64_SHL).op(I64_OR);
            }
            self.f.local_set(o);
            o
        }).collect()
    }

    fn shl_const(&mut self, v: &V, c: u64, nout: u32) -> V {
        let (k, r) = ((c / 64) as i64, (c % 64) as u32);
        (0..nout as i64).map(|i| {
            let o = self.l64();
            let a = i - k;
            if a >= 0 && (a as usize) < v.len() && c < 64 * nout as u64 { self.f.local_get(v[a as usize]); } else { self.f.i64c(0); }
            if r > 0 {
                self.f.i64c(r as u64).op(I64_SHL);
                let b = a - 1;
                if b >= 0 && (b as usize) < v.len() && c < 64 * nout as u64 { self.f.local_get(v[b as usize]).i64c(64 - r as u64).op(I64_SHR_U).op(I64_OR); }
            }
            self.f.local_set(o);
            o
        }).collect()
    }

    /// shift right by the amount in i64 local `amt` (any value); `fill` = the limb shifted in
    fn shr_dyn(&mut self, v: &V, amt: u32, fill: Option<u32>) -> V {
        let n = v.len();
        if n == 1 && fill.is_none() {
            let o = self.l64();
            self.f.local_get(v[0]).local_get(amt).op(I64_SHR_U).i64c(0).local_get(amt).i64c(64).op(I64_LT_U).op(SELECT).local_set(o);
            return vec![o];
        }
        let (k, r, ri, rz) = (self.l64(), self.l64(), self.l64(), self.l32());
        self.f.local_get(amt).i64c(6).op(I64_SHR_U).local_set(k);
        self.f.local_get(amt).i64c(63).op(I64_AND).local_set(r);
        self.f.i64c(64).local_get(r).op(I64_SUB).local_set(ri);
        self.f.local_get(r).op(I64_EQZ).local_set(rz);
        let get = |me: &mut Self, i: usize| { if i < n { me.f.local_get(v[i]); } else if let Some(f) = fill { me.f.local_get(f); } else { me.f.i64c(0); } };
        let out: V = (0..n).map(|i| {
            let o = self.l64();
            if let Some(f) = fill { self.f.local_get(f); } else { self.f.i64c(0); }
            self.f.local_set(o);
            for kk in (0..n).rev() {
                // candidate: (src[i+kk] >> r) | (r ? src[i+kk+1] << (64 - r) : 0)
                get(self, i + kk);
                self.f.local_get(r).op(I64_SHR_U);
                self.f.i64c(0);
                get(self, i + kk + 1);
                self.f.local_get(ri).op(I64_SHL).local_get(rz).op(SELECT).op(I64_OR);
                self.f.local_get(o).local_get(k).i64c(kk as u64).op(I64_EQ).op(SELECT).local_set(o);
            }
            o
        }).collect();
        self.rel(vec![k, r, ri]);
        self.rel32(rz);
        out
    }

    fn shl_dyn(&mut self, v: &V, amt: u32) -> V {
        let n = v.len();
        if n == 1 {
            let o = self.l64();
            self.f.local_get(v[0]).local_get(amt).op(I64_SHL).i64c(0).local_get(amt).i64c(64).op(I64_LT_U).op(SELECT).local_set(o);
            return vec![o];
        }
        let (k, r, ri, rz) = (self.l64(), self.l64(), self.l64(), self.l32());
        self.f.local_get(amt).i64c(6).op(I64_SHR_U).local_set(k);
        self.f.local_get(amt).i64c(63).op(I64_AND).local_set(r);
        self.f.i64c(64).local_get(r).op(I64_SUB).local_set(ri);
        self.f.local_get(r).op(I64_EQZ).local_set(rz);
        let out: V = (0..n).map(|i| {
            let o = self.konst(0);
            for kk in (0..n.min(i + 1)).rev() {
                // candidate: (src[i-kk] << r) | (r ? src[i-kk-1] >> (64 - r) : 0)
                self.f.local_get(v[i - kk]).local_get(r).op(I64_SHL);
                if i >= kk + 1 { self.f.i64c(0).local_get(v[i - kk - 1]).local_get(ri).op(I64_SHR_U).local_get(rz).op(SELECT).op(I64_OR); }
                self.f.local_get(o).local_get(k).i64c(kk as u64).op(I64_EQ).op(SELECT).local_set(o);
            }
            o
        }).collect();
        self.rel(vec![k, r, ri]);
        self.rel32(rz);
        out
    }

    /// sign-extended copy of a single-limb value of width w
    fn sext64(&mut self, x: u32, w: u32) -> u32 {
        let o = self.l64();
        if w >= 64 { self.f.local_get(x).local_set(o); } else {
            self.f.local_get(x).i64c(64 - w as u64).op(I64_SHL).i64c(64 - w as u64).op(I64_SHR_S).local_set(o);
        }
        o
    }

    // ---- expressions ----
    fn ex(&mut self, e: &E) -> R<V> {
        let w = e.w;
        let n = limbs(w);
        Ok(match &e.k {
            K::Const(l) => l.iter().map(|&x| self.konst(x)).collect(),
            K::Sig(s) => { let (off, nl) = (self.lay.off[*s], self.lay.nl[*s]); self.load(off, nl, None) }
            K::Elem(s, idx) => {
                let (addr, ok) = self.elem_addr(*s, idx)?;
                let v = self.load(self.lay.off[*s], self.lay.nl[*s], Some(addr));
                for &x in &v { self.f.local_get(x).i64c(0).local_get(ok).op(SELECT).local_set(x); }
                self.rel32(addr);
                self.rel32(ok);
                v
            }
            K::Bit(b, i) | K::Slice(b, i) => {
                let bv = self.ex(b)?;
                let r = if let Some(c) = i.const_u64() {
                    self.shr_const(&bv, c, None, n)
                } else {
                    let iv = self.ex(i)?;
                    let a = self.amount(&iv);
                    self.rel(iv);
                    let mut r = self.shr_dyn(&bv, a, None);
                    self.rel(vec![a]);
                    let extra = r.split_off((n as usize).min(r.len()));
                    self.rel(extra);
                    while r.len() < n as usize { let z = self.konst(0); r.push(z); }
                    r
                };
                self.rel(bv);
                self.mask_top(&r, w);
                r
            }
            K::Not(a) => {
                let v = self.ex(a)?;
                for (i, &x) in v.iter().enumerate() {
                    let m = if i + 1 == v.len() { top_mask(w) } else { u64::MAX };
                    self.f.local_get(x).i64c(m).op(I64_XOR).local_set(x);
                }
                v
            }
            K::Neg(a) => {
                let v = self.ex(a)?;
                let z = self.zeros(n);
                let r = self.sub(&z, &v);
                self.rel(z);
                self.rel(v);
                self.mask_top(&r, w);
                r
            }
            K::LNot(a) => {
                let v = self.ex(a)?;
                let c = self.nonzero(&v);
                self.rel(v);
                let o = self.l64();
                self.f.local_get(c).op(I32_EQZ).op(I64_EXTEND_I32_U).local_set(o);
                self.rel32(c);
                vec![o]
            }
            K::Red(op, inv, a) => {
                let v = self.ex(a)?;
                let aw = a.w;
                let o = self.l64();
                match op {
                    '&' => {
                        // all bits set: every limb equals its mask
                        for (i, &x) in v.iter().enumerate() {
                            let m = if i + 1 == v.len() { top_mask(aw) } else { u64::MAX };
                            self.f.local_get(x).i64c(m).op(I64_EQ);
                            if i > 0 { self.f.op(I32_AND); }
                        }
                        self.f.op(I64_EXTEND_I32_U).local_set(o);
                    }
                    '|' => {
                        let c = self.nonzero(&v);
                        self.f.local_get(c).op(I64_EXTEND_I32_U).local_set(o);
                        self.rel32(c);
                    }
                    _ => {
                        self.f.local_get(v[0]).op(I64_POPCNT);
                        for &x in &v[1..] { self.f.local_get(x).op(I64_POPCNT).op(I64_ADD); }
                        self.f.i64c(1).op(I64_AND).local_set(o);
                    }
                }
                if *inv { self.f.local_get(o).i64c(1).op(I64_XOR).local_set(o); }
                self.rel(v);
                vec![o]
            }
            K::Bin(op, a, b) => {
                let (va, vb) = (self.ex(a)?, self.ex(b)?);
                let r = match *op {
                    "&" | "|" | "^" | "~^" => {
                        let code = match *op { "&" => I64_AND, "|" => I64_OR, _ => I64_XOR };
                        for i in 0..va.len() { self.f.local_get(va[i]).local_get(vb[i]).op(code).local_set(va[i]); }
                        if *op == "~^" {
                            for (i, &x) in va.iter().enumerate() {
                                let m = if i + 1 == va.len() { top_mask(w) } else { u64::MAX };
                                self.f.local_get(x).i64c(m).op(I64_XOR).local_set(x);
                            }
                        }
                        self.rel(vb);
                        return Ok(va);
                    }
                    "+" => self.add(&va, &vb),
                    "-" => self.sub(&va, &vb),
                    "*" => {
                        if n > 1 { return Err(format!("multiplication wider than 64 bits ({} bits) is not supported", w)); }
                        let o = self.l64();
                        self.f.local_get(va[0]).local_get(vb[0]).op(I64_MUL).local_set(o);
                        vec![o]
                    }
                    _ => {
                        if n > 1 { return Err(format!("division wider than 64 bits ({} bits) is not supported", w)); }
                        vec![self.divrem(op, va[0], vb[0], w, e.s)]
                    }
                };
                self.rel(va);
                self.rel(vb);
                self.mask_top(&r, w);
                r
            }
            K::Cmp(op, sg, a, b) => {
                let (va, vb) = (self.ex(a)?, self.ex(b)?);
                let c = self.cmp(op, *sg, &va, &vb, a.w);
                self.rel(va);
                self.rel(vb);
                let o = self.l64();
                self.f.local_get(c).op(I64_EXTEND_I32_U).local_set(o);
                self.rel32(c);
                vec![o]
            }
            K::LAnd(a, b) | K::LOr(a, b) => {
                let va = self.ex(a)?;
                let ca = self.nonzero(&va);
                self.rel(va);
                let vb = self.ex(b)?;
                let cb = self.nonzero(&vb);
                self.rel(vb);
                let o = self.l64();
                self.f.local_get(ca).local_get(cb).op(if matches!(e.k, K::LAnd(..)) { I32_AND } else { I32_OR }).op(I64_EXTEND_I32_U).local_set(o);
                self.rel32(ca);
                self.rel32(cb);
                vec![o]
            }
            K::Shift(op, a, b) => {
                let va = self.ex(a)?;
                let r = if let Some(c) = b.const_u64() {
                    match *op {
                        "<<" => self.shl_const(&va, c, n),
                        ">>" => self.shr_const(&va, c, None, n),
                        _ => {
                            let sx = self.sign_fill(&va, w);
                            let f = self.fill_of(&sx);
                            let r = self.shr_const(&sx, c, Some(f), n);
                            self.rel(sx);
                            self.rel(vec![f]);
                            r
                        }
                    }
                } else {
                    let vb = self.ex(b)?;
                    let amt = self.amount(&vb);
                    self.rel(vb);
                    let r = match *op {
                        "<<" => self.shl_dyn(&va, amt),
                        ">>" => self.shr_dyn(&va, amt, None),
                        _ => {
                            let sx = self.sign_fill(&va, w);
                            let f = self.fill_of(&sx);
                            let r = if n == 1 {
                                // clamp the amount to 63 and shift the sign-extended value
                                let o = self.l64();
                                self.f.local_get(sx[0]).local_get(amt).i64c(63).local_get(amt).i64c(63).op(I64_LT_U).op(SELECT).op(I64_SHR_S).local_set(o);
                                vec![o]
                            } else { self.shr_dyn(&sx, amt, Some(f)) };
                            self.rel(sx);
                            self.rel(vec![f]);
                            r
                        }
                    };
                    self.rel(vec![amt]);
                    r
                };
                self.rel(va);
                self.mask_top(&r, w);
                r
            }
            K::Tern(c, a, b) => {
                let cv = self.ex(c)?;
                let cc = self.nonzero(&cv);
                self.rel(cv);
                let out: V = (0..n).map(|_| self.l64()).collect();
                self.f.local_get(cc).if_();
                self.rel32(cc);
                let va = self.ex(a)?;
                for i in 0..n as usize { self.f.local_get(va[i]).local_set(out[i]); }
                self.rel(va);
                self.f.else_();
                let vb = self.ex(b)?;
                for i in 0..n as usize { self.f.local_get(vb[i]).local_set(out[i]); }
                self.rel(vb);
                self.f.end();
                out
            }
            K::Concat(items) => {
                let res = self.zeros(n);
                let mut pos = w;
                for it in items {
                    pos -= it.w;
                    let iv = self.ex(it)?;
                    for (j, &x) in iv.iter().enumerate() {
                        let b = pos + 64 * j as u32;
                        if b >= w { break; }
                        let (t, sh) = ((b / 64) as usize, b % 64);
                        self.f.local_get(res[t]).local_get(x).i64c(sh as u64).op(I64_SHL).op(I64_OR).local_set(res[t]);
                        if sh > 0 && t + 1 < res.len() {
                            self.f.local_get(res[t + 1]).local_get(x).i64c(64 - sh as u64).op(I64_SHR_U).op(I64_OR).local_set(res[t + 1]);
                        }
                    }
                    self.rel(iv);
                }
                self.mask_top(&res, w);
                res
            }
            K::Resize(a) => {
                let v = self.ex(a)?;
                self.resize(v, a.w, a.s, w)
            }
            K::Call(fi, args) => {
                self.call_args(*fi, args)?;
                self.f.call(self.fbase + *fi as u32);
                let r = self.lw.funcs[*fi].ret;
                self.load(self.lay.off[r], self.lay.nl[r], None)
            }
        })
    }

    /// a copy sign-extended over all of its limbs (bits above w = the sign)
    fn sign_fill(&mut self, v: &V, w: u32) -> V {
        let c = self.copy(v);
        let top = *c.last().unwrap();
        let m = top_mask(w);
        if m != u64::MAX {
            let s = self.sext64(top, ((w - 1) % 64) + 1);
            self.f.local_get(s).local_set(top);
            self.rel(vec![s]);
        }
        c
    }
    /// all ones if the (sign-filled) value is negative, else 0
    fn fill_of(&mut self, sx: &V) -> u32 {
        let f = self.l64();
        self.f.local_get(*sx.last().unwrap()).i64c(63).op(I64_SHR_S).local_set(f);
        f
    }

    fn call_args(&mut self, fi: usize, args: &[E]) -> R<()> {
        let params = self.lw.funcs[fi].params.clone();
        let mut vals = vec![];
        for a in args { vals.push(self.ex(a)?); }
        for (i, v) in vals.into_iter().enumerate() {
            let p = params[i];
            let off = self.lay.off[p];
            self.store(off, &v, None);
            self.rel(v);
        }
        Ok(())
    }

    fn add(&mut self, a: &V, b: &V) -> V {
        let n = a.len();
        let out: V = (0..n).map(|_| self.l64()).collect();
        let c = self.l64();
        for i in 0..n {
            // t = a + b; c1 = t < a; s = t + c; c2 = s < t
            self.f.local_get(a[i]).local_get(b[i]).op(I64_ADD).local_set(out[i]);
            if i == 0 {
                if n > 1 { self.f.local_get(out[i]).local_get(a[i]).op(I64_LT_U).op(I64_EXTEND_I32_U).local_set(c); }
            } else {
                let t = self.l64();
                self.f.local_get(out[i]).local_get(a[i]).op(I64_LT_U).op(I64_EXTEND_I32_U).local_set(t);
                self.f.local_get(out[i]).local_get(c).op(I64_ADD).local_set(out[i]);
                self.f.local_get(out[i]).local_get(c).op(I64_LT_U).op(I64_EXTEND_I32_U).local_get(t).op(I64_OR).local_set(c);
                self.rel(vec![t]);
            }
        }
        self.rel(vec![c]);
        out
    }

    fn sub(&mut self, a: &V, b: &V) -> V {
        let n = a.len();
        let out: V = (0..n).map(|_| self.l64()).collect();
        let br = self.l64();
        for i in 0..n {
            self.f.local_get(a[i]).local_get(b[i]).op(I64_SUB).local_set(out[i]);
            if i == 0 {
                if n > 1 { self.f.local_get(a[i]).local_get(b[i]).op(I64_LT_U).op(I64_EXTEND_I32_U).local_set(br); }
            } else {
                // borrow out = a < b | (d < borrow_in), d = a - b
                let t = self.l64();
                self.f.local_get(a[i]).local_get(b[i]).op(I64_LT_U).op(I64_EXTEND_I32_U).local_set(t);
                self.f.local_get(out[i]).local_get(br).op(I64_LT_U).op(I64_EXTEND_I32_U).local_get(t).op(I64_OR);
                self.f.local_get(out[i]).local_get(br).op(I64_SUB).local_set(out[i]);
                self.f.local_set(br);
                self.rel(vec![t]);
            }
        }
        self.rel(vec![br]);
        out
    }

    /// / or % of single-limb values of width w (by zero: 0); signed on magnitudes
    fn divrem(&mut self, op: &str, a: u32, b: u32, w: u32, sg: bool) -> u32 {
        let o = self.l64();
        let rem = op == "%";
        if !sg {
            // select(0, a op (b == 0 ? 1 : b), b == 0)
            self.f.i64c(0).local_get(a).i64c(1).local_get(b).local_get(b).op(I64_EQZ).op(SELECT).op(if rem { I64_REM_U } else { I64_DIV_U });
            self.f.local_get(b).op(I64_EQZ).op(SELECT).local_set(o);
            return o;
        }
        let (sa, sb) = (self.sext64(a, w), self.sext64(b, w));
        let (ma, mb) = (self.l64(), self.l64());
        // |x| = (x ^ (x >> 63)) - (x >> 63)
        for (x, m) in [(sa, ma), (sb, mb)] {
            self.f.local_get(x).local_get(x).i64c(63).op(I64_SHR_S).op(I64_XOR).local_get(x).i64c(63).op(I64_SHR_S).op(I64_SUB).local_set(m);
        }
        let q = self.l64();
        self.f.local_get(ma).i64c(1).local_get(mb).local_get(mb).op(I64_EQZ).op(SELECT).op(if rem { I64_REM_U } else { I64_DIV_U }).local_set(q);
        // the sign: quotient negative when the signs differ, remainder takes the dividend's
        let neg = self.l64();
        if rem { self.f.local_get(sa).i64c(63).op(I64_SHR_S).local_set(neg); } else { self.f.local_get(sa).local_get(sb).op(I64_XOR).i64c(63).op(I64_SHR_S).local_set(neg); }
        self.f.i64c(0).local_get(q).local_get(neg).op(I64_XOR).local_get(neg).op(I64_SUB).local_get(mb).op(I64_EQZ).op(SELECT).local_set(o);
        self.rel(vec![sa, sb, ma, mb, q, neg]);
        o
    }

    /// i32 local: the comparison of two values of width w
    fn cmp(&mut self, op: &str, sg: bool, a: &V, b: &V, w: u32) -> u32 {
        let c = self.l32();
        let n = a.len();
        if op == "==" || op == "!=" {
            for i in 0..n {
                self.f.local_get(a[i]).local_get(b[i]).op(I64_EQ);
                if i > 0 { self.f.op(I32_AND); }
            }
            if op == "!=" { self.f.op(I32_EQZ); }
            self.f.local_set(c);
            return c;
        }
        // top limbs (sign-extended when signed), then the others unsigned
        let tw = ((w - 1) % 64) + 1;
        let (ta, tb) = if sg { (self.sext64(a[n - 1], tw), self.sext64(b[n - 1], tw)) } else { (a[n - 1], b[n - 1]) };
        let (lt, gt) = if sg { (I64_LT_S, I64_GT_S) } else { (I64_LT_U, I64_GT_U) };
        // r = result of the strict comparison a < b (or a > b), eq = all equal so far
        let strict = if op == "<" || op == "<=" { (lt, I64_LT_U) } else { (gt, I64_GT_U) };
        let (r, eq) = (self.l32(), self.l32());
        self.f.local_get(ta).local_get(tb).op(strict.0).local_set(r);
        self.f.local_get(ta).local_get(tb).op(I64_EQ).local_set(eq);
        for i in (0..n - 1).rev() {
            self.f.local_get(r).local_get(eq).local_get(a[i]).local_get(b[i]).op(strict.1).op(I32_AND).op(I32_OR).local_set(r);
            self.f.local_get(eq).local_get(a[i]).local_get(b[i]).op(I64_EQ).op(I32_AND).local_set(eq);
        }
        if op == "<=" || op == ">=" { self.f.local_get(r).local_get(eq).op(I32_OR).local_set(c); } else { self.f.local_get(r).local_set(c); }
        if sg { self.rel(vec![ta, tb]); }
        self.rel32(r);
        self.rel32(eq);
        c
    }

    // ---- statements ----
    fn stmts(&mut self, body: &[S]) -> R<()> {
        for s in body { self.stmt(s)?; }
        Ok(())
    }

    fn stmt(&mut self, s: &S) -> R<()> {
        match s {
            S::Assign(t, e) => self.assign(t, e)?,
            S::If(arms, els) => {
                let mut opened = 0;
                for (c, b) in arms {
                    let cv = self.ex(c)?;
                    let cc = self.nonzero(&cv);
                    self.rel(cv);
                    self.f.local_get(cc).if_();
                    self.rel32(cc);
                    self.stmts(b)?;
                    self.f.else_();
                    opened += 1;
                }
                self.stmts(els)?;
                for _ in 0..opened { self.f.end(); }
            }
            S::For { var, from, to, incl, body } => {
                let fv = self.ex(from)?;
                let tv = self.ex(to)?;
                let (i, t) = (self.l64(), self.l64());
                self.f.local_get(fv[0]).local_set(i);
                self.f.local_get(tv[0]).local_set(t);
                if *incl { self.f.local_get(t).i64c(1).op(I64_ADD).local_set(t); }
                self.rel(fv);
                self.rel(tv);
                let (off, nl, vw) = (self.lay.off[*var], self.lay.nl[*var], self.lw.sigs[*var].w);
                self.f.block().loop_();
                self.f.local_get(i).local_get(t).op(I64_LT_U).op(I32_EQZ).br_if(1);
                self.f.i32c(0).local_get(i).i64c(mask_bits(vw)).op(I64_AND).store64(off);
                for k in 1..nl { self.f.i32c(0).i64c(0).store64(off + 8 * k); }
                self.stmts(body)?;
                self.f.local_get(i).i64c(1).op(I64_ADD).local_set(i).br(0);
                self.f.end().end();
                self.rel(vec![i, t]);
            }
            S::Call(fi, args) => {
                self.call_args(*fi, args)?;
                self.f.call(self.fbase + *fi as u32);
            }
            S::Return(e) => {
                let v = self.ex(e)?;
                return Err(format!("internal: return outside a function body ({} bits)", v.len()));
            }
            S::Finish => { self.f.i32c(FINISH as i32).i32c(1).store32(0); }
        }
        Ok(())
    }

    fn assign(&mut self, t: &Target, e: &E) -> R<()> {
        match t {
            Target::Elem { sig, idx } => {
                let v = self.ex(e)?;
                let (addr, ok) = self.elem_addr(*sig, idx)?;
                let off = self.lay.off[*sig];
                self.f.local_get(ok).if_();
                if self.ff && self.lay.queued[*sig] {
                    // queue entry: [address, limbs, value...]
                    let p = self.l32();
                    self.f.i32c(0).load32(QPTR).local_set(p);
                    self.f.local_get(p).local_get(addr).i32c(off as i32).op(I32_ADD).store32(0);
                    self.f.local_get(p).i32c(v.len() as i32).store32(4);
                    for (k, &x) in v.iter().enumerate() { self.f.local_get(p).local_get(x).store64(8 + 8 * k as u32); }
                    self.f.i32c(0).local_get(p).i32c(8 + 8 * v.len() as i32).op(I32_ADD).store32(QPTR);
                    // overflow: trap
                    self.f.i32c(0).load32(QPTR).i32c(self.lay.qend as i32).op(I32_GE_U).if_().op(UNREACHABLE).end();
                    self.rel32(p);
                } else {
                    self.store(off, &v, Some(addr));
                }
                self.f.end();
                self.rel32(addr);
                self.rel32(ok);
                self.rel(v);
            }
            Target::Sig { sig, lo, w } => {
                let sig = *sig;
                let sw = self.lw.sigs[sig].w;
                let nl = self.lay.nl[sig];
                let off = if self.ff { self.lay.shadow[sig].unwrap_or(self.lay.off[sig]) } else { self.lay.off[sig] };
                let v = self.ex(e)?;
                if let Some(l) = lo.const_u64() {
                    if l == 0 && *w == sw { self.store(off, &v, None); self.rel(v); return Ok(()); }
                    if l + *w as u64 > sw as u64 { self.rel(v); return Ok(()); }
                    // read-modify-write of the limbs the field touches
                    let vx = self.resize(v, *w, false, sw);
                    let sv = self.shl_const(&vx, l, nl);
                    self.rel(vx);
                    for k in 0..nl {
                        let (b0, b1) = (64 * k as u64, 64 * k as u64 + 64);
                        let (f0, f1) = (l, l + *w as u64);
                        if f1 <= b0 || f0 >= b1 { continue; }
                        let (s0, s1) = (f0.max(b0) - b0, f1.min(b1) - b0);
                        let m = if s1 - s0 == 64 { u64::MAX } else { ((1u64 << (s1 - s0)) - 1) << s0 };
                        self.f.i32c(0).i32c(0).load64(off + 8 * k).i64c(!m).op(I64_AND).local_get(sv[k as usize]).i64c(m).op(I64_AND).op(I64_OR).store64(off + 8 * k);
                    }
                    self.rel(sv);
                    return Ok(());
                }
                // variable position: only when [lo, lo + w) lies inside the signal
                let lv = self.ex(lo)?;
                let a = self.amount(&lv);
                self.rel(lv);
                self.f.local_get(a).i64c((sw - *w) as u64).op(I64_LE_U).if_();
                let vx = self.resize(v, *w, false, sw);
                let sv = self.shl_dyn(&vx, a);
                self.rel(vx);
                let mut mk: V = vec![];
                for k in 0..nl {
                    let (b0, b1) = (64 * k, 64 * k + 64);
                    let m = if *w >= b1 { u64::MAX } else if *w <= b0 { 0 } else { (1u64 << (*w - b0)) - 1 };
                    let l = self.konst(m);
                    mk.push(l);
                }
                let sm = self.shl_dyn(&mk, a);
                self.rel(mk);
                for k in 0..nl as usize {
                    self.f.i32c(0).i32c(0).load64(off + 8 * k as u32).local_get(sm[k]).i64c(u64::MAX).op(I64_XOR).op(I64_AND).local_get(sv[k]).local_get(sm[k]).op(I64_AND).op(I64_OR).store64(off + 8 * k as u32);
                }
                self.f.end();
                self.rel(sv);
                self.rel(sm);
                self.rel(vec![a]);
            }
        }
        Ok(())
    }

    /// a user function body: `return` stores the value and leaves
    fn func_stmts(&mut self, body: &[S], ret: usize) -> R<()> {
        for s in body {
            match s {
                S::Return(e) => {
                    let v = self.ex(e)?;
                    let off = self.lay.off[ret];
                    self.store(off, &v, None);
                    self.rel(v);
                    self.f.ret();
                }
                S::If(arms, els) => {
                    let mut opened = 0;
                    for (c, b) in arms {
                        let cv = self.ex(c)?;
                        let cc = self.nonzero(&cv);
                        self.rel(cv);
                        self.f.local_get(cc).if_();
                        self.rel32(cc);
                        self.func_stmts(b, ret)?;
                        self.f.else_();
                        opened += 1;
                    }
                    self.func_stmts(els, ret)?;
                    for _ in 0..opened { self.f.end(); }
                }
                S::For { .. } if contains_return(std::slice::from_ref(s)) => {
                    return Err("return inside a for loop of a function is not supported".into());
                }
                _ => self.stmt(s)?,
            }
        }
        Ok(())
    }
}

fn contains_return(b: &[S]) -> bool {
    b.iter().any(|s| match s {
        S::Return(_) => true,
        S::If(a, e) => a.iter().any(|(_, x)| contains_return(x)) || contains_return(e),
        S::For { body, .. } => contains_return(body),
        _ => false,
    })
}

/// strongly connected components in dependency order (Tarjan, iterative)
fn sccs(n: usize, succ: &[Vec<usize>]) -> Vec<Vec<usize>> {
    let mut index = vec![usize::MAX; n];
    let mut low = vec![0; n];
    let mut on = vec![false; n];
    let mut st = vec![];
    let mut out = vec![];
    let mut next = 0;
    for root in 0..n {
        if index[root] != usize::MAX { continue; }
        let mut work = vec![(root, 0usize)];
        while let Some(&(v, i)) = work.last() {
            if i == 0 { index[v] = next; low[v] = next; next += 1; st.push(v); on[v] = true; }
            if i < succ[v].len() {
                work.last_mut().unwrap().1 += 1;
                let w = succ[v][i];
                if index[w] == usize::MAX { work.push((w, 0)); } else if on[w] { low[v] = low[v].min(index[w]); }
                continue;
            }
            work.pop();
            if let Some(&(p, _)) = work.last() { low[p] = low[p].min(low[v]); }
            if low[v] == index[v] {
                let mut c = vec![];
                loop { let w = st.pop().unwrap(); on[w] = false; c.push(w); if w == v { break; } }
                out.push(c);
            }
        }
    }
    out.reverse();
    out
}

/// Compile an elaborated design. `stops`: signal names that end `run(n)` early.
pub fn compile(sim: &veryl_sim::sim::Sim, procs: &[Proc], stops: &[String]) -> R<Output> {
    let lw = Lower::new(sim)?;
    let nsig = lw.sigs.len();
    // processes
    let mut combs: Vec<Vec<S>> = vec![];
    for p in procs { if let Proc::Comb(b) = p { combs.push(lw.stmts(b, None)?); } }
    // a clock reaches an instance through port connections (`child.clk = clk`): follow them
    let mut alias: HashMap<usize, usize> = HashMap::new();
    for b in &combs {
        if let [S::Assign(Target::Sig { sig, lo, w }, E { k: K::Sig(src), w: sw, .. })] = b.as_slice() {
            if lo.const_u64() == Some(0) && w == sw { alias.insert(*sig, *src); }
        }
    }
    let root = |mut s: usize| { let mut n = 0; while let Some(&t) = alias.get(&s) { s = t; n += 1; if n > 100 { break; } } s };
    let mut ffs: Vec<Vec<S>> = vec![];
    let mut clock: Option<(usize, bool)> = None;
    for p in procs {
        if let Proc::Ff { clk, pos, body, .. } = p {
            let c = (root(*clk), *pos);
            match clock {
                None => clock = Some(c),
                Some(k) if k == c => {}
                Some(k) => return Err(format!("more than one clock (or clock edge) is not supported yet: {} and {}", lw.sigs[k.0].name, lw.sigs[c.0].name)),
            }
            ffs.push(lw.stmts(body, None)?);
        }
    }
    // signals only functions use, loop variables: not part of the process graph
    let mut internal: HashSet<usize> = HashSet::new();
    for f in &lw.funcs {
        internal.extend(f.params.iter().copied());
        internal.insert(f.ret);
        let (mut r, mut w) = (vec![], vec![]);
        rw_s(&f.body, &mut r, &mut w, &lw.funcs);
        internal.extend(w);
    }
    fn for_vars(b: &[S], out: &mut HashSet<usize>) {
        for s in b {
            match s {
                S::For { var, body, .. } => { out.insert(*var); for_vars(body, out); }
                S::If(a, e) => { for (_, x) in a { for_vars(x, out); } for_vars(e, out); }
                _ => {}
            }
        }
    }
    for b in combs.iter().chain(&ffs) { for_vars(b, &mut internal); }
    for f in &lw.funcs { for_vars(&f.body, &mut internal); }

    // registers: written by always_ff; deferred if an always_ff also reads them
    let (mut ff_reads, mut ff_writes) = (HashSet::new(), HashSet::new());
    for b in &ffs {
        let (mut r, mut w) = (vec![], vec![]);
        rw_s(b, &mut r, &mut w, &lw.funcs);
        ff_reads.extend(r);
        ff_writes.extend(w.into_iter().filter(|s| !internal.contains(s)));
    }
    // a function called from always_ff reads its own signals only, but its arguments count as reads (above)
    let deferred: HashSet<usize> = ff_writes.iter().copied().filter(|s| ff_reads.contains(s)).collect();

    // layout: deferred registers first (one region, copied to / from the shadow), then the rest
    let mut lay = Layout { off: vec![0; nsig], nl: vec![0; nsig], shadow: vec![None; nsig], queued: vec![false; nsig], region: (0, 0), shadow_base: 0, qbase: 0, qend: 0, scratch: 0, size: 0 };
    let mut at = BASE;
    let mut order: Vec<usize> = (0..nsig).filter(|s| deferred.contains(s) && lw.sigs[*s].arr.is_none()).collect();
    let rest: Vec<usize> = (0..nsig).filter(|s| !(deferred.contains(s) && lw.sigs[*s].arr.is_none())).collect();
    order.sort();
    let region_start = at;
    for &s in &order { lay.off[s] = at; lay.nl[s] = limbs(lw.sigs[s].w); at += 8 * lay.nl[s]; }
    let region_end = at;
    for &s in &rest {
        lay.nl[s] = limbs(lw.sigs[s].w);
        lay.off[s] = at;
        at += 8 * lay.nl[s] * lw.sigs[s].arr.unwrap_or(1);
    }
    lay.region = (region_start, region_end);
    lay.shadow_base = at;
    for &s in &order { lay.shadow[s] = Some(lay.shadow_base + (lay.off[s] - region_start)); }
    at += region_end - region_start;
    for s in 0..nsig { if lw.sigs[s].arr.is_some() && deferred.contains(&s) { lay.queued[s] = true; } }
    lay.qbase = at;
    lay.qend = at + QUEUE_BYTES - 1024;
    at += QUEUE_BYTES;
    lay.scratch = at;

    // the combinational processes in dependency order
    let n = combs.len();
    let mut rw: Vec<(Vec<usize>, Vec<usize>)> = vec![];
    let mut writers: HashMap<usize, Vec<usize>> = HashMap::new();
    for (i, b) in combs.iter().enumerate() {
        let (mut r, mut w) = (vec![], vec![]);
        rw_s(b, &mut r, &mut w, &lw.funcs);
        r.retain(|s| !internal.contains(s));
        w.retain(|s| !internal.contains(s));
        r.sort(); r.dedup(); w.sort(); w.dedup();
        for &s in &w { writers.entry(s).or_default().push(i); }
        rw.push((r, w));
    }
    let mut succ: Vec<Vec<usize>> = vec![vec![]; n];
    for (i, (r, _)) in rw.iter().enumerate() {
        for s in r {
            if let Some(ws) = writers.get(s) { for &p in ws { if p != i { succ[p].push(i); } } }
        }
    }
    for s in succ.iter_mut() { s.sort(); s.dedup(); }
    let groups = sccs(n, &succ);
    let cyclic = groups.iter().filter(|g| g.len() > 1).count();
    // scratch for the cycle check: the largest written set of a cyclic group
    let mut scratch_need = 0u32;
    for g in groups.iter().filter(|g| g.len() > 1) {
        let mut sz = 0;
        let mut seen = HashSet::new();
        for &p in g { for &s in &rw[p].1 { if lw.sigs[s].arr.is_none() && seen.insert(s) { sz += 8 * lay.nl[s]; } } }
        scratch_need = scratch_need.max(sz);
    }
    at += scratch_need + 64;
    lay.size = at;

    // ---- functions ----
    // wasm function indices: user functions, then process chunks, then settle / posedge / run
    let mut wf: Vec<WFunc> = vec![];
    for (i, f) in lw.funcs.iter().enumerate() {
        let mut cg = Cg::new(&lay, &lw, wasm::T_VOID, false, 0);
        cg.func_stmts(&f.body, f.ret).map_err(|e| format!("function {}: {}", f.name, e))?;
        let _ = i;
        wf.push(cg.f);
    }
    // combinational chunks: consecutive acyclic processes share a function
    const CHUNK: usize = 60_000;
    let mut settle_plan: Vec<Result<u32, Vec<u32>>> = vec![]; // Ok(chunk) or Err(chunks of a cyclic group)
    let mut cur: Option<Cg> = None;
    let flush = |cur: &mut Option<Cg>, wf: &mut Vec<WFunc>| -> Option<u32> {
        cur.take().map(|cg| { wf.push(cg.f); wf.len() as u32 - 1 })
    };
    for g in &groups {
        if g.len() == 1 {
            let c = cur.get_or_insert_with(|| Cg::new(&lay, &lw, wasm::T_VOID, false, 0));
            c.stmts(&combs[g[0]]).map_err(|e| format!("combinational process: {}", e))?;
            if c.f.code.len() > CHUNK { if let Some(i) = flush(&mut cur, &mut wf) { settle_plan.push(Ok(i)); } }
        } else {
            if let Some(i) = flush(&mut cur, &mut wf) { settle_plan.push(Ok(i)); }
            let mut parts = vec![];
            let mut cg = Cg::new(&lay, &lw, wasm::T_VOID, false, 0);
            for &p in g { cg.stmts(&combs[p]).map_err(|e| format!("combinational process: {}", e))?; }
            wf.push(cg.f);
            parts.push(wf.len() as u32 - 1);
            settle_plan.push(Err(parts));
        }
    }
    if let Some(i) = flush(&mut cur, &mut wf) { settle_plan.push(Ok(i)); }
    // always_ff bodies
    let mut ff_funcs = vec![];
    let mut cur_ff: Option<Cg> = None;
    for b in &ffs {
        let c = cur_ff.get_or_insert_with(|| Cg::new(&lay, &lw, wasm::T_VOID, true, 0));
        c.stmts(b).map_err(|e| format!("always_ff: {}", e))?;
        if c.f.code.len() > CHUNK { wf.push(cur_ff.take().unwrap().f); ff_funcs.push(wf.len() as u32 - 1); }
    }
    if let Some(c) = cur_ff.take() { wf.push(c.f); ff_funcs.push(wf.len() as u32 - 1); }

    // settle
    let groups_cyclic: Vec<&Vec<usize>> = groups.iter().filter(|g| g.len() > 1).collect();
    let mut settle = WFunc::new(wasm::T_VOID);
    let mut gi = 0;
    for step in &settle_plan {
        match step {
            Ok(i) => { settle.call(*i); }
            Err(parts) => {
                // repeat until the group's outputs stop changing (at most 100 times)
                let g = groups_cyclic[gi];
                gi += 1;
                let mut outs: Vec<usize> = vec![];
                for &p in g.iter() { for &s in &rw[p].1 { if lw.sigs[s].arr.is_none() && !outs.contains(&s) { outs.push(s); } } }
                let (cnt, ch) = (settle.local(I32), settle.local(I32));
                settle.i32c(100).local_set(cnt);
                settle.loop_();
                let mut so = lay.scratch;
                for &s in &outs { for k in 0..lay.nl[s] { settle.i32c(0).i32c(0).load64(lay.off[s] + 8 * k).store64(so); so += 8; } }
                for &i in parts { settle.call(i); }
                settle.i32c(0).local_set(ch);
                let mut so = lay.scratch;
                for &s in &outs { for k in 0..lay.nl[s] { settle.local_get(ch).i32c(0).load64(lay.off[s] + 8 * k).i32c(0).load64(so).op(I64_NE).op(I32_OR).local_set(ch); so += 8; } }
                settle.local_get(cnt).i32c(1).op(I32_SUB).local_tee(cnt).i32c(0).op(I32_NE).local_get(ch).op(I32_AND).br_if(0);
                settle.end();
            }
        }
    }
    wf.push(settle);
    let settle_i = wf.len() as u32 - 1;

    // posedge
    let mut pe = WFunc::new(wasm::T_VOID);
    let rlen = lay.region.1 - lay.region.0;
    if rlen > 0 { pe.i32c(lay.shadow_base as i32).i32c(lay.region.0 as i32).i32c(rlen as i32).memcopy(); }
    pe.i32c(0).i32c(lay.qbase as i32).store32(QPTR);
    for &i in &ff_funcs { pe.call(i); }
    if rlen > 0 { pe.i32c(lay.region.0 as i32).i32c(lay.shadow_base as i32).i32c(rlen as i32).memcopy(); }
    // the write queue
    if lay.queued.iter().any(|q| *q) {
        let p = pe.local(I32);
        pe.i32c(lay.qbase as i32).local_set(p);
        pe.block().loop_();
        pe.local_get(p).i32c(0).load32(QPTR).op(I32_GE_U).br_if(1);
        // memory.copy(dst = entry address, src = p + 8, len = 8 * limbs)
        pe.local_get(p).load32(0).local_get(p).i32c(8).op(I32_ADD).local_get(p).load32(4).i32c(8).op(I32_MUL).memcopy();
        pe.local_get(p).local_get(p).load32(4).i32c(8).op(I32_MUL).i32c(8).op(I32_ADD).op(I32_ADD).local_set(p);
        pe.br(0).end().end();
    }
    pe.call(settle_i);
    wf.push(pe);
    let posedge_i = wf.len() as u32 - 1;

    // run(n): cycles until a stop signal is set (checked before each edge)
    if stops.len() > ((BASE - MUTE) / 4) as usize { return Err(format!("at most {} stop signals", (BASE - MUTE) / 4)); }
    let mut stop_sigs = vec![];
    for s in stops {
        let i = lw.sigs.iter().position(|x| x.name == *s).ok_or(format!("stop signal '{}' not found", s))?;
        stop_sigs.push(i);
    }
    let mut run = WFunc::new(wasm::T_I32_I32);
    let i = run.local(I32);
    run.i32c(0).local_set(i);
    run.block().loop_();
    run.local_get(i).local_get(0).op(I32_GE_U).br_if(1);
    for (j, &s) in stop_sigs.iter().enumerate() {
        for k in 0..lay.nl[s] {
            run.i32c(0).load64(lay.off[s] + 8 * k).i64c(0).op(I64_NE).i32c(0).load32(MUTE + 4 * j as u32).op(I32_EQZ).op(I32_AND).if_().local_get(i).ret().end();
        }
    }
    run.i32c(0).load32(FINISH).if_().local_get(i).ret().end();
    run.call(posedge_i);
    run.local_get(i).i32c(1).op(I32_ADD).local_set(i).br(0);
    run.end().end();
    run.local_get(i);
    wf.push(run);
    let run_i = wf.len() as u32 - 1;

    let pages = lay.size.div_ceil(65536) + 1;
    let exports = vec![("settle".to_string(), settle_i), ("posedge".to_string(), posedge_i), ("run".to_string(), run_i)];
    let bytes = wasm::module(pages, &wf, &exports);

    // metadata for the harness
    let stops_json: Vec<String> = stops.iter().enumerate().map(|(j, s)| format!("\"{}\": {}", s, MUTE + 4 * j as u32)).collect();
    let mut json = format!("{{\n  \"finish\": 0,\n  \"mute\": {{{}}},\n  \"signals\": {{\n", stops_json.join(", "));
    let mut first = true;
    for (i, s) in lw.sigs.iter().enumerate() {
        if s.name.contains('$') { continue; }
        if !first { json.push_str(",\n"); }
        first = false;
        json.push_str(&format!("    \"{}\": {{\"off\": {}, \"w\": {}, \"limbs\": {}, \"arr\": {}}}", s.name.replace('"', "\\\""), lay.off[i], s.w, lay.nl[i], s.arr.unwrap_or(0)));
    }
    json.push_str("\n  }\n}\n");
    let code: usize = wf.iter().map(|f| f.code.len()).sum();
    let stats = format!("{} signals, {} combinational processes ({} cyclic groups), {} always_ff, {} functions; {} registers deferred ({} bytes), {} queued arrays; {} KB of code, {} MB of memory",
        nsig, n, cyclic, ffs.len(), lw.funcs.len(), order.len(), rlen, lay.queued.iter().filter(|q| **q).count(), code / 1024, (pages as u64 * 65536) >> 20);
    Ok(Output { wasm: bytes, json, stats })
}
