//! Post-synthesis simulation: a synthesized netlist (generic gates, iCE40
//! or vlib standard cells) as a gate model for veryl-sim, so the design's
//! own RTL testbenches run against the gates.

use crate::netlist::{Bit, Dir, Netlist};
use std::cell::RefCell;
use std::collections::HashMap;
use veryl_sim::gates::{GCell, GPort, GateNetlist, Pin};
use veryl_sim::value::Val;

fn pin(b: Bit) -> Pin { match b { Bit::C0 => Pin::C0, Bit::C1 => Pin::C1, Bit::W(w) => Pin::W(w) } }

pub fn to_gates(nl: &Netlist) -> GateNetlist {
    GateNetlist {
        ports: nl.ports.iter().map(|p| GPort { name: p.name.clone(), output: p.dir == Dir::Out, bits: p.bits.iter().map(|b| pin(*b)).collect() }).collect(),
        cells: nl.cells.iter().map(|c| GCell {
            typ: c.typ.clone(),
            conns: c.conns.iter().map(|(p, b)| (p.to_string(), pin(*b))).collect(),
            params: c.params.iter().map(|(k, v)| (k.to_string(), v.clone())).collect(),
        }).collect(),
    }
}

/// the netlist of `top` for a gate-level simulation of the given kind:
/// "opt" (generic gates), "ice40" (LUTs, carries, block RAM), "asic" (vlib cells)
pub fn netlist_for(lib: &crate::elab::Lib, top: &str, kind: &str) -> Result<Netlist, String> {
    netlist_with(lib, top, &HashMap::new(), kind)
}

/// `netlist_for` with `top`'s parameters overridden
pub fn netlist_with(lib: &crate::elab::Lib, top: &str, ov: &HashMap<String, Val>, kind: &str) -> Result<Netlist, String> {
    let (nl, _) = crate::elab::synthesize_with(lib, top, ov)?;
    match kind {
        "opt" | "gate" => Ok(nl),
        "ice40" => crate::ice40::map(&nl),
        "asic" => crate::asic::map::map(&nl),
        k => Err(format!("unknown netlist kind '{}' (opt, ice40, asic)", k)),
    }
}

/// A gate provider for `veryl_sim::run_gates`: every instance of `top`, with
/// whatever parameters it is given, is synthesized to a `kind` netlist.
/// `built` collects (parameters, cell count) of each netlist made.
pub struct Provider<'a> {
    pub lib: &'a crate::elab::Lib<'a>,
    pub top: String,
    pub kind: String,
    pub built: RefCell<Vec<(String, usize)>>,
}

impl<'a> Provider<'a> {
    pub fn new(lib: &'a crate::elab::Lib<'a>, top: &str, kind: &str) -> Self {
        Provider { lib, top: top.to_string(), kind: kind.to_string(), built: RefCell::new(vec![]) }
    }
    pub fn get(&self, module: &str, ov: &HashMap<String, Val>) -> Result<Option<GateNetlist>, String> {
        if module != self.top { return Ok(None); }
        let nl = netlist_with(self.lib, module, ov, &self.kind)?;
        let mut ps: Vec<String> = ov.iter().map(|(n, v)| format!("{}={}", n, v.fmt_dec())).collect();
        ps.sort();
        self.built.borrow_mut().push((ps.join(", "), nl.cells.len()));
        Ok(Some(to_gates(&nl)))
    }
}
