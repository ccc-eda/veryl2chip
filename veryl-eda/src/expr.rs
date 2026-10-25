//! Expression IR (symbol-based) plus a precedence-climbing parser over the
//! token stream veryl-parser produced for an `Expression` node.
//! Unlike veryl-sim, identifiers resolve to names, not signal indices:
//! synthesis builds gates from a name->bits environment.

use crate::value::*;

#[derive(Clone, Debug)]
pub enum Expr {
    Num(Val),
    AllBit(u8), // '0 '1 'x : width comes from context
    #[allow(dead_code)]
    Str(String),
    Sym(String),
    Index(Box<Expr>, Box<Expr>),
    Slice(Box<Expr>, Box<Expr>, Box<Expr>, u8), // 0 = ':', 1 = '+:', 2 = '-:'
    Un(String, Box<Expr>),
    Bin(String, Box<Expr>, Box<Expr>),
    Tern(Box<Expr>, Box<Expr>, Box<Expr>),
    Concat(Vec<(Expr, Expr)>), // (repeat count, item)
    Call(String, Vec<Expr>),
}

pub enum Res {
    Sym(String),
    Const(Val),
    Fn(String),
}

pub type Resolver<'a> = &'a dyn Fn(&[String]) -> Option<Res>;
/// (signal name, field name) -> (bit offset, width) for struct fields
pub type Fielder<'a> = &'a dyn Fn(&str, &str) -> Option<(u32, u32)>;

pub struct P<'a> {
    pub t: &'a [String],
    pub i: usize,
    pub r: Resolver<'a>,
    pub f: Fielder<'a>,
}

pub fn parse_expr(toks: &[String], r: Resolver, f: Fielder) -> Result<Expr, String> {
    let mut p = P { t: toks, i: 0, r, f };
    let e = p.expr()?;
    if p.i != toks.len() {
        return Err(format!("unexpected token '{}' in expression `{}`", toks[p.i], toks.join(" ")));
    }
    Ok(e)
}

fn binprec(op: &str) -> Option<(u8, bool)> {
    Some(match op {
        "||" => (1, false),
        "&&" => (2, false),
        "|" => (3, false),
        "^" | "~^" | "^~" => (4, false),
        "&" => (5, false),
        "==" | "!=" | "==?" | "!=?" | "===" | "!==" => (6, false),
        "<:" | "<=" | ">:" | ">=" => (7, false),
        "<<" | ">>" | "<<<" | ">>>" => (8, false),
        "+" | "-" => (9, false),
        "*" | "/" | "%" => (10, false),
        "**" => (11, true),
        _ => return None,
    })
}

impl<'a> P<'a> {
    pub fn peek(&self) -> Option<&str> { self.t.get(self.i).map(|s| s.as_str()) }
    pub fn next(&mut self) -> Option<String> {
        let s = self.t.get(self.i).cloned();
        if s.is_some() { self.i += 1; }
        s
    }
    pub fn expect(&mut self, s: &str) -> Result<(), String> {
        match self.next() {
            Some(ref x) if x == s => Ok(()),
            other => Err(format!("expected '{}', found {:?}", s, other)),
        }
    }

    pub fn expr(&mut self) -> Result<Expr, String> {
        if self.peek() == Some("if") {
            self.i += 1;
            let c = self.bin(0)?;
            self.expect("?")?;
            let a = self.expr()?;
            self.expect(":")?;
            let b = self.expr()?;
            return Ok(Expr::Tern(Box::new(c), Box::new(a), Box::new(b)));
        }
        self.bin(0)
    }

    pub fn bin(&mut self, min: u8) -> Result<Expr, String> {
        let mut lhs = self.unary()?;
        loop {
            let op = match self.peek() { Some(o) => o.to_string(), None => break };
            let Some((p, right)) = binprec(&op) else { break };
            if p < min { break; }
            self.i += 1;
            let rhs = self.bin(if right { p } else { p + 1 })?;
            lhs = Expr::Bin(op, Box::new(lhs), Box::new(rhs));
        }
        Ok(lhs)
    }

    fn unary(&mut self) -> Result<Expr, String> {
        if let Some(op) = self.peek() {
            if matches!(op, "+" | "-" | "!" | "~" | "&" | "|" | "^" | "~&" | "~|" | "~^" | "^~") {
                let op = op.to_string();
                self.i += 1;
                let e = self.unary()?;
                return Ok(Expr::Un(op, Box::new(e)));
            }
        }
        self.primary()
    }

    fn args(&mut self) -> Result<Vec<Expr>, String> {
        let mut v = vec![];
        self.expect("(")?;
        if self.peek() == Some(")") { self.i += 1; return Ok(v); }
        loop {
            v.push(self.expr()?);
            match self.next().as_deref() {
                Some(",") => { if self.peek() == Some(")") { self.i += 1; break; } }
                Some(")") => break,
                o => return Err(format!("bad argument list near {:?}", o)),
            }
        }
        Ok(v)
    }

    fn primary(&mut self) -> Result<Expr, String> {
        let t = self.next().ok_or("unexpected end of expression")?;
        let c = t.chars().next().unwrap();
        if c.is_ascii_digit() || c == '\'' {
            return parse_num(&t).ok_or_else(|| format!("unsupported number literal '{}'", t));
        }
        if c == '"' { return Ok(Expr::Str(unescape(&t))); }
        let mut e = match t.as_str() {
            "(" => { let e = self.expr()?; self.expect(")")?; e }
            "{" => {
                let mut items = vec![];
                loop {
                    let e = self.expr()?;
                    let cnt = if self.peek() == Some("repeat") {
                        self.i += 1;
                        self.expr()?
                    } else { Expr::Num(Val::new(32, 1)) };
                    items.push((cnt, e));
                    match self.next().as_deref() {
                        Some(",") => { if self.peek() == Some("}") { self.i += 1; break; } }
                        Some("}") => break,
                        o => return Err(format!("bad concatenation near {:?}", o)),
                    }
                }
                Expr::Concat(items)
            }
            "true" => Expr::Num(Val::new(1, 1)),
            "false" => Expr::Num(Val::new(1, 0)),
            "case" | "switch" => return Err("case/switch expressions are not supported".into()),
            _ if c == '$' => {
                let args = if self.peek() == Some("(") { self.args()? } else { vec![] };
                return Ok(Expr::Call(t, args));
            }
            _ if c.is_ascii_alphabetic() || c == '_' => {
                let mut path = vec![t.clone()];
                while self.peek() == Some("::") && self.t.get(self.i + 1).map(|s| s.chars().next().map(|c| c.is_ascii_alphabetic() || c == '_').unwrap_or(false)).unwrap_or(false) {
                    self.i += 1;
                    path.push(self.next().unwrap());
                }
                match (self.r)(&path) {
                    Some(Res::Sym(n)) => Expr::Sym(n),
                    Some(Res::Const(v)) => Expr::Num(v),
                    Some(Res::Fn(name)) => {
                        let args = self.args()?;
                        return Ok(Expr::Call(name, args));
                    }
                    None => return Err(format!("undeclared identifier '{}'", path.join(""))),
                }
            }
            _ => return Err(format!("unexpected token '{}' in expression", t)),
        };
        // struct field access becomes a constant slice of the packed value
        while self.peek() == Some(".") {
            let Expr::Sym(sig) = &e else { return Err("field access on a non-signal".into()) };
            self.i += 1;
            let fname = self.next().ok_or("expected field name after '.'")?;
            let (lo, w) = (self.f)(sig, &fname).ok_or_else(|| format!("no field '{}' on '{}'", fname, sig))?;
            let num = |v: u32| Box::new(Expr::Num(Val::new(32, v as u128)));
            e = Expr::Slice(Box::new(e), num(lo + w - 1), num(lo), 0);
        }
        while self.peek() == Some("[") {
            self.i += 1;
            let a = self.expr()?;
            match self.next().as_deref() {
                Some("]") => e = Expr::Index(Box::new(e), Box::new(a)),
                Some(op @ (":" | "+:" | "-:")) => {
                    let k = match op { ":" => 0, "+:" => 1, _ => 2 };
                    let b = self.expr()?;
                    self.expect("]")?;
                    e = Expr::Slice(Box::new(e), Box::new(a), Box::new(b), k);
                }
                o => return Err(format!("bad select near {:?}", o)),
            }
        }
        Ok(e)
    }
}

fn unescape(s: &str) -> String {
    let inner = &s[1..s.len().saturating_sub(1).max(1)];
    let mut out = String::new();
    let mut it = inner.chars();
    while let Some(c) = it.next() {
        if c == '\\' {
            match it.next() {
                Some('n') => out.push('\n'),
                Some('t') => out.push('\t'),
                Some('"') => out.push('"'),
                Some('\\') => out.push('\\'),
                Some(o) => { out.push('\\'); out.push(o) }
                None => out.push('\\'),
            }
        } else { out.push(c) }
    }
    out
}

pub fn parse_num(s: &str) -> Option<Expr> {
    let s: String = s.chars().filter(|c| *c != '_').collect();
    if let Some(p) = s.find('\'') {
        let (wpart, rest) = (&s[..p], &s[p + 1..]);
        if wpart.is_empty() && rest.len() == 1 {
            return match rest {
                "0" => Some(Expr::AllBit(0)),
                "1" => Some(Expr::AllBit(1)),
                "x" | "X" | "z" | "Z" => Some(Expr::AllBit(2)),
                _ => None,
            };
        }
        let mut r = rest.chars();
        let mut c = r.next()?;
        let mut signed = false;
        if c == 's' || c == 'S' { signed = true; c = r.next()?; }
        let bits = match c.to_ascii_lowercase() { 'b' => 1, 'o' => 3, 'h' => 4, 'd' => 0, _ => return None };
        let digits: Vec<char> = r.collect();
        let w: u32 = if wpart.is_empty() { 32 } else { wpart.parse().ok()? };
        let w = w.clamp(1, 128);
        let (mut v, mut x) = (0u128, 0u128);
        if bits == 0 {
            if digits.len() == 1 && matches!(digits[0], 'x' | 'X' | 'z' | 'Z') {
                x = mask(w);
            } else {
                v = digits.iter().collect::<String>().parse().ok()?;
            }
        } else {
            for d in digits {
                v <<= bits;
                x <<= bits;
                match d {
                    'x' | 'X' | 'z' | 'Z' | '?' => x |= (1u128 << bits) - 1,
                    _ => v |= d.to_digit(1 << bits)? as u128,
                }
            }
        }
        Some(Expr::Num(Val { w, v: v & mask(w), x: x & mask(w), s: signed }))
    } else {
        if s.contains('.') { return None; }
        let v: u128 = s.parse().ok()?;
        let need = (128 - v.leading_zeros()).max(1);
        Some(Expr::Num(Val::new(need.max(32), v)))
    }
}
