//! A tiny 2-state gate-level simulator over the synthesized netlist, used to
//! check synthesis results (single clock domain: `step` = one active edge).

use crate::netlist::*;
use std::collections::HashMap;

pub struct NetSim<'n> {
    nl: &'n Netlist,
    v: HashMap<u32, bool>,
}

impl<'n> NetSim<'n> {
    pub fn new(nl: &'n Netlist) -> Self { NetSim { nl, v: HashMap::new() } }

    fn get_bit(&self, b: Bit) -> bool {
        match b { Bit::C0 => false, Bit::C1 => true, Bit::W(w) => *self.v.get(&w).unwrap_or(&false) }
    }
    fn port(&self, name: &str) -> &'n Port {
        self.nl.ports.iter().find(|p| p.name == name).unwrap_or_else(|| panic!("no port '{}'", name))
    }

    pub fn set(&mut self, name: &str, val: u128) {
        for (i, b) in self.port(name).bits.iter().enumerate() {
            if let Bit::W(w) = b { self.v.insert(*w, (val >> i) & 1 == 1); }
        }
        self.settle();
    }

    pub fn get(&self, name: &str) -> u128 {
        self.port(name).bits.iter().enumerate().fold(0, |acc, (i, b)| acc | ((self.get_bit(*b) as u128) << i))
    }

    /// (reset pin, active-high, async, value) of a flip-flop with reset/set
    fn reset_of(c: &Cell) -> Option<(&'static str, bool, bool, bool)> {
        let t = c.typ.as_str();
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
                if c.is_ff() { continue; }
                let g = |p: &str, s: &Self| s.get_bit(c.port(p).unwrap());
                let y = match c.typ.as_str() {
                    "$_NOT_" => !g("A", self),
                    "$_AND_" => g("A", self) & g("B", self),
                    "$_OR_" => g("A", self) | g("B", self),
                    "$_XOR_" => g("A", self) ^ g("B", self),
                    "$_MUX_" => if g("S", self) { g("B", self) } else { g("A", self) },
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
    pub fn step(&mut self) {
        let mut next = vec![];
        for c in self.nl.cells.iter().filter(|c| c.is_ff()) {
            let mut d = self.get_bit(c.port("D").unwrap());
            if let Some((pin, hi, _, val)) = Self::reset_of(c) {
                if self.get_bit(c.port(pin).unwrap()) == hi { d = val; }
            }
            if let Bit::W(w) = c.out() { next.push((w, d)); }
        }
        for (w, d) in next { self.v.insert(w, d); }
        self.settle();
    }
}
