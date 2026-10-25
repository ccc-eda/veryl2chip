//! Simulation kernel: evaluation, statement execution, scheduler, VCD.

use crate::expr::*;
use crate::value::*;
use std::cell::{Cell, RefCell};
use std::cmp::Reverse;
use std::collections::BinaryHeap;
use std::collections::HashMap;
use std::io::Write;

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Kind {
    Normal,
    Clock(bool), // true = posedge
    Reset { low: bool, asynch: bool },
}

pub struct Signal {
    pub name: String,
    pub w: u32,
    pub signed: bool,
    pub kind: Kind,
    pub val: Val,
    /// for arrays: number of elements (this signal is element 0, elements are
    /// the following `n` signals, each with width `w`)
    pub arr: Option<u32>,
    /// for structs: (field name, bit offset, width)
    pub fields: Vec<(String, u32, u32)>,
}

#[derive(Clone, Debug)]
pub enum CaseArm {
    V(Expr),
    R(Expr, Expr, bool), // lo, hi, inclusive
}

#[derive(Clone, Debug)]
pub enum Stmt {
    Assign(LValue, Expr),
    If(Vec<(Expr, Vec<Stmt>)>, Vec<Stmt>),
    Case(Expr, Vec<(Vec<CaseArm>, Vec<Stmt>)>, Vec<Stmt>),
    Switch(Vec<(Vec<Expr>, Vec<Stmt>)>, Vec<Stmt>),
    For { var: usize, from: Expr, to: Expr, incl: bool, body: Vec<Stmt> },
    Call(String, Vec<Expr>),
    Return(Expr),
    Wait(usize, Expr), // only legal in `initial`
}

pub struct FuncDef {
    pub params: Vec<usize>,
    pub ret: Option<usize>,
    pub body: Vec<Stmt>,
}

pub enum Proc {
    Comb(Vec<Stmt>),
    Ff { clk: usize, pos: bool, rst: Option<(usize, bool, bool)>, body: Vec<Stmt> }, // rst = (sig, low, async)
    ClockGen { sig: usize, half: u64 },
}

#[derive(Clone)]
pub enum Op {
    Exec(Stmt),
    Wait(usize, Expr),
    Jmp(usize),
    JmpIfNot(Expr, usize),
}

#[derive(Default)]
pub struct InitState {
    pub ops: Vec<Op>,
    pub pc: usize,
    pub wait: Option<(usize, u128)>,
    pub done: bool,
}

pub struct Sim {
    pub sigs: Vec<Signal>,
    pub funcs: HashMap<String, FuncDef>,
    pub time: u64,
    pub changed: bool,
    pub nba: Vec<(usize, u32, u32, Val)>,
    pub finished: bool,
    pub fails: u32,
    pub rng: Cell<u64>,
    /// return value / abort flag of the innermost user-function frame
    pub ret_val: Option<Val>,
    pub ret_now: bool,
    pub in_call: Vec<String>,
    /// everything the simulation prints ($display, assertions, warnings)
    pub log: RefCell<String>,
    /// also print it to stdout as it happens (command line)
    pub echo: bool,
}

fn bitv(v: &Val) -> u8 {
    if v.x.bit(0) { 2 } else { v.v.bit(0) as u8 }
}

impl Sim {
    /// print a line (or a fragment when `nl` is false) to the simulation log
    pub fn say(&self, s: &str, nl: bool) {
        if self.echo { if nl { println!("{}", s); } else { print!("{}", s); } }
        let mut l = self.log.borrow_mut();
        l.push_str(s);
        if nl { l.push('\n'); }
    }

    pub fn new() -> Self {
        Sim { sigs: vec![], funcs: HashMap::new(), time: 0, changed: false, nba: vec![], finished: false, fails: 0, rng: Cell::new(0x2545F4914F6CDD1D), ret_val: None, ret_now: false, in_call: vec![], log: RefCell::new(String::new()), echo: false }
    }

    // ---------- expression evaluation ----------
    pub fn eval(&mut self, e: &Expr, ctx: u32) -> Val {
        match e {
            Expr::Num(v) => *v,
            Expr::AllBit(b) => {
                let w = ctx.max(1);
                match b { 0 => Val::new(w, 0), 1 => Val::of(w, mask(w)), _ => Val::allx(w) }
            }
            Expr::Str(s) => {
                let mut v = 0u128;
                for b in s.bytes().take(16) { v = (v << 8) | b as u128; }
                Val::new((s.len().clamp(1, 16) * 8) as u32, v)
            }
            Expr::Sig(i) => self.sigs[*i].val,
            Expr::Elem(base, idx) => {
                let n = self.sigs[*base].arr.unwrap_or(1);
                let idx = self.eval(idx, 0);
                if idx.x != 0u128 || idx.v >= n as u128 { return Val::allx(self.sigs[*base].w); }
                self.sigs[*base + idx.v.sat() as usize].val
            }
            Expr::Index(b, i) => {
                let base = self.eval(b, 0);
                let idx = self.eval(i, 0);
                if idx.x != 0u128 || idx.v >= base.w as u128 { return Val::allx(1); }
                let k = idx.v.sat() as u32;
                Val { w: 1, v: (base.v >> k) & 1, x: (base.x >> k) & 1, s: false }
            }
            Expr::Slice(b, a, c, kind) => {
                let base = self.eval(b, 0);
                let (lo, w) = match kind {
                    0 => {
                        let (hi, lo) = (self.eval(a, 0), self.eval(c, 0));
                        if hi.x != 0u128 || lo.x != 0u128 || hi.v < lo.v { return Val::allx(1); }
                        (lo.v.sat() as u32, (hi.v.sat() - lo.v.sat() + 1) as u32)
                    }
                    1 => {
                        let (bs, w) = (self.eval(a, 0), self.eval(c, 0));
                        if bs.x != 0u128 || w.x != 0u128 { return Val::allx(w.v.sat().max(1) as u32); }
                        (bs.v.sat() as u32, w.v.sat() as u32)
                    }
                    _ => {
                        let (bs, w) = (self.eval(a, 0), self.eval(c, 0));
                        let (b, n) = (bs.v.sat(), w.v.sat());
                        if bs.x != 0u128 || w.x != 0u128 || b + 1 < n { return Val::allx(n.max(1) as u32); }
                        ((b + 1 - n) as u32, n as u32)
                    }
                };
                if lo >= MAXW { return Val::allx(w); }
                let w = w.clamp(1, MAXW);
                Val { w, v: (base.v >> lo) & mask(w), x: (base.x >> lo) & mask(w), s: false }
            }
            Expr::Concat(items) => {
                let (mut v, mut x, mut w) = (Bits::ZERO, Bits::ZERO, 0u32);
                for (cnt, it) in items {
                    let c = self.eval(cnt, 0).v.sat() as u32;
                    let iv = self.eval(it, 0);
                    for _ in 0..c {
                        if w + iv.w > MAXW { break; }
                        v = (v << iv.w) | iv.v;
                        x = (x << iv.w) | iv.x;
                        w += iv.w;
                    }
                }
                if w == 0 { return Val::new(1, 0); }
                Val { w, v, x, s: false }
            }
            Expr::Tern(c, a, b) => {
                let cv = self.eval(c, 0).truth();
                let (va, vb) = (self.eval(a, ctx), self.eval(b, ctx));
                let w = va.w.max(vb.w);
                let (va, vb) = (va.resize(w), vb.resize(w));
                match cv {
                    Some(true) => va,
                    Some(false) => vb,
                    None => {
                        let diff = (va.v ^ vb.v) | va.x | vb.x;
                        Val { w, v: va.v & vb.v & !diff, x: diff, s: false }
                    }
                }
            }
            Expr::Un(op, a) => self.eval_un(op, a, ctx),
            Expr::Bin(op, a, b) => self.eval_bin(op, a, b, ctx),
            Expr::Call(name, args) => self.eval_call(name, args),
        }
    }

    fn eval_call(&mut self, name: &str, args: &[Expr]) -> Val {
        if !name.starts_with('$') {
            return self.call_user(name, args);
        }
        match name {
            "$clog2" => {
                let v = self.eval(&args[0], 0);
                if v.x != 0u128 { return Val::allx(32); }
                let n = if v.v <= 1 { 0 } else { MAXW - v.v.wrapping_sub(Bits::from_u128(1)).leading_zeros() };
                Val::new(32, n as u128)
            }
            "$signed" => self.eval(&args[0], 0).signed(true),
            "$unsigned" => self.eval(&args[0], 0).signed(false),
            "$bits" => Val::new(32, self.eval(&args[0], 0).w as u128),
            "$time" | "$stime" => Val::new(64, self.time as u128),
            "$random" | "$urandom" => {
                let mut s = self.rng.get();
                s ^= s << 13; s ^= s >> 7; s ^= s << 17;
                self.rng.set(s);
                Val::new(32, s as u128 & 0xffff_ffff)
            }
            _ => Val::allx(1),
        }
    }

    /// Call a user-declared function: bind args to parameter signals, run the
    /// body, and return the value assigned by `return`.
    fn call_user(&mut self, name: &str, args: &[Expr]) -> Val {
        if self.in_call.iter().any(|n| n == name) {
            self.say(&format!("warning: recursion into function '{}' is not supported", name), true);
            return Val::allx(1);
        }
        let Some(f) = self.funcs.get(name) else { return Val::allx(1) };
        let (params, ret, body) = (f.params.clone(), f.ret, f.body.clone());
        // evaluate args first, then bind (allows nested calls of other functions)
        let mut vals = vec![];
        for a in args { vals.push(self.eval(a, 0)); }
        for (i, v) in vals.iter().enumerate() {
            if let Some(p) = params.get(i) {
                let w = self.sigs[*p].w;
                self.write_bits(*p, 0, w, v.resize(w));
            }
        }
        self.in_call.push(name.to_string());
        self.ret_val = None;
        self.ret_now = false;
        self.exec(&body, false);
        self.ret_now = false;
        self.in_call.pop();
        let rw = ret.map(|r| self.sigs[r].w).unwrap_or(1);
        match self.ret_val.take() {
            Some(v) => v.resize(rw),
            None => Val::allx(rw),
        }
    }

    fn eval_un(&mut self, op: &str, a: &Expr, ctx: u32) -> Val {
        let v = self.eval(a, ctx);
        let m = mask(v.w);
        match op {
            "+" => v,
            "-" => {
                let w = v.w.max(ctx);
                let v = v.resize(w);
                if v.x != 0u128 { return Val::allx(w).signed(v.s); }
                Val { w, v: v.v.wrapping_neg() & mask(w), x: Bits::ZERO, s: v.s }
            }
            "~" => {
                let w = v.w.max(ctx);
                let v = v.resize(w);
                Val { w, v: !v.v & mask(w) & !v.x, x: v.x, s: v.s }
            }
            "!" => match v.truth() { Some(t) => Val::bit(!t), None => Val::allx(1) },
            "&" | "~&" => {
                let r = if (!v.v & !v.x & m) != 0 { Val::bit(false) } else if v.x != 0u128 { Val::allx(1) } else { Val::bit(true) };
                if op == "~&" { Self::inv1(r) } else { r }
            }
            "|" | "~|" => {
                let r = if v.v != 0u128 { Val::bit(true) } else if v.x != 0u128 { Val::allx(1) } else { Val::bit(false) };
                if op == "~|" { Self::inv1(r) } else { r }
            }
            _ => { // ^ ~^ ^~
                let r = if v.x != 0u128 { Val::allx(1) } else { Val::bit(v.v.count_ones() % 2 == 1) };
                if op == "^" { r } else { Self::inv1(r) }
            }
        }
    }

    fn inv1(r: Val) -> Val { if r.x != 0u128 { r } else { Val::bit(r.v == 0) } }

    fn eval_bin(&mut self, op: &str, a: &Expr, b: &Expr, ctx: u32) -> Val {
        match op {
            "&&" | "||" => {
                let (x, y) = (self.eval(a, 0).truth(), self.eval(b, 0).truth());
                let r = if op == "&&" {
                    if x == Some(false) || y == Some(false) { Some(false) }
                    else if x == Some(true) && y == Some(true) { Some(true) } else { None }
                } else if x == Some(true) || y == Some(true) { Some(true) }
                else if x == Some(false) && y == Some(false) { Some(false) } else { None };
                return match r { Some(t) => Val::bit(t), None => Val::allx(1) };
            }
            "==" | "!=" | "==?" | "!=?" | "===" | "!==" | "<:" | "<=" | ">:" | ">=" => {
                let w = self.eval(a, 0).w.max(self.eval(b, 0).w);
                let (va, vb) = (self.eval(a, w).resize(w), self.eval(b, w).resize(w));
                let sg = va.s && vb.s;
                let r: Option<bool> = match op {
                    "===" => Some(va.v == vb.v && va.x == vb.x),
                    "!==" => Some(!(va.v == vb.v && va.x == vb.x)),
                    "==?" | "!=?" => {
                        let care = !vb.x & mask(w);
                        let eq = (va.v ^ vb.v) & care == 0 && va.x & care == 0;
                        Some(if op == "==?" { eq } else { !eq })
                    }
                    _ => {
                        if va.x != 0u128 || vb.x != 0u128 { None } else {
                            let ord = if sg { va.to_i128().cmp(&vb.to_i128()) } else { va.v.cmp(&vb.v) };
                            Some(match op {
                                "==" => ord.is_eq(),
                                "!=" => ord.is_ne(),
                                "<:" => ord.is_lt(),
                                "<=" => ord.is_le(),
                                ">:" => ord.is_gt(),
                                _ => ord.is_ge(),
                            })
                        }
                    }
                };
                return match r { Some(t) => Val::bit(t), None => Val::allx(1) };
            }
            "<<" | ">>" | "<<<" | ">>>" => {
                let va = self.eval(a, ctx);
                let w = va.w.max(ctx);
                let va = va.resize(w);
                let vb = self.eval(b, 0);
                if vb.x != 0u128 { return Val::allx(w).signed(va.s); }
                let n = vb.v.sat().min(MAXW as u128 + 1) as u32;
                let m = mask(w);
                let (v, x) = match op {
                    "<<" | "<<<" => ((va.v << n) & m, (va.x << n) & m),
                    ">>>" if va.s => {
                        // arithmetic: the sign bit fills from the left
                        let fill = if va.negative() { m & !(mask(w.saturating_sub(n))) } else { Bits::ZERO };
                        ((va.v >> n) | fill, va.x >> n)
                    }
                    _ => (va.v >> n, va.x >> n),
                };
                return Val { w, v, x, s: va.s };
            }
            _ => {}
        }
        // arithmetic / bitwise: context-determined width
        let (va, vb) = (self.eval(a, ctx), self.eval(b, ctx));
        let w = ctx.max(va.w).max(vb.w).clamp(1, MAXW);
        let (va2, vb2) = (self.eval(a, w).resize(w), self.eval(b, w).resize(w));
        let (va, vb) = (if va2.w == w { va2 } else { va.resize(w) }, if vb2.w == w { vb2 } else { vb.resize(w) });
        let sg = va.s && vb.s;
        let m = mask(w);
        match op {
            "&" => {
                let k0 = (!va.v & !va.x) | (!vb.v & !vb.x);
                Val { w, v: va.v & vb.v, x: (va.x | vb.x) & !k0 & m, s: sg }
            }
            "|" => {
                let k1 = va.v | vb.v;
                Val { w, v: k1, x: (va.x | vb.x) & !k1 & m, s: sg }
            }
            "^" => { let x = va.x | vb.x; Val { w, v: (va.v ^ vb.v) & !x, x, s: sg } }
            "~^" | "^~" => { let x = va.x | vb.x; Val { w, v: !(va.v ^ vb.v) & !x & m, x, s: sg } }
            _ => {
                if va.x != 0u128 || vb.x != 0u128 { return Val::allx(w).signed(sg); }
                let (ua, ub) = (va.v, vb.v);
                let r = match op {
                    "+" => ua.wrapping_add(ub),
                    "-" => ua.wrapping_sub(ub),
                    "*" => ua.wrapping_mul(ub),
                    "/" | "%" => {
                        if ub == 0 { return Val::allx(w).signed(sg); }
                        if sg {
                            // on magnitudes; the quotient is negative when the signs differ,
                            // the remainder takes the dividend's sign
                            let (q, r) = va.abs().divrem(vb.abs());
                            let neg = |x: Bits, n: bool| if n { x.wrapping_neg() } else { x };
                            if op == "/" { neg(q, va.negative() != vb.negative()) } else { neg(r, va.negative()) }
                        } else { let (q, r) = ua.divrem(ub); if op == "/" { q } else { r } }
                    }
                    "**" => {
                        let mut r = Bits::from_u128(1);
                        let (mut b, mut e) = (ua, ub.sat().min(4096));
                        while e > 0 { if e & 1 == 1 { r = r.wrapping_mul(b); } b = b.wrapping_mul(b); e >>= 1; }
                        r
                    }
                    _ => return Val::allx(w),
                };
                Val { w, v: r & m, x: Bits::ZERO, s: sg }
            }
        }
    }

    // ---------- assignment ----------
    /// Returns (sig, bit offset, width) of the target, or None if an index is x/out of range.
    fn target(&mut self, lv: &LValue) -> Option<(usize, u32, u32)> {
        let sw = self.sigs[lv.sig].w;
        let base = |s: usize, lo: u32, w: u32| Some((s, lo, w));
        match &lv.sel {
            Sel::All => base(lv.sig, 0, sw),
            Sel::Bit(i) => {
                let i = self.eval(i, 0);
                if i.x != 0u128 || i.v >= sw as u128 { None } else { base(lv.sig, i.v.sat() as u32, 1) }
            }
            Sel::Range(h, l) => {
                let (h, l) = (self.eval(h, 0), self.eval(l, 0));
                if h.x != 0u128 || l.x != 0u128 || h.v < l.v || h.v >= sw as u128 { None } else { base(lv.sig, l.v.sat() as u32, (h.v.sat() - l.v.sat() + 1) as u32) }
            }
            Sel::Plus(b, w) => {
                let (b, w) = (self.eval(b, 0), self.eval(w, 0));
                if b.x != 0u128 || w.x != 0u128 || b.v.sat().saturating_add(w.v.sat()) > sw as u128 { None } else { base(lv.sig, b.v.sat() as u32, w.v.sat() as u32) }
            }
            Sel::Minus(b, w) => {
                let (b, w) = (self.eval(b, 0), self.eval(w, 0));
                let (bb, ww) = (b.v.sat(), w.v.sat());
                if b.x != 0u128 || w.x != 0u128 || bb + 1 < ww || bb >= sw as u128 { None } else { base(lv.sig, (bb + 1 - ww) as u32, ww as u32) }
            }
            Sel::Elem(idx) => {
                let n = self.sigs[lv.sig].arr.unwrap_or(1);
                let i = self.eval(idx, 0);
                if i.x != 0u128 || i.v >= n as u128 { None } else {
                    let es = lv.sig + i.v.sat() as usize;
                    base(es, 0, self.sigs[es].w)
                }
            }
        }
    }

    pub fn write_bits(&mut self, sig: usize, lo: u32, w: u32, v: Val) {
        let s = &mut self.sigs[sig];
        let m = mask(w) << lo;
        let nv = (s.val.v & !m) | ((v.v << lo) & m);
        let nx = (s.val.x & !m) | ((v.x << lo) & m);
        if nv != s.val.v || nx != s.val.x {
            s.val.v = nv;
            s.val.x = nx;
            self.changed = true;
        }
    }

    pub fn assign(&mut self, lv: &LValue, e: &Expr, nb: bool) {
        let Some((sig, lo, w)) = self.target(lv) else { return };
        let v = self.eval(e, w).resize(w);
        if nb { self.nba.push((sig, lo, w, v)); } else { self.write_bits(sig, lo, w, v); }
    }

    pub fn apply_nba(&mut self) {
        let q = std::mem::take(&mut self.nba);
        for (s, lo, w, v) in q { self.write_bits(s, lo, w, v); }
    }

    // ---------- statements ----------
    pub fn exec(&mut self, body: &[Stmt], nb: bool) {
        for s in body {
            if self.finished || self.ret_now { return; }
            match s {
                Stmt::Assign(lv, e) => self.assign(lv, e, nb),
                Stmt::Return(e) => {
                    let v = self.eval(e, 0);
                    self.ret_val = Some(v);
                    self.ret_now = true;
                }
                Stmt::If(arms, els) => {
                    let mut hit = false;
                    for (c, b) in arms {
                        if self.eval(c, 0).truth() == Some(true) { self.exec(b, nb); hit = true; break; }
                    }
                    if !hit { self.exec(els, nb); }
                }
                Stmt::Case(sel, arms, def) => {
                    let sv = self.eval(sel, 0);
                    let mut hit = false;
                    'arms: for (items, b) in arms {
                        for it in items {
                            let m = match it {
                                CaseArm::V(e) => {
                                    let w = sv.w.max(self.eval(e, 0).w);
                                    let (a, c) = (sv.resize(w), self.eval(e, w).resize(w));
                                    a.x == 0 && c.x == 0 && a.v == c.v
                                }
                                CaseArm::R(lo, hi, incl) => {
                                    let (l, h) = (self.eval(lo, sv.w), self.eval(hi, sv.w));
                                    sv.x == 0 && l.x == 0 && h.x == 0 && sv.v >= l.v && (if *incl { sv.v <= h.v } else { sv.v < h.v })
                                }
                            };
                            if m { self.exec(b, nb); hit = true; break 'arms; }
                        }
                    }
                    if !hit { self.exec(def, nb); }
                }
                Stmt::Switch(arms, def) => {
                    let mut hit = false;
                    'sw: for (conds, b) in arms {
                        for c in conds {
                            if self.eval(c, 0).truth() == Some(true) { self.exec(b, nb); hit = true; break 'sw; }
                        }
                    }
                    if !hit { self.exec(def, nb); }
                }
                Stmt::For { var, from, to, incl, body } => {
                    let (f, t) = (self.eval(from, 0).v.sat(), self.eval(to, 0).v.sat());
                    let t = if *incl { t + 1 } else { t };
                    let w = self.sigs[*var].w;
                    let mut i = f;
                    while i < t && !self.finished {
                        self.write_bits(*var, 0, w, Val::new(w, i));
                        self.exec(body, nb);
                        i += 1;
                    }
                }
                Stmt::Call(name, args) => {
                    if name.starts_with('$') {
                        self.call(name, args);
                    } else {
                        let vals: Vec<Expr> = args.to_vec();
                        self.call_user(name, &vals);
                    }
                }
                Stmt::Wait(..) => self.say("warning: clk.next() is only valid inside `initial`", true),
            }
        }
    }

    fn call(&mut self, name: &str, args: &[Expr]) {
        match name {
            "$display" | "$info" | "$write" => {
                let s = self.format(args);
                self.say(&s, name != "$write");
            }
            "$warning" => { let m = format!("WARNING: {}", self.format(args)); self.say(&m, true); }
            "$error" => { let m = format!("ERROR: {}", self.format(args)); self.say(&m, true); self.fails += 1; }
            "$fatal" => { let m = format!("FATAL: {}", self.format(args)); self.say(&m, true); self.fails += 1; self.finished = true; }
            "$assert" => {
                let ok = args.first().map(|e| self.eval(e, 0).truth() == Some(true)).unwrap_or(false);
                if !ok {
                    let msg = if args.len() > 1 { self.format(&args[1..]) } else { String::new() };
                    self.say(&format!("ASSERTION FAILED at time {} {}", self.time, msg), true);
                    self.fails += 1;
                }
            }
            "$finish" | "$stop" => {
                self.finished = true;
            }
            _ => self.say(&format!("warning: unsupported system task {}", name), true),
        }
    }

    pub fn format(&mut self, args: &[Expr]) -> String {
        let mut out = String::new();
        let Some(Expr::Str(f)) = args.first() else {
            return args.iter().map(|e| self.eval(e, 0).fmt_dec()).collect::<Vec<_>>().join(" ");
        };
        let cs: Vec<char> = f.chars().collect();
        let (mut i, mut ai) = (0, 1);
        while i < cs.len() {
            if cs[i] != '%' { out.push(cs[i]); i += 1; continue; }
            i += 1;
            let (mut zero, mut wd) = (false, String::new());
            while i < cs.len() && cs[i].is_ascii_digit() {
                if wd.is_empty() && cs[i] == '0' { zero = true } else { wd.push(cs[i]) }
                i += 1;
            }
            let conv = cs.get(i).copied().unwrap_or('%');
            i += 1;
            if conv == '%' { out.push('%'); continue; }
            if conv == 'm' { out.push_str("top"); continue; }
            let arg = args.get(ai);
            ai += 1;
            let Some(arg) = arg else { continue };
            if let (Expr::Str(s), 's') = (arg, conv.to_ascii_lowercase()) { out.push_str(s); continue; }
            let v = self.eval(arg, 0);
            let (body, pad_c, dflt) = match conv.to_ascii_lowercase() {
                'd' => (v.fmt_dec(), ' ', mask_digits(v.w)),
                'b' => (v.fmt_bin(), '0', v.w as usize),
                'h' | 'x' => (v.fmt_hex(), '0', ((v.w + 3) / 4) as usize),
                'o' => (v.fmt_oct(), '0', ((v.w + 2) / 3) as usize),
                't' => (v.fmt_dec(), ' ', 0),
                'c' => (((v.v.lo() as u8) as char).to_string(), ' ', 0),
                's' => {
                    let bytes: Vec<u8> = (0..v.w / 8).rev().map(|k| (v.v >> (k * 8)).lo() as u8).filter(|b| *b != 0).collect();
                    (String::from_utf8_lossy(&bytes).to_string(), ' ', 0)
                }
                _ => (v.fmt_dec(), ' ', 0),
            };
            let target = if !wd.is_empty() { wd.parse().unwrap_or(0) } else if zero { 0 } else { dflt };
            for _ in body.len()..target { out.push(pad_c); }
            out.push_str(&body);
        }
        out
    }
}

fn mask_digits(w: u32) -> usize { mask(w).to_dec().len() }

// ====================================================================
pub struct Vcd {
    out: Vec<u8>,
    ids: Vec<String>,
    last: Vec<Option<Val>>,
}

pub struct Design {
    pub sim: Sim,
    pub procs: Vec<Proc>,
    pub inits: Vec<InitState>,
    pub watched: Vec<usize>,
    prev: Vec<u8>,
    vcd: Option<Vcd>,
}

impl Design {
    pub fn new(sim: Sim, procs: Vec<Proc>, inits: Vec<InitState>, mut watched: Vec<usize>) -> Self {
        watched.sort();
        watched.dedup();
        let n = sim.sigs.len();
        Design { sim, procs, inits, watched, prev: vec![2; n], vcd: None }
    }

    /// record a VCD waveform in memory (`take_vcd` returns it after `run`)
    pub fn enable_vcd(&mut self) -> std::io::Result<()> {
        let mut out = Vec::new();
        writeln!(out, "$timescale 1ns $end\n$scope module top $end")?;
        let mut ids = vec![];
        for (i, s) in self.sim.sigs.iter().enumerate() {
            let id = vcd_id(i);
            writeln!(out, "$var wire {} {} {} $end", s.w, id, s.name.replace(' ', "_"))?;
            ids.push(id);
        }
        writeln!(out, "$upscope $end\n$enddefinitions $end")?;
        self.vcd = Some(Vcd { out, ids, last: vec![None; self.sim.sigs.len()] });
        Ok(())
    }

    fn dump(&mut self) {
        let t = self.sim.time;
        let Some(v) = self.vcd.as_mut() else { return };
        let mut wrote_t = false;
        for (i, s) in self.sim.sigs.iter().enumerate() {
            if v.last[i] == Some(s.val) { continue; }
            if !wrote_t { let _ = writeln!(v.out, "#{}", t); wrote_t = true; }
            if s.w == 1 {
                let c = if s.val.x & 1 == 1 { 'x' } else if s.val.v & 1 == 1 { '1' } else { '0' };
                let _ = writeln!(v.out, "{}{}", c, v.ids[i]);
            } else {
                let _ = writeln!(v.out, "b{} {}", s.val.fmt_bin(), v.ids[i]);
            }
            v.last[i] = Some(s.val);
        }
    }

    fn settle_comb(&mut self) {
        for it in 0..500 {
            // compare the state before/after a whole pass: a block may legitimately
            // write a signal twice (`x = 0; x += 1;`) without the result changing.
            let before: Vec<(Bits, Bits)> = self.sim.sigs.iter().map(|s| (s.val.v, s.val.x)).collect();
            for p in &self.procs {
                if let Proc::Comb(b) = p { self.sim.exec(b, false); }
            }
            let same = self.sim.sigs.iter().zip(&before).all(|(s, b)| (s.val.v, s.val.x) == *b);
            if same { return; }
            if it == 499 { self.sim.say(&format!("warning: combinational loop did not settle at time {}", self.sim.time), true); }
        }
    }

    pub fn settle(&mut self) {
        for _ in 0..1000 {
            self.settle_comb();
            let n = self.sim.sigs.len();
            let (mut pos, mut neg, mut any) = (vec![false; n], vec![false; n], false);
            for &s in &self.watched {
                let b = bitv(&self.sim.sigs[s].val);
                let o = self.prev[s];
                if b != o {
                    if b == 1 { pos[s] = true; any = true; }
                    if b == 0 { neg[s] = true; any = true; }
                }
                self.prev[s] = b;
            }
            if !any { return; }
            for st in &mut self.inits {
                if let Some((c, ref mut k)) = st.wait {
                    if pos[c] && *k > 0 { *k -= 1; }
                }
            }
            for p in &self.procs {
                if let Proc::Ff { clk, pos: edge_pos, rst, body } = p {
                    let mut trig = if *edge_pos { pos[*clk] } else { neg[*clk] };
                    if let Some((r, low, asynch)) = rst {
                        if *asynch && ((*low && neg[*r]) || (!*low && pos[*r])) { trig = true; }
                    }
                    if trig { self.sim.exec(body, true); }
                }
            }
            self.sim.apply_nba();
        }
        self.sim.say(&format!("warning: event loop did not settle at time {}", self.sim.time), true);
    }

    fn run_init(&mut self, k: usize) {
        loop {
            let st = &mut self.inits[k];
            if st.done || self.sim.finished { return; }
            if st.pc >= st.ops.len() { st.done = true; return; }
            let pc = st.pc;
            st.pc += 1;
            let op = self.inits[k].ops[pc].clone();
            match op {
                Op::Exec(s) => {
                    self.sim.exec(std::slice::from_ref(&s), false);
                    // settle combinational logic so later reads in the same
                    // `initial` block see up-to-date values (delta cycles)
                    self.settle();
                }
                Op::Jmp(t) => { self.inits[k].pc = t; }
                Op::JmpIfNot(c, t) => {
                    if self.sim.eval(&c, 0).truth() != Some(true) { self.inits[k].pc = t; }
                }
                Op::Wait(clk, n) => {
                    let n = self.sim.eval(&n, 0).v.sat();
                    if n > 0 { self.inits[k].wait = Some((clk, n)); return; }
                }
            }
        }
    }

    fn resume_ready(&mut self) -> bool {
        let mut ran = false;
        for k in 0..self.inits.len() {
            if matches!(self.inits[k].wait, Some((_, 0))) {
                self.inits[k].wait = None;
                self.run_init(k);
                ran = true;
            }
        }
        ran
    }

    pub fn run(&mut self, max_time: u64) {
        let mut heap: BinaryHeap<Reverse<(u64, usize)>> = BinaryHeap::new();
        for (i, p) in self.procs.iter().enumerate() {
            if let Proc::ClockGen { half, .. } = p { heap.push(Reverse((*half, i))); }
        }
        self.sim.time = 0;
        self.settle();
        for k in 0..self.inits.len() { self.run_init(k); }
        self.settle();
        while self.resume_ready() && !self.sim.finished { self.settle(); }
        self.dump();
        while !self.sim.finished {
            let Some(Reverse((t, _))) = heap.peek().copied() else { break };
            if t > max_time { self.sim.say(&format!("simulation stopped: reached max time {}", max_time), true); break; }
            self.sim.time = t;
            while let Some(Reverse((t2, i))) = heap.peek().copied() {
                if t2 != t { break; }
                heap.pop();
                if let Proc::ClockGen { sig, half } = &self.procs[i] {
                    let cur = self.sim.sigs[*sig].val.v.bit(0);
                    self.sim.write_bits(*sig, 0, 1, Val::bit(!cur));
                    heap.push(Reverse((t + *half, i)));
                }
            }
            self.settle();
            while self.resume_ready() && !self.sim.finished { self.settle(); }
            self.dump();
        }
        if self.sim.finished { self.sim.say(&format!("$finish called at time {}", self.sim.time), true); }
        self.dump();
        if let Some(v) = self.vcd.as_mut() { let _ = writeln!(v.out, "#{}", self.sim.time); }
    }
}

impl Design {
    pub fn take_vcd(&mut self) -> Option<Vec<u8>> { self.vcd.take().map(|v| v.out) }
}

fn vcd_id(mut i: usize) -> String {
    let mut s = String::new();
    loop {
        s.push((b'!' + (i % 94) as u8) as char);
        i /= 94;
        if i == 0 { break; }
    }
    s
}

// ---------- compile `initial` bodies (which may contain waits) into a flat program ----------
fn has_wait(s: &Stmt) -> bool {
    match s {
        Stmt::Wait(..) => true,
        Stmt::If(a, e) => a.iter().any(|(_, b)| b.iter().any(has_wait)) || e.iter().any(has_wait),
        Stmt::For { body, .. } => body.iter().any(has_wait),
        _ => false,
    }
}

pub fn compile_initial(stmts: &[Stmt], ops: &mut Vec<Op>, watched: &mut Vec<usize>) {
    for s in stmts {
        if !has_wait(s) { ops.push(Op::Exec(s.clone())); continue; }
        match s {
            Stmt::Wait(c, n) => { watched.push(*c); ops.push(Op::Wait(*c, n.clone())); }
            Stmt::If(arms, els) => {
                let mut ends = vec![];
                for (c, b) in arms {
                    let j = ops.len();
                    ops.push(Op::Jmp(0));
                    compile_initial(b, ops, watched);
                    ends.push(ops.len());
                    ops.push(Op::Jmp(0));
                    let next = ops.len();
                    ops[j] = Op::JmpIfNot(c.clone(), next);
                }
                compile_initial(els, ops, watched);
                let end = ops.len();
                for e in ends { ops[e] = Op::Jmp(end); }
            }
            Stmt::For { var, from, to, incl, body } => {
                let lv = LValue { sig: *var, sel: Sel::All };
                ops.push(Op::Exec(Stmt::Assign(lv.clone(), from.clone())));
                let top = ops.len();
                ops.push(Op::Jmp(0));
                compile_initial(body, ops, watched);
                let one = Expr::Num(Val::new(32, 1));
                ops.push(Op::Exec(Stmt::Assign(lv, Expr::Bin("+".into(), Box::new(Expr::Sig(*var)), Box::new(one)))));
                ops.push(Op::Jmp(top));
                let end = ops.len();
                let cmp = if *incl { "<=" } else { "<:" };
                ops[top] = Op::JmpIfNot(Expr::Bin(cmp.into(), Box::new(Expr::Sig(*var)), Box::new(to.clone())), end);
            }
            _ => ops.push(Op::Exec(s.clone())),
        }
    }
}
