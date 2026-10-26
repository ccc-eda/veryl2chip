//! Loader for the IceStorm chip database (`chipdb-5k.txt`): tiles and their
//! configuration-bit tables, the routing graph (nets = wires, pips = mux
//! inputs with their config-bit patterns), package pins, global buffers.

use std::collections::HashMap;

type R<T> = Result<T, String>;

/// one config bit: (row, column) inside a tile
pub type BitPos = (u8, u8);

/// what a wire is, for timing and drawing (from its name)
#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
#[repr(u8)]
pub enum Kind {
    #[default]
    Other,
    Local,
    LutIn,
    LutOut,
    Ctrl,
    Glb,
    Glb2Local,
    Sp4H,
    Sp4V,
    Sp12H,
    Sp12V,
    Io,
    Carry,
    Fabout,
}

impl Kind {
    pub fn of(name: &str) -> Kind {
        let n = name;
        if n.starts_with("local_g") { Kind::Local }
        else if n.starts_with("lutff_global/") { Kind::Ctrl }
        else if let Some(p) = n.strip_prefix("ram/") {
            // block RAM pins: data out drives routing like an LC output
            if p.starts_with("RDATA") { Kind::LutOut } else if p.contains("ADDR") || p.starts_with("WDATA") || p.starts_with("MASK") { Kind::LutIn } else { Kind::Ctrl }
        }
        else if n.starts_with("lutff_") && n.contains("/in_") { Kind::LutIn }
        else if n.starts_with("lutff_") || n.starts_with("neigh_op_") || n.starts_with("logic_op_") { Kind::LutOut }
        else if n.starts_with("glb_netwk_") { Kind::Glb }
        else if n.starts_with("glb2local") { Kind::Glb2Local }
        else if n.starts_with("sp4_h") || n.starts_with("span4_horz") { Kind::Sp4H }
        else if n.starts_with("sp4_v") || n.starts_with("sp4_r_v") || n.starts_with("span4_vert") { Kind::Sp4V }
        else if n.starts_with("sp12_h") || n.starts_with("span12_horz") { Kind::Sp12H }
        else if n.starts_with("sp12_v") || n.starts_with("span12_vert") { Kind::Sp12V }
        else if n.starts_with("io_") { Kind::Io }
        else if n.starts_with("carry_in") { Kind::Carry }
        else if n == "fabout" { Kind::Fabout }
        else { Kind::Other }
    }
}

/// names the place and route looks up (`Chip::net`); other aliases are not kept
fn wanted(name: &str) -> bool {
    name.starts_with("lutff_") || name.starts_with("io_") || name.starts_with("glb_netwk_") || name == "fabout" || name.starts_with("carry_in") || name.starts_with("ram/")
}

pub struct Pip {
    pub x: u8,
    pub y: u8,
    pub src: u32,
    pub dst: u32,
    /// index into `Chip::groups` (the destination mux's config bits)
    pub group: u32,
    /// value of the group's bits, bit i = group[i]
    pub pat: u32,
}

pub struct Chip {
    pub w: i32,
    pub h: i32,
    /// tile type ("logic", "io", "ramb", "ramt", "dsp0".., "ipcon") by position, in file order
    pub tiles: Vec<((i32, i32), String)>,
    pub tile_type: HashMap<(i32, i32), String>,
    /// tile type -> (columns, rows)
    pub dims: HashMap<String, (usize, usize)>,
    /// tile type -> function name -> bits
    pub tile_bits: HashMap<String, HashMap<String, Vec<BitPos>>>,
    /// (x, y, name) -> net
    pub by_name: HashMap<(i32, i32, String), u32>,
    /// per net: bounding box of the tiles it appears in (x0, y0, x1, y1)
    pub net_box: Vec<(i16, i16, i16, i16)>,
    /// per net: one (x, y, name) for messages
    pub net_label: Vec<(i32, i32, String)>,
    pub kind: Vec<Kind>,
    pub pips: Vec<Pip>,
    pub groups: Vec<Vec<BitPos>>,
    /// net -> pips leaving it
    pub fanout: Vec<Vec<u32>>,
    /// package pin -> (x, y, pio)
    pub pins: HashMap<String, (i32, i32, u8)>,
    pub pin_order: Vec<String>,
    /// (x, y) of a `fabout` that drives global network g
    pub gbufin: Vec<(i32, i32, u8)>,
    /// (x, y, pio) -> (x, y, ieren number)
    pub ieren: HashMap<(i32, i32, u8), (i32, i32, u8)>,
    /// column buffer source tiles
    pub colbuf_src: Vec<(i32, i32)>,
    /// (x, y, pio, g): an IO pad that can drive global network g directly (padin)
    pub gbufpin: Vec<(i32, i32, u8, u8)>,
    /// config bits outside the tiles: name ("padin_glb_netwk.3") -> (bank, x, y)
    pub extra_bits: HashMap<String, (usize, usize, usize)>,
}

fn bitpos(s: &str) -> R<BitPos> {
    // "B12[34]"
    let s = s.strip_prefix('B').ok_or_else(|| format!("bad bit '{}'", s))?;
    let (r, c) = s.split_once('[').ok_or_else(|| format!("bad bit '{}'", s))?;
    let c = c.trim_end_matches(']');
    Ok((r.parse().map_err(|_| format!("bad bit '{}'", s))?, c.parse().map_err(|_| format!("bad bit '{}'", s))?))
}

pub fn default_path() -> Option<String> {
    if let Ok(p) = std::env::var("VERYL_EDA_CHIPDB") { return Some(p); }
    let home = std::env::var("HOME").unwrap_or_default();
    let cands = [
        "/opt/homebrew/share/icebox/chipdb-5k.txt".to_string(),
        "/usr/local/share/icebox/chipdb-5k.txt".to_string(),
        "/usr/share/icebox/chipdb-5k.txt".to_string(),
        "/Users/Shared/ccc/oss-cad-suite/share/icebox/chipdb-5k.txt".to_string(),
        format!("{}/oss-cad-suite/share/icebox/chipdb-5k.txt", home),
    ];
    cands.into_iter().find(|p| std::path::Path::new(p).exists())
}

impl Chip {
    pub fn load(path: &str, package: &str) -> R<Chip> {
        let text = std::fs::read_to_string(path).map_err(|e| format!("{}: {}", path, e))?;
        Self::parse(&text, package).map_err(|e| format!("{}: {}", path, e))
    }

    /// parse the text of a chipdb file
    pub fn parse(text: &str, package: &str) -> R<Chip> {
        let path = "chipdb";
        let mut c = Chip {
            w: 0, h: 0, tiles: vec![], tile_type: HashMap::new(), dims: HashMap::new(), tile_bits: HashMap::new(),
            by_name: HashMap::new(), net_box: vec![], net_label: vec![], kind: vec![], pips: vec![], groups: vec![], fanout: vec![],
            pins: HashMap::new(), pin_order: vec![], gbufin: vec![], ieren: HashMap::new(), colbuf_src: vec![],
            gbufpin: vec![], extra_bits: HashMap::new(),
        };
        enum Sec { None, Pins(bool), Gbufin, Gbufpin, ExtraBits, Ieren, Colbuf, Bits(String), Net(u32), Mux(u8, u8, u32, u32) }
        let mut sec = Sec::None;
        let mut group_ix: HashMap<(u8, u8, Vec<BitPos>), u32> = HashMap::new();
        for line in text.lines() {
            let p: Vec<&str> = line.split_whitespace().collect();
            if p.is_empty() || p[0].starts_with('#') { sec = Sec::None; continue; }
            if p[0].starts_with('.') {
                sec = Sec::None;
                match p[0] {
                    ".device" => {
                        c.w = p[2].parse().unwrap_or(0);
                        c.h = p[3].parse().unwrap_or(0);
                        let n: usize = p[4].parse().unwrap_or(0);
                        c.net_box = vec![(i16::MAX, i16::MAX, i16::MIN, i16::MIN); n];
                        c.net_label = vec![(0, 0, String::new()); n];
                        c.kind = vec![Kind::Other; n];
                        c.fanout = vec![vec![]; n];
                    }
                    ".pins" => sec = Sec::Pins(p[1] == package),
                    ".gbufin" => sec = Sec::Gbufin,
                    ".gbufpin" => sec = Sec::Gbufpin,
                    ".extra_bits" => sec = Sec::ExtraBits,
                    ".ieren" => sec = Sec::Ieren,
                    ".colbuf" => sec = Sec::Colbuf,
                    ".net" => sec = Sec::Net(p[1].parse().map_err(|_| "bad .net")?),
                    ".buffer" | ".routing" => {
                        let (x, y, dst): (u8, u8, u32) = (p[1].parse().unwrap(), p[2].parse().unwrap(), p[3].parse().unwrap());
                        let bits: Vec<BitPos> = p[4..].iter().map(|b| bitpos(b)).collect::<R<_>>()?;
                        let n = c.groups.len() as u32;
                        let g = *group_ix.entry((x, y, bits.clone())).or_insert(n);
                        if g == n { c.groups.push(bits); }
                        sec = Sec::Mux(x, y, dst, g);
                    }
                    t if t.ends_with("_tile_bits") => {
                        let k = t[1..t.len() - 10].to_string();
                        c.dims.insert(k.clone(), (p[1].parse().unwrap_or(0), p[2].parse().unwrap_or(0)));
                        c.tile_bits.insert(k.clone(), HashMap::new());
                        sec = Sec::Bits(k);
                    }
                    t if t.ends_with("_tile") => {
                        let k = t[1..t.len() - 5].to_string();
                        let xy = (p[1].parse().unwrap(), p[2].parse().unwrap());
                        c.tiles.push((xy, k.clone()));
                        c.tile_type.insert(xy, k);
                    }
                    _ => {}
                }
                continue;
            }
            match &mut sec {
                Sec::None => {}
                Sec::Pins(ours) => if *ours {
                    c.pin_order.push(p[0].to_string());
                    c.pins.insert(p[0].to_string(), (p[1].parse().unwrap(), p[2].parse().unwrap(), p[3].parse().unwrap()));
                },
                Sec::Gbufin => c.gbufin.push((p[0].parse().unwrap(), p[1].parse().unwrap(), p[2].parse().unwrap())),
                Sec::Gbufpin => c.gbufpin.push((p[0].parse().unwrap(), p[1].parse().unwrap(), p[2].parse().unwrap(), p[3].parse().unwrap())),
                Sec::ExtraBits => { c.extra_bits.insert(p[0].to_string(), (p[1].parse().unwrap(), p[2].parse().unwrap(), p[3].parse().unwrap())); }
                Sec::Ieren => {
                    let v: Vec<i32> = p.iter().map(|s| s.parse().unwrap()).collect();
                    c.ieren.insert((v[0], v[1], v[2] as u8), (v[3], v[4], v[5] as u8));
                }
                Sec::Colbuf => {
                    let xy = (p[0].parse().unwrap(), p[1].parse().unwrap());
                    if !c.colbuf_src.contains(&xy) { c.colbuf_src.push(xy); }
                }
                Sec::Bits(k) => {
                    let bits: Vec<BitPos> = p[1..].iter().map(|b| bitpos(b)).collect::<R<_>>()?;
                    c.tile_bits.get_mut(k).unwrap().insert(p[0].to_string(), bits);
                }
                Sec::Net(n) => {
                    let (x, y): (i32, i32) = (p[0].parse().unwrap(), p[1].parse().unwrap());
                    let n = *n as usize;
                    let b = &mut c.net_box[n];
                    *b = (b.0.min(x as i16), b.1.min(y as i16), b.2.max(x as i16), b.3.max(y as i16));
                    if c.net_label[n].2.is_empty() { c.net_label[n] = (x, y, p[2].to_string()); c.kind[n] = Kind::of(p[2]); }
                    if wanted(p[2]) { c.by_name.insert((x, y, p[2].to_string()), n as u32); }
                }
                Sec::Mux(x, y, dst, g) => {
                    let pat = p[0].bytes().enumerate().fold(0u32, |a, (i, b)| a | (((b == b'1') as u32) << i));
                    let src: u32 = p[1].parse().unwrap();
                    c.fanout[src as usize].push(c.pips.len() as u32);
                    c.pips.push(Pip { x: *x, y: *y, src, dst: *dst, group: *g, pat });
                }
            }
        }
        if c.w == 0 { return Err(format!("{}: no .device line", path)); }
        if c.pins.is_empty() { return Err(format!("{}: no pins for package '{}'", path, package)); }
        Ok(c)
    }

    pub fn net(&self, x: i32, y: i32, name: &str) -> Option<u32> {
        self.by_name.get(&(x, y, name.to_string())).copied()
    }

    pub fn label(&self, n: u32) -> String {
        let (x, y, s) = &self.net_label[n as usize];
        format!("{}@{},{}", s, x, y)
    }

    /// config bits of a tile function, e.g. ("logic", "LC_3") or ("io", "IOB_0.PINTYPE_0")
    pub fn bits(&self, ttype: &str, func: &str) -> R<&Vec<BitPos>> {
        self.tile_bits.get(ttype).and_then(|t| t.get(func)).ok_or_else(|| format!("no config bits '{}' in {} tiles", func, ttype))
    }
}
