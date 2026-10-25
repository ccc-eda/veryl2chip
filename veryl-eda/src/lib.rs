//! veryl-eda as a library: synthesis (Veryl -> gate netlist), iCE40
//! technology mapping, place & route, netlist writers.
//! Used by the command line (`main.rs`) and the WebAssembly build.

pub mod asic;
pub mod bram;
pub mod elab;
pub mod expr;
pub mod ice40;
pub mod netlist;
pub mod netsim;
pub mod output;
pub mod pnr;
pub mod power;
pub mod value;

#[cfg(test)]
mod tests;
