//! Typed IR: veryl-sim's expressions and statements with every width and
//! signedness decided at compile time, by the same rules `veryl_sim::sim::Sim::eval`
//! applies at run time (context-determined widths for arithmetic, comparisons at the
//! wider operand, shifts at the left operand's width, ...). Two-state: x / z bits
//! become 0, an x result (division by zero, an index out of range) becomes 0.
//! `case` / `switch` become `if` chains.

use std::collections::HashMap;
use veryl_sim::expr::{Expr, LValue, Sel};
use veryl_sim::sim::{CaseArm, Sim, Stmt};
use veryl_sim::value::{Val, MAXW};

type R<T> = Result<T, String>;

pub fn limbs(w: u32) -> u32 { w.div_ceil(64).max(1) }

#[derive(Clone, Debug)]
pub enum K {
    /// little-endian 64-bit limbs, already masked to the width
    Const(Vec<u64>),
    Sig(usize),
    /// array element (out of range: 0)
    Elem(usize, Box<E>),
    /// bit `idx` of the base (out of range: 0)
    Bit(Box<E>, Box<E>),
    /// `w` bits of the base from bit `lo` (bits past the base: 0)
    Slice(Box<E>, Box<E>),
    Not(Box<E>),
    Neg(Box<E>),
    LNot(Box<E>),
    /// reduction: '&', '|', '^', then inverted?
    Red(char, bool, Box<E>),
    /// & | ^ ~^ + - * / % at the node's width (operands have it too)
    Bin(&'static str, Box<E>, Box<E>),
    /// == != < <= > >= of two operands of the same width; signed?
    Cmp(&'static str, bool, Box<E>, Box<E>),
    LAnd(Box<E>, Box<E>),
    LOr(Box<E>, Box<E>),
    /// << >> >>> (the left operand has the node's width)
    Shift(&'static str, Box<E>, Box<E>),
    Tern(Box<E>, Box<E>, Box<E>),
    /// most significant item first
    Concat(Vec<E>),
    /// `n` copies of a value
    Rep(u32, Box<E>),
    /// to the node's width: truncate, or extend (sign extension if the inner value is signed)
    Resize(Box<E>),
    /// user function: index, arguments (already at the parameters' widths)
    Call(usize, Vec<E>),
}

#[derive(Clone, Debug)]
pub struct E {
    pub k: K,
    pub w: u32,
    pub s: bool,
}

impl E {
    pub fn konst(w: u32, v: &Val) -> E {
        let w = w.clamp(1, MAXW);
        let n = limbs(w) as usize;
        let mut l = vec![0u64; n];
        for (i, limb) in l.iter_mut().enumerate() {
            let mut x = 0u64;
            for b in 0..64 {
                let k = (i * 64 + b) as u32;
                if k < w && v.v.bit(k) { x |= 1 << b; }
            }
            *limb = x;
        }
        E { k: K::Const(l), w, s: v.s }
    }
    pub fn num(w: u32, v: u64) -> E {
        let mut l = vec![0u64; limbs(w) as usize];
        l[0] = if w >= 64 { v } else { v & ((1u64 << w) - 1) };
        E { k: K::Const(l), w, s: false }
    }
    pub fn const_u64(&self) -> Option<u64> {
        match &self.k { K::Const(l) => if l[1..].iter().all(|x| *x == 0) { Some(l[0]) } else { Some(u64::MAX) }, _ => None }
    }
    /// resize to `w` (sign extension if this value is signed)
    pub fn resize(self, w: u32) -> E {
        if self.w == w { return self; }
        let s = self.s;
        E { k: K::Resize(Box::new(self)), w, s }
    }
    /// resize with zero extension
    pub fn zext(mut self, w: u32) -> E {
        self.s = false;
        let r = self.resize(w);
        E { s: false, ..r }
    }
}

#[derive(Clone, Debug)]
pub enum Target {
    /// bits [lo, lo + w) of a signal (lo outside the signal: no write)
    Sig { sig: usize, lo: E, w: u32 },
    /// a whole array element (index out of range: no write)
    Elem { sig: usize, idx: E },
}

#[derive(Clone, Debug)]
pub enum S {
    Assign(Target, E),
    If(Vec<(E, Vec<S>)>, Vec<S>),
    For { var: usize, from: E, to: E, incl: bool, body: Vec<S> },
    Call(usize, Vec<E>),
    /// return from the current function with this value (at the return width)
    Return(E),
    Finish,
}

pub struct Func {
    pub name: String,
    pub params: Vec<usize>,
    /// signal that holds the return value (one per function, made by the lowering)
    pub ret: usize,
    pub body: Vec<S>,
}

/// signals as the code generator sees them
#[derive(Clone)]
pub struct Sig {
    pub name: String,
    pub w: u32,
    pub signed: bool,
    pub arr: Option<u32>,
}

pub struct Lower<'a> {
    pub sim: &'a Sim,
    pub sigs: Vec<Sig>,
    pub funcs: Vec<Func>,
    pub func_ids: HashMap<String, usize>,
}

fn is_const(e: &Expr) -> bool {
    match e {
        Expr::Num(_) | Expr::AllBit(_) | Expr::Str(_) => true,
        Expr::Sig(_) | Expr::Elem(..) => false,
        Expr::Index(a, b) => is_const(a) && is_const(b),
        Expr::Slice(a, b, c, _) => is_const(a) && is_const(b) && is_const(c),
        Expr::Un(_, a) => is_const(a),
        Expr::Bin(_, a, b) => is_const(a) && is_const(b),
        Expr::Tern(a, b, c) => is_const(a) && is_const(b) && is_const(c),
        Expr::Concat(v) => v.iter().all(|(a, b)| is_const(a) && is_const(b)),
        Expr::Call(n, args) => matches!(n.as_str(), "$clog2" | "$signed" | "$unsigned" | "$bits") && args.iter().all(is_const),
    }
}

/// loops with constant bounds and at most this many iterations are unrolled
const UNROLL: u32 = 128;

/// `e` with signal `var` replaced by the constant `v`
fn subst_e(e: &Expr, var: usize, v: &Val) -> Expr {
    let b = |x: &Expr| Box::new(subst_e(x, var, v));
    match e {
        Expr::Sig(s) if *s == var => Expr::Num(*v),
        Expr::Num(_) | Expr::AllBit(_) | Expr::Str(_) | Expr::Sig(_) => e.clone(),
        Expr::Elem(s, i) => Expr::Elem(*s, b(i)),
        Expr::Index(a, i) => Expr::Index(b(a), b(i)),
        Expr::Slice(a, x, y, k) => Expr::Slice(b(a), b(x), b(y), *k),
        Expr::Un(o, a) => Expr::Un(o.clone(), b(a)),
        Expr::Bin(o, a, c) => Expr::Bin(o.clone(), b(a), b(c)),
        Expr::Tern(a, x, y) => Expr::Tern(b(a), b(x), b(y)),
        Expr::Concat(v2) => Expr::Concat(v2.iter().map(|(c, x)| (subst_e(c, var, v), subst_e(x, var, v))).collect()),
        Expr::Call(n, a) => Expr::Call(n.clone(), a.iter().map(|x| subst_e(x, var, v)).collect()),
    }
}

fn subst_s(s: &Stmt, var: usize, v: &Val) -> Stmt {
    let e = |x: &Expr| subst_e(x, var, v);
    let b = |x: &Expr| Box::new(subst_e(x, var, v));
    let body = |x: &[Stmt]| x.iter().map(|y| subst_s(y, var, v)).collect::<Vec<_>>();
    match s {
        Stmt::Assign(lv, x) => {
            let sel = match &lv.sel {
                Sel::All => Sel::All,
                Sel::Bit(i) => Sel::Bit(b(i)),
                Sel::Range(h, l) => Sel::Range(b(h), b(l)),
                Sel::Plus(a, w) => Sel::Plus(b(a), b(w)),
                Sel::Minus(a, w) => Sel::Minus(b(a), b(w)),
                Sel::Elem(i) => Sel::Elem(b(i)),
            };
            Stmt::Assign(LValue { sig: lv.sig, sel }, e(x))
        }
        Stmt::If(arms, els) => Stmt::If(arms.iter().map(|(c, x)| (e(c), body(x))).collect(), body(els)),
        Stmt::Case(sel, arms, def) => Stmt::Case(e(sel), arms.iter().map(|(items, x)| (items.iter().map(|it| match it {
            CaseArm::V(y) => CaseArm::V(e(y)),
            CaseArm::R(l, h, inc) => CaseArm::R(e(l), e(h), *inc),
        }).collect(), body(x))).collect(), body(def)),
        Stmt::Switch(arms, def) => Stmt::Switch(arms.iter().map(|(cs, x)| (cs.iter().map(e).collect(), body(x))).collect(), body(def)),
        Stmt::For { var: w, from, to, incl, body: x } => Stmt::For { var: *w, from: e(from), to: e(to), incl: *incl, body: body(x) },
        Stmt::Call(n, a) => Stmt::Call(n.clone(), a.iter().map(e).collect()),
        Stmt::Return(x) => Stmt::Return(e(x)),
        Stmt::Wait(c, x) => Stmt::Wait(*c, e(x)),
    }
}

fn const_eval(e: &Expr, ctx: u32) -> Val {
    let mut s = Sim::new();
    s.eval(e, ctx)
}

impl<'a> Lower<'a> {
    pub fn new(sim: &'a Sim) -> R<Self> {
        let sigs = sim.sigs.iter().map(|s| Sig { name: s.name.clone(), w: s.w, signed: s.signed, arr: s.arr }).collect();
        let mut l = Lower { sim, sigs, funcs: vec![], func_ids: HashMap::new() };
        // functions: give each one a return-value signal, then lower the bodies
        let mut names: Vec<&String> = sim.funcs.keys().collect();
        names.sort();
        for n in &names {
            let f = &sim.funcs[*n];
            let (rw, rs) = f.ret.map(|r| (sim.sigs[r].w, sim.sigs[r].signed)).unwrap_or((1, false));
            let ret = l.sigs.len();
            l.sigs.push(Sig { name: format!("{}.$ret", n), w: rw, signed: rs, arr: None });
            l.func_ids.insert((*n).clone(), l.funcs.len());
            l.funcs.push(Func { name: (*n).clone(), params: f.params.clone(), ret, body: vec![] });
        }
        for (i, n) in names.iter().enumerate() {
            let body = l.stmts(&sim.funcs[*n].body, Some(i))?;
            l.funcs[i].body = body;
        }
        Ok(l)
    }

    fn sig(&self, i: usize) -> E { E { k: K::Sig(i), w: self.sigs[i].w, s: self.sigs[i].signed } }

    /// a constant integer (array sizes, part-select widths, repeat counts)
    fn const_int(&self, e: &Expr, what: &str) -> R<u64> {
        if !is_const(e) { return Err(format!("{} must be a constant", what)); }
        let v = const_eval(e, 0);
        Ok(v.v.sat().min(u64::MAX as u128) as u64)
    }

    pub fn expr(&self, e: &Expr, ctx: u32) -> R<E> {
        if is_const(e) {
            let v = const_eval(e, ctx);
            return Ok(E::konst(v.w, &v));
        }
        Ok(match e {
            Expr::Num(_) | Expr::AllBit(_) | Expr::Str(_) => unreachable!(),
            Expr::Sig(i) => self.sig(*i),
            Expr::Elem(base, idx) => {
                let idx = self.expr(idx, 0)?;
                E { k: K::Elem(*base, Box::new(idx)), w: self.sigs[*base].w, s: self.sigs[*base].signed }
            }
            Expr::Index(b, i) => {
                let base = self.expr(b, 0)?;
                let idx = self.expr(i, 0)?;
                if let Some(k) = idx.const_u64() {
                    if k >= base.w as u64 { return Ok(E::num(1, 0)); }
                    return Ok(E { k: K::Slice(Box::new(base), Box::new(E::num(32, k))), w: 1, s: false });
                }
                E { k: K::Bit(Box::new(base), Box::new(idx)), w: 1, s: false }
            }
            Expr::Slice(b, a, c, kind) => {
                let base = self.expr(b, 0)?;
                let (lo, w): (E, u64) = match kind {
                    0 => {
                        if is_const(a) && is_const(c) {
                            let (hi, lo) = (self.const_int(a, "a part select")?, self.const_int(c, "a part select")?);
                            if hi < lo { return Ok(E::num(1, 0)); }
                            (E::num(32, lo), hi - lo + 1)
                        } else {
                            // [lo + k : lo] with the same `lo` on both sides
                            let w = match a.as_ref() {
                                Expr::Bin(op, x, k) if op == "+" && format!("{:?}", x) == format!("{:?}", c) && is_const(k) => self.const_int(k, "a part select")? + 1,
                                _ if format!("{:?}", a) == format!("{:?}", c) => 1,
                                _ => return Err("a part select [hi:lo] with a variable width is not supported (use [lo +: w])".into()),
                            };
                            (self.expr(c, 0)?, w)
                        }
                    }
                    1 => (self.expr(a, 0)?, self.const_int(c, "the width of [base +: width]")?),
                    _ => {
                        let n = self.const_int(c, "the width of [base -: width]")?;
                        let base64 = self.expr(a, 0)?.zext(64);
                        (E { k: K::Bin("-", Box::new(base64), Box::new(E::num(64, n.saturating_sub(1)))), w: 64, s: false }, n)
                    }
                };
                let w = w.clamp(1, MAXW as u64) as u32;
                if let Some(l) = lo.const_u64() { if l >= MAXW as u64 { return Ok(E::num(w, 0)); } }
                E { k: K::Slice(Box::new(base), Box::new(lo)), w, s: false }
            }
            Expr::Concat(items) => {
                let mut v = vec![];
                let mut w = 0u32;
                for (cnt, it) in items {
                    let c = self.const_int(cnt, "a repeat count")?;
                    let iv = self.expr(it, 0)?;
                    // as many copies as fit
                    let n = (c as u32).min((MAXW - w) / iv.w.max(1));
                    if n == 0 { continue; }
                    w += n * iv.w;
                    if n == 1 { v.push(iv); } else { let iw = iv.w; v.push(E { k: K::Rep(n, Box::new(iv)), w: n * iw, s: false }); }
                }
                if w == 0 { return Ok(E::num(1, 0)); }
                E { k: K::Concat(v), w, s: false }
            }
            Expr::Tern(c, a, b) => {
                let c = self.expr(c, 0)?;
                let (a, b) = (self.expr(a, ctx)?, self.expr(b, ctx)?);
                let w = a.w.max(b.w);
                let s = a.s && b.s;
                E { k: K::Tern(Box::new(c), Box::new(a.resize(w)), Box::new(b.resize(w))), w, s }
            }
            Expr::Un(op, a) => {
                let v = self.expr(a, ctx)?;
                match op.as_str() {
                    "+" => v,
                    "-" | "~" => {
                        let w = v.w.max(ctx);
                        let s = v.s;
                        let v = Box::new(v.resize(w));
                        E { k: if op == "-" { K::Neg(v) } else { K::Not(v) }, w, s }
                    }
                    "!" => E { k: K::LNot(Box::new(v)), w: 1, s: false },
                    "&" | "~&" => E { k: K::Red('&', op == "~&", Box::new(v)), w: 1, s: false },
                    "|" | "~|" => E { k: K::Red('|', op == "~|", Box::new(v)), w: 1, s: false },
                    "^" => E { k: K::Red('^', false, Box::new(v)), w: 1, s: false },
                    _ => E { k: K::Red('^', true, Box::new(v)), w: 1, s: false },
                }
            }
            Expr::Bin(op, a, b) => self.bin(op, a, b, ctx)?,
            Expr::Call(name, args) => match name.as_str() {
                "$signed" | "$unsigned" => {
                    let mut v = self.expr(&args[0], 0)?;
                    v.s = name == "$signed";
                    v
                }
                "$bits" => E::num(32, self.expr(&args[0], 0)?.w as u64),
                "$time" | "$stime" => E::num(64, 0),
                "$random" | "$urandom" => E::num(32, 0),
                n if n.starts_with('$') => return Err(format!("{} is not supported in compiled simulation", n)),
                n => {
                    let id = *self.func_ids.get(n).ok_or(format!("unknown function '{}'", n))?;
                    let f = &self.funcs[id];
                    let mut av = vec![];
                    for (i, a) in args.iter().enumerate() {
                        let Some(&p) = f.params.get(i) else { continue };
                        av.push(self.expr(a, 0)?.resize(self.sigs[p].w));
                    }
                    let r = &self.sigs[f.ret];
                    E { k: K::Call(id, av), w: r.w, s: r.signed }
                }
            },
        })
    }

    fn bin(&self, op: &str, a: &Expr, b: &Expr, ctx: u32) -> R<E> {
        Ok(match op {
            "&&" | "||" => {
                let (x, y) = (Box::new(self.expr(a, 0)?), Box::new(self.expr(b, 0)?));
                E { k: if op == "&&" { K::LAnd(x, y) } else { K::LOr(x, y) }, w: 1, s: false }
            }
            "==" | "!=" | "==?" | "!=?" | "===" | "!==" | "<:" | "<=" | ">:" | ">=" => {
                let w = self.expr(a, 0)?.w.max(self.expr(b, 0)?.w);
                let (va, vb) = (self.expr(a, w)?.resize(w), self.expr(b, w)?.resize(w));
                let sg = va.s && vb.s;
                let c: &'static str = match op {
                    "==" | "==?" | "===" => "==",
                    "!=" | "!=?" | "!==" => "!=",
                    "<:" => "<",
                    "<=" => "<=",
                    ">:" => ">",
                    _ => ">=",
                };
                E { k: K::Cmp(c, sg, Box::new(va), Box::new(vb)), w: 1, s: false }
            }
            "<<" | ">>" | "<<<" | ">>>" => {
                let va = self.expr(a, ctx)?;
                let w = va.w.max(ctx);
                let s = va.s;
                let va = va.resize(w);
                let vb = self.expr(b, 0)?;
                let o: &'static str = match op { "<<" | "<<<" => "<<", ">>>" if s => ">>>", _ => ">>" };
                E { k: K::Shift(o, Box::new(va), Box::new(vb)), w, s }
            }
            _ => {
                let (wa, wb) = (self.expr(a, ctx)?.w, self.expr(b, ctx)?.w);
                let w = ctx.max(wa).max(wb).clamp(1, MAXW);
                let (va, vb) = (self.expr(a, w)?.resize(w), self.expr(b, w)?.resize(w));
                let sg = va.s && vb.s;
                let o: &'static str = match op {
                    "&" => "&", "|" => "|", "^" => "^", "~^" | "^~" => "~^",
                    "+" => "+", "-" => "-", "*" => "*", "/" => "/", "%" => "%",
                    _ => return Err(format!("operator {} is not supported in compiled simulation", op)),
                };
                E { k: K::Bin(o, Box::new(va), Box::new(vb)), w, s: sg }
            }
        })
    }

    fn target(&self, lv: &LValue) -> R<Target> {
        let sw = self.sigs[lv.sig].w;
        Ok(match &lv.sel {
            Sel::All => Target::Sig { sig: lv.sig, lo: E::num(32, 0), w: sw },
            Sel::Bit(i) => Target::Sig { sig: lv.sig, lo: self.expr(i, 0)?, w: 1 },
            Sel::Range(h, l) => {
                if is_const(h) && is_const(l) {
                    let (h, l) = (self.const_int(h, "a part select")?, self.const_int(l, "a part select")?);
                    if h < l { return Err("part select [hi:lo] with hi < lo".into()); }
                    Target::Sig { sig: lv.sig, lo: E::num(32, l), w: (h - l + 1) as u32 }
                } else {
                    let w = match h.as_ref() {
                        Expr::Bin(op, x, k) if op == "+" && format!("{:?}", x) == format!("{:?}", l) && is_const(k) => self.const_int(k, "a part select")? + 1,
                        _ => return Err("an assignment to [hi:lo] with a variable width is not supported (use [lo +: w])".into()),
                    };
                    Target::Sig { sig: lv.sig, lo: self.expr(l, 0)?, w: w as u32 }
                }
            }
            Sel::Plus(b, w) => Target::Sig { sig: lv.sig, lo: self.expr(b, 0)?, w: self.const_int(w, "the width of [base +: width]")? as u32 },
            Sel::Minus(b, w) => {
                let n = self.const_int(w, "the width of [base -: width]")?;
                let b64 = self.expr(b, 0)?.zext(64);
                Target::Sig { sig: lv.sig, lo: E { k: K::Bin("-", Box::new(b64), Box::new(E::num(64, n.saturating_sub(1)))), w: 64, s: false }, w: n as u32 }
            }
            Sel::Elem(idx) => Target::Elem { sig: lv.sig, idx: self.expr(idx, 0)? },
        })
    }

    fn target_w(&self, t: &Target) -> u32 {
        match t { Target::Sig { w, .. } => *w, Target::Elem { sig, .. } => self.sigs[*sig].w }
    }

    fn or(conds: Vec<E>) -> E {
        let mut it = conds.into_iter();
        let first = it.next().unwrap_or_else(|| E::num(1, 0));
        it.fold(first, |a, b| E { k: K::LOr(Box::new(a), Box::new(b)), w: 1, s: false })
    }

    /// statements; `func` = the function they belong to (for `return`)
    pub fn stmts(&self, body: &[Stmt], func: Option<usize>) -> R<Vec<S>> {
        let mut out = vec![];
        for s in body {
            match s {
                Stmt::Assign(lv, e) => {
                    let t = self.target(lv)?;
                    let w = self.target_w(&t);
                    out.push(S::Assign(t, self.expr(e, w)?.resize(w)));
                }
                Stmt::If(arms, els) => {
                    let mut a = vec![];
                    for (c, b) in arms { a.push((self.expr(c, 0)?, self.stmts(b, func)?)); }
                    out.push(S::If(a, self.stmts(els, func)?));
                }
                Stmt::Case(sel, arms, def) => {
                    let sv = self.expr(sel, 0)?;
                    let mut a = vec![];
                    for (items, b) in arms {
                        let mut conds = vec![];
                        for it in items {
                            conds.push(match it {
                                CaseArm::V(e) => {
                                    let w = sv.w.max(self.expr(e, 0)?.w);
                                    E { k: K::Cmp("==", false, Box::new(sv.clone().resize(w)), Box::new(self.expr(e, w)?.resize(w))), w: 1, s: false }
                                }
                                CaseArm::R(lo, hi, incl) => {
                                    let (l, h) = (self.expr(lo, sv.w)?, self.expr(hi, sv.w)?);
                                    let w = sv.w.max(l.w).max(h.w);
                                    let ge = E { k: K::Cmp(">=", false, Box::new(sv.clone().zext(w)), Box::new(l.zext(w))), w: 1, s: false };
                                    let le = E { k: K::Cmp(if *incl { "<=" } else { "<" }, false, Box::new(sv.clone().zext(w)), Box::new(h.zext(w))), w: 1, s: false };
                                    E { k: K::LAnd(Box::new(ge), Box::new(le)), w: 1, s: false }
                                }
                            });
                        }
                        a.push((Self::or(conds), self.stmts(b, func)?));
                    }
                    out.push(S::If(a, self.stmts(def, func)?));
                }
                Stmt::Switch(arms, def) => {
                    let mut a = vec![];
                    for (conds, b) in arms {
                        let mut cs = vec![];
                        for c in conds { cs.push(self.expr(c, 0)?); }
                        a.push((Self::or(cs), self.stmts(b, func)?));
                    }
                    out.push(S::If(a, self.stmts(def, func)?));
                }
                Stmt::For { var, from, to, incl, body } => {
                    // constant bounds and few iterations: unrolled with the variable as a constant
                    // (array indices and bit selects by it become fixed addresses and shifts)
                    if is_const(from) && is_const(to) {
                        let (f, t) = (const_eval(from, 0).v.sat(), const_eval(to, 0).v.sat());
                        let t = if *incl { t.saturating_add(1) } else { t };
                        if t.saturating_sub(f) <= UNROLL as u128 {
                            let (vw, vs) = (self.sigs[*var].w, self.sigs[*var].signed);
                            for i in f..t {
                                let v = Val::new(vw, i).signed(vs);
                                let b: Vec<Stmt> = body.iter().map(|x| subst_s(x, *var, &v)).collect();
                                out.extend(self.stmts(&b, func)?);
                            }
                            // the variable keeps its last value, as in veryl-sim
                            if t > f { out.push(S::Assign(Target::Sig { sig: *var, lo: E::num(32, 0), w: vw }, E::konst(vw, &Val::new(vw, t - 1)))); }
                            continue;
                        }
                    }
                    out.push(S::For { var: *var, from: self.expr(from, 0)?, to: self.expr(to, 0)?, incl: *incl, body: self.stmts(body, func)? });
                }
                Stmt::Call(name, args) => match name.as_str() {
                    "$finish" | "$stop" | "$fatal" => out.push(S::Finish),
                    n if n.starts_with('$') => {}
                    n => {
                        let id = *self.func_ids.get(n).ok_or(format!("unknown function '{}'", n))?;
                        let f = &self.funcs[id];
                        let mut av = vec![];
                        for (i, a) in args.iter().enumerate() {
                            let Some(&p) = f.params.get(i) else { continue };
                            av.push(self.expr(a, 0)?.resize(self.sigs[p].w));
                        }
                        out.push(S::Call(id, av));
                    }
                },
                Stmt::Return(e) => {
                    let Some(f) = func else { return Err("return outside a function".into()) };
                    let rw = self.sigs[self.funcs[f].ret].w;
                    out.push(S::Return(self.expr(e, 0)?.resize(rw)));
                }
                Stmt::Wait(..) => return Err("clk.next() is only for testbenches (initial blocks)".into()),
            }
        }
        Ok(out)
    }
}

/// signals an expression reads
pub fn reads_e(e: &E, out: &mut Vec<usize>, funcs: &[Func]) {
    match &e.k {
        K::Const(_) => {}
        K::Sig(s) => out.push(*s),
        K::Elem(s, i) => { out.push(*s); reads_e(i, out, funcs); }
        K::Bit(a, b) | K::Slice(a, b) | K::Bin(_, a, b) | K::Cmp(_, _, a, b) | K::LAnd(a, b) | K::LOr(a, b) | K::Shift(_, a, b) => { reads_e(a, out, funcs); reads_e(b, out, funcs); }
        K::Not(a) | K::Neg(a) | K::LNot(a) | K::Red(_, _, a) | K::Resize(a) | K::Rep(_, a) => reads_e(a, out, funcs),
        K::Tern(a, b, c) => { reads_e(a, out, funcs); reads_e(b, out, funcs); reads_e(c, out, funcs); }
        K::Concat(v) => for x in v { reads_e(x, out, funcs) },
        K::Call(f, args) => { for a in args { reads_e(a, out, funcs); } out.push(funcs[*f].ret); }
    }
}

/// signals statements read and write (`writes` = assignment targets, For variables)
pub fn rw_s(body: &[S], reads: &mut Vec<usize>, writes: &mut Vec<usize>, funcs: &[Func]) {
    for s in body {
        match s {
            S::Assign(t, e) => {
                reads_e(e, reads, funcs);
                match t {
                    Target::Sig { sig, lo, .. } => { reads_e(lo, reads, funcs); writes.push(*sig); }
                    Target::Elem { sig, idx } => { reads_e(idx, reads, funcs); writes.push(*sig); }
                }
            }
            S::If(arms, els) => {
                for (c, b) in arms { reads_e(c, reads, funcs); rw_s(b, reads, writes, funcs); }
                rw_s(els, reads, writes, funcs);
            }
            S::For { var, from, to, body, .. } => {
                reads_e(from, reads, funcs);
                reads_e(to, reads, funcs);
                writes.push(*var);
                rw_s(body, reads, writes, funcs);
            }
            S::Call(f, args) => { for a in args { reads_e(a, reads, funcs); } let _ = f; }
            S::Return(e) => reads_e(e, reads, funcs),
            S::Finish => {}
        }
    }
}

/// the mask of the top limb of a `w`-bit value
pub fn top_mask(w: u32) -> u64 { let r = w % 64; if r == 0 { u64::MAX } else { (1u64 << r) - 1 } }
