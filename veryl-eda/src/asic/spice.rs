//! The mapped netlist as SPICE (CDL style): one subcircuit for the design,
//! an `X` instance per cell calling the library's own subcircuit (SKY130:
//! `sky130_fd_sc_hd__*` from the PDK's CDL file), power pins tied to VPWR /
//! VGND (the wells VPB / VNB with them). It is the reference netlist for
//! KLayout's LVS (`tools/lvs_check.py`) and can be simulated with the
//! PDK's models in ngspice.
//!
//! The pin order of a cell's subcircuit is the CDL's: its inputs, VGND VNB
//! VPB VPWR, its outputs, each group in alphabetical order (checked against
//! the CDL file by the tests when it is there).

use super::Output;
use crate::netlist::{Bit, Dir};
use std::collections::HashMap;

/// a cell's pins in the order of its CDL subcircuit
pub fn pin_order(m: &crate::pdk::lef::Macro) -> Vec<String> {
    let power = |p: &crate::pdk::lef::MacroPin| matches!(p.usage.as_str(), "POWER" | "GROUND");
    let mut ins: Vec<String> = m.pins.iter().filter(|p| !power(p) && p.dir != "OUTPUT").map(|p| p.name.clone()).collect();
    let mut outs: Vec<String> = m.pins.iter().filter(|p| !power(p) && p.dir == "OUTPUT").map(|p| p.name.clone()).collect();
    let mut pw: Vec<String> = m.pins.iter().filter(|p| power(p)).map(|p| p.name.clone()).collect();
    ins.sort();
    outs.sort();
    pw.sort();
    [ins, pw, outs].concat()
}

/// a SPICE name: letters, digits and _ [ ] . kept, anything else as _
fn clean(s: &str) -> String { s.chars().map(|c| if c.is_ascii_alphanumeric() || "_[].".contains(c) { c } else { '_' }).collect() }

/// `include`: a line `.INCLUDE <path>` for the library's subcircuits (the PDK's CDL file)
pub fn write(o: &Output, include: Option<&str>) -> Result<String, String> {
    let tech = crate::pdk::tech();
    let lef = tech.lef.as_ref().ok_or("SPICE output needs a LEF technology (--pdk sky130)")?;
    let nl = &o.mapped;
    // net names: a port's name where the net is a port, else n<wire>
    let mut name: HashMap<Bit, String> = HashMap::new();
    let mut ports = vec![];
    for p in &nl.ports {
        for (i, b) in p.bits.iter().enumerate() {
            let n = clean(&if p.bits.len() > 1 { format!("{}[{}]", p.name, i) } else { p.name.clone() });
            ports.push(n.clone());
            name.entry(*b).or_insert(n);
        }
    }
    let net = |b: &Bit| match b { Bit::W(w) => name.get(b).cloned().unwrap_or_else(|| format!("n{}", w)), Bit::C0 => "VGND".into(), Bit::C1 => "VPWR".into() };
    let mut s = String::new();
    s += &format!("* {}: the mapped netlist of veryl2chip (veryl-eda), {} cells of {}\n", nl.name, nl.cells.len(), tech.name);
    if let Some(p) = include { s += &format!(".INCLUDE {}\n", p); }
    let mut pins = ports.clone();
    pins.push("VPWR".into());
    pins.push("VGND".into());
    s += &format!("\n.SUBCKT {} {}\n", clean(&nl.name), pins.join(" "));
    // an output port driven straight by an input (no cell between) is the same net under two names
    for p in nl.ports.iter().filter(|p| p.dir == Dir::Out) {
        for (i, b) in p.bits.iter().enumerate() {
            let n = clean(&if p.bits.len() > 1 { format!("{}[{}]", p.name, i) } else { p.name.clone() });
            if net(b) != n { s += &format!("* {} is {}\n", n, net(b)); }
        }
    }
    for (k, c) in nl.cells.iter().enumerate() {
        let b = tech.binding(&c.typ).ok_or_else(|| format!("cell {} has no {} binding", c.typ, tech.name))?;
        let m = lef.macro_(&b.cell).ok_or_else(|| format!("{} not in the LEF", b.cell))?;
        let args: Vec<String> = pin_order(m).iter().map(|p| match p.as_str() {
            "VPWR" | "VPB" => "VPWR".to_string(),
            "VGND" | "VNB" => "VGND".to_string(),
            lp => b.pins.iter().find(|x| x.1 == lp).and_then(|x| c.port(x.0)).map(|x| net(&x)).unwrap_or_else(|| format!("nc{}_{}", k, lp)),
        }).collect();
        s += &format!("Xc{} {} {}\n", k, args.join(" "), b.cell);
    }
    s += &format!(".ENDS {}\n", clean(&nl.name));
    Ok(s)
}
