//! A two-pass RV32I assembler: GNU-style syntax (labels, `#` comments, `off(reg)`
//! operands, `%hi` / `%lo`), the common pseudo-instructions and data directives.
//! Sections `.text`, `.rodata`, `.data`, `.bss` are laid out in that order from
//! address 0 into one flat image (the SoC loads it into RAM as it is).

use std::collections::HashMap;

/// one assembled source line (for the listing)
#[derive(Clone, Debug)]
pub struct Line {
    pub addr: u32,
    pub bytes: Vec<u8>,
    /// source line number (1-based) and its text
    pub line: usize,
    pub text: String,
}

#[derive(Clone, Debug)]
pub struct Program {
    /// the image from address 0 (bss not included: memory past the image reads 0 at power-up)
    pub bytes: Vec<u8>,
    pub symbols: Vec<(String, u32)>,
    pub listing: Vec<Line>,
    /// end of all sections, bss included
    pub end: u32,
}

impl Program {
    pub fn symbol(&self, name: &str) -> Option<u32> { self.symbols.iter().find(|s| s.0 == name).map(|s| s.1) }
}

#[derive(Clone, Debug, PartialEq)]
pub struct Error { pub line: usize, pub msg: String }

const SECTIONS: [&str; 4] = [".text", ".rodata", ".data", ".bss"];

pub fn reg(s: &str) -> Option<u32> {
    let abi = ["zero", "ra", "sp", "gp", "tp", "t0", "t1", "t2", "s0", "s1", "a0", "a1", "a2", "a3", "a4", "a5", "a6", "a7",
        "s2", "s3", "s4", "s5", "s6", "s7", "s8", "s9", "s10", "s11", "t3", "t4", "t5", "t6"];
    if let Some(i) = abi.iter().position(|r| *r == s) { return Some(i as u32); }
    if s == "fp" { return Some(8); }
    let n: u32 = s.strip_prefix('x')?.parse().ok()?;
    (n < 32).then_some(n)
}

/// a parsed operand expression: symbol + constant, maybe wrapped in %hi / %lo
#[derive(Clone, Debug)]
struct Expr { sym: Option<String>, off: i64, part: Part }
#[derive(Clone, Copy, Debug, PartialEq)]
enum Part { All, Hi, Lo }

fn parse_num(s: &str) -> Option<i64> {
    let s = s.trim();
    let (neg, t) = match s.strip_prefix('-') { Some(t) => (true, t.trim()), None => (false, s) };
    let v = if let Some(h) = t.strip_prefix("0x").or_else(|| t.strip_prefix("0X")) { i64::from_str_radix(h, 16).ok()? }
        else if let Some(b) = t.strip_prefix("0b") { i64::from_str_radix(b, 2).ok()? }
        else if t.len() >= 3 && t.starts_with('\'') && t.ends_with('\'') { unescape(&t[1..t.len() - 1]).ok()?.first().copied()? as i64 }
        else { t.parse().ok()? };
    Some(if neg { -v } else { v })
}

fn parse_expr(s: &str) -> Result<Expr, String> {
    let s = s.trim();
    for (p, part) in [("%hi(", Part::Hi), ("%lo(", Part::Lo)] {
        if let Some(r) = s.strip_prefix(p) {
            let inner = r.strip_suffix(')').ok_or_else(|| format!("missing ) in {}", s))?;
            let mut e = parse_expr(inner)?;
            e.part = part;
            return Ok(e);
        }
    }
    // terms separated by + / - (a leading - belongs to the first term)
    let mut e = Expr { sym: None, off: 0, part: Part::All };
    let b = s.as_bytes();
    let mut start = 0;
    let mut sign = 1i64;
    let mut i = 0;
    let mut in_char = false;
    loop {
        let end = i == b.len();
        if !end && b[i] == b'\'' { in_char = !in_char; }
        if end || (!in_char && i > start && (b[i] == b'+' || b[i] == b'-')) {
            let t = s[start..i].trim();
            if t.is_empty() { return Err(format!("bad expression {}", s)); }
            if let Some(v) = parse_num(t) { e.off += sign * v; }
            else if t.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '.' || c == '$') && sign == 1 && e.sym.is_none() { e.sym = Some(t.to_string()); }
            else { return Err(format!("bad operand {}", t)); }
            if end { break; }
            sign = if b[i] == b'-' { -1 } else { 1 };
            start = i + 1;
        }
        i += 1;
    }
    Ok(e)
}

pub fn unescape(s: &str) -> Result<Vec<u8>, String> {
    let mut out = vec![];
    let mut it = s.bytes().peekable();
    while let Some(c) = it.next() {
        if c != b'\\' { out.push(c); continue; }
        let Some(e) = it.next() else { return Err("trailing \\".into()) };
        out.push(match e {
            b'n' => b'\n', b't' => b'\t', b'r' => b'\r', b'0' => 0, b'\\' => b'\\', b'\'' => b'\'', b'"' => b'"', b'a' => 7, b'b' => 8, b'f' => 12, b'v' => 11, b'e' => 27,
            b'x' => {
                let mut v = 0u32;
                let mut n = 0;
                while let Some(h) = it.peek().and_then(|c| (*c as char).to_digit(16)) { v = v * 16 + h; it.next(); n += 1; }
                if n == 0 { return Err("bad \\x escape".into()); }
                v as u8
            }
            o => return Err(format!("unknown escape \\{}", o as char)),
        });
    }
    Ok(out)
}

/// split operands at top-level commas (not inside quotes or parentheses)
fn operands(s: &str) -> Vec<String> {
    let mut v = vec![];
    let (mut cur, mut depth, mut q) = (String::new(), 0, None::<char>);
    let mut esc = false;
    for c in s.chars() {
        if let Some(qc) = q {
            cur.push(c);
            if esc { esc = false; } else if c == '\\' { esc = true; } else if c == qc { q = None; }
            continue;
        }
        match c {
            '"' | '\'' => { q = Some(c); cur.push(c); }
            '(' => { depth += 1; cur.push(c); }
            ')' => { depth -= 1; cur.push(c); }
            ',' if depth == 0 => { v.push(cur.trim().to_string()); cur.clear(); }
            _ => cur.push(c),
        }
    }
    if !cur.trim().is_empty() { v.push(cur.trim().to_string()); }
    v
}

/// strip a comment (`#` or `//`, not inside quotes)
fn strip_comment(l: &str) -> &str {
    let mut q = None::<char>;
    let mut esc = false;
    let b: Vec<char> = l.chars().collect();
    let mut byte = 0;
    for (i, &c) in b.iter().enumerate() {
        if let Some(qc) = q {
            if esc { esc = false; } else if c == '\\' { esc = true; } else if c == qc { q = None; }
        } else if c == '"' || c == '\'' { q = Some(c); }
        else if c == '#' || (c == '/' && b.get(i + 1) == Some(&'/')) { return &l[..byte]; }
        byte += c.len_utf8();
    }
    l
}

enum Item {
    Inst { op: String, args: Vec<String> },
    Data(Vec<u8>),
    Words { size: usize, vals: Vec<String> },
    Align,
    Space,
}

struct Stmt { sec: usize, offset: u32, size: u32, item: Item, line: usize, text: String }

fn fits12(v: i64) -> bool { (-2048..2048).contains(&v) }

/// instruction size in bytes, known in pass 1
fn inst_size(op: &str, args: &[String]) -> u32 {
    match op {
        "li" => match args.get(1).and_then(|a| parse_num(a)) { Some(v) if fits12(v) => 4, Some(v) if v & 0xfff == 0 => 4, _ => 8 },
        "la" => 8,
        _ => 4,
    }
}

pub fn assemble(src: &str) -> Result<Program, Vec<Error>> {
    let mut errs = vec![];
    let mut stmts: Vec<Stmt> = vec![];
    let mut labels: Vec<(String, usize, u32, usize)> = vec![]; // name, section, offset, line
    let mut equ: HashMap<String, i64> = HashMap::new();
    let mut sec = 0usize;
    let mut off = [0u32; 4];
    // every non-empty line and where it is (labels and comments go into the listing too)
    let mut at: Vec<(usize, usize, u32, String)> = vec![];
    for (ln, raw) in src.lines().enumerate() {
        let ln = ln + 1;
        if !raw.trim().is_empty() { at.push((ln, sec, off[sec], raw.trim_end().to_string())); }
        let mut l = strip_comment(raw).trim();
        // labels (several allowed)
        loop {
            let Some(p) = l.find(':') else { break };
            let name = &l[..p];
            if name.is_empty() || !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '.' || c == '$') { break; }
            if labels.iter().any(|x| x.0 == name) { errs.push(Error { line: ln, msg: format!("label {} defined twice", name) }); }
            labels.push((name.to_string(), sec, off[sec], ln));
            l = l[p + 1..].trim();
        }
        if l.is_empty() { continue; }
        let (op, rest) = match l.find(char::is_whitespace) { Some(p) => (&l[..p], l[p..].trim()), None => (l, "") };
        let op = op.to_ascii_lowercase();
        let args = operands(rest);
        let mut push = |item: Item, size: u32, sec: usize, off: &mut [u32; 4]| {
            stmts.push(Stmt { sec, offset: off[sec], size, item, line: ln, text: raw.trim().to_string() });
            off[sec] += size;
        };
        if op.starts_with('.') {
            match op.as_str() {
                ".text" | ".rodata" | ".data" | ".bss" => sec = SECTIONS.iter().position(|s| *s == op).unwrap(),
                ".section" => {
                    let n = args.first().map(|s| s.as_str()).unwrap_or("");
                    sec = if n.starts_with(".rodata") { 1 } else if n.starts_with(".data") || n.starts_with(".sdata") { 2 } else if n.starts_with(".bss") || n.starts_with(".sbss") { 3 } else { 0 };
                }
                ".globl" | ".global" | ".local" | ".type" | ".size" | ".file" | ".ident" | ".option" | ".attribute" => {}
                ".align" | ".p2align" | ".balign" => {
                    let n = args.first().and_then(|a| parse_num(a)).unwrap_or(2) as u32;
                    let a = if op == ".balign" { n.max(1) } else { 1 << n.min(12) };
                    let pad = (a - off[sec] % a) % a;
                    push(Item::Align, pad, sec, &mut off);
                }
                ".word" | ".4byte" | ".long" | ".half" | ".2byte" | ".short" | ".byte" => {
                    let size = match op.as_str() { ".word" | ".4byte" | ".long" => 4, ".half" | ".2byte" | ".short" => 2, _ => 1 };
                    let n = args.len() as u32 * size as u32;
                    push(Item::Words { size, vals: args.clone() }, n, sec, &mut off);
                }
                ".ascii" | ".asciz" | ".string" => {
                    let mut data = vec![];
                    for a in &args {
                        match a.strip_prefix('"').and_then(|x| x.strip_suffix('"')).map(unescape) {
                            Some(Ok(b)) => { data.extend(b); if op != ".ascii" { data.push(0); } }
                            Some(Err(e)) => errs.push(Error { line: ln, msg: e }),
                            None => errs.push(Error { line: ln, msg: format!("{} needs a string", op) }),
                        }
                    }
                    let n = data.len() as u32;
                    push(Item::Data(data), n, sec, &mut off);
                }
                ".space" | ".zero" | ".skip" => {
                    let n = args.first().and_then(|a| parse_num(a).or_else(|| equ.get(a.as_str()).copied())).unwrap_or(-1);
                    if n < 0 { errs.push(Error { line: ln, msg: format!("{} needs a size", op) }); continue; }
                    push(Item::Space, n as u32, sec, &mut off);
                }
                ".equ" | ".set" => {
                    match (args.first(), args.get(1).and_then(|a| parse_num(a))) {
                        (Some(n), Some(v)) => { equ.insert(n.clone(), v); }
                        _ => errs.push(Error { line: ln, msg: format!("{} name, constant", op) }),
                    }
                }
                _ => errs.push(Error { line: ln, msg: format!("unknown directive {}", op) }),
            }
            continue;
        }
        if sec == 3 { errs.push(Error { line: ln, msg: "instructions in .bss".into() }); continue; }
        let size = inst_size(&op, &args);
        push(Item::Inst { op, args }, size, sec, &mut off);
    }
    // section bases: text, rodata, data, bss (each word aligned)
    let mut base = [0u32; 4];
    for s in 1..4 { base[s] = (base[s - 1] + off[s - 1] + 3) & !3; }
    let end = base[3] + off[3];
    let mut sym: HashMap<String, i64> = equ.clone();
    for (n, s, o, _) in &labels { sym.insert(n.clone(), (base[*s] + o) as i64); }
    sym.insert("__bss_start".into(), base[3] as i64);
    sym.insert("__bss_end".into(), ((end + 3) & !3) as i64);
    sym.entry("__end".into()).or_insert(end as i64);

    let image_len = base[2] + off[2];
    let mut bytes = vec![0u8; image_len as usize];
    let mut listing = vec![];
    for st in &stmts {
        let addr = base[st.sec] + st.offset;
        let mut out: Vec<u8> = vec![];
        let r = (|| -> Result<(), String> {
            let value = |e: &Expr| -> Result<i64, String> {
                let mut v = e.off;
                // `.` is the address of this line
                if let Some(s) = &e.sym { v += if s == "." { addr as i64 } else { *sym.get(s).ok_or_else(|| format!("undefined symbol {}", s))? }; }
                Ok(match e.part { Part::All => v, Part::Hi => ((v + 0x800) >> 12) & 0xfffff, Part::Lo => ((v & 0xfff) ^ 0x800) - 0x800 })
            };
            let ev = |s: &str| -> Result<i64, String> { value(&parse_expr(s)?) };
            match &st.item {
                Item::Data(d) => out.extend(d),
                Item::Align | Item::Space => out.resize(st.size as usize, 0),
                Item::Words { size, vals } => for v in vals {
                    let x = ev(v)?;
                    out.extend(&(x as u32).to_le_bytes()[..*size]);
                },
                Item::Inst { op, args } => for w in encode(op, args, addr, &ev)? { out.extend(w.to_le_bytes()); },
            }
            Ok(())
        })();
        if let Err(msg) = r { errs.push(Error { line: st.line, msg }); continue; }
        if out.len() as u32 != st.size { errs.push(Error { line: st.line, msg: format!("internal: size {} != {}", out.len(), st.size) }); continue; }
        if st.sec != 3 { bytes[addr as usize..addr as usize + out.len()].copy_from_slice(&out); }
        listing.push(Line { addr, bytes: if st.sec == 3 { vec![] } else { out }, line: st.line, text: st.text.clone() });
    }
    // lines without code (labels, comments, directives) at their address, in source order
    let coded: std::collections::HashSet<usize> = listing.iter().map(|l| l.line).collect();
    for (ln, sec, o, text) in at { if !coded.contains(&ln) { listing.push(Line { addr: base[sec] + o, bytes: vec![], line: ln, text }); } }
    listing.sort_by_key(|l| l.line);
    if !errs.is_empty() { errs.sort_by_key(|e| e.line); return Err(errs); }
    let mut symbols: Vec<(String, u32)> = labels.iter().map(|(n, s, o, _)| (n.clone(), base[*s] + o)).collect();
    symbols.sort_by_key(|s| s.1);
    Ok(Program { bytes, symbols, listing, end })
}

fn r_type(f7: u32, rs2: u32, rs1: u32, f3: u32, rd: u32, op: u32) -> u32 { f7 << 25 | rs2 << 20 | rs1 << 15 | f3 << 12 | rd << 7 | op }
fn i_type(imm: i64, rs1: u32, f3: u32, rd: u32, op: u32) -> u32 { ((imm as u32) & 0xfff) << 20 | rs1 << 15 | f3 << 12 | rd << 7 | op }
fn s_type(imm: i64, rs2: u32, rs1: u32, f3: u32, op: u32) -> u32 {
    let i = imm as u32;
    ((i >> 5) & 0x7f) << 25 | rs2 << 20 | rs1 << 15 | f3 << 12 | (i & 0x1f) << 7 | op
}
fn b_type(off: i64, rs2: u32, rs1: u32, f3: u32) -> u32 {
    let i = off as u32;
    ((i >> 12) & 1) << 31 | ((i >> 5) & 0x3f) << 25 | rs2 << 20 | rs1 << 15 | f3 << 12 | ((i >> 1) & 0xf) << 8 | ((i >> 11) & 1) << 7 | 0x63
}
fn j_type(off: i64, rd: u32) -> u32 {
    let i = off as u32;
    ((i >> 20) & 1) << 31 | ((i >> 1) & 0x3ff) << 21 | ((i >> 11) & 1) << 20 | ((i >> 12) & 0xff) << 12 | rd << 7 | 0x6f
}

fn encode(op: &str, a: &[String], pc: u32, ev: &dyn Fn(&str) -> Result<i64, String>) -> Result<Vec<u32>, String> {
    let n = |k: usize| -> Result<(), String> { if a.len() == k { Ok(()) } else { Err(format!("{} takes {} operand{}", op, k, if k == 1 { "" } else { "s" })) } };
    let r = |i: usize| -> Result<u32, String> { let s = a.get(i).ok_or_else(|| format!("{}: missing operand", op))?; reg(s).ok_or_else(|| format!("{}: {} is not a register", op, s)) };
    let imm12 = |v: i64| -> Result<i64, String> { if fits12(v) { Ok(v) } else { Err(format!("{}: immediate {} out of range (-2048..2047)", op, v)) } };
    let target = |i: usize, bits: u32| -> Result<i64, String> {
        let t = ev(a.get(i).ok_or_else(|| format!("{}: missing target", op))?)?;
        let d = t - pc as i64;
        let lim = 1i64 << bits;
        if d < -lim || d >= lim || d & 1 != 0 { return Err(format!("{}: target out of range ({} bytes away)", op, d)); }
        Ok(d)
    };
    // `off(reg)` or `off` (then x0)
    let mem = |i: usize| -> Result<(i64, u32), String> {
        let s = a.get(i).ok_or_else(|| format!("{}: missing address", op))?;
        if let Some(p) = s.rfind('(') {
            let rr = s[p + 1..].trim_end_matches(')').trim();
            let base = reg(rr).ok_or_else(|| format!("{}: {} is not a register", op, rr))?;
            let o = s[..p].trim();
            Ok((if o.is_empty() { 0 } else { ev(o)? }, base))
        } else { Ok((ev(s)?, 0)) }
    };
    let alu_i = ["addi", "slti", "sltiu", "xori", "ori", "andi"];
    let alu_r = ["add", "sub", "sll", "slt", "sltu", "xor", "srl", "sra", "or", "and"];
    let br = ["beq", "bne", "blt", "bge", "bltu", "bgeu"];
    let f3b = |o: &str| match o { "beq" => 0, "bne" => 1, "blt" => 4, "bge" => 5, "bltu" => 6, _ => 7 };
    Ok(match op {
        "lui" | "auipc" => {
            n(2)?;
            let v = ev(&a[1])?;
            if !(0..=0xfffff).contains(&v) && !(-0x80000..0).contains(&v) { return Err(format!("{}: immediate {} out of range", op, v)); }
            vec![((v as u32) & 0xfffff) << 12 | r(0)? << 7 | if op == "lui" { 0x37 } else { 0x17 }]
        }
        "jal" => match a.len() {
            1 => vec![j_type(target(0, 20)?, 1)],
            _ => { n(2)?; vec![j_type(target(1, 20)?, r(0)?)] }
        },
        "jalr" => match a.len() {
            1 => vec![i_type(0, r(0)?, 0, 1, 0x67)],
            2 if a[1].contains('(') => { let (o, b) = mem(1)?; vec![i_type(imm12(o)?, b, 0, r(0)?, 0x67)] }
            _ => { n(3)?; vec![i_type(imm12(ev(&a[2])?)?, r(1)?, 0, r(0)?, 0x67)] }
        },
        o if br.contains(&o) => { n(3)?; vec![b_type(target(2, 12)?, r(1)?, r(0)?, f3b(o))] }
        "lb" | "lh" | "lw" | "lbu" | "lhu" => {
            n(2)?;
            let (o, b) = mem(1)?;
            let f3 = match op { "lb" => 0, "lh" => 1, "lw" => 2, "lbu" => 4, _ => 5 };
            vec![i_type(imm12(o)?, b, f3, r(0)?, 0x03)]
        }
        "sb" | "sh" | "sw" => {
            n(2)?;
            let (o, b) = mem(1)?;
            vec![s_type(imm12(o)?, r(0)?, b, match op { "sb" => 0, "sh" => 1, _ => 2 }, 0x23)]
        }
        o if alu_i.contains(&o) => {
            n(3)?;
            let f3 = match o { "addi" => 0, "slti" => 2, "sltiu" => 3, "xori" => 4, "ori" => 6, _ => 7 };
            vec![i_type(imm12(ev(&a[2])?)?, r(1)?, f3, r(0)?, 0x13)]
        }
        "slli" | "srli" | "srai" => {
            n(3)?;
            let s = ev(&a[2])?;
            if !(0..32).contains(&s) { return Err(format!("{}: shift {} out of range", op, s)); }
            let (f3, f7) = match op { "slli" => (1, 0), "srli" => (5, 0), _ => (5, 0x20) };
            vec![i_type(s | f7 << 5, r(1)?, f3, r(0)?, 0x13)]
        }
        o if alu_r.contains(&o) => {
            n(3)?;
            let (f3, f7) = match o { "add" => (0, 0), "sub" => (0, 0x20), "sll" => (1, 0), "slt" => (2, 0), "sltu" => (3, 0), "xor" => (4, 0), "srl" => (5, 0), "sra" => (5, 0x20), "or" => (6, 0), _ => (7, 0) };
            vec![r_type(f7, r(2)?, r(1)?, f3, r(0)?, 0x33)]
        }
        "ecall" => { n(0)?; vec![0x73] }
        "ebreak" => { n(0)?; vec![0x0010_0073] }
        "fence" => vec![0x0ff0_000f],
        // ---- pseudo-instructions ----
        "nop" => { n(0)?; vec![0x13] }
        "li" => {
            n(2)?;
            let v = ev(&a[1])?;
            let rd = r(0)?;
            if !(-0x8000_0000..=0xffff_ffff).contains(&v) { return Err(format!("li: {} does not fit 32 bits", v)); }
            let small = parse_num(&a[1]).is_some();
            if small && fits12(v) { vec![i_type(v, 0, 0, rd, 0x13)] }
            else if small && v & 0xfff == 0 { vec![((v as u32) & 0xfffff000) | rd << 7 | 0x37] }
            else {
                let hi = ((v + 0x800) >> 12) & 0xfffff;
                let lo = ((v & 0xfff) ^ 0x800) - 0x800;
                vec![(hi as u32) << 12 | rd << 7 | 0x37, i_type(lo, rd, 0, rd, 0x13)]
            }
        }
        "la" => {
            n(2)?;
            let v = ev(&a[1])?;
            let rd = r(0)?;
            let hi = ((v + 0x800) >> 12) & 0xfffff;
            let lo = ((v & 0xfff) ^ 0x800) - 0x800;
            vec![(hi as u32) << 12 | rd << 7 | 0x37, i_type(lo, rd, 0, rd, 0x13)]
        }
        "mv" => { n(2)?; vec![i_type(0, r(1)?, 0, r(0)?, 0x13)] }
        "not" => { n(2)?; vec![i_type(-1, r(1)?, 4, r(0)?, 0x13)] }
        "neg" => { n(2)?; vec![r_type(0x20, r(1)?, 0, 0, r(0)?, 0x33)] }
        "seqz" => { n(2)?; vec![i_type(1, r(1)?, 3, r(0)?, 0x13)] }
        "snez" => { n(2)?; vec![r_type(0, r(1)?, 0, 3, r(0)?, 0x33)] }
        "sltz" => { n(2)?; vec![r_type(0, 0, r(1)?, 2, r(0)?, 0x33)] }
        "sgtz" => { n(2)?; vec![r_type(0, r(1)?, 0, 2, r(0)?, 0x33)] }
        "beqz" | "bnez" | "blez" | "bgez" | "bltz" | "bgtz" => {
            n(2)?;
            let (rs, d) = (r(0)?, target(1, 12)?);
            vec![match op {
                "beqz" => b_type(d, 0, rs, 0), "bnez" => b_type(d, 0, rs, 1), "blez" => b_type(d, rs, 0, 5),
                "bgez" => b_type(d, 0, rs, 5), "bltz" => b_type(d, 0, rs, 4), _ => b_type(d, rs, 0, 4),
            }]
        }
        "bgt" | "ble" | "bgtu" | "bleu" => {
            n(3)?;
            let d = target(2, 12)?;
            let f3 = match op { "bgt" => 4, "ble" => 5, "bgtu" => 6, _ => 7 };
            vec![b_type(d, r(0)?, r(1)?, f3)]
        }
        "j" => { n(1)?; vec![j_type(target(0, 20)?, 0)] }
        "jr" => { n(1)?; vec![i_type(0, r(0)?, 0, 0, 0x67)] }
        "ret" => { n(0)?; vec![0x0000_8067] }
        "call" => { n(1)?; vec![j_type(target(0, 20)?, 1)] }
        "tail" => { n(1)?; vec![j_type(target(0, 20)?, 0)] }
        _ => return Err(format!("unknown instruction {}", op)),
    })
}

/// a readable listing: address, machine code, source
pub fn listing_text(p: &Program) -> String {
    let mut s = String::new();
    for l in &p.listing {
        if l.bytes.is_empty() {
            // a label at its address; comments and directives as they are
            let t = l.text.trim_start();
            if t.starts_with('#') || t.starts_with('.') { s += &format!("{:24} {}\n", "", l.text); } else { s += &format!("{:04x}{:20} {}\n", l.addr, "", l.text); }
            continue;
        }
        let words: Vec<String> = if l.bytes.len() % 4 == 0 && l.bytes.len() <= 8 && !l.text.trim_start().starts_with('.') {
            l.bytes.chunks(4).map(|c| format!("{:08x}", u32::from_le_bytes([c[0], c[1], c[2], c[3]]))).collect()
        } else { l.bytes.iter().take(8).map(|b| format!("{:02x}", b)).collect() };
        s += &format!("{:04x}  {:<18} {}\n", l.addr, words.join(" "), l.text);
    }
    s
}
