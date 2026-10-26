//! A compiler for a subset of C to RV32I assembly (for RvSoc, examples/src/rvsoc.veryl).
//!
//! Types: `char` (unsigned, as in the RISC-V ABI), `signed char`, `short`, `int`,
//! `long` (= int), their `unsigned` forms, `void`, pointers and arrays (any
//! number of dimensions). `const` / `volatile` / `static` / `extern` are accepted.
//! No structs, unions, enums, typedefs, floating point or function pointers.
//! Statements: blocks, `if`, `while`, `do`, `for`, `switch`, `break`,
//! `continue`, `return`, declarations anywhere. All C expression operators.
//! Functions: up to 8 arguments, `...` (the arguments are consecutive words:
//! see `va_start` in the runtime library). A small preprocessor: `#define`
//! (with parameters), `#undef`, `#ifdef` / `#ifndef` / `#if` / `#else` / `#endif`;
//! `#include` is ignored (the runtime library is always there).
//!
//! The code is simple and predictable on purpose: every expression result goes
//! to a0, intermediate values are pushed on the stack, locals live in the
//! frame (s0 = frame pointer). Each statement is preceded by a comment with its
//! C source line, so the assembly reads alongside the program.

use super::asm;
use std::collections::{HashMap, HashSet};

pub const PRELUDE: &str = include_str!("prelude.c");

#[derive(Clone, Debug, PartialEq)]
pub struct Diag { pub file: String, pub line: usize, pub msg: String }

pub struct Options {
    /// RAM size in bytes: the stack starts at its top
    pub mem_size: u32,
}

impl Default for Options { fn default() -> Self { Options { mem_size: 8192 } } }

pub struct Output {
    pub asm: String,
    pub program: asm::Program,
}

// ------------------------------------------------------------------ tokens

#[derive(Clone, Debug, PartialEq)]
enum Tok { Id(String), Num(i64, bool), Str(Vec<u8>), P(&'static str) }

#[derive(Clone, Debug)]
struct Token { t: Tok, file: usize, line: usize }

const PUNCT: [&str; 47] = ["<<=", ">>=", "...", "->", "++", "--", "<<", ">>", "<=", ">=", "==", "!=", "&&", "||", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "##",
    "+", "-", "*", "/", "%", "<", ">", "=", "!", "&", "|", "^", "~", "?", ":", ";", ",", ".", "(", ")", "[", "]", "{", "}"];

fn lex_line(s: &str, file: usize, line: usize, out: &mut Vec<Token>, errs: &mut Vec<Diag>, files: &[String]) {
    let b = s.as_bytes();
    let mut i = 0;
    let err = |errs: &mut Vec<Diag>, m: String| errs.push(Diag { file: files[file].clone(), line, msg: m });
    while i < b.len() {
        let c = b[i];
        if c.is_ascii_whitespace() { i += 1; continue; }
        if c.is_ascii_alphabetic() || c == b'_' {
            let st = i;
            while i < b.len() && (b[i].is_ascii_alphanumeric() || b[i] == b'_') { i += 1; }
            out.push(Token { t: Tok::Id(s[st..i].to_string()), file, line });
            continue;
        }
        if c.is_ascii_digit() {
            let st = i;
            while i < b.len() && (b[i].is_ascii_alphanumeric()) { i += 1; }
            let mut t = &s[st..i];
            let mut uns = false;
            while let Some(r) = t.strip_suffix(['u', 'U', 'l', 'L']) { if t.ends_with(['u', 'U']) { uns = true; } t = r; }
            let v = if let Some(h) = t.strip_prefix("0x").or_else(|| t.strip_prefix("0X")) { i64::from_str_radix(h, 16) }
                else if let Some(bn) = t.strip_prefix("0b").or_else(|| t.strip_prefix("0B")) { i64::from_str_radix(bn, 2) }
                else if t.len() > 1 && t.starts_with('0') { i64::from_str_radix(&t[1..], 8) }
                else { t.parse() };
            match v {
                Ok(v) => { if v > 0x7fff_ffff { uns = true; } out.push(Token { t: Tok::Num(v, uns), file, line }) }
                Err(_) => err(errs, format!("bad number {}", &s[st..i])),
            }
            continue;
        }
        if c == b'"' || c == b'\'' {
            let st = i;
            i += 1;
            while i < b.len() && b[i] != c { if b[i] == b'\\' { i += 1; } i += 1; }
            if i >= b.len() { err(errs, "unterminated literal".into()); return; }
            let body = &s[st + 1..i];
            i += 1;
            match asm::unescape(body) {
                Ok(v) if c == b'"' => {
                    // adjacent strings join
                    if let Some(Token { t: Tok::Str(prev), .. }) = out.last_mut() { prev.extend(v); } else { out.push(Token { t: Tok::Str(v), file, line }); }
                }
                Ok(v) if v.len() == 1 => out.push(Token { t: Tok::Num(v[0] as i64, false), file, line }),
                Ok(_) => err(errs, format!("character constant '{}' must be one character", body)),
                Err(e) => err(errs, e),
            }
            continue;
        }
        match PUNCT.iter().find(|p| s[i..].starts_with(**p)) {
            Some(p) => { out.push(Token { t: Tok::P(p), file, line }); i += p.len(); }
            None => { err(errs, format!("unexpected character '{}'", c as char)); i += 1; }
        }
    }
}

/// remove comments (keeping newlines) and join continued lines
fn strip_comments(src: &str) -> String {
    let b = src.as_bytes();
    let mut out = String::with_capacity(src.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'/' && b.get(i + 1) == Some(&b'/') { while i < b.len() && b[i] != b'\n' { i += 1; } continue; }
        if b[i] == b'/' && b.get(i + 1) == Some(&b'*') {
            i += 2;
            while i < b.len() && !(b[i] == b'*' && b.get(i + 1) == Some(&b'/')) { if b[i] == b'\n' { out.push('\n'); } i += 1; }
            i += 2;
            out.push(' ');
            continue;
        }
        if b[i] == b'"' || b[i] == b'\'' {
            let q = b[i];
            let st = i;
            i += 1;
            while i < b.len() && b[i] != q && b[i] != b'\n' { if b[i] == b'\\' { i += 1; } i += 1; }
            i = (i + 1).min(b.len());
            out.push_str(&src[st..i]);
            continue;
        }
        let ch = src[i..].chars().next().unwrap();
        out.push(ch);
        i += ch.len_utf8();
    }
    out
}

#[derive(Clone)]
struct Macro { params: Option<Vec<String>>, variadic: bool, body: Vec<Token> }

struct Pre<'a> { macros: HashMap<String, Macro>, errs: Vec<Diag>, files: &'a [String] }

impl Pre<'_> {
    fn run(&mut self, file: usize, src: &str, out: &mut Vec<Token>) {
        let text = strip_comments(src);
        let lines: Vec<&str> = text.split('\n').collect();
        // conditional stack: (taking this branch, some branch was taken)
        let mut cond: Vec<(bool, bool)> = vec![];
        let mut k = 0;
        while k < lines.len() {
            let ln = k + 1;
            let mut l = lines[k].to_string();
            while l.ends_with('\\') && k + 1 < lines.len() { l.pop(); k += 1; l += lines[k]; }
            k += 1;
            let active = cond.iter().all(|c| c.0);
            let t = l.trim_start();
            if let Some(d) = t.strip_prefix('#') {
                let d = d.trim_start();
                let (name, rest) = match d.find(|c: char| !c.is_ascii_alphanumeric() && c != '_') { Some(p) => (&d[..p], d[p..].trim()), None => (d, "") };
                let err = |s: &mut Self, m: String| s.errs.push(Diag { file: s.files[file].clone(), line: ln, msg: m });
                match name {
                    "ifdef" | "ifndef" => { let has = self.macros.contains_key(rest.trim()); let on = if name == "ifdef" { has } else { !has }; cond.push((on, on)); }
                    "if" => {
                        let mut toks = vec![];
                        let mut e2 = vec![];
                        lex_line(rest, file, ln, &mut toks, &mut e2, self.files);
                        let toks = self.expand(toks, &mut vec![]);
                        let on = match &toks[..] { [Token { t: Tok::Num(v, _), .. }] => *v != 0, _ => { err(self, format!("#if needs a constant: {}", rest)); false } };
                        cond.push((on, on));
                    }
                    "else" => match cond.last_mut() { Some(c) => { c.0 = !c.1; c.1 = true; } None => err(self, "#else without #if".into()) },
                    "endif" => { if cond.pop().is_none() { err(self, "#endif without #if".into()); } }
                    _ if !active => {}
                    "define" => self.define(rest, file, ln),
                    "undef" => { self.macros.remove(rest.trim()); }
                    "include" | "pragma" => {}
                    "error" => err(self, format!("#error {}", rest)),
                    _ => err(self, format!("unknown directive #{}", name)),
                }
                continue;
            }
            if !active { continue; }
            let mut toks = vec![];
            let mut e = vec![];
            lex_line(&l, file, ln, &mut toks, &mut e, self.files);
            self.errs.extend(e);
            // a macro call can continue on the next lines: keep its tokens together
            let x = self.expand(toks, &mut vec![]);
            for t in x {
                // adjacent strings join, also across lines
                if let (Tok::Str(v), Some(Token { t: Tok::Str(prev), .. })) = (&t.t, out.last_mut()) { prev.extend(v.iter().copied()); continue; }
                out.push(t);
            }
        }
        if !cond.is_empty() { self.errs.push(Diag { file: self.files[file].clone(), line: lines.len(), msg: "missing #endif".into() }); }
    }

    fn define(&mut self, rest: &str, file: usize, ln: usize) {
        let name_end = rest.find(|c: char| !c.is_ascii_alphanumeric() && c != '_').unwrap_or(rest.len());
        let name = rest[..name_end].to_string();
        if name.is_empty() { self.errs.push(Diag { file: self.files[file].clone(), line: ln, msg: "#define needs a name".into() }); return; }
        let mut body_src = &rest[name_end..];
        let mut params = None;
        let mut variadic = false;
        if body_src.starts_with('(') {
            let close = body_src.find(')').unwrap_or(body_src.len() - 1);
            let mut ps: Vec<String> = body_src[1..close].split(',').map(|p| p.trim().to_string()).filter(|p| !p.is_empty()).collect();
            if ps.last().map(|p| p == "...") == Some(true) { ps.pop(); variadic = true; }
            params = Some(ps);
            body_src = &body_src[close + 1..];
        }
        let mut body = vec![];
        let mut e = vec![];
        lex_line(body_src, file, ln, &mut body, &mut e, self.files);
        self.errs.extend(e);
        self.macros.insert(name, Macro { params, variadic, body });
    }

    fn expand(&mut self, toks: Vec<Token>, hide: &mut Vec<String>) -> Vec<Token> {
        let mut out = vec![];
        let mut i = 0;
        while i < toks.len() {
            let t = &toks[i];
            let Tok::Id(name) = &t.t else { out.push(t.clone()); i += 1; continue };
            let Some(m) = self.macros.get(name).cloned() else { out.push(t.clone()); i += 1; continue };
            if hide.contains(name) { out.push(t.clone()); i += 1; continue; }
            let at = |b: &[Token]| -> Vec<Token> { b.iter().map(|x| Token { t: x.t.clone(), file: t.file, line: t.line }).collect() };
            match &m.params {
                None => {
                    hide.push(name.clone());
                    let e = self.expand(at(&m.body), hide);
                    hide.pop();
                    out.extend(e);
                    i += 1;
                }
                Some(ps) => {
                    if toks.get(i + 1).map(|x| x.t == Tok::P("(")) != Some(true) { out.push(t.clone()); i += 1; continue; }
                    // arguments
                    let mut args: Vec<Vec<Token>> = vec![vec![]];
                    let mut depth = 0;
                    let mut j = i + 2;
                    while j < toks.len() {
                        match toks[j].t {
                            Tok::P("(") => depth += 1,
                            Tok::P(")") if depth == 0 => break,
                            Tok::P(")") => depth -= 1,
                            Tok::P(",") if depth == 0 && (args.len() <= ps.len() || !m.variadic) => { args.push(vec![]); j += 1; continue; }
                            _ => {}
                        }
                        args.last_mut().unwrap().push(toks[j].clone());
                        j += 1;
                    }
                    if j >= toks.len() { self.errs.push(Diag { file: self.files[t.file].clone(), line: t.line, msg: format!("macro {}: missing )", name) }); return out; }
                    if args.len() == 1 && args[0].is_empty() && ps.is_empty() { args.clear(); }
                    if args.len() != ps.len() && !(m.variadic && args.len() >= ps.len()) {
                        self.errs.push(Diag { file: self.files[t.file].clone(), line: t.line, msg: format!("macro {} takes {} arguments", name, ps.len()) });
                    }
                    let exp_args: Vec<Vec<Token>> = args.iter().map(|a| self.expand(a.clone(), hide)).collect();
                    let mut body = vec![];
                    for b in at(&m.body) {
                        match &b.t {
                            Tok::Id(p) if ps.contains(p) => body.extend(exp_args.get(ps.iter().position(|x| x == p).unwrap()).cloned().unwrap_or_default()),
                            Tok::Id(p) if p == "__VA_ARGS__" && m.variadic => {
                                for (k, a) in exp_args.iter().enumerate().skip(ps.len()) {
                                    if k > ps.len() { body.push(Token { t: Tok::P(","), file: t.file, line: t.line }); }
                                    body.extend(a.clone());
                                }
                            }
                            _ => body.push(b),
                        }
                    }
                    hide.push(name.clone());
                    let e = self.expand(body, hide);
                    hide.pop();
                    out.extend(e);
                    i = j + 1;
                }
            }
        }
        out
    }
}

// ------------------------------------------------------------------ types and syntax

#[derive(Clone, Debug, PartialEq)]
pub enum Ty {
    Void,
    /// signed?
    Char(bool),
    Short(bool),
    Int(bool),
    Ptr(Box<Ty>),
    /// element, count (None: size from the initializer)
    Arr(Box<Ty>, Option<usize>),
    Func(Box<Ty>, Vec<Ty>, bool),
}

impl Ty {
    fn size(&self) -> usize {
        match self { Ty::Void => 1, Ty::Char(_) => 1, Ty::Short(_) => 2, Ty::Int(_) | Ty::Ptr(_) | Ty::Func(..) => 4, Ty::Arr(e, n) => e.size() * n.unwrap_or(0) }
    }
    fn align(&self) -> usize { match self { Ty::Arr(e, _) => e.align(), t => t.size().min(4) } }
    fn is_int(&self) -> bool { matches!(self, Ty::Char(_) | Ty::Short(_) | Ty::Int(_)) }
    fn is_ptr(&self) -> bool { matches!(self, Ty::Ptr(_)) }
    fn is_scalar(&self) -> bool { self.is_int() || self.is_ptr() }
    /// the value type after array / function decay
    fn decay(&self) -> Ty {
        match self { Ty::Arr(e, _) => Ty::Ptr(e.clone()), Ty::Func(..) => Ty::Ptr(Box::new(self.clone())), t => t.clone() }
    }
    fn unsigned(&self) -> bool { matches!(self, Ty::Int(false) | Ty::Ptr(_)) }
    fn name(&self) -> String {
        match self {
            Ty::Void => "void".into(), Ty::Char(s) => if *s { "signed char".into() } else { "char".into() },
            Ty::Short(s) => if *s { "short".into() } else { "unsigned short".into() }, Ty::Int(s) => if *s { "int".into() } else { "unsigned".into() },
            Ty::Ptr(e) => format!("{} *", e.name()), Ty::Arr(e, n) => format!("{}[{}]", e.name(), n.map(|n| n.to_string()).unwrap_or_default()),
            Ty::Func(r, ..) => format!("function returning {}", r.name()),
        }
    }
}

#[derive(Clone, Debug)]
struct E { k: EK, file: usize, line: usize }

#[derive(Clone, Debug)]
enum EK {
    Num(i64, Ty),
    Str(Vec<u8>),
    Id(String),
    Un(&'static str, Box<E>),
    Bin(&'static str, Box<E>, Box<E>),
    Asg(Option<&'static str>, Box<E>, Box<E>),
    Cond(Box<E>, Box<E>, Box<E>),
    Call(String, Vec<E>),
    Idx(Box<E>, Box<E>),
    Cast(Ty, Box<E>),
    SizeT(Ty),
    SizeE(Box<E>),
    /// ++ / -- : prefix?, +1 / -1
    Inc(bool, i64, Box<E>),
    Comma(Box<E>, Box<E>),
}

#[derive(Clone, Debug)]
enum Init { E(E), List(Vec<Init>) }

#[derive(Clone, Debug)]
struct Decl { name: String, ty: Ty, init: Option<Init>, file: usize, line: usize }

#[derive(Clone, Debug)]
enum S {
    Expr(E),
    Decl(Vec<Decl>),
    Block(Vec<S>),
    If(E, Box<S>, Option<Box<S>>),
    While(E, Box<S>),
    Do(Box<S>, E),
    For(Option<Box<S>>, Option<E>, Option<E>, Box<S>),
    Ret(Option<E>, usize, usize),
    Break(usize, usize),
    Cont(usize, usize),
    Switch(E, Box<S>),
    Case(i64, usize, usize),
    Default(usize, usize),
    Empty,
}

struct Func { name: String, ty: Ty, params: Vec<String>, body: S, file: usize, line: usize }

struct Parser<'a> {
    t: Vec<Token>,
    p: usize,
    errs: Vec<Diag>,
    files: &'a [String],
}

type PR<T> = Result<T, ()>;

const BINOPS: [(&str, u8); 18] = [("||", 1), ("&&", 2), ("|", 3), ("^", 4), ("&", 5), ("==", 6), ("!=", 6), ("<", 7), (">", 7), ("<=", 7), (">=", 7),
    ("<<", 8), (">>", 8), ("+", 9), ("-", 9), ("*", 10), ("/", 10), ("%", 10)];
const ASSIGN: [&str; 11] = ["=", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "<<=", ">>="];
const TYPE_WORDS: [&str; 12] = ["void", "char", "short", "int", "long", "signed", "unsigned", "const", "volatile", "static", "extern", "register"];

impl Parser<'_> {
    fn peek(&self) -> Option<&Tok> { self.t.get(self.p).map(|t| &t.t) }
    fn peek_at(&self, k: usize) -> Option<&Tok> { self.t.get(self.p + k).map(|t| &t.t) }
    fn here(&self) -> (usize, usize) { let t = self.t.get(self.p).or(self.t.last()); t.map(|t| (t.file, t.line)).unwrap_or((0, 0)) }
    fn is(&self, p: &str) -> bool { matches!(self.peek(), Some(Tok::P(x)) if *x == p) }
    fn is_id(&self, w: &str) -> bool { matches!(self.peek(), Some(Tok::Id(x)) if x == w) }
    fn eat(&mut self, p: &str) -> bool { if self.is(p) || self.is_id(p) { self.p += 1; true } else { false } }
    fn err<T>(&mut self, m: String) -> PR<T> {
        let (f, l) = self.here();
        self.errs.push(Diag { file: self.files[f].clone(), line: l, msg: m });
        Err(())
    }
    fn expect(&mut self, p: &str) -> PR<()> {
        if self.eat(p) { return Ok(()); }
        let got = match self.peek() { Some(Tok::P(x)) => x.to_string(), Some(Tok::Id(x)) => x.clone(), Some(Tok::Num(v, _)) => v.to_string(), Some(Tok::Str(_)) => "a string".into(), None => "the end".into() };
        self.err(format!("expected '{}' but found '{}'", p, got))
    }
    fn ident(&mut self) -> PR<String> {
        match self.peek() { Some(Tok::Id(x)) if !TYPE_WORDS.contains(&x.as_str()) => { let x = x.clone(); self.p += 1; Ok(x) } _ => self.err("expected a name".into()) }
    }
    fn is_type_start(&self) -> bool { matches!(self.peek(), Some(Tok::Id(x)) if TYPE_WORDS.contains(&x.as_str())) }
    fn e(&self, k: EK, at: (usize, usize)) -> E { E { k, file: at.0, line: at.1 } }

    /// base type with qualifiers: (type, is it static/extern)
    fn base_type(&mut self) -> PR<Ty> {
        let (mut signed, mut unsigned, mut size) = (false, false, None::<&str>);
        let mut seen = false;
        while let Some(Tok::Id(w)) = self.peek().cloned() {
            match w.as_str() {
                "const" | "volatile" | "static" | "extern" | "register" => {}
                "signed" => signed = true,
                "unsigned" => unsigned = true,
                "void" | "char" | "short" | "int" => { if size.is_some() && !(w == "int" && matches!(size, Some("short") | Some("long"))) { return self.err(format!("two types: {} and {}", size.unwrap(), w)); } if size.is_none() || w != "int" { size = Some(match w.as_str() { "void" => "void", "char" => "char", "short" => "short", _ => "int" }); } }
                "long" => { if size.is_none() || size == Some("int") { size = Some("long"); } }
                _ => break,
            }
            seen = true;
            self.p += 1;
        }
        if !seen { return self.err("expected a type".into()); }
        Ok(match size {
            Some("void") => Ty::Void,
            Some("char") => Ty::Char(signed),
            Some("short") => Ty::Short(!unsigned),
            _ => Ty::Int(!unsigned),
        })
    }

    /// `*`s, a name (optional for abstract declarators), array / function suffixes
    fn declarator(&mut self, base: Ty, abstract_ok: bool) -> PR<(String, Ty, Option<(Vec<String>, Vec<Ty>, bool)>)> {
        let mut ty = base;
        while self.eat("*") { while self.eat("const") || self.eat("volatile") {} ty = Ty::Ptr(Box::new(ty)); }
        let name = if abstract_ok && !matches!(self.peek(), Some(Tok::Id(_))) { String::new() } else { self.ident()? };
        let mut dims: Vec<Option<usize>> = vec![];
        let mut func = None;
        loop {
            if self.eat("[") {
                if self.eat("]") { dims.push(None); continue; }
                let e = self.expr()?;
                self.expect("]")?;
                match const_eval(&e) {
                    Some(n) if n > 0 => dims.push(Some(n as usize)),
                    _ => return self.err("an array size must be a positive constant".into()),
                }
            } else if self.is("(") && func.is_none() && dims.is_empty() {
                self.p += 1;
                let (mut names, mut tys, mut variadic) = (vec![], vec![], false);
                if self.is_id("void") && self.peek_at(1) == Some(&Tok::P(")")) { self.p += 1; }
                while !self.is(")") {
                    if self.eat("...") { variadic = true; break; }
                    let b = self.base_type()?;
                    let (n, t, _) = self.declarator(b, true)?;
                    // array parameters are pointers
                    let t = match t { Ty::Arr(e, _) => Ty::Ptr(e), t => t };
                    names.push(n);
                    tys.push(t);
                    if !self.eat(",") { break; }
                }
                self.expect(")")?;
                func = Some((names, tys, variadic));
            } else { break; }
        }
        for d in dims.into_iter().rev() { ty = Ty::Arr(Box::new(ty), d); }
        if let Some((_, tys, v)) = &func { ty = Ty::Func(Box::new(ty), tys.clone(), *v); }
        Ok((name, ty, func))
    }

    fn type_name(&mut self) -> PR<Ty> {
        let b = self.base_type()?;
        let (n, t, _) = self.declarator(b, true)?;
        if !n.is_empty() { return self.err("unexpected name in a type".into()); }
        Ok(t)
    }

    fn init(&mut self) -> PR<Init> {
        if self.eat("{") {
            let mut v = vec![];
            while !self.is("}") {
                v.push(self.init()?);
                if !self.eat(",") { break; }
            }
            self.expect("}")?;
            Ok(Init::List(v))
        } else { Ok(Init::E(self.assign()?)) }
    }

    // ---- expressions ----
    fn expr(&mut self) -> PR<E> {
        let at = self.here();
        let mut e = self.assign()?;
        while self.eat(",") { let r = self.assign()?; e = self.e(EK::Comma(Box::new(e), Box::new(r)), at); }
        Ok(e)
    }
    fn assign(&mut self) -> PR<E> {
        let at = self.here();
        let l = self.cond()?;
        if let Some(Tok::P(op)) = self.peek().cloned() {
            if let Some(a) = ASSIGN.iter().find(|x| **x == op) {
                self.p += 1;
                let r = self.assign()?;
                let o = if *a == "=" { None } else { Some(BINOPS.iter().find(|b| b.0 == &a[..a.len() - 1]).unwrap().0) };
                return Ok(self.e(EK::Asg(o, Box::new(l), Box::new(r)), at));
            }
        }
        Ok(l)
    }
    fn cond(&mut self) -> PR<E> {
        let at = self.here();
        let c = self.binary(1)?;
        if self.eat("?") {
            let a = self.expr()?;
            self.expect(":")?;
            let b = self.cond()?;
            return Ok(self.e(EK::Cond(Box::new(c), Box::new(a), Box::new(b)), at));
        }
        Ok(c)
    }
    fn binary(&mut self, min: u8) -> PR<E> {
        let mut l = self.unary()?;
        loop {
            let Some(Tok::P(op)) = self.peek().cloned() else { break };
            let Some(&(o, prec)) = BINOPS.iter().find(|b| b.0 == op) else { break };
            if prec < min { break; }
            let at = self.here();
            self.p += 1;
            let r = self.binary(prec + 1)?;
            l = self.e(EK::Bin(o, Box::new(l), Box::new(r)), at);
        }
        Ok(l)
    }
    fn unary(&mut self) -> PR<E> {
        let at = self.here();
        for op in ["-", "+", "!", "~", "*", "&"] {
            if self.is(op) {
                self.p += 1;
                let e = self.unary()?;
                return Ok(self.e(EK::Un(op, Box::new(e)), at));
            }
        }
        if self.is("++") || self.is("--") {
            let d = if self.is("++") { 1 } else { -1 };
            self.p += 1;
            let e = self.unary()?;
            return Ok(self.e(EK::Inc(true, d, Box::new(e)), at));
        }
        if self.is_id("sizeof") {
            self.p += 1;
            if self.is("(") && matches!(self.peek_at(1), Some(Tok::Id(x)) if TYPE_WORDS.contains(&x.as_str())) {
                self.p += 1;
                let t = self.type_name()?;
                self.expect(")")?;
                return Ok(self.e(EK::SizeT(t), at));
            }
            let e = self.unary()?;
            return Ok(self.e(EK::SizeE(Box::new(e)), at));
        }
        if self.is("(") && matches!(self.peek_at(1), Some(Tok::Id(x)) if TYPE_WORDS.contains(&x.as_str())) {
            self.p += 1;
            let t = self.type_name()?;
            self.expect(")")?;
            let e = self.unary()?;
            return Ok(self.e(EK::Cast(t, Box::new(e)), at));
        }
        self.postfix()
    }
    fn postfix(&mut self) -> PR<E> {
        let mut e = self.primary()?;
        loop {
            let at = self.here();
            if self.eat("[") {
                let i = self.expr()?;
                self.expect("]")?;
                e = self.e(EK::Idx(Box::new(e), Box::new(i)), at);
            } else if self.eat("++") {
                e = self.e(EK::Inc(false, 1, Box::new(e)), at);
            } else if self.eat("--") {
                e = self.e(EK::Inc(false, -1, Box::new(e)), at);
            } else if self.is("(") {
                let EK::Id(name) = &e.k else { return self.err("only named functions can be called".into()) };
                let name = name.clone();
                self.p += 1;
                let mut args = vec![];
                while !self.is(")") {
                    args.push(self.assign()?);
                    if !self.eat(",") { break; }
                }
                self.expect(")")?;
                e = self.e(EK::Call(name, args), at);
            } else if self.is(".") || self.is("->") {
                return self.err("structs are not supported".into());
            } else { break; }
        }
        Ok(e)
    }
    fn primary(&mut self) -> PR<E> {
        let at = self.here();
        match self.peek().cloned() {
            Some(Tok::Num(v, u)) => { self.p += 1; Ok(self.e(EK::Num(v, Ty::Int(!u)), at)) }
            Some(Tok::Str(s)) => { self.p += 1; Ok(self.e(EK::Str(s), at)) }
            Some(Tok::Id(x)) if !TYPE_WORDS.contains(&x.as_str()) && !["if", "else", "while", "for", "do", "return", "break", "continue", "switch", "case", "default", "sizeof"].contains(&x.as_str()) => {
                self.p += 1;
                Ok(self.e(EK::Id(x), at))
            }
            Some(Tok::P("(")) => { self.p += 1; let e = self.expr()?; self.expect(")")?; Ok(e) }
            Some(Tok::Id(x)) => self.err(format!("unexpected '{}' in an expression", x)),
            Some(Tok::P(x)) => self.err(format!("unexpected '{}' in an expression", x)),
            _ => self.err("expected an expression".into()),
        }
    }

    // ---- statements ----
    fn decls(&mut self) -> PR<Vec<Decl>> {
        let base = self.base_type()?;
        let mut v = vec![];
        loop {
            let at = self.here();
            let (name, ty, _) = self.declarator(base.clone(), false)?;
            let init = if self.eat("=") { Some(self.init()?) } else { None };
            v.push(Decl { name, ty, init, file: at.0, line: at.1 });
            if !self.eat(",") { break; }
        }
        self.expect(";")?;
        Ok(v)
    }

    fn stmt(&mut self) -> PR<S> {
        let at = self.here();
        if self.is_type_start() { return Ok(S::Decl(self.decls()?)); }
        if self.eat("{") {
            let mut v = vec![];
            while !self.is("}") {
                if self.peek().is_none() { return self.err("missing }".into()); }
                match self.stmt() { Ok(s) => v.push(s), Err(()) => self.recover() }
            }
            self.p += 1;
            return Ok(S::Block(v));
        }
        if self.eat(";") { return Ok(S::Empty); }
        if self.eat("if") {
            self.expect("(")?;
            let c = self.expr()?;
            self.expect(")")?;
            let a = self.stmt()?;
            let b = if self.eat("else") { Some(Box::new(self.stmt()?)) } else { None };
            return Ok(S::If(c, Box::new(a), b));
        }
        if self.eat("while") {
            self.expect("(")?;
            let c = self.expr()?;
            self.expect(")")?;
            return Ok(S::While(c, Box::new(self.stmt()?)));
        }
        if self.eat("do") {
            let b = self.stmt()?;
            if !self.eat("while") { return self.err("expected while after do".into()); }
            self.expect("(")?;
            let c = self.expr()?;
            self.expect(")")?;
            self.expect(";")?;
            return Ok(S::Do(Box::new(b), c));
        }
        if self.eat("for") {
            self.expect("(")?;
            let init = if self.eat(";") { None } else if self.is_type_start() { Some(Box::new(S::Decl(self.decls()?))) } else { let e = self.expr()?; self.expect(";")?; Some(Box::new(S::Expr(e))) };
            let c = if self.is(";") { None } else { Some(self.expr()?) };
            self.expect(";")?;
            let step = if self.is(")") { None } else { Some(self.expr()?) };
            self.expect(")")?;
            return Ok(S::For(init, c, step, Box::new(self.stmt()?)));
        }
        if self.eat("return") {
            let e = if self.is(";") { None } else { Some(self.expr()?) };
            self.expect(";")?;
            return Ok(S::Ret(e, at.0, at.1));
        }
        if self.eat("break") { self.expect(";")?; return Ok(S::Break(at.0, at.1)); }
        if self.eat("continue") { self.expect(";")?; return Ok(S::Cont(at.0, at.1)); }
        if self.eat("switch") {
            self.expect("(")?;
            let c = self.expr()?;
            self.expect(")")?;
            return Ok(S::Switch(c, Box::new(self.stmt()?)));
        }
        if self.eat("case") {
            let e = self.cond()?;
            self.expect(":")?;
            let Some(v) = const_eval(&e) else { return self.err("case needs a constant".into()) };
            return Ok(S::Case(v, at.0, at.1));
        }
        if self.eat("default") { self.expect(":")?; return Ok(S::Default(at.0, at.1)); }
        if self.is_id("goto") { return self.err("goto is not supported".into()); }
        let e = self.expr()?;
        self.expect(";")?;
        Ok(S::Expr(e))
    }

    /// skip to the end of the statement after an error
    fn recover(&mut self) {
        let mut depth = 0;
        while let Some(t) = self.peek().cloned() {
            self.p += 1;
            match t {
                Tok::P(";") if depth == 0 => return,
                Tok::P("{") => depth += 1,
                Tok::P("}") => { if depth == 0 { self.p -= 1; return; } depth -= 1; if depth == 0 { return; } }
                _ => {}
            }
        }
    }

    fn unit(&mut self) -> (Vec<Func>, Vec<Decl>, Vec<(String, Ty, usize, usize)>, Vec<String>) {
        let (mut funcs, mut globals, mut protos, mut asms) = (vec![], vec![], vec![], vec![]);
        while self.peek().is_some() {
            let st = self.p;
            let r = (|| -> PR<()> {
                if self.eat(";") { return Ok(()); }
                if self.is_id("asm") || self.is_id("__asm__") {
                    // top-level assembly (labels, data, ...)
                    self.p += 1;
                    self.expect("(")?;
                    let Some(Tok::Str(t)) = self.peek().cloned() else { return self.err("asm takes one string of assembly".into()) };
                    self.p += 1;
                    self.expect(")")?;
                    self.expect(";")?;
                    asms.push(String::from_utf8_lossy(&t).to_string());
                    return Ok(());
                }
                let at = self.here();
                let base = self.base_type()?;
                let (name, ty, f) = self.declarator(base.clone(), false)?;
                if let (Some((params, _, _)), true) = (&f, self.is("{")) {
                    let body = self.stmt()?;
                    funcs.push(Func { name, ty, params: params.clone(), body, file: at.0, line: at.1 });
                    return Ok(());
                }
                let mut d = vec![(name, ty, at)];
                loop {
                    let (name, ty, at) = d.pop().unwrap();
                    if matches!(ty, Ty::Func(..)) { protos.push((name, ty, at.0, at.1)); }
                    else {
                        let init = if self.eat("=") { Some(self.init()?) } else { None };
                        globals.push(Decl { name, ty, init, file: at.0, line: at.1 });
                    }
                    if !self.eat(",") { break; }
                    let at = self.here();
                    let (n, t, _) = self.declarator(base.clone(), false)?;
                    d.push((n, t, at));
                }
                self.expect(";")
            })();
            if r.is_err() { if self.p == st { self.p += 1; } self.recover(); }
        }
        (funcs, globals, protos, asms)
    }
}

/// identifiers in assembly text (functions / globals it refers to stay in the program)
fn asm_names(text: &str) -> Vec<String> {
    text.split(|c: char| !(c.is_ascii_alphanumeric() || c == '_')).filter(|w| w.chars().next().is_some_and(|c| c.is_ascii_alphabetic() || c == '_')).map(|w| w.to_string()).collect()
}

fn const_eval(e: &E) -> Option<i64> {
    Some(match &e.k {
        EK::Num(v, _) => *v,
        EK::Un(op, a) => { let a = const_eval(a)?; match *op { "-" => -a, "+" => a, "!" => (a == 0) as i64, "~" => !a, _ => return None } }
        EK::Bin(op, a, b) => {
            let (a, b) = (const_eval(a)?, const_eval(b)?);
            match *op {
                "+" => a + b, "-" => a - b, "*" => a * b, "/" => { if b == 0 { return None; } a / b } "%" => { if b == 0 { return None; } a % b }
                "<<" => a << (b & 63), ">>" => a >> (b & 63), "&" => a & b, "|" => a | b, "^" => a ^ b,
                "==" => (a == b) as i64, "!=" => (a != b) as i64, "<" => (a < b) as i64, ">" => (a > b) as i64, "<=" => (a <= b) as i64, ">=" => (a >= b) as i64,
                "&&" => (a != 0 && b != 0) as i64, "||" => (a != 0 || b != 0) as i64, _ => return None,
            }
        }
        EK::Cond(c, a, b) => if const_eval(c)? != 0 { const_eval(a)? } else { const_eval(b)? },
        EK::Cast(Ty::Ptr(_), _) => return None,
        EK::Cast(t, a) => { let v = const_eval(a)?; match t { Ty::Char(true) => v as i8 as i64, Ty::Char(false) => v as u8 as i64, Ty::Short(true) => v as i16 as i64, Ty::Short(false) => v as u16 as i64, Ty::Int(true) => v as i32 as i64, _ => v as u32 as i64 } }
        EK::SizeT(t) => t.size() as i64,
        _ => return None,
    })
}

// ------------------------------------------------------------------ code generation

#[derive(Clone)]
struct Local { off: i32, ty: Ty }

struct Gen<'a> {
    files: &'a [String],
    user_file: usize,
    src_lines: Vec<Vec<String>>,
    globals: HashMap<String, Ty>,
    funcs: HashMap<String, Ty>,
    scopes: Vec<HashMap<String, Local>>,
    /// bytes of locals so far (below the 8 argument words)
    frame: i32,
    max_frame: i32,
    out: Vec<String>,
    lab: usize,
    brk: Vec<String>,
    cont: Vec<String>,
    /// per switch: (case value or None for default, label)
    cases: Vec<Vec<(Option<i64>, String)>>,
    strings: Vec<Vec<u8>>,
    /// functions / globals / strings the current function uses
    refs: HashSet<String>,
    ret_ty: Ty,
    ret_lab: String,
    errs: Vec<Diag>,
    last_line: (usize, usize),
    /// generating only for a type (sizeof): no code kept
    dry: usize,
}

/// arguments: 8 words at s0 - 40 .. s0 - 12 (ascending, so `...` arguments follow the named ones)
const ARGS: i32 = 40;

impl Gen<'_> {
    fn emit(&mut self, s: impl Into<String>) { self.out.push(format!("    {}", s.into())); }
    fn label(&mut self, l: &str) { self.out.push(format!("{}:", l)); }
    fn new_label(&mut self) -> String { self.lab += 1; format!(".L{}", self.lab) }
    fn error(&mut self, e: &E, m: String) { if self.dry == 0 { self.errs.push(Diag { file: self.files[e.file].clone(), line: e.line, msg: m }); } }
    fn error_at(&mut self, f: usize, l: usize, m: String) { self.errs.push(Diag { file: self.files[f].clone(), line: l, msg: m }); }
    fn push(&mut self) { self.emit("addi sp, sp, -4"); self.emit("sw a0, 0(sp)"); }
    fn pop(&mut self, r: &str) { self.emit(format!("lw {}, 0(sp)", r)); self.emit("addi sp, sp, 4"); }
    fn note_line(&mut self, f: usize, l: usize) {
        if (f, l) == self.last_line || f != self.user_file { return; }
        self.last_line = (f, l);
        let text = self.src_lines.get(f).and_then(|v| v.get(l.wrapping_sub(1))).map(|s| s.trim().to_string()).unwrap_or_default();
        self.out.push(format!("    # {}: {}", l, text));
    }
    /// a0 = s0 + off
    fn frame_addr(&mut self, off: i32) {
        if (-2048..2048).contains(&off) { self.emit(format!("addi a0, s0, {}", off)); } else { self.emit(format!("li a0, {}", off)); self.emit("add a0, s0, a0"); }
    }
    fn lookup(&self, n: &str) -> Option<Local> { self.scopes.iter().rev().find_map(|s| s.get(n).cloned()) }

    /// a folded constant and its type (not folded when unsigned arithmetic went negative)
    fn constant(e: &E) -> Option<(i64, Ty)> {
        let v = const_eval(e)?;
        let u = has_unsigned(e);
        if u && v < 0 { return None; }
        Some((v, Ty::Int(!u)))
    }

    /// a scalar variable (local in reach of s0, or global)
    fn slot(&self, e: &E) -> Option<Slot> {
        let EK::Id(n) = &e.k else { return None };
        if let Some(l) = self.lookup(n) { return (l.ty.is_scalar() && fits12(l.off as i64)).then_some(Slot::Local(l.off, l.ty)); }
        let t = self.globals.get(n)?;
        t.is_scalar().then(|| Slot::Global(n.clone(), t.clone()))
    }
    fn load_slot(&mut self, s: &Slot, reg: &str) {
        match s {
            Slot::Local(off, t) => self.emit(format!("{} {}, {}(s0)", load_op(t), reg, off)),
            Slot::Global(n, t) => { self.refs.insert(n.clone()); self.emit(format!("la {}, {}", reg, n)); self.emit(format!("{} {}, 0({})", load_op(t), reg, reg)); }
        }
    }
    /// store a0 (uses t0 for a global)
    fn store_slot(&mut self, s: &Slot) {
        match s {
            Slot::Local(off, t) => self.emit(format!("{} a0, {}(s0)", store_op(t), off)),
            Slot::Global(n, t) => { self.refs.insert(n.clone()); self.emit(format!("la t0, {}", n)); self.emit(format!("{} a0, 0(t0)", store_op(t))); }
        }
    }

    /// can `load_simple` put this value in a register directly?
    fn is_simple(&self, e: &E) -> bool {
        if Self::constant(e).is_some() || matches!(e.k, EK::Str(_)) || self.slot(e).is_some() { return true; }
        let EK::Id(n) = &e.k else { return false };
        match self.lookup(n) { Some(l) => matches!(l.ty, Ty::Arr(..)) && fits12(l.off as i64), None => matches!(self.globals.get(n), Some(Ty::Arr(..))) }
    }
    /// a simple value (see `is_simple`) into `reg`; its type
    fn load_simple(&mut self, e: &E, reg: &str) -> Ty {
        if let Some((v, t)) = Self::constant(e) { self.emit(format!("li {}, {}", reg, v as i32)); return t; }
        if let EK::Str(st) = &e.k { let l = self.string(st); self.emit(format!("la {}, {}", reg, l)); return Ty::Ptr(Box::new(Ty::Char(false))); }
        if let Some(s) = self.slot(e) { self.load_slot(&s, reg); return match s { Slot::Local(_, t) | Slot::Global(_, t) => t }; }
        let EK::Id(n) = &e.k else { unreachable!() };
        if let Some(l) = self.lookup(n) { self.emit(format!("addi {}, s0, {}", reg, l.off)); return l.ty.decay(); }
        self.refs.insert(n.clone());
        self.emit(format!("la {}, {}", reg, n));
        self.globals[n].decay()
    }

    /// a0 = a0 op constant, with an immediate instruction when there is one
    fn binop_imm(&mut self, op: &str, ta: &Ty, k: i64, tk: &Ty) -> Option<Ty> {
        if let Ty::Ptr(el) = ta {
            let d = k * el.size() as i64 * if op == "-" { -1 } else { 1 };
            if (op == "+" || op == "-") && fits12(d) { self.emit(format!("addi a0, a0, {}", d)); return Some(ta.clone()); }
            return None;
        }
        if !ta.is_int() { return None; }
        let t = arith(ta, tk);
        let pow2 = k > 0 && (k & (k - 1)) == 0;
        match op {
            "+" if fits12(k) => self.emit(format!("addi a0, a0, {}", k)),
            "-" if fits12(-k) => self.emit(format!("addi a0, a0, {}", -k)),
            "&" if fits12(k) => self.emit(format!("andi a0, a0, {}", k)),
            "|" if fits12(k) => self.emit(format!("ori a0, a0, {}", k)),
            "^" if fits12(k) => self.emit(format!("xori a0, a0, {}", k)),
            "<<" if (0..32).contains(&k) => { self.emit(format!("slli a0, a0, {}", k)); return Some(promote(ta)); }
            ">>" if (0..32).contains(&k) => { self.emit(format!("{} a0, a0, {}", if promote(ta).unsigned() { "srli" } else { "srai" }, k)); return Some(promote(ta)); }
            "*" if pow2 => self.emit(format!("slli a0, a0, {}", k.trailing_zeros())),
            "/" if pow2 && t.unsigned() => self.emit(format!("srli a0, a0, {}", k.trailing_zeros())),
            "%" if pow2 && t.unsigned() && fits12(k - 1) => self.emit(format!("andi a0, a0, {}", k - 1)),
            "<" if fits12(k) => { self.emit(format!("{} a0, a0, {}", if t.unsigned() { "sltiu" } else { "slti" }, k)); return Some(Ty::Int(true)); }
            "==" | "!=" if fits12(-k) => {
                if k != 0 { self.emit(format!("addi a0, a0, {}", -k)); }
                self.emit(if op == "==" { "seqz a0, a0" } else { "snez a0, a0" });
                return Some(Ty::Int(true));
            }
            _ => return None,
        }
        Some(t)
    }

    /// jump to `label` when c is true (`when`) / false; comparisons become one branch
    fn cond_jump(&mut self, c: &E, when: bool, label: &str) {
        if let Some((v, _)) = Self::constant(c) { if (v != 0) == when { self.emit(format!("j {}", label)); } return; }
        match &c.k {
            EK::Un("!", x) => self.cond_jump(x, !when, label),
            EK::Bin("&&", a, b) | EK::Bin("||", a, b) => {
                let and = matches!(c.k, EK::Bin("&&", ..));
                if and != when { self.cond_jump(a, when, label); self.cond_jump(b, when, label); }
                else { let skip = self.new_label(); self.cond_jump(a, !when, &skip); self.cond_jump(b, when, label); self.label(&skip); }
            }
            EK::Bin(op, a, b) if ["==", "!=", "<", ">", "<=", ">="].contains(op) => {
                let ta = self.expr(a);
                let zero = Self::constant(b).map(|x| x.0) == Some(0);
                let tb = if zero { Ty::Int(true) } else if self.is_simple(b) { self.emit("mv t0, a0"); self.load_simple(b, "t1") } else { self.push(); let tb = self.expr(b); self.emit("mv t1, a0"); self.pop("t0"); tb };
                let (x, y) = if zero { ("a0", "zero") } else { ("t0", "t1") };
                let u = if ta.unsigned() || tb.unsigned() { "u" } else { "" };
                // the branch for "op is true" / "op is false"
                let (br, l, r) = match (*op, when) {
                    ("==", true) | ("!=", false) => ("beq".to_string(), x, y),
                    ("==", false) | ("!=", true) => ("bne".to_string(), x, y),
                    ("<", true) | (">=", false) => (format!("blt{}", u), x, y),
                    ("<", false) | (">=", true) => (format!("bge{}", u), x, y),
                    (">", true) | ("<=", false) => (format!("blt{}", u), y, x),
                    _ => (format!("bge{}", u), y, x),
                };
                self.emit(format!("{} {}, {}, {}", br, l, r, label));
            }
            _ => { self.expr(c); self.emit(format!("{} a0, {}", if when { "bnez" } else { "beqz" }, label)); }
        }
    }

    /// load the object at address a0 (of type t) into a0
    fn load(&mut self, t: &Ty) {
        match t {
            Ty::Char(true) => self.emit("lb a0, 0(a0)"),
            Ty::Char(false) => self.emit("lbu a0, 0(a0)"),
            Ty::Short(true) => self.emit("lh a0, 0(a0)"),
            Ty::Short(false) => self.emit("lhu a0, 0(a0)"),
            Ty::Int(_) | Ty::Ptr(_) => self.emit("lw a0, 0(a0)"),
            _ => {}
        }
    }
    /// store a0 to the address in `r`
    fn store(&mut self, t: &Ty, r: &str) {
        match t.size() { 1 => self.emit(format!("sb a0, 0({})", r)), 2 => self.emit(format!("sh a0, 0({})", r)), _ => self.emit(format!("sw a0, 0({})", r)) }
    }
    /// convert a0 from `from` to `to` (narrowing / sign)
    fn convert(&mut self, from: &Ty, to: &Ty) {
        if from == to { return; }
        match to {
            Ty::Char(false) => self.emit("andi a0, a0, 255"),
            Ty::Char(true) => { self.emit("slli a0, a0, 24"); self.emit("srai a0, a0, 24"); }
            Ty::Short(false) => { self.emit("slli a0, a0, 16"); self.emit("srli a0, a0, 16"); }
            Ty::Short(true) => { self.emit("slli a0, a0, 16"); self.emit("srai a0, a0, 16"); }
            _ => {}
        }
    }

    /// the type of an expression, without code
    fn type_of(&mut self, e: &E) -> Ty {
        let (n, lab, refs) = (self.out.len(), self.lab, self.refs.clone());
        self.dry += 1;
        let t = self.expr(e);
        self.dry -= 1;
        self.out.truncate(n);
        self.lab = lab;
        self.refs = refs;
        t
    }

    /// address of an lvalue into a0; its (undecayed) type
    fn addr(&mut self, e: &E) -> Ty {
        match &e.k {
            EK::Id(n) => {
                if let Some(l) = self.lookup(n) { self.frame_addr(l.off); return l.ty; }
                if let Some(t) = self.globals.get(n).cloned() { self.refs.insert(n.clone()); self.emit(format!("la a0, {}", n)); return t; }
                if let Some(t) = self.funcs.get(n).cloned() { self.refs.insert(n.clone()); self.emit(format!("la a0, {}", n)); return t; }
                self.error(e, format!("'{}' is not declared", n));
                Ty::Int(true)
            }
            EK::Un("*", p) => {
                let t = self.expr(p);
                match t { Ty::Ptr(el) => { if *el == Ty::Void { self.error(e, "dereferencing a void pointer".into()); } *el } _ => { self.error(e, format!("* needs a pointer, not {}", t.name())); Ty::Int(true) } }
            }
            EK::Idx(a, i) => {
                let p = E { k: EK::Bin("+", a.clone(), i.clone()), file: e.file, line: e.line };
                let t = self.expr(&p);
                match t { Ty::Ptr(el) => *el, _ => { self.error(e, "[] needs an array or a pointer".into()); Ty::Int(true) } }
            }
            EK::Str(s) => { let l = self.string(s); self.emit(format!("la a0, {}", l)); Ty::Arr(Box::new(Ty::Char(false)), Some(s.len() + 1)) }
            EK::Comma(a, b) => { self.expr(a); self.addr(b) }
            _ => { self.error(e, "this expression has no address (not a variable, *p or a[i])".into()); Ty::Int(true) }
        }
    }

    fn string(&mut self, s: &[u8]) -> String {
        let i = self.strings.iter().position(|x| x == s).unwrap_or_else(|| { self.strings.push(s.to_vec()); self.strings.len() - 1 });
        let l = format!(".LS{}", i);
        self.refs.insert(l.clone());
        l
    }

    fn is_lvalue(e: &E) -> bool { matches!(e.k, EK::Id(_) | EK::Un("*", _) | EK::Idx(..) | EK::Str(_)) }

    /// value of an expression into a0; its type (arrays decayed)
    fn expr(&mut self, e: &E) -> Ty {
        if matches!(e.k, EK::Un(..) | EK::Bin(..) | EK::Cast(..) | EK::Cond(..)) {
            if let Some((v, t)) = Self::constant(e) { self.emit(format!("li a0, {}", v as i32)); return t; }
        }
        match &e.k {
            EK::Num(v, t) => { self.emit(format!("li a0, {}", *v as i32)); t.clone() }
            EK::Str(_) => self.addr(e).decay(),
            EK::Id(n) => {
                if self.lookup(n).is_none() && !self.globals.contains_key(n) {
                    if let Some(t) = self.funcs.get(n).cloned() {
                        // a function's name is its address (for mtvec, a thread's entry, ...)
                        self.refs.insert(n.clone());
                        self.emit(format!("la a0, {}", n));
                        return Ty::Ptr(Box::new(t));
                    }
                }
                if let Some(l) = self.lookup(n) {
                    if l.ty.is_scalar() && (-2048..2048).contains(&l.off) {
                        let op = match &l.ty { Ty::Char(true) => "lb", Ty::Char(false) => "lbu", Ty::Short(true) => "lh", Ty::Short(false) => "lhu", _ => "lw" };
                        self.emit(format!("{} a0, {}(s0)", op, l.off));
                        return l.ty;
                    }
                }
                let t = self.addr(e);
                self.load(&t);
                t.decay()
            }
            EK::Un("*", _) | EK::Idx(..) => { let t = self.addr(e); self.load(&t); t.decay() }
            EK::Un("&", a) => {
                if !Self::is_lvalue(a) { self.error(e, "& needs a variable, *p or a[i]".into()); }
                let t = self.addr(a);
                Ty::Ptr(Box::new(t))
            }
            EK::Un(op, a) => {
                let t = self.expr(a);
                match *op {
                    "-" => self.emit("neg a0, a0"),
                    "~" => self.emit("not a0, a0"),
                    "!" => { self.emit("seqz a0, a0"); return Ty::Int(true); }
                    _ => {}
                }
                if t.is_ptr() && *op != "+" { self.error(e, format!("{} on a pointer", op)); }
                promote(&t)
            }
            EK::Cast(t, a) => {
                let f = self.expr(a);
                if *t == Ty::Void { return Ty::Void; }
                if !t.is_scalar() || !f.is_scalar() { self.error(e, format!("cannot cast {} to {}", f.name(), t.name())); }
                self.convert(&f, t);
                t.clone()
            }
            EK::SizeT(t) => { self.emit(format!("li a0, {}", t.size())); Ty::Int(false) }
            EK::SizeE(a) => {
                let t = match &a.k { EK::Id(_) | EK::Un("*", _) | EK::Idx(..) | EK::Str(_) => { let (n, l, r) = (self.out.len(), self.lab, self.refs.clone()); self.dry += 1; let t = self.addr(a); self.dry -= 1; self.out.truncate(n); self.lab = l; self.refs = r; t } _ => self.type_of(a) };
                self.emit(format!("li a0, {}", t.size()));
                Ty::Int(false)
            }
            EK::Comma(a, b) => { self.expr(a); self.expr(b) }
            EK::Cond(c, a, b) => {
                let (l1, l2) = (self.new_label(), self.new_label());
                self.cond_jump(c, false, &l1);
                let ta = self.expr(a);
                self.emit(format!("j {}", l2));
                self.label(&l1);
                let tb = self.expr(b);
                self.label(&l2);
                if ta.is_ptr() { ta } else if tb.is_ptr() { tb } else { arith(&ta, &tb) }
            }
            EK::Bin("&&", a, b) | EK::Bin("||", a, b) => {
                let and = matches!(e.k, EK::Bin("&&", ..));
                let l = self.new_label();
                self.expr(a);
                self.emit("snez a0, a0");
                self.emit(format!("{} a0, {}", if and { "beqz" } else { "bnez" }, l));
                self.expr(b);
                self.emit("snez a0, a0");
                self.label(&l);
                Ty::Int(true)
            }
            EK::Bin(op, a, b) => {
                let ta = self.expr(a);
                if let Some((k, tk)) = Self::constant(b) { if let Some(t) = self.binop_imm(op, &ta, k, &tk) { return t; } }
                // t0 = a, t1 = b
                let tb = if self.is_simple(b) { self.emit("mv t0, a0"); self.load_simple(b, "t1") } else {
                    self.push();
                    let tb = self.expr(b);
                    self.emit("mv t1, a0");
                    self.pop("t0");
                    tb
                };
                self.binop(e, op, &ta, &tb)
            }
            EK::Asg(op, l, r) => {
                if !Self::is_lvalue(l) || matches!(l.k, EK::Str(_)) { self.error(e, "the left side of an assignment must be a variable, *p or a[i]".into()); }
                // a scalar variable: no address on the stack
                if let Some(s) = self.slot(l) {
                    let lt = match &s { Slot::Local(_, t) | Slot::Global(_, t) => t.clone() };
                    let rt = match op {
                        None => { let rt = self.expr(r); self.check_assign(e, &lt, &rt, r); rt }
                        Some(o) => {
                            let imm = Self::constant(r).filter(|_| !lt.is_ptr() || matches!(*o, "+" | "-"));
                            match imm {
                                Some((k, tk)) if { self.load_slot(&s, "a0"); true } && self.binop_imm(o, &lt.decay(), k, &tk).is_some() => arith(&lt, &tk),
                                _ => {
                                    if imm.is_some() { self.out.pop(); if matches!(s, Slot::Global(..)) { self.out.pop(); } }
                                    let rt = self.expr(r);
                                    self.emit("mv t1, a0");
                                    self.load_slot(&s, "t0");
                                    self.binop(e, o, &lt.decay(), &rt)
                                }
                            }
                        }
                    };
                    let rt = if lt.is_ptr() { lt.clone() } else { rt };
                    self.convert(&rt, &lt);
                    self.store_slot(&s);
                    return lt;
                }
                // a simple value: address in t0, value in a0
                if op.is_none() && self.is_simple(r) {
                    let lt = self.addr(l);
                    if matches!(lt, Ty::Arr(..)) { self.error(e, "cannot assign to an array".into()); }
                    self.emit("mv t0, a0");
                    let rt = self.load_simple(r, "a0");
                    self.check_assign(e, &lt, &rt, r);
                    self.convert(&rt, &lt);
                    self.store(&lt, "t0");
                    return lt;
                }
                let lt = self.addr(l);
                if matches!(lt, Ty::Arr(..)) { self.error(e, "cannot assign to an array".into()); }
                self.push();
                let rt = match op {
                    None => { let rt = self.expr(r); self.check_assign(e, &lt, &rt, r); rt }
                    Some(o) => {
                        self.emit("lw t0, 0(sp)");
                        self.emit("mv a0, t0");
                        self.load(&lt);
                        self.push();
                        let rt = self.expr(r);
                        self.emit("mv t1, a0");
                        self.pop("t0");
                        self.binop(e, o, &lt.decay(), &rt)
                    }
                };
                self.convert(&rt, &lt);
                self.pop("t0");
                self.store(&lt, "t0");
                lt
            }
            EK::Inc(pre, d, a) => {
                if !Self::is_lvalue(a) { self.error(e, "++ / -- need a variable, *p or a[i]".into()); }
                if let Some(s) = self.slot(a) {
                    let t = match &s { Slot::Local(_, t) | Slot::Global(_, t) => t.clone() };
                    let step = match &t { Ty::Ptr(el) => el.size() as i64 * d, _ => *d };
                    self.load_slot(&s, "a0");
                    if !pre { self.emit("mv t1, a0"); }
                    self.emit(format!("addi a0, a0, {}", step));
                    self.convert(&Ty::Int(true), &t);
                    self.store_slot(&s);
                    if !pre { self.emit("mv a0, t1"); }
                    return t;
                }
                let t = self.addr(a);
                let step = match &t { Ty::Ptr(el) => el.size() as i64 * d, t if t.is_int() => *d, _ => { self.error(e, "++ / -- need a number or a pointer".into()); 1 } };
                self.emit("mv t0, a0");
                self.load(&t);
                self.emit("mv t1, a0");
                self.emit(format!("addi a0, a0, {}", step));
                self.convert(&Ty::Int(true), &t);
                self.store(&t, "t0");
                if !pre { self.emit("mv a0, t1"); }
                t
            }
            EK::Call(name, args) => self.call(e, name, args),
        }
    }

    fn check_assign(&mut self, e: &E, lt: &Ty, rt: &Ty, r: &E) {
        let zero = matches!(r.k, EK::Num(0, _));
        let ok = (lt.is_int() && rt.is_int()) || (lt.is_ptr() && (rt.is_ptr() || zero));
        if !ok && lt.is_scalar() {
            if lt.is_ptr() && rt.is_int() { self.error(e, format!("assigning {} to {}: cast it, e.g. ({}) x", rt.name(), lt.name(), lt.name())); }
            else if lt.is_int() && rt.is_ptr() { self.error(e, format!("assigning a pointer ({}) to {}", rt.name(), lt.name())); }
        }
    }

    /// t0 op t1 -> a0
    fn binop(&mut self, e: &E, op: &str, ta: &Ty, tb: &Ty) -> Ty {
        match op {
            "+" | "-" => {
                if let (Ty::Ptr(el), Ty::Ptr(_)) = (ta, tb) {
                    if op == "+" { self.error(e, "adding two pointers".into()); }
                    self.emit("sub a0, t0, t1");
                    let s = el.size();
                    self.scale_down(s);
                    return Ty::Int(true);
                }
                if let Ty::Ptr(el) = ta { let s = el.size(); self.scale("t1", s); self.emit(format!("{} a0, t0, t1", if op == "+" { "add" } else { "sub" })); return ta.clone(); }
                if let (Ty::Ptr(el), "+") = (tb, op) { let s = el.size(); self.scale("t0", s); self.emit("add a0, t0, t1"); return tb.clone(); }
                if tb.is_ptr() { self.error(e, "number - pointer".into()); }
                self.emit(format!("{} a0, t0, t1", if op == "+" { "add" } else { "sub" }));
                arith(ta, tb)
            }
            "*" | "/" | "%" => {
                if ta.is_ptr() || tb.is_ptr() { self.error(e, format!("{} on a pointer", op)); }
                let t = arith(ta, tb);
                let i = match (op, t.unsigned()) { ("*", _) => "mul", ("/", false) => "div", ("/", true) => "divu", (_, false) => "rem", _ => "remu" };
                self.emit(format!("{} a0, t0, t1", i));
                t
            }
            "<<" | ">>" => {
                let t = promote(ta);
                self.emit(format!("{} a0, t0, t1", if op == "<<" { "sll" } else if t.unsigned() { "srl" } else { "sra" }));
                t
            }
            "&" | "|" | "^" => { self.emit(format!("{} a0, t0, t1", match op { "&" => "and", "|" => "or", _ => "xor" })); arith(ta, tb) }
            _ => {
                let u = ta.unsigned() || tb.unsigned();
                let slt = if u { "sltu" } else { "slt" };
                match op {
                    "==" => { self.emit("sub a0, t0, t1"); self.emit("seqz a0, a0"); }
                    "!=" => { self.emit("sub a0, t0, t1"); self.emit("snez a0, a0"); }
                    "<" => self.emit(format!("{} a0, t0, t1", slt)),
                    ">" => self.emit(format!("{} a0, t1, t0", slt)),
                    "<=" => { self.emit(format!("{} a0, t1, t0", slt)); self.emit("xori a0, a0, 1"); }
                    _ => { self.emit(format!("{} a0, t0, t1", slt)); self.emit("xori a0, a0, 1"); }
                }
                Ty::Int(true)
            }
        }
    }

    /// r *= size (pointer arithmetic)
    fn scale(&mut self, r: &str, size: usize) {
        if size <= 1 { return; }
        if size.is_power_of_two() { self.emit(format!("slli {}, {}, {}", r, r, size.trailing_zeros())); return; }
        self.emit(format!("li t2, {}", size));
        self.emit(format!("mul {}, {}, t2", r, r));
    }
    /// a0 /= size (pointer difference)
    fn scale_down(&mut self, size: usize) {
        if size <= 1 { return; }
        if size.is_power_of_two() { self.emit(format!("srai a0, a0, {}", size.trailing_zeros())); return; }
        self.emit(format!("li a1, {}", size));
        self.emit("div a0, a0, a1");
    }

    fn call(&mut self, e: &E, name: &str, args: &[E]) -> Ty {
        if name == "asm" || name == "__asm__" {
            match args { [E { k: EK::Str(text), .. }] => {
                let text = String::from_utf8_lossy(text).to_string();
                for n in asm_names(&text) { if self.funcs.contains_key(&n) || self.globals.contains_key(&n) { self.refs.insert(n); } }
                for l in text.lines() { if !l.trim().is_empty() { self.emit(l.trim()); } }
            } _ => self.error(e, "asm takes one string of assembly".into()) }
            return Ty::Void;
        }
        let Some(Ty::Func(ret, params, variadic)) = self.funcs.get(name).cloned() else {
            if self.lookup(name).is_some() || self.globals.contains_key(name) { self.error(e, format!("{} is not a function", name)); }
            else { self.error(e, format!("function {} is not declared", name)); }
            return Ty::Int(true);
        };
        self.refs.insert(name.to_string());
        if args.len() > 8 { self.error(e, "more than 8 arguments".into()); }
        if args.len() < params.len() || (args.len() > params.len() && !variadic) {
            self.error(e, format!("{} takes {} argument{}, not {}", name, params.len(), if params.len() == 1 { "" } else { "s" }, args.len()));
        }
        // arguments that need code first (on the stack), then the simple ones straight into a0..a7
        let simple: Vec<bool> = args.iter().map(|a| self.is_simple(a)).collect();
        let mut tys: Vec<Option<Ty>> = vec![None; args.len()];
        for (i, a) in args.iter().enumerate() { if !simple[i] { tys[i] = Some(self.expr(a)); self.push(); } }
        for i in (0..args.len().min(8)).rev() { if !simple[i] { self.pop(&format!("a{}", i)); } }
        for (i, a) in args.iter().enumerate().take(8) { if simple[i] { tys[i] = Some(self.load_simple(a, &format!("a{}", i))); } }
        for (i, a) in args.iter().enumerate() {
            let t = tys[i].clone().unwrap_or(Ty::Int(true));
            if let Some(p) = params.get(i) {
                if p.is_ptr() && t.is_int() && !matches!(a.k, EK::Num(0, _)) { self.error(a, format!("argument {} of {}: {} given where {} is expected", i + 1, name, t.name(), p.name())); }
                if p.is_int() && t.is_ptr() { self.error(a, format!("argument {} of {}: a pointer given where {} is expected", i + 1, name, p.name())); }
            }
        }
        self.emit(format!("call {}", name));
        (*ret).clone()
    }

    // ---- statements ----
    fn alloc(&mut self, ty: &Ty) -> i32 {
        let a = ty.align().max(1) as i32;
        self.frame = (self.frame + ty.size() as i32 + a - 1) / a * a;
        self.max_frame = self.max_frame.max(self.frame);
        -(ARGS + self.frame)
    }

    fn local_init(&mut self, off: i32, ty: &Ty, init: &Init, at: (usize, usize)) {
        match (ty, init) {
            (Ty::Arr(el, n), Init::List(items)) => {
                let n = n.unwrap_or(items.len());
                if items.len() > n { self.error_at(at.0, at.1, "too many initializers".into()); }
                for k in 0..n {
                    let o = off + (k * el.size()) as i32;
                    match items.get(k) { Some(i) => self.local_init(o, el, i, at), None => self.zero(o, el) }
                }
            }
            (Ty::Arr(el, n), Init::E(E { k: EK::Str(s), .. })) if matches!(**el, Ty::Char(_)) => {
                let n = n.unwrap_or(s.len() + 1);
                if s.len() > n { self.error_at(at.0, at.1, "string longer than the array".into()); }
                for k in 0..n {
                    self.frame_addr(off + k as i32);
                    self.emit(format!("li t0, {}", s.get(k).copied().unwrap_or(0)));
                    self.emit("sb t0, 0(a0)");
                }
            }
            (Ty::Arr(..), _) => self.error_at(at.0, at.1, "an array is initialized with { ... }".into()),
            (t, Init::E(x)) => {
                let rt = self.expr(x);
                self.check_assign(x, t, &rt, x);
                self.convert(&rt, t);
                if fits12(off as i64) { self.emit(format!("{} a0, {}(s0)", store_op(t), off)); return; }
                self.emit("mv t1, a0");
                self.frame_addr(off);
                self.emit("mv t0, a0");
                self.emit("mv a0, t1");
                self.store(t, "t0");
            }
            (t, Init::List(v)) => match v.as_slice() { [i] => self.local_init(off, t, i, at), _ => self.error_at(at.0, at.1, "too many initializers".into()) },
        }
    }
    fn zero(&mut self, off: i32, ty: &Ty) {
        for k in 0..ty.size() as i32 { self.frame_addr(off + k); self.emit("sb zero, 0(a0)"); }
    }

    fn stmt(&mut self, s: &S) {
        match s {
            S::Empty => {}
            S::Expr(e) => { self.note_line(e.file, e.line); self.expr(e); }
            S::Decl(ds) => for d in ds {
                self.note_line(d.file, d.line);
                let mut ty = d.ty.clone();
                if matches!(ty, Ty::Func(..)) { self.funcs.insert(d.name.clone(), ty.clone()); continue; }
                if let Ty::Arr(el, None) = &ty {
                    let n = match &d.init { Some(Init::List(v)) => v.len(), Some(Init::E(E { k: EK::Str(s), .. })) => s.len() + 1, _ => { self.error_at(d.file, d.line, format!("array {} needs a size", d.name)); 1 } };
                    ty = Ty::Arr(el.clone(), Some(n));
                }
                if ty == Ty::Void { self.error_at(d.file, d.line, format!("variable {} is void", d.name)); }
                let off = self.alloc(&ty);
                if let Some(i) = &d.init { self.local_init(off, &ty, i, (d.file, d.line)); }
                self.scopes.last_mut().unwrap().insert(d.name.clone(), Local { off, ty });
            },
            S::Block(v) => {
                self.scopes.push(HashMap::new());
                for x in v { self.stmt(x); }
                self.scopes.pop();
            }
            S::If(c, a, b) => {
                self.note_line(c.file, c.line);
                let (l1, l2) = (self.new_label(), self.new_label());
                self.cond_jump(c, false, &l1);
                self.stmt(a);
                if let Some(b) = b { self.emit(format!("j {}", l2)); self.label(&l1); self.stmt(b); self.label(&l2); } else { self.label(&l1); }
            }
            S::While(c, b) => {
                let (top, end) = (self.new_label(), self.new_label());
                self.label(&top);
                self.note_line(c.file, c.line);
                self.last_line = (usize::MAX, 0);
                self.cond_jump(c, false, &end);
                self.loop_body(b, &end, &top);
                self.emit(format!("j {}", top));
                self.label(&end);
            }
            S::Do(b, c) => {
                let (top, cont, end) = (self.new_label(), self.new_label(), self.new_label());
                self.label(&top);
                self.loop_body(b, &end, &cont);
                self.label(&cont);
                self.note_line(c.file, c.line);
                self.cond_jump(c, true, &top);
                self.label(&end);
            }
            S::For(init, c, step, b) => {
                self.scopes.push(HashMap::new());
                if let Some(i) = init { self.stmt(i); }
                let (top, cont, end) = (self.new_label(), self.new_label(), self.new_label());
                self.label(&top);
                if let Some(c) = c { self.last_line = (usize::MAX, 0); self.note_line(c.file, c.line); self.cond_jump(c, false, &end); }
                self.loop_body(b, &end, &cont);
                self.label(&cont);
                if let Some(s) = step { self.expr(s); }
                self.emit(format!("j {}", top));
                self.label(&end);
                self.scopes.pop();
            }
            S::Ret(e, f, l) => {
                self.note_line(*f, *l);
                match (e, &self.ret_ty) {
                    (Some(e), Ty::Void) => { self.error(e, "returning a value from a void function".into()); self.expr(e); }
                    (Some(e), t) => { let t = t.clone(); let rt = self.expr(e); self.convert(&rt, &t); }
                    (None, Ty::Void) => {}
                    (None, _) => { self.error_at(*f, *l, "return needs a value".into()); }
                }
                let r = self.ret_lab.clone();
                self.emit(format!("j {}", r));
            }
            S::Break(f, l) => match self.brk.last().cloned() { Some(b) => { self.note_line(*f, *l); self.emit(format!("j {}", b)); } None => self.error_at(*f, *l, "break outside a loop or switch".into()) },
            S::Cont(f, l) => match self.cont.last().cloned() { Some(b) => { self.note_line(*f, *l); self.emit(format!("j {}", b)); } None => self.error_at(*f, *l, "continue outside a loop".into()) },
            S::Switch(c, body) => {
                self.note_line(c.file, c.line);
                let end = self.new_label();
                let mut cases = vec![];
                collect_cases(body, &mut cases);
                let labels: Vec<(Option<i64>, String)> = cases.iter().map(|v| (*v, self.new_label())).collect();
                let mut seen = HashSet::new();
                for (v, _) in &labels { if !seen.insert(*v) { self.error(c, format!("duplicate case {}", v.map(|x| x.to_string()).unwrap_or("default".into()))); } }
                self.expr(c);
                for (v, l) in &labels { if let Some(v) = v { self.emit(format!("li t0, {}", *v as i32)); self.emit(format!("beq a0, t0, {}", l)); } }
                let dflt = labels.iter().find(|x| x.0.is_none()).map(|x| x.1.clone()).unwrap_or(end.clone());
                self.emit(format!("j {}", dflt));
                self.cases.push(labels);
                self.brk.push(end.clone());
                self.stmt(body);
                self.brk.pop();
                self.cases.pop();
                self.label(&end);
            }
            S::Case(v, f, l) => {
                let lab = self.cases.last().and_then(|c| c.iter().find(|x| x.0 == Some(*v)).map(|x| x.1.clone()));
                match lab { Some(l) => self.label(&l), None => self.error_at(*f, *l, "case outside a switch".into()) }
            }
            S::Default(f, l) => {
                let lab = self.cases.last().and_then(|c| c.iter().find(|x| x.0.is_none()).map(|x| x.1.clone()));
                match lab { Some(l) => self.label(&l), None => self.error_at(*f, *l, "default outside a switch".into()) }
            }
        }
    }

    fn loop_body(&mut self, b: &S, brk: &str, cont: &str) {
        self.brk.push(brk.to_string());
        self.cont.push(cont.to_string());
        self.stmt(b);
        self.brk.pop();
        self.cont.pop();
    }

    fn function(&mut self, f: &Func) -> (Vec<String>, HashSet<String>) {
        let Ty::Func(ret, ptys, variadic) = &f.ty else { unreachable!() };
        self.out.clear();
        self.refs.clear();
        // a body of asm statements only: naked (no prologue / epilogue: the assembly returns itself)
        if let S::Block(v) = &f.body {
            let is_asm = |s: &S| matches!(s, S::Expr(E { k: EK::Call(n, _), .. }) if n == "asm" || n == "__asm__");
            if !v.is_empty() && v.iter().all(|s| is_asm(s) || matches!(s, S::Empty)) {
                self.scopes = vec![HashMap::new()];
                for s in v { self.stmt(s); }
                let mut out = vec![format!("{}:", f.name)];
                out.extend(std::mem::take(&mut self.out));
                return (out, std::mem::take(&mut self.refs));
            }
        }
        self.frame = 0;
        self.max_frame = 0;
        self.ret_ty = (**ret).clone();
        self.ret_lab = format!(".Lret_{}", f.name);
        self.last_line = (usize::MAX, 0);
        let mut scope = HashMap::new();
        for (i, (n, t)) in f.params.iter().zip(ptys).enumerate() {
            if n.is_empty() { self.error_at(f.file, f.line, format!("parameter {} of {} needs a name", i + 1, f.name)); }
            scope.insert(n.clone(), Local { off: -ARGS + 4 * i as i32, ty: t.clone() });
        }
        if ptys.len() > 8 { self.error_at(f.file, f.line, "more than 8 parameters".into()); }
        self.scopes = vec![scope];
        self.note_line(f.file, f.line);
        self.stmt(&f.body);
        let body = std::mem::take(&mut self.out);
        let frame = (ARGS + self.max_frame + 15) / 16 * 16;
        // prologue: frame, return address, frame pointer s0 (= the caller's sp)
        let mut v = vec![format!("{}:", f.name)];
        if frame < 2048 {
            v.push(format!("    addi sp, sp, -{}", frame));
            v.push(format!("    sw ra, {}(sp)", frame - 4));
            v.push(format!("    sw s0, {}(sp)", frame - 8));
            v.push(format!("    addi s0, sp, {}", frame));
        } else {
            v.push("    mv t0, sp".into());
            v.push(format!("    li t1, -{}", frame));
            v.push("    add sp, sp, t1".into());
            v.push("    sw ra, -4(t0)".into());
            v.push("    sw s0, -8(t0)".into());
            v.push("    mv s0, t0".into());
        }
        let saved = if *variadic { 8 } else { ptys.len().min(8) };
        for i in 0..saved { v.push(format!("    sw a{}, {}(s0)", i, -ARGS + 4 * i as i32)); }
        v.extend(body);
        // falling off the end returns 0 (main) / whatever is in a0
        if f.name == "main" { v.push("    li a0, 0".into()); }
        v.push(format!("{}:", self.ret_lab));
        // never read below sp: an interrupt pushes its frame there
        v.push("    addi sp, s0, -8".into());
        v.push("    lw ra, 4(sp)".into());
        v.push("    lw s0, 0(sp)".into());
        v.push("    addi sp, sp, 8".into());
        v.push("    ret".into());
        (v, std::mem::take(&mut self.refs))
    }
}

fn collect_cases(s: &S, out: &mut Vec<Option<i64>>) {
    match s {
        S::Case(v, ..) => out.push(Some(*v)),
        S::Default(..) => out.push(None),
        S::Block(v) => for x in v { collect_cases(x, out); },
        S::If(_, a, b) => { collect_cases(a, out); if let Some(b) = b { collect_cases(b, out); } }
        S::While(_, b) | S::Do(b, _) | S::For(_, _, _, b) => collect_cases(b, out),
        _ => {}
    }
}

fn has_unsigned(e: &E) -> bool {
    match &e.k {
        EK::Num(_, t) => *t == Ty::Int(false),
        EK::Un(_, a) => has_unsigned(a),
        EK::Bin(_, a, b) => has_unsigned(a) || has_unsigned(b),
        EK::Cond(_, a, b) => has_unsigned(a) || has_unsigned(b),
        EK::Cast(t, _) => t.unsigned(),
        EK::SizeT(_) => true,
        _ => false,
    }
}

/// where a scalar variable lives
#[derive(Clone)]
enum Slot { Local(i32, Ty), Global(String, Ty) }

fn load_op(t: &Ty) -> &'static str { match t { Ty::Char(true) => "lb", Ty::Char(false) => "lbu", Ty::Short(true) => "lh", Ty::Short(false) => "lhu", _ => "lw" } }
fn store_op(t: &Ty) -> &'static str { match t.size() { 1 => "sb", 2 => "sh", _ => "sw" } }
fn fits12(v: i64) -> bool { (-2048..2048).contains(&v) }

fn promote(t: &Ty) -> Ty { match t { Ty::Char(_) | Ty::Short(_) => Ty::Int(true), t => t.clone() } }
fn arith(a: &Ty, b: &Ty) -> Ty { if promote(a) == Ty::Int(false) || promote(b) == Ty::Int(false) { Ty::Int(false) } else { Ty::Int(true) } }

/// bytes of a global's initial value (and the symbols it refers to)
fn global_bytes(ty: &Ty, init: &Init, strings: &mut Vec<Vec<u8>>, out: &mut Vec<String>, refs: &mut HashSet<String>) -> Result<(), String> {
    match (ty, init) {
        (Ty::Arr(el, Some(n)), Init::List(items)) => {
            if items.len() > *n { return Err("too many initializers".into()); }
            for k in 0..*n {
                match items.get(k) { Some(i) => global_bytes(el, i, strings, out, refs)?, None => out.push(format!("    .zero {}", el.size())) }
            }
            Ok(())
        }
        (Ty::Arr(el, Some(n)), Init::E(E { k: EK::Str(s), .. })) if matches!(**el, Ty::Char(_)) => {
            if s.len() > *n { return Err("string longer than the array".into()); }
            let mut b = s.clone();
            b.resize(*n, 0);
            out.push(format!("    .byte {}", b.iter().map(|x| x.to_string()).collect::<Vec<_>>().join(", ")));
            Ok(())
        }
        (Ty::Arr(..), _) => Err("an array is initialized with { ... }".into()),
        (t, Init::List(v)) if v.len() == 1 => global_bytes(t, &v[0], strings, out, refs),
        (t, Init::E(e)) => {
            let dir = match t.size() { 1 => ".byte", 2 => ".half", _ => ".word" };
            if let Some(v) = const_eval(e) { out.push(format!("    {} {}", dir, v as i32)); return Ok(()); }
            // addresses: "string", &global, array (decays), &a[k] / a + k
            let sym = |e: &E, strings: &mut Vec<Vec<u8>>| -> Option<String> {
                match &e.k {
                    EK::Str(s) => { let i = strings.iter().position(|x| x == s).unwrap_or_else(|| { strings.push(s.clone()); strings.len() - 1 }); Some(format!(".LS{}", i)) }
                    EK::Id(n) => Some(n.clone()),
                    EK::Un("&", a) => match &a.k { EK::Id(n) => Some(n.clone()), _ => None },
                    _ => None,
                }
            };
            match sym(e, strings) {
                Some(s) if t.size() == 4 => { refs.insert(s.clone()); out.push(format!("    .word {}", s)); Ok(()) }
                _ => Err("a global needs a constant initializer (a number, a string or the address of a global)".into()),
            }
        }
        _ => Err("bad initializer".into()),
    }
}

/// Compile a C program (with the runtime library) to assembly and assemble it
pub fn compile(name: &str, src: &str, opts: &Options) -> Result<Output, Vec<Diag>> {
    let files = vec!["<runtime>".to_string(), name.to_string()];
    let mut pre = Pre { macros: HashMap::new(), errs: vec![], files: &files };
    pre.macros.insert("__VERYL2CHIP__".into(), Macro { params: None, variadic: false, body: vec![Token { t: Tok::Num(1, false), file: 0, line: 0 }] });
    pre.macros.insert("RAM_SIZE".into(), Macro { params: None, variadic: false, body: vec![Token { t: Tok::Num(opts.mem_size as i64, false), file: 0, line: 0 }] });
    let mut toks = vec![];
    pre.run(0, PRELUDE, &mut toks);
    pre.run(1, src, &mut toks);
    let mut errs = std::mem::take(&mut pre.errs);
    let mut p = Parser { t: toks, p: 0, errs: vec![], files: &files };
    let (funcs, globals, protos, asms) = p.unit();
    errs.extend(p.errs);

    let mut g = Gen {
        files: &files, user_file: 1, src_lines: vec![PRELUDE.lines().map(|s| s.to_string()).collect(), src.lines().map(|s| s.to_string()).collect()],
        globals: HashMap::new(), funcs: HashMap::new(), scopes: vec![], frame: 0, max_frame: 0, out: vec![], lab: 0, brk: vec![], cont: vec![], cases: vec![],
        strings: vec![], refs: HashSet::new(), ret_ty: Ty::Void, ret_lab: String::new(), errs: vec![], last_line: (usize::MAX, 0), dry: 0,
    };
    for (n, t, f, l) in &protos {
        if let Some(old) = g.funcs.get(n) { if old != t { g.error_at(*f, *l, format!("{} declared twice with different types", n)); } }
        g.funcs.insert(n.clone(), t.clone());
    }
    let mut defined = HashSet::new();
    for f in &funcs {
        if !defined.insert(f.name.clone()) { g.error_at(f.file, f.line, format!("function {} defined twice", f.name)); }
        if let Some(old) = g.funcs.get(&f.name) { if old != &f.ty { g.error_at(f.file, f.line, format!("{} does not match its declaration", f.name)); } }
        g.funcs.insert(f.name.clone(), f.ty.clone());
    }
    // globals: sizes of open arrays from their initializers
    let mut gl: Vec<Decl> = vec![];
    for d in globals {
        let mut d = d;
        if let Ty::Arr(el, None) = &d.ty {
            let n = match &d.init { Some(Init::List(v)) => v.len(), Some(Init::E(E { k: EK::Str(s), .. })) => s.len() + 1, _ => { g.error_at(d.file, d.line, format!("array {} needs a size", d.name)); 1 } };
            d.ty = Ty::Arr(el.clone(), Some(n));
        }
        if let Some(i) = gl.iter().position(|x| x.name == d.name) {
            // `extern int x;` then `int x = 1;`
            if gl[i].ty != d.ty { g.error_at(d.file, d.line, format!("{} declared twice with different types", d.name)); }
            if d.init.is_some() { gl[i] = d; }
            continue;
        }
        if g.funcs.contains_key(&d.name) { g.error_at(d.file, d.line, format!("{} is a function", d.name)); }
        g.globals.insert(d.name.clone(), d.ty.clone());
        gl.push(d);
    }
    if !g.funcs.contains_key("main") || !defined.contains("main") { g.errs.push(Diag { file: name.into(), line: 1, msg: "no main function".into() }); }
    // code per function, then keep what main needs
    let mut code: HashMap<String, (Vec<String>, HashSet<String>)> = HashMap::new();
    for f in &funcs { let c = g.function(f); code.insert(f.name.clone(), c); }
    let mut data: HashMap<String, (Vec<String>, HashSet<String>, usize, bool)> = HashMap::new();
    for d in &gl {
        let mut out = vec![];
        let mut refs = HashSet::new();
        let has = d.init.is_some();
        if let Some(i) = &d.init {
            if let Err(m) = global_bytes(&d.ty, i, &mut g.strings, &mut out, &mut refs) { g.error_at(d.file, d.line, format!("{}: {}", d.name, m)); }
        }
        if d.ty.size() == 0 || d.ty == Ty::Void { g.error_at(d.file, d.line, format!("{} has no size", d.name)); }
        data.insert(d.name.clone(), (out, refs, d.ty.align(), has));
    }
    errs.extend(std::mem::take(&mut g.errs));
    // reachability
    let mut keep: Vec<String> = vec![];
    let mut todo = vec!["main".to_string()];
    // what top-level assembly refers to
    for a in &asms { for n in asm_names(a) { if code.contains_key(&n) || data.contains_key(&n) { todo.push(n); } } }
    // labels defined by top-level assembly
    let asm_labels: HashSet<String> = asms.iter().flat_map(|a| a.lines().filter_map(|l| l.trim().strip_suffix(':').map(|w| w.to_string())).collect::<Vec<_>>()).collect();
    let mut seen = HashSet::new();
    while let Some(n) = todo.pop() {
        if !seen.insert(n.clone()) { continue; }
        keep.push(n.clone());
        let refs = code.get(&n).map(|c| &c.1).or_else(|| data.get(&n).map(|d| &d.1));
        match refs {
            Some(r) => todo.extend(r.iter().cloned()),
            None if n.starts_with(".LS") => {}
            None => {
                let (f, l) = funcs.iter().find(|f| code.get(&f.name).is_some_and(|c| c.1.contains(&n))).map(|f| (1usize.min(f.file), f.line)).unwrap_or((1, 1));
                if g.funcs.contains_key(&n) && !asm_labels.contains(&n) { errs.push(Diag { file: files[f].clone(), line: l, msg: format!("function {} is declared but never defined", n) }); }
            }
        }
    }
    if !errs.is_empty() { errs.sort_by(|a, b| (a.file != *name, a.line).cmp(&(b.file != *name, b.line))); errs.dedup(); return Err(errs); }

    let mut s = String::new();
    s += &format!("# compiled by veryl-eda's C compiler ({} bytes of RAM)\n    .text\n_start:\n    li sp, {}\n", opts.mem_size, opts.mem_size);
    s += "    la t0, __bss_start\n    la t1, __bss_end\n.Lbss:\n    bgeu t0, t1, .Lmain\n    sw zero, 0(t0)\n    addi t0, t0, 4\n    j .Lbss\n.Lmain:\n    call main\n_halt:\n    j _halt\n";
    // functions in source order (runtime first), then top-level assembly
    for f in &funcs {
        if keep.contains(&f.name) {
            s += "\n";
            for l in &code[&f.name].0 { s += l; s.push('\n'); }
        }
    }
    for a in &asms { s += "\n    .text\n"; s += a; s.push('\n'); }
    let strs: Vec<(usize, &Vec<u8>)> = g.strings.iter().enumerate().filter(|(i, _)| keep.contains(&format!(".LS{}", i))).collect();
    if !strs.is_empty() {
        s += "\n    .rodata\n";
        for (i, b) in strs {
            s += &format!(".LS{}:\n    .byte {}\n", i, b.iter().chain(std::iter::once(&0)).map(|x| x.to_string()).collect::<Vec<_>>().join(", "));
        }
    }
    for (sec, init) in [(".data", true), (".bss", false)] {
        let mut first = true;
        for d in gl.iter().filter(|d| keep.contains(&d.name)) {
            let (out, _, align, has) = &data[&d.name];
            if *has != init { continue; }
            if first { s += &format!("\n    {}\n", sec); first = false; }
            s += &format!("    .balign {}\n{}:\n", align, d.name);
            if init { for l in out { s += l; s.push('\n'); } } else { s += &format!("    .zero {}\n", d.ty.size()); }
        }
    }
    let program = asm::assemble(&s).map_err(|es| es.into_iter().map(|e| Diag { file: format!("{} (assembly)", name), line: e.line, msg: e.msg }).collect::<Vec<_>>())?;
    if program.end + 256 > opts.mem_size {
        return Err(vec![Diag { file: name.into(), line: 1, msg: format!("the program needs {} bytes; the RAM has {} (and the stack needs room)", program.end, opts.mem_size) }]);
    }
    Ok(Output { asm: s, program })
}
