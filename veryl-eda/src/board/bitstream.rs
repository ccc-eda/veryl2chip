//! Bitstream → circuit: decodes an iCE40UP5K configuration (`.asc`, or a
//! `.bin` through [`crate::pnr::bitstream::bin_to_asc`]) into a [`Design`],
//! so the virtual board runs exactly what would be flashed.
//!
//! Routing: every input mux whose config bits equal a pip's pattern connects
//! the pip's source and destination wires; a union-find over the chip's
//! wires turns that into electrical nets. Drivers: logic cell outputs and
//! carries, IO inputs, global networks (from `fabout`, or directly from a
//! pad through the `padin_glb_netwk` extra bits), block RAM outputs and
//! `CarryInSet`. An undriven net reads 0; an unconnected clock enable is on.
//! The design's IO is named by package pin ("35").

use super::{Comb, Ctl, Design, Ff, Ram, C0, C1};
use crate::pnr::chipdb::Chip;
use std::collections::{HashMap, HashSet};

type R<T> = Result<T, String>;

/// LUT_INIT bit k sits at LC config bit LUT_PERM[k] (as the place and route writes it)
const LUT_PERM: [usize; 16] = [4, 14, 15, 5, 6, 16, 17, 7, 3, 13, 12, 2, 1, 11, 10, 0];

/// the configuration of a chip, as an `.asc` describes it
pub struct Config {
    pub tiles: HashMap<(i32, i32), Vec<Vec<bool>>>,
    /// block RAM contents by ramb tile: 256 words of 16 bits (INIT_0 word 0 first)
    pub ram: HashMap<(i32, i32), Vec<u16>>,
    pub extra: HashSet<(usize, usize, usize)>,
}

impl Config {
    pub fn parse_asc(asc: &str) -> R<Config> {
        let mut c = Config { tiles: HashMap::new(), ram: HashMap::new(), extra: HashSet::new() };
        let lines: Vec<&str> = asc.lines().collect();
        let mut i = 0;
        while i < lines.len() {
            let p: Vec<&str> = lines[i].split_whitespace().collect();
            i += 1;
            let Some(&cmd) = p.first() else { continue };
            let num = |k: usize| -> R<i32> { p.get(k).and_then(|s| s.parse().ok()).ok_or_else(|| format!("bad line: {}", p.join(" "))) };
            if cmd.ends_with("_tile") {
                let (x, y) = (num(1)?, num(2)?);
                let mut rows = vec![];
                while i < lines.len() && !lines[i].starts_with('.') {
                    rows.push(lines[i].bytes().map(|b| b == b'1').collect());
                    i += 1;
                }
                c.tiles.insert((x, y), rows);
            } else if cmd == ".ram_data" {
                let (x, y) = (num(1)?, num(2)?);
                let mut words = vec![0u16; 256];
                let mut k = 0;
                while i < lines.len() && !lines[i].starts_with('.') {
                    // line k = INIT_k, 64 hex digits, most significant first; word j = bits 16j..16j+15
                    let digits: Vec<u32> = lines[i].trim().chars().map(|ch| ch.to_digit(16).unwrap_or(0)).collect();
                    for (d, v) in digits.iter().rev().enumerate() {
                        for b in 0..4 {
                            let bit = d * 4 + b;
                            if (v >> b) & 1 == 1 && k < 16 { words[k * 16 + bit / 16] |= 1 << (bit % 16); }
                        }
                    }
                    k += 1;
                    i += 1;
                }
                c.ram.insert((x, y), words);
            } else if cmd == ".extra_bit" {
                c.extra.insert((num(1)? as usize, num(2)? as usize, num(3)? as usize));
            }
        }
        Ok(c)
    }

    pub fn parse_bin(bin: &[u8]) -> R<Config> { Self::parse_asc(&crate::pnr::bitstream::bin_to_asc(bin)?) }

    fn bit(&self, x: i32, y: i32, (r, c): (u8, u8)) -> bool {
        self.tiles.get(&(x, y)).and_then(|t| t.get(r as usize)).and_then(|row| row.get(c as usize)).copied().unwrap_or(false)
    }
}

struct Uf(Vec<u32>);
impl Uf {
    fn find(&mut self, mut a: u32) -> u32 {
        while self.0[a as usize] != a { let p = self.0[a as usize]; self.0[a as usize] = self.0[p as usize]; a = p; }
        a
    }
    fn union(&mut self, a: u32, b: u32) { let (a, b) = (self.find(a), self.find(b)); if a != b { self.0[a as usize] = b; } }
}

/// what decoding found, besides the design
#[derive(Default, Debug)]
pub struct Report {
    pub lcs: usize,
    pub rams: usize,
    pub pins_in: Vec<String>,
    pub pins_out: Vec<String>,
    pub warnings: Vec<String>,
}

/// decode a configuration into a design for the board engine
pub fn decode(chip: &Chip, cfg: &Config) -> R<(Design, Report)> {
    let mut rep = Report::default();
    let func = |x: i32, y: i32, f: &str| -> bool {
        let Some(t) = chip.tile_type.get(&(x, y)) else { return false };
        chip.tile_bits.get(t).and_then(|m| m.get(f)).map(|bits| !bits.is_empty() && bits.iter().all(|b| cfg.bit(x, y, *b))).unwrap_or(false)
    };
    let lc_bits = |x: i32, y: i32, z: usize| -> [bool; 20] {
        let mut v = [false; 20];
        if let Ok(bits) = chip.bits("logic", &format!("LC_{}", z)) { for (k, b) in bits.iter().enumerate().take(20) { v[k] = cfg.bit(x, y, *b); } }
        v
    };
    let nnets = chip.kind.len();
    let mut uf = Uf((0..nnets as u32).collect());

    // routing: enabled pips (a mux's bits equal to the pip's pattern; all-zero = no connection)
    let mut group_val: HashMap<(u8, u8, u32), u32> = HashMap::new();
    for p in &chip.pips {
        if p.pat == 0 { continue; }
        let v = *group_val.entry((p.x, p.y, p.group)).or_insert_with(|| {
            chip.groups[p.group as usize].iter().enumerate().fold(0u32, |a, (i, b)| a | ((cfg.bit(p.x as i32, p.y as i32, *b) as u32) << i))
        });
        if v == p.pat { uf.union(p.src, p.dst); }
    }
    let net = |x: i32, y: i32, name: &str| chip.net(x, y, name);

    // global networks: padin (extra bits) or the hardwired fabout of a gbufin
    let mut padin_glb: HashMap<u8, (i32, i32, u8)> = HashMap::new();
    for &(x, y, pio, g) in &chip.gbufpin {
        if let Some(&(b, bx, by)) = chip.extra_bits.get(&format!("padin_glb_netwk.{}", g)) {
            if cfg.extra.contains(&(b, bx, by)) { padin_glb.insert(g, (x, y, pio)); }
        }
    }
    for &(x, y, g) in &chip.gbufin {
        if padin_glb.contains_key(&g) { continue; }
        if let (Some(f), Some(n)) = (net(x, y, "fabout"), net(x, y, &format!("glb_netwk_{}", g))) { uf.union(f, n); }
    }

    // design nets: one per union-find root that is used; drivers recorded per root
    let mut d = Design { nets: 2, ..Default::default() };
    let mut id: HashMap<u32, u32> = HashMap::new();
    let mut driven: HashMap<u32, String> = HashMap::new();
    let new_net = |d: &mut Design| { d.nets += 1; d.nets as u32 - 1 };
    macro_rules! wire { ($n:expr) => {{ let r = uf.find($n); *id.entry(r).or_insert_with(|| new_net(&mut d)) }} }
    let drive = |root_of: u32, what: String, uf: &mut Uf, driven: &mut HashMap<u32, String>, rep: &mut Report| {
        let r = uf.find(root_of);
        if let Some(prev) = driven.insert(r, what.clone()) { rep.warnings.push(format!("{} and {} drive the same wire {}", prev, what, chip.label(root_of))); }
    };
    // constant drivers become aliases of C0 / C1
    let mut constant: Vec<(u32, u32)> = vec![];

    // ---- logic cells ----
    let mut tiles: Vec<(i32, i32)> = chip.tiles.iter().filter(|(_, t)| t == "logic").map(|(xy, _)| *xy).collect();
    tiles.sort();
    for &(x, y) in &tiles {
        if !cfg.tiles.contains_key(&(x, y)) { continue; }
        let neg = func(x, y, "NegClk");
        let gl = |n: &str| net(x, y, &format!("lutff_global/{}", n));
        for z in 0..8 {
            let v = lc_bits(x, y, z);
            let lut: u16 = (0..16).fold(0, |a, k| a | ((v[LUT_PERM[k]] as u16) << k));
            let (carry, ff) = (v[8], v[9]);
            let Some(out) = net(x, y, &format!("lutff_{}/out", z)) else { continue };
            // an unconfigured LC (an all-zero LUT alone would only drive 0, which undriven wires read anyway)
            if lut == 0 && !carry && !ff { continue; }
            rep.lcs += 1;
            let ins: Vec<u32> = (0..4).map(|k| net(x, y, &format!("lutff_{}/in_{}", z, k)).map(|n| wire!(n)).unwrap_or(C0)).collect();
            let ins = [ins[0], ins[1], ins[2], ins[3]];
            if carry {
                let cin = if z == 0 { net(x, y, "carry_in_mux") } else { net(x, y, &format!("lutff_{}/cout", z - 1)) };
                let cin_net = match cin { Some(n) => wire!(n), None => C0 };
                if z == 0 && func(x, y, "CarryInSet") {
                    if let Some(n) = cin { let r = uf.find(n); if !driven.contains_key(&r) { constant.push((cin_net, C1)); driven.insert(r, "CarryInSet".into()); } }
                }
                if let Some(co) = net(x, y, &format!("lutff_{}/cout", z)) {
                    let co_net = wire!(co);
                    drive(co, format!("carry {},{}/{}", x, y, z), &mut uf, &mut driven, &mut rep);
                    d.comb.push(Comb { ins: [ins[1], ins[2], cin_net, C0], table: 0b1110_1000, out: co_net });
                }
            }
            let out_net = wire!(out);
            drive(out, format!("LC {},{}/{}", x, y, z), &mut uf, &mut driven, &mut rep);
            if ff {
                let lut_out = new_net(&mut d);
                d.comb.push(Comb { ins, table: lut, out: lut_out });
                let clk = gl("clk").map(|n| wire!(n)).unwrap_or(C0);
                let en = gl("cen").map(|n| wire!(n));
                let sr = gl("s_r").map(|n| wire!(n));
                let ctl = sr.map(|n| Ctl { net: n, val: v[18], sync: !v[19] });
                d.ffs.push(Ff { d: lut_out, q: out_net, clk, neg, en, ctl });
            } else {
                d.comb.push(Comb { ins, table: lut, out: out_net });
            }
        }
    }

    // ---- IO pins ----
    let mut pins: Vec<(&String, &(i32, i32, u8))> = chip.pins.iter().collect();
    pins.sort_by_key(|(p, _)| p.parse::<u32>().unwrap_or(u32::MAX));
    let mut pad_in: HashMap<(i32, i32, u8), u32> = HashMap::new();
    for (pin, &(x, y, z)) in pins {
        let pt = |k: usize| func(x, y, &format!("IOB_{}.PINTYPE_{}", z, k));
        let (t0, t1, t2, t3, t4, t5) = (pt(0), pt(1), pt(2), pt(3), pt(4), pt(5));
        // PIN_TYPE[5:2] = 0110: simple output; [1:0] = 01: simple input
        let output = t3 && t4 && !t2 && !t5;
        let input = t0 && !t1;
        let used_glb = padin_glb.values().any(|p| *p == (x, y, z));
        if output {
            match net(x, y, &format!("io_{}/D_OUT_0", z)) {
                Some(n) => { let w = wire!(n); d.outputs.push((pin.clone(), w)); rep.pins_out.push(pin.clone()); }
                None => rep.warnings.push(format!("pin {}: no D_OUT_0 wire", pin)),
            }
        } else if input || used_glb {
            let pad = new_net(&mut d);
            d.inputs.push((pin.clone(), pad));
            rep.pins_in.push(pin.clone());
            pad_in.insert((x, y, z), pad);
            if input {
                if let Some(n) = net(x, y, &format!("io_{}/D_IN_0", z)) {
                    let w = wire!(n);
                    drive(n, format!("pin {}", pin), &mut uf, &mut driven, &mut rep);
                    constant.push((w, pad));
                }
            }
        } else if t0 || t1 || t2 || t3 || t4 || t5 {
            rep.warnings.push(format!("pin {}: IO mode {}{}{}{}{}{} is not simulated (only simple inputs and outputs)", pin, t5 as u8, t4 as u8, t3 as u8, t2 as u8, t1 as u8, t0 as u8));
        }
    }
    for (g, xyz) in &padin_glb {
        let Some(&pad) = pad_in.get(xyz) else { continue };
        // any tile's glb_netwk_g wire is the same network
        let Some((x, y)) = chip.tiles.iter().map(|(xy, _)| *xy).find(|(x, y)| net(*x, *y, &format!("glb_netwk_{}", g)).is_some()) else { continue };
        let n = net(x, y, &format!("glb_netwk_{}", g)).unwrap();
        let w = wire!(n);
        drive(n, format!("pad of global {}", g), &mut uf, &mut driven, &mut rep);
        constant.push((w, pad));
    }

    // ---- block RAMs ----
    let mut rambs: Vec<(i32, i32)> = chip.tiles.iter().filter(|(_, t)| t == "ramb").map(|(xy, _)| *xy).collect();
    rambs.sort();
    for (x, y) in rambs {
        if !func(x, y, "RamConfig.PowerUp") { continue; }
        rep.rams += 1;
        let rw = |pin: &str| net(x, y, &format!("ram/{}", pin)).or_else(|| net(x, y + 1, &format!("ram/{}", pin)));
        let cb = |k: usize| func(x, y + 1, &format!("RamConfig.CBIT_{}", k)) as usize;
        let mut pin = |name: &str, d: &mut Design| -> u32 { match rw(name) { Some(n) => { let r = uf.find(n); *id.entry(r).or_insert_with(|| { d.nets += 1; d.nets as u32 - 1 }) } None => C0 } };
        let bus = |base: &str, n: usize, d: &mut Design, pin: &mut dyn FnMut(&str, &mut Design) -> u32| -> Vec<u32> { (0..n).map(|i| pin(&format!("{}_{}", base, i), d)).collect() };
        let a = |v: Vec<u32>| -> [u32; 11] { v.try_into().unwrap() };
        let w16 = |v: Vec<u32>| -> [u32; 16] { v.try_into().unwrap() };
        let ram = Ram {
            rclk: pin("RCLK", &mut d), rclke: pin("RCLKE", &mut d), re: pin("RE", &mut d), raddr: a(bus("RADDR", 11, &mut d, &mut pin)), rdata: w16(bus("RDATA", 16, &mut d, &mut pin)),
            wclk: pin("WCLK", &mut d), wclke: pin("WCLKE", &mut d), we: pin("WE", &mut d), waddr: a(bus("WADDR", 11, &mut d, &mut pin)), wdata: w16(bus("WDATA", 16, &mut d, &mut pin)),
            mask: w16(bus("MASK", 16, &mut d, &mut pin)),
            write_mode: cb(0) | cb(1) << 1, read_mode: cb(2) | cb(3) << 1,
            init: cfg.ram.get(&(x, y)).cloned().unwrap_or_else(|| vec![0; 256]),
        };
        for i in 0..16 { if let Some(n) = rw(&format!("RDATA_{}", i)) { drive(n, format!("RAM {},{}", x, y), &mut uf, &mut driven, &mut rep); } }
        d.rams.push(ram);
    }

    // a wire tied to another (pads, CarryInSet): a buffer cell
    for (dst, src) in constant { d.comb.push(Comb { ins: [src, C0, C0, C0], table: 0b10, out: dst }); }
    // clock enables that nothing drives are on
    let mut has_driver = vec![false; d.nets];
    for c in &d.comb { has_driver[c.out as usize] = true; }
    for f in &d.ffs { has_driver[f.q as usize] = true; }
    for i in &d.inputs { has_driver[i.1 as usize] = true; }
    for r in &d.rams { for n in r.rdata { has_driver[n as usize] = true; } }
    for f in d.ffs.iter_mut() { if let Some(e) = f.en { if !has_driver[e as usize] { f.en = None; } } }
    let _ = &driven;
    Ok((d, rep))
}
