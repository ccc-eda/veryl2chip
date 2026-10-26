//! Liberty (.lib) reader: the generic group / attribute syntax, then the parts
//! a standard-cell flow needs: units, cells with area, pins (direction,
//! capacitance, function), flip-flops (`ff` groups), and timing arcs with
//! their NLDM tables (delay / transition indexed by input slew and output
//! load, constraints indexed by the two slews).

use std::collections::HashMap;

/// one group: `kind (args) { attributes; groups }`
#[derive(Debug, Default, Clone)]
pub struct Group {
    pub kind: String,
    pub args: Vec<String>,
    /// simple (`name : value ;`) and complex (`name (v, ...) ;`) attributes, in order
    pub attrs: Vec<(String, Vec<String>)>,
    pub groups: Vec<Group>,
}

impl Group {
    pub fn attr(&self, k: &str) -> Option<&str> { self.attrs.iter().find(|a| a.0 == k).and_then(|a| a.1.first()).map(|s| s.as_str()) }
    pub fn attr_list(&self, k: &str) -> Option<&Vec<String>> { self.attrs.iter().find(|a| a.0 == k).map(|a| &a.1) }
    pub fn num(&self, k: &str) -> Option<f64> { self.attr(k).and_then(|s| s.trim().parse().ok()) }
    pub fn sub<'a>(&'a self, kind: &'a str) -> impl Iterator<Item = &'a Group> + 'a { self.groups.iter().filter(move |g| g.kind == kind) }
    pub fn name(&self) -> &str { self.args.first().map(|s| s.as_str()).unwrap_or("") }
}

struct Lexer<'a> { b: &'a [u8], i: usize, line: usize }

#[derive(Debug, PartialEq)]
enum Tok { Word(String), Str(String), P(u8), End }

impl<'a> Lexer<'a> {
    fn next(&mut self) -> Tok {
        loop {
            while self.i < self.b.len() && (self.b[self.i].is_ascii_whitespace() || self.b[self.i] == b'\\') {
                if self.b[self.i] == b'\n' { self.line += 1; }
                self.i += 1;
            }
            if self.b[self.i..].starts_with(b"/*") {
                let e = self.b[self.i + 2..].windows(2).position(|w| w == b"*/").map(|p| self.i + 2 + p + 2).unwrap_or(self.b.len());
                self.line += self.b[self.i..e].iter().filter(|&&c| c == b'\n').count();
                self.i = e;
                continue;
            }
            if self.b[self.i..].starts_with(b"//") {
                while self.i < self.b.len() && self.b[self.i] != b'\n' { self.i += 1; }
                continue;
            }
            break;
        }
        if self.i >= self.b.len() { return Tok::End; }
        let c = self.b[self.i];
        if c == b'"' {
            let st = self.i + 1;
            let mut j = st;
            while j < self.b.len() && self.b[j] != b'"' { if self.b[j] == b'\\' { j += 1; } if self.b[j] == b'\n' { self.line += 1; } j += 1; }
            self.i = j + 1;
            // line continuations inside strings ("1, 2, \<newline> 3")
            let s = String::from_utf8_lossy(&self.b[st..j.min(self.b.len())]).replace("\\\n", "").replace("\\\r\n", "");
            return Tok::Str(s);
        }
        if matches!(c, b'(' | b')' | b'{' | b'}' | b':' | b';' | b',') { self.i += 1; return Tok::P(c); }
        let st = self.i;
        while self.i < self.b.len() && !self.b[self.i].is_ascii_whitespace() && !matches!(self.b[self.i], b'(' | b')' | b'{' | b'}' | b':' | b';' | b',' | b'"') { self.i += 1; }
        Tok::Word(String::from_utf8_lossy(&self.b[st..self.i]).to_string())
    }
}

/// parse a Liberty file into its top group (`library (name) { ... }`)
pub fn parse(src: &str) -> Result<Group, String> {
    let mut lx = Lexer { b: src.as_bytes(), i: 0, line: 1 };
    let mut tok = lx.next();
    let mut stack: Vec<Group> = vec![Group::default()];
    loop {
        let name = match tok {
            Tok::End => break,
            Tok::P(b'}') => {
                let g = stack.pop().unwrap();
                if stack.is_empty() { return Err(format!("line {}: unbalanced }}", lx.line)); }
                stack.last_mut().unwrap().groups.push(g);
                tok = lx.next();
                if tok == Tok::P(b';') { tok = lx.next(); }
                continue;
            }
            Tok::Word(w) | Tok::Str(w) => w,
            Tok::P(c) => return Err(format!("line {}: unexpected '{}'", lx.line, c as char)),
        };
        tok = lx.next();
        match tok {
            Tok::P(b':') => {
                // simple attribute: value up to ';' (or the end of the line)
                let mut v = String::new();
                loop {
                    tok = lx.next();
                    match tok {
                        Tok::P(b';') => { tok = lx.next(); break; }
                        Tok::Word(ref w) | Tok::Str(ref w) => { if !v.is_empty() { v.push(' '); } v.push_str(w); }
                        Tok::P(b'}') | Tok::End => break,
                        Tok::P(c) => { v.push(c as char); }
                    }
                }
                stack.last_mut().unwrap().attrs.push((name, vec![v]));
            }
            Tok::P(b'(') => {
                let mut args = vec![];
                let mut cur = String::new();
                loop {
                    tok = lx.next();
                    match tok {
                        Tok::P(b')') => break,
                        Tok::P(b',') => args.push(std::mem::take(&mut cur)),
                        Tok::Word(ref w) | Tok::Str(ref w) => { if !cur.is_empty() { cur.push(' '); } cur.push_str(w); }
                        Tok::End => return Err(format!("line {}: unterminated (", lx.line)),
                        Tok::P(c) => cur.push(c as char),
                    }
                }
                if !cur.is_empty() || !args.is_empty() { args.push(cur); }
                tok = lx.next();
                if tok == Tok::P(b'{') {
                    stack.push(Group { kind: name, args, ..Default::default() });
                    tok = lx.next();
                } else {
                    if tok == Tok::P(b';') { tok = lx.next(); }
                    stack.last_mut().unwrap().attrs.push((name, args));
                }
            }
            _ => return Err(format!("line {}: expected ':' or '(' after {}", lx.line, name)),
        }
    }
    let top = stack.pop().ok_or("empty file")?;
    if !stack.is_empty() { return Err("unbalanced {".into()); }
    top.groups.into_iter().find(|g| g.kind == "library").ok_or_else(|| "no library group".into())
}

/// a lookup table: values[i][j] at (index_1[i], index_2[j]); 1-D tables have one column
#[derive(Debug, Clone, Default)]
pub struct Table {
    pub index_1: Vec<f64>,
    pub index_2: Vec<f64>,
    pub values: Vec<Vec<f64>>,
    /// the template said variable_1 is the output load (tables are stored slew-first)
    pub transposed: bool,
}

impl Table {
    /// bilinear interpolation (extrapolating linearly past the ends)
    pub fn at(&self, x: f64, y: f64) -> f64 {
        if self.values.is_empty() { return 0.0; }
        let (x, y) = if self.transposed { (y, x) } else { (x, y) };
        let seg = |ix: &[f64], v: f64| -> (usize, f64) {
            if ix.len() < 2 { return (0, 0.0); }
            let mut k = 0;
            while k + 2 < ix.len() && v > ix[k + 1] { k += 1; }
            (k, (v - ix[k]) / (ix[k + 1] - ix[k]))
        };
        let (i, fi) = seg(&self.index_1, x);
        let (j, fj) = seg(&self.index_2, y);
        let g = |a: usize, b: usize| self.values.get(a).and_then(|r| r.get(b)).copied().unwrap_or(0.0);
        let i1 = (i + 1).min(self.values.len() - 1);
        let j1 = (j + 1).min(self.values[0].len() - 1);
        let r0 = g(i, j) + (g(i, j1) - g(i, j)) * fj;
        let r1 = g(i1, j) + (g(i1, j1) - g(i1, j)) * fj;
        r0 + (r1 - r0) * fi
    }
}

#[derive(Debug, Clone, Default)]
pub struct Arc {
    pub related: String,
    /// combinational, rising_edge, falling_edge, setup_rising, hold_rising, recovery_rising, clear, preset, ...
    pub kind: String,
    pub sense: String,
    pub cell_rise: Option<Table>,
    pub cell_fall: Option<Table>,
    pub rise_transition: Option<Table>,
    pub fall_transition: Option<Table>,
    pub rise_constraint: Option<Table>,
    pub fall_constraint: Option<Table>,
}

#[derive(Debug, Clone, Default)]
pub struct Pin {
    pub name: String,
    pub dir: String,
    pub cap: f64,
    pub function: Option<String>,
    pub clock: bool,
    pub max_cap: Option<f64>,
    pub arcs: Vec<Arc>,
}

/// a flip-flop: `ff (IQ, IQN) { clocked_on; next_state; clear; preset }`
#[derive(Debug, Clone, Default)]
pub struct Ff {
    pub state: (String, String),
    pub clocked_on: String,
    pub next_state: String,
    pub clear: Option<String>,
    pub preset: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct Cell {
    pub name: String,
    pub area: f64,
    pub pins: Vec<Pin>,
    pub ff: Option<Ff>,
    /// latches, clock gates, ... (not used by the flow)
    pub other_seq: bool,
    pub dont_use: bool,
    pub leakage: f64,
}

impl Cell {
    pub fn pin(&self, n: &str) -> Option<&Pin> { self.pins.iter().find(|p| p.name == n) }
    pub fn inputs(&self) -> impl Iterator<Item = &Pin> { self.pins.iter().filter(|p| p.dir == "input") }
    pub fn outputs(&self) -> impl Iterator<Item = &Pin> { self.pins.iter().filter(|p| p.dir == "output") }
}

#[derive(Debug, Clone, Default)]
pub struct Library {
    pub name: String,
    /// ns per library time unit, pF per capacitance unit
    pub time_ns: f64,
    pub cap_pf: f64,
    pub voltage: f64,
    pub cells: Vec<Cell>,
}

impl Library {
    pub fn cell(&self, n: &str) -> Option<&Cell> { self.cells.iter().find(|c| c.name == n) }
}

fn nums(s: &str) -> Vec<f64> { s.split(|c: char| c == ',' || c.is_whitespace()).filter(|t| !t.is_empty()).filter_map(|t| t.parse().ok()).collect() }

fn table(g: &Group, templates: &HashMap<String, (Vec<f64>, Vec<f64>, bool)>) -> Table {
    let tpl = templates.get(g.name());
    let i1 = g.attr_list("index_1").map(|v| nums(&v.join(","))).or_else(|| tpl.map(|t| t.0.clone())).unwrap_or_default();
    let i2 = g.attr_list("index_2").map(|v| nums(&v.join(","))).or_else(|| tpl.map(|t| t.1.clone())).unwrap_or_default();
    let values: Vec<Vec<f64>> = g.attr_list("values").map(|v| v.iter().map(|r| nums(r)).collect()).unwrap_or_default();
    Table { index_1: i1, index_2: i2, values, transposed: tpl.map(|t| t.2).unwrap_or(false) }
}

/// the flow's view of a parsed library
pub fn library(top: &Group) -> Library {
    let unit = |s: Option<&str>, base: &[(&str, f64)]| -> f64 {
        let s = s.unwrap_or("").trim().trim_matches('"').to_lowercase();
        let num: String = s.chars().take_while(|c| c.is_ascii_digit() || *c == '.').collect();
        let n: f64 = num.parse().unwrap_or(1.0);
        base.iter().find(|(u, _)| s.ends_with(u)).map(|(_, f)| n * f).unwrap_or(n)
    };
    let time_ns = unit(top.attr("time_unit"), &[("ps", 1e-3), ("ns", 1.0), ("us", 1e3)]);
    let cap_pf = top.attr_list("capacitive_load_unit").map(|v| {
        let n: f64 = v.first().and_then(|s| s.trim().parse().ok()).unwrap_or(1.0);
        let u = v.get(1).map(|s| s.trim().trim_matches('"').to_lowercase()).unwrap_or_default();
        n * match u.as_str() { "ff" => 1e-3, "nf" => 1e3, _ => 1.0 }
    }).unwrap_or(1.0);
    let mut templates: HashMap<String, (Vec<f64>, Vec<f64>, bool)> = HashMap::new();
    for t in top.sub("lu_table_template") {
        let v1 = t.attr("variable_1").unwrap_or("");
        templates.insert(t.name().to_string(), (
            t.attr_list("index_1").map(|v| nums(&v.join(","))).unwrap_or_default(),
            t.attr_list("index_2").map(|v| nums(&v.join(","))).unwrap_or_default(),
            v1.contains("capacitance"),
        ));
    }
    let mut cells = vec![];
    for c in top.sub("cell") {
        let mut cell = Cell { name: c.name().to_string(), area: c.num("area").unwrap_or(0.0), leakage: c.num("cell_leakage_power").unwrap_or(0.0), ..Default::default() };
        cell.dont_use = c.attr("dont_use").map(|v| v.contains("true")).unwrap_or(false);
        if let Some(f) = c.sub("ff").next() {
            cell.ff = Some(Ff {
                state: (f.args.first().cloned().unwrap_or_default(), f.args.get(1).cloned().unwrap_or_default()),
                clocked_on: f.attr("clocked_on").unwrap_or("").to_string(),
                next_state: f.attr("next_state").unwrap_or("").to_string(),
                clear: f.attr("clear").map(|s| s.to_string()),
                preset: f.attr("preset").map(|s| s.to_string()),
            });
        }
        cell.other_seq = c.groups.iter().any(|g| matches!(g.kind.as_str(), "latch" | "statetable" | "ff_bank" | "latch_bank" | "clock_gating_integrated_cell"))
            || c.attr("clock_gating_integrated_cell").is_some();
        // pins, also inside bus / bundle groups
        let mut pin_groups: Vec<&Group> = c.sub("pin").collect();
        for b in c.groups.iter().filter(|g| g.kind == "bus" || g.kind == "bundle") { pin_groups.extend(b.sub("pin")); }
        for p in pin_groups {
            for name in &p.args {
                let mut pin = Pin {
                    name: name.trim().to_string(),
                    dir: p.attr("direction").unwrap_or("").trim().to_string(),
                    cap: p.num("capacitance").unwrap_or(0.0),
                    function: p.attr("function").map(|s| s.trim().to_string()),
                    clock: p.attr("clock").map(|v| v.contains("true")).unwrap_or(false),
                    max_cap: p.num("max_capacitance"),
                    arcs: vec![],
                };
                for t in p.sub("timing") {
                    let get = |k: &str| t.sub(k).next().map(|g| table(g, &templates));
                    pin.arcs.push(Arc {
                        related: t.attr("related_pin").unwrap_or("").trim().to_string(),
                        kind: t.attr("timing_type").unwrap_or("combinational").trim().to_string(),
                        sense: t.attr("timing_sense").unwrap_or("").trim().to_string(),
                        cell_rise: get("cell_rise"),
                        cell_fall: get("cell_fall"),
                        rise_transition: get("rise_transition"),
                        fall_transition: get("fall_transition"),
                        rise_constraint: get("rise_constraint"),
                        fall_constraint: get("fall_constraint"),
                    });
                }
                cell.pins.push(pin);
            }
        }
        cells.push(cell);
    }
    Library { name: top.name().to_string(), time_ns, cap_pf, voltage: top.num("nom_voltage").unwrap_or(0.0), cells }
}

// ---- Liberty boolean functions ----

#[derive(Debug, Clone, PartialEq)]
pub enum Expr { Var(String), Const(bool), Not(Box<Expr>), And(Box<Expr>, Box<Expr>), Or(Box<Expr>, Box<Expr>), Xor(Box<Expr>, Box<Expr>) }

impl Expr {
    pub fn eval(&self, env: &dyn Fn(&str) -> bool) -> bool {
        match self {
            Expr::Var(v) => env(v),
            Expr::Const(c) => *c,
            Expr::Not(a) => !a.eval(env),
            Expr::And(a, b) => a.eval(env) && b.eval(env),
            Expr::Or(a, b) => a.eval(env) || b.eval(env),
            Expr::Xor(a, b) => a.eval(env) ^ b.eval(env),
        }
    }
    pub fn vars(&self, out: &mut Vec<String>) {
        match self {
            Expr::Var(v) => { if !out.contains(v) { out.push(v.clone()); } }
            Expr::Const(_) => {}
            Expr::Not(a) => a.vars(out),
            Expr::And(a, b) | Expr::Or(a, b) | Expr::Xor(a, b) => { a.vars(out); b.vars(out); }
        }
    }
    /// as a Verilog expression
    pub fn verilog(&self) -> String {
        match self {
            Expr::Var(v) => v.clone(),
            Expr::Const(c) => if *c { "1'b1".into() } else { "1'b0".into() },
            Expr::Not(a) => format!("~{}", a.verilog()),
            Expr::And(a, b) => format!("({} & {})", a.verilog(), b.verilog()),
            Expr::Or(a, b) => format!("({} | {})", a.verilog(), b.verilog()),
            Expr::Xor(a, b) => format!("({} ^ {})", a.verilog(), b.verilog()),
        }
    }
}

/// parse a Liberty function: ! ' (postfix) & * (and, also juxtaposition) + | ^ ( ) 0 1
pub fn function(s: &str) -> Result<Expr, String> {
    let toks: Vec<char> = s.chars().filter(|c| !c.is_whitespace() || true).collect();
    let mut p = FParser { t: toks, i: 0 };
    let e = p.or()?;
    p.ws();
    if p.i < p.t.len() { return Err(format!("unexpected '{}' in function {}", p.t[p.i], s)); }
    Ok(e)
}

struct FParser { t: Vec<char>, i: usize }
impl FParser {
    fn ws(&mut self) { while self.i < self.t.len() && self.t[self.i].is_whitespace() { self.i += 1; } }
    fn peek(&mut self) -> Option<char> { self.ws(); self.t.get(self.i).copied() }
    fn or(&mut self) -> Result<Expr, String> {
        let mut a = self.xor()?;
        while matches!(self.peek(), Some('+') | Some('|')) { self.i += 1; let b = self.xor()?; a = Expr::Or(Box::new(a), Box::new(b)); }
        Ok(a)
    }
    fn xor(&mut self) -> Result<Expr, String> {
        let mut a = self.and()?;
        while self.peek() == Some('^') { self.i += 1; let b = self.and()?; a = Expr::Xor(Box::new(a), Box::new(b)); }
        Ok(a)
    }
    fn and(&mut self) -> Result<Expr, String> {
        let mut a = self.unary()?;
        loop {
            match self.peek() {
                Some('&') | Some('*') => { self.i += 1; }
                // juxtaposition: "A B" or "A(B)" means A & B
                Some(c) if c.is_alphanumeric() || c == '_' || c == '(' || c == '!' => {}
                _ => break,
            }
            let b = self.unary()?;
            a = Expr::And(Box::new(a), Box::new(b));
        }
        Ok(a)
    }
    fn unary(&mut self) -> Result<Expr, String> {
        let mut e = match self.peek() {
            Some('!') => { self.i += 1; Expr::Not(Box::new(self.unary()?)) }
            Some('(') => {
                self.i += 1;
                let e = self.or()?;
                if self.peek() != Some(')') { return Err("missing )".into()); }
                self.i += 1;
                e
            }
            Some(c) if c.is_alphanumeric() || c == '_' => {
                let st = self.i;
                while self.i < self.t.len() && (self.t[self.i].is_alphanumeric() || matches!(self.t[self.i], '_' | '[' | ']' | '.')) { self.i += 1; }
                let w: String = self.t[st..self.i].iter().collect();
                match w.as_str() { "0" => Expr::Const(false), "1" => Expr::Const(true), _ => Expr::Var(w) }
            }
            c => return Err(format!("unexpected {:?}", c)),
        };
        while self.peek() == Some('\'') { self.i += 1; e = Expr::Not(Box::new(e)); }
        Ok(e)
    }
}

/// truth table of `e` over `vars` (bit k of the index = vars[k])
pub fn truth(e: &Expr, vars: &[String]) -> u64 {
    let mut t = 0u64;
    for m in 0..(1u64 << vars.len()) {
        if e.eval(&|v: &str| vars.iter().position(|x| x == v).map(|k| m >> k & 1 == 1).unwrap_or(false)) { t |= 1 << m; }
    }
    t
}
