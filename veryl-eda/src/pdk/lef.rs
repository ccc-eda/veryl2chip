//! LEF reader: technology (units, sites, layers with pitch / width / spacing /
//! RC, fixed vias) and cell abstracts (size, site, pins with their shapes,
//! obstructions). Blocks it does not need are skipped up to their END.

#[derive(Debug, Clone, Default)]
pub struct Rect { pub layer: String, pub x0: f64, pub y0: f64, pub x1: f64, pub y1: f64 }

#[derive(Debug, Clone, Default)]
pub struct Layer {
    pub name: String,
    /// ROUTING, CUT, MASTERSLICE, ...
    pub kind: String,
    pub horizontal: bool,
    pub pitch: (f64, f64),
    pub offset: (f64, f64),
    pub width: f64,
    pub spacing: f64,
    /// Ω per square, pF per µm² (area) and per µm (edge)
    pub rpersq: f64,
    pub cpersq: f64,
    pub edgecap: f64,
    /// cut layers: Ω per cut
    pub cut_r: f64,
}

#[derive(Debug, Clone, Default)]
pub struct Via { pub name: String, pub rects: Vec<Rect> }

#[derive(Debug, Clone, Default)]
pub struct Site { pub name: String, pub w: f64, pub h: f64 }

#[derive(Debug, Clone, Default)]
pub struct MacroPin { pub name: String, pub dir: String, pub usage: String, pub shapes: Vec<Rect> }

#[derive(Debug, Clone, Default)]
pub struct Macro {
    pub name: String,
    pub class: String,
    pub w: f64,
    pub h: f64,
    pub site: String,
    pub pins: Vec<MacroPin>,
    pub obs: Vec<Rect>,
}

impl Macro {
    pub fn pin(&self, n: &str) -> Option<&MacroPin> { self.pins.iter().find(|p| p.name == n) }
}

#[derive(Debug, Clone, Default)]
pub struct Lef {
    /// database units per micron
    pub dbu: f64,
    pub sites: Vec<Site>,
    pub layers: Vec<Layer>,
    pub vias: Vec<Via>,
    pub macros: Vec<Macro>,
}

impl Lef {
    pub fn layer(&self, n: &str) -> Option<&Layer> { self.layers.iter().find(|l| l.name == n) }
    pub fn via(&self, n: &str) -> Option<&Via> { self.vias.iter().find(|v| v.name == n) }
    pub fn site(&self, n: &str) -> Option<&Site> { self.sites.iter().find(|s| s.name == n) }
    pub fn macro_(&self, n: &str) -> Option<&Macro> { self.macros.iter().find(|m| m.name == n) }
    /// the routing layers, bottom up
    pub fn routing(&self) -> Vec<&Layer> { self.layers.iter().filter(|l| l.kind == "ROUTING").collect() }
    /// add another file's contents (tech LEF + cell LEF)
    pub fn merge(&mut self, o: Lef) {
        if self.dbu == 0.0 { self.dbu = o.dbu; }
        self.sites.extend(o.sites);
        self.layers.extend(o.layers);
        self.vias.extend(o.vias);
        self.macros.extend(o.macros);
    }
}

fn tokens(src: &str) -> Vec<String> {
    let mut t = vec![];
    for line in src.lines() {
        let mut cur = String::new();
        let mut in_str = false;
        for c in line.chars() {
            if in_str { cur.push(c); if c == '"' { in_str = false; } continue; }
            match c {
                '#' => break,
                '"' => { in_str = true; cur.push(c); }
                ';' => { if !cur.is_empty() { t.push(std::mem::take(&mut cur)); } t.push(";".into()); }
                c if c.is_whitespace() => { if !cur.is_empty() { t.push(std::mem::take(&mut cur)); } }
                c => cur.push(c),
            }
        }
        if !cur.is_empty() { t.push(cur); }
    }
    t
}

struct P { t: Vec<String>, i: usize }
impl P {
    fn peek(&self) -> &str { self.t.get(self.i).map(|s| s.as_str()).unwrap_or("") }
    fn next(&mut self) -> String { let s = self.peek().to_string(); self.i += 1; s }
    fn done(&self) -> bool { self.i >= self.t.len() }
    /// the rest of a statement (up to ';')
    fn stmt(&mut self) -> Vec<String> {
        let mut v = vec![];
        while !self.done() && self.peek() != ";" { v.push(self.next()); }
        self.i += 1;
        v
    }
    fn num(s: Option<&String>) -> f64 { s.and_then(|s| s.parse().ok()).unwrap_or(0.0) }
    /// skip to `END name` (or a bare END when `name` is empty)
    fn skip_block(&mut self, name: &str) {
        while !self.done() {
            if self.peek() == "END" {
                self.i += 1;
                if name.is_empty() || self.peek() == name { if !name.is_empty() { self.i += 1; } return; }
            } else { self.i += 1; }
        }
    }
    /// LAYER x ; RECT a b c d ; ... up to END (geometry of a PORT / OBS / VIA)
    fn shapes(&mut self, end_name: Option<&str>) -> Vec<Rect> {
        let mut out = vec![];
        let mut layer = String::new();
        while !self.done() {
            let w = self.next();
            match w.as_str() {
                "END" => {
                    if let Some(n) = end_name { if self.peek() == n { self.i += 1; } }
                    return out;
                }
                "LAYER" => { let s = self.stmt(); layer = s.first().cloned().unwrap_or_default(); }
                "RECT" => {
                    let mut s = self.stmt();
                    if s.first().map(|x| x == "MASK") == Some(true) { s.drain(0..2); }
                    let n: Vec<f64> = s.iter().filter_map(|x| x.parse().ok()).collect();
                    if n.len() >= 4 { out.push(Rect { layer: layer.clone(), x0: n[0].min(n[2]), y0: n[1].min(n[3]), x1: n[0].max(n[2]), y1: n[1].max(n[3]) }); }
                }
                "POLYGON" => {
                    // bounding box (the cells use rectangles; polygons are rare)
                    let n: Vec<f64> = self.stmt().iter().filter_map(|x| x.parse().ok()).collect();
                    if n.len() >= 4 {
                        let xs: Vec<f64> = n.iter().step_by(2).copied().collect();
                        let ys: Vec<f64> = n.iter().skip(1).step_by(2).copied().collect();
                        out.push(Rect { layer: layer.clone(), x0: xs.iter().copied().fold(f64::MAX, f64::min), y0: ys.iter().copied().fold(f64::MAX, f64::min), x1: xs.iter().copied().fold(f64::MIN, f64::max), y1: ys.iter().copied().fold(f64::MIN, f64::max) });
                    }
                }
                _ => { self.stmt(); }
            }
        }
        out
    }
}

pub fn parse(src: &str) -> Result<Lef, String> {
    let mut p = P { t: tokens(src), i: 0 };
    let mut lef = Lef::default();
    while !p.done() {
        let w = p.next();
        match w.as_str() {
            "UNITS" => {
                while !p.done() && p.peek() != "END" {
                    let s = p.stmt();
                    if s.first().map(|x| x == "DATABASE") == Some(true) { lef.dbu = P::num(s.get(2)); }
                }
                p.skip_block("UNITS");
            }
            "SITE" => {
                let name = p.next();
                let mut site = Site { name: name.clone(), ..Default::default() };
                while !p.done() && !(p.peek() == "END") {
                    let s = p.stmt();
                    if s.first().map(|x| x == "SIZE") == Some(true) { site.w = P::num(s.get(1)); site.h = P::num(s.get(3)); }
                }
                p.skip_block(&name);
                lef.sites.push(site);
            }
            "LAYER" => {
                let name = p.next();
                let mut l = Layer { name: name.clone(), ..Default::default() };
                loop {
                    if p.done() { break; }
                    if p.peek() == "END" { p.i += 1; if p.peek() == name { p.i += 1; break; } continue; }
                    let s = p.stmt();
                    let Some(k) = s.first() else { continue };
                    match k.as_str() {
                        "TYPE" => l.kind = s.get(1).cloned().unwrap_or_default(),
                        "DIRECTION" => l.horizontal = s.get(1).map(|d| d == "HORIZONTAL") == Some(true),
                        "PITCH" => { let a = P::num(s.get(1)); l.pitch = (a, if s.len() > 2 { P::num(s.get(2)) } else { a }); }
                        "OFFSET" => { let a = P::num(s.get(1)); l.offset = (a, if s.len() > 2 { P::num(s.get(2)) } else { a }); }
                        "WIDTH" => l.width = P::num(s.get(1)),
                        "SPACING" => { let v = P::num(s.get(1)); if l.spacing == 0.0 || v < l.spacing { l.spacing = v; } }
                        "SPACINGTABLE" => {
                            // SPACINGTABLE PARALLELRUNLENGTH ... WIDTH 0 s ... : the first spacing value
                            if let Some(k) = s.iter().position(|x| x == "WIDTH") { let v = P::num(s.get(k + 2)); if l.spacing == 0.0 || v < l.spacing { l.spacing = v; } }
                        }
                        "RESISTANCE" => { if s.get(1).map(|x| x == "RPERSQ") == Some(true) { l.rpersq = P::num(s.get(2)); } else { l.cut_r = P::num(s.get(1)); } }
                        "CAPACITANCE" => l.cpersq = P::num(s.get(2)),
                        "EDGECAPACITANCE" => l.edgecap = P::num(s.get(1)),
                        _ => {}
                    }
                }
                lef.layers.push(l);
            }
            "VIA" => {
                let name = p.next();
                // VIA name [DEFAULT] ;
                while !p.done() && p.peek() != ";" { p.i += 1; }
                p.i += 1;
                let rects = p.shapes(Some(&name));
                lef.vias.push(Via { name, rects });
            }
            "MACRO" => {
                let name = p.next();
                let mut m = Macro { name: name.clone(), ..Default::default() };
                loop {
                    if p.done() { break; }
                    let w = p.next();
                    match w.as_str() {
                        "END" => { if p.peek() == name { p.i += 1; break; } }
                        "CLASS" => m.class = p.stmt().join(" "),
                        "SIZE" => { let s = p.stmt(); m.w = P::num(s.first()); m.h = P::num(s.get(2)); }
                        "SITE" => m.site = p.stmt().first().cloned().unwrap_or_default(),
                        "PIN" => {
                            let pn = p.next();
                            let mut pin = MacroPin { name: pn.clone(), ..Default::default() };
                            loop {
                                if p.done() { break; }
                                let w = p.next();
                                match w.as_str() {
                                    "END" => { if p.peek() == pn { p.i += 1; break; } }
                                    "DIRECTION" => pin.dir = p.stmt().first().cloned().unwrap_or_default(),
                                    "USE" => pin.usage = p.stmt().first().cloned().unwrap_or_default(),
                                    "PORT" => { let r = p.shapes(None); pin.shapes.extend(r); }
                                    _ => { p.stmt(); }
                                }
                            }
                            m.pins.push(pin);
                        }
                        "OBS" => { let r = p.shapes(None); m.obs.extend(r); }
                        "PROPERTY" | "ORIGIN" | "FOREIGN" | "SYMMETRY" => { p.stmt(); }
                        _ => { p.stmt(); }
                    }
                }
                lef.macros.push(m);
            }
            "PROPERTYDEFINITIONS" | "NONDEFAULTRULE" | "VIARULE" | "SPACING" => {
                let name = if w == "NONDEFAULTRULE" || w == "VIARULE" { p.next() } else { w.clone() };
                p.skip_block(&name);
            }
            "END" => { if p.peek() == "LIBRARY" { p.i += 1; } }
            _ => { p.stmt(); }
        }
    }
    Ok(lef)
}
