//! A tiny 2-state gate-level simulator over the synthesized netlist, used to
//! check synthesis results (single clock domain: `step` = one active edge).

use crate::netlist::*;
use std::collections::HashMap;

pub struct NetSim<'n> {
    nl: &'n Netlist,
    v: HashMap<u32, bool>,
    /// SB_RAM40_4K contents (256 × 16 bits), by cell index
    ram: HashMap<usize, Vec<u16>>,
    /// SRAM macro contents, by cell index
    sram: HashMap<usize, Vec<u128>>,
}

impl<'n> NetSim<'n> {
    pub fn new(nl: &'n Netlist) -> Self { NetSim { nl, v: HashMap::new(), ram: HashMap::new(), sram: HashMap::new() } }

    fn get_bit(&self, b: Bit) -> bool {
        match b { Bit::C0 => false, Bit::C1 => true, Bit::W(w) => *self.v.get(&w).unwrap_or(&false) }
    }
    fn port(&self, name: &str) -> &'n Port {
        self.nl.ports.iter().find(|p| p.name == name).unwrap_or_else(|| panic!("no port '{}'", name))
    }

    /// value of any wire
    pub fn bit(&self, b: Bit) -> bool { self.get_bit(b) }

    /// drive an input port without settling (call `settle` after the last one)
    pub fn poke(&mut self, name: &str, val: u128) {
        for (i, b) in self.port(name).bits.iter().enumerate() {
            if let Bit::W(w) = b { self.v.insert(*w, i < 128 && (val >> i) & 1 == 1); }
        }
    }

    pub fn set(&mut self, name: &str, val: u128) {
        for (i, b) in self.port(name).bits.iter().enumerate() {
            if let Bit::W(w) = b { self.v.insert(*w, i < 128 && (val >> i) & 1 == 1); }
        }
        self.settle();
    }

    /// ports wider than 128 bits
    pub fn set_wide(&mut self, name: &str, val: crate::value::Bits) {
        for (i, b) in self.port(name).bits.iter().enumerate() {
            if let Bit::W(w) = b { self.v.insert(*w, val.bit(i as u32)); }
        }
        self.settle();
    }
    pub fn get_wide(&self, name: &str) -> crate::value::Bits {
        let mut v = crate::value::Bits::ZERO;
        for (i, b) in self.port(name).bits.iter().enumerate() { if self.get_bit(*b) { v.0[i / 64] |= 1 << (i % 64); } }
        v
    }

    pub fn get(&self, name: &str) -> u128 {
        self.port(name).bits.iter().enumerate().take(128).fold(0, |acc, (i, b)| acc | ((self.get_bit(*b) as u128) << i))
    }

    /// (reset pin, active-high, async, value) of a flip-flop with reset/set
    fn reset_of(c: &Cell) -> Option<(&'static str, bool, bool, bool)> {
        let t = c.typ.as_str();
        // vlib flip-flops: active-low asynchronous reset / set
        match t {
            "DFFR" | "DFFNR" => return Some(("RN", false, true, false)),
            "DFFS" | "DFFNS" => return Some(("SN", false, true, true)),
            "DFF" | "DFFN" => return None,
            _ => {}
        }
        if let Some(k) = t.strip_prefix("SB_DFF") {
            // SB_DFF[N][S]{R,S}: iCE40 resets/sets are active-high
            let k = k.trim_start_matches('N');
            let (sync, k) = if k.len() == 2 { (true, &k[1..]) } else { (false, k) };
            return match k { "R" => Some(("R", true, !sync, false)), "S" => Some(("S", true, !sync, true)), _ => None };
        }
        c.port("R")?;
        let f: Vec<char> = t.trim_start_matches("$_").trim_start_matches('S').trim_start_matches("DFF_").chars().collect();
        Some(("R", f[1] == 'P', !t.starts_with("$_SDFF"), f[2] == '1'))
    }

    /// evaluate combinational logic (cells are in topological order); async
    /// resets can change flip-flops, so repeat until stable
    pub fn settle(&mut self) {
        for _ in 0..4 {
            for c in &self.nl.cells {
                if c.is_ff() || c.typ == "SB_RAM40_4K" || c.typ == "SRAM" { continue; }
                let g = |p: &str, s: &Self| s.get_bit(c.port(p).unwrap());
                let y = match c.typ.as_str() {
                    "$_NOT_" => !g("A", self),
                    "$_AND_" => g("A", self) & g("B", self),
                    "$_OR_" => g("A", self) | g("B", self),
                    "$_XOR_" => g("A", self) ^ g("B", self),
                    "$_MUX_" => if g("S", self) { g("B", self) } else { g("A", self) },
                    "INV" => !g("A", self),
                    "BUF" | "CLKBUF" => g("A", self),
                    "NAND2" => !(g("A", self) & g("B", self)),
                    "NOR2" => !(g("A", self) | g("B", self)),
                    "AND2" => g("A", self) & g("B", self),
                    "OR2" => g("A", self) | g("B", self),
                    "XOR2" => g("A", self) ^ g("B", self),
                    "XNOR2" => !(g("A", self) ^ g("B", self)),
                    "AOI21" => !((g("A", self) & g("B", self)) | g("C", self)),
                    "AO21" => (g("A", self) & g("B", self)) | g("C", self),
                    "OA21" => (g("A", self) | g("B", self)) & g("C", self),
                    "NAND3" => !(g("A", self) & g("B", self) & g("C", self)),
                    "NOR3" => !(g("A", self) | g("B", self) | g("C", self)),
                    "AND3" => g("A", self) & g("B", self) & g("C", self),
                    "OR3" => g("A", self) | g("B", self) | g("C", self),
                    "AOI22" => !((g("A", self) & g("B", self)) | (g("C", self) & g("D", self))),
                    "OAI22" => !((g("A", self) | g("B", self)) & (g("C", self) | g("D", self))),
                    "OAI21" => !((g("A", self) | g("B", self)) & g("C", self)),
                    "MUX2" => if g("S", self) { g("B", self) } else { g("A", self) },
                    "TIEL" => false,
                    "TIEH" => true,
                    "SB_CARRY" => { let (a, b, ci) = (g("I0", self), g("I1", self), g("CI", self)); (a & b) | ((a | b) & ci) }
                    "SB_LUT4" => {
                        let idx = ["I0", "I1", "I2", "I3"].iter().enumerate().fold(0, |a, (i, p)| a | ((g(p, self) as usize) << i));
                        let init = &c.params.iter().find(|p| p.0 == "LUT_INIT").unwrap().1;
                        init.as_bytes()[15 - idx] == b'1'
                    }
                    t => panic!("unknown cell {}", t),
                };
                if let Bit::W(w) = c.out() { self.v.insert(w, y); }
            }
            let mut changed = false;
            for c in &self.nl.cells {
                if let Some((pin, hi, true, val)) = Self::reset_of(c) {
                    if self.get_bit(c.port(pin).unwrap()) == hi {
                        if let Bit::W(w) = c.out() { changed |= self.v.insert(w, val) != Some(val); }
                    }
                }
            }
            if !changed { break; }
        }
    }

    /// one active clock edge on every flip-flop
    pub fn step(&mut self) { self.capture(&vec![true; self.nl.cells.len()]); }

    /// clock pin and active edge (true = rising) of a sequential cell
    fn clock_of(c: &Cell) -> Option<(Bit, bool)> {
        let t = c.typ.as_str();
        let pin = ["C", "CK", "RCLK"].iter().find_map(|p| c.port(p))?;
        let rising = match t {
            "SB_RAM40_4K" | "SRAM" => true,
            _ if t.starts_with("SB_DFFN") || t.starts_with("DFFN") => false,
            _ if t.starts_with("$_DFF_N") || t.starts_with("$_SDFF_N") => false,
            _ => true,
        };
        (c.is_ff() || t == "SB_RAM40_4K" || t == "SRAM").then_some((pin, rising))
    }

    /// one full cycle (rise, then fall) of the input clock `clk`: only the
    /// flip-flops / RAMs whose clock pin sees their active edge capture (several
    /// clock domains, negative-edge flip-flops, clocks through buffers)
    pub fn tick(&mut self, clk: &str) {
        let cells: Vec<Option<(Bit, bool)>> = self.nl.cells.iter().map(Self::clock_of).collect();
        self.set(clk, 0);
        for level in [1u128, 0] {
            let before: Vec<bool> = cells.iter().map(|c| c.map(|(p, _)| self.get_bit(p)).unwrap_or(false)).collect();
            self.set(clk, level);
            let sel: Vec<bool> = cells.iter().zip(&before).map(|(c, b)| match c {
                Some((p, rising)) => { let now = self.get_bit(*p); now != *b && now == *rising }
                None => false,
            }).collect();
            if sel.iter().any(|x| *x) { self.capture(&sel); }
        }
    }

    /// the selected flip-flops and RAMs take their next state
    fn capture(&mut self, sel: &[bool]) {
        let mut next = vec![];
        for (_, c) in self.nl.cells.iter().enumerate().filter(|(i, c)| c.is_ff() && sel[*i]) {
            let mut d = self.get_bit(c.port("D").unwrap());
            if let Some((pin, hi, _, val)) = Self::reset_of(c) {
                if self.get_bit(c.port(pin).unwrap()) == hi { d = val; }
            }
            if let Bit::W(w) = c.out() { next.push((w, d)); }
        }
        // block RAMs (yosys cells_sim.v): registered read of the old contents, then the write;
        // in mode m data bit d is physical bit (d << m) | lane, lane = the address bits above 7
        let mut next_ram = vec![];
        for (i, c) in self.nl.cells.iter().enumerate().filter(|(i, c)| c.typ == "SB_RAM40_4K" && sel[*i]) {
            let g = |p: &str| self.get_bit(c.port(p).unwrap_or(Bit::C0));
            let bus = |name: &[&str]| name.iter().enumerate().fold(0usize, |a, (k, p)| a | ((g(p) as usize) << k));
            let mode = |p: &str| c.params.iter().find(|x| x.0 == p).map(|x| usize::from_str_radix(&x.1, 2).unwrap_or(0)).unwrap_or(0);
            let (rm, wm) = (mode("READ_MODE"), mode("WRITE_MODE"));
            let (re, we) = (g("RE") && g("RCLKE"), g("WE") && g("WCLKE"));
            let (ra, wa, wd, mask) = (bus(&crate::bram::RADDR), bus(&crate::bram::WADDR), bus(&crate::bram::WDATA), bus(&crate::bram::MASK));
            let mem = self.ram.entry(i).or_insert_with(|| vec![0; 256]);
            if re {
                let (word, lane) = (mem[ra & 0xff], (ra >> 8) & ((1 << rm) - 1));
                let mut out = [false; 16];
                for d in 0..(16 >> rm) { out[crate::bram::data_pin(rm, d)] = (word >> ((d << rm) | lane)) & 1 == 1; }
                for (k, p) in crate::bram::RDATA.iter().enumerate() {
                    if let Some(Bit::W(w)) = c.port(p) { next_ram.push((w, out[k])); }
                }
            }
            if we {
                let cur = mem[wa & 0xff];
                mem[wa & 0xff] = if wm == 0 {
                    (cur & mask as u16) | (wd as u16 & !(mask as u16))
                } else {
                    let lane = (wa >> 8) & ((1 << wm) - 1);
                    let mut v = cur;
                    for d in 0..(16 >> wm) {
                        let b = (d << wm) | lane;
                        v = (v & !(1 << b)) | ((((wd >> crate::bram::data_pin(wm, d)) & 1) as u16) << b);
                    }
                    v
                };
            }
        }
        // SRAM macros (asic::lib): registered read of the old word, then the write
        for (i, c) in self.nl.cells.iter().enumerate().filter(|(i, c)| c.typ == "SRAM" && sel[*i]) {
            let depth = crate::asic::lib::param(c, "DEPTH");
            let bus = |base: &str| c.conns.iter().filter_map(|(p, b)| {
                let k: usize = p.strip_prefix(base)?.strip_prefix('[')?.strip_suffix(']')?.parse().ok()?;
                Some((self.get_bit(*b) as u128) << k)
            }).fold(0u128, |a, x| a | x);
            let g = |p: &str| self.get_bit(c.port(p).unwrap_or(Bit::C0));
            let (re, we, ra, wa, wd) = (g("RE"), g("WE"), bus("RA") as usize % depth, bus("WA") as usize % depth, bus("WD"));
            let mem = self.sram.entry(i).or_insert_with(|| vec![0; depth]);
            if re {
                let word = mem[ra];
                for (p, b) in &c.conns {
                    let Some(k) = p.strip_prefix("RDATA[").and_then(|r| r.strip_suffix(']')).and_then(|r| r.parse::<usize>().ok()) else { continue };
                    if let Bit::W(w) = b { next_ram.push((*w, (word >> k) & 1 == 1)); }
                }
            }
            if we { mem[wa] = wd; }
        }
        for (w, d) in next { self.v.insert(w, d); }
        for (w, d) in next_ram { self.v.insert(w, d); }
        self.settle();
    }
}
