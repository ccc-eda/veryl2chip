//! The finished layout as shapes: every wire, via (its cut and the metal
//! around it, from the technology LEF's via definitions), pin stub, IO pin,
//! power rail, strap and via stack as rectangles on named layers, each with
//! its net; and the cell instances (library cell, position, orientation).
//! The DRC checker and the GDS writer both start from here (a library
//! technology: SKY130).

use super::detail::{self, TRACKS};
use super::lib::{dims, row_h, site_w};
use super::{pdn, Output};
use crate::netlist::Bit;
use std::collections::HashMap;

/// a rectangle (nm) on a layer; net: index into `Layout::nets` (usize::MAX = none)
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Shape { pub layer: u8, pub x0: i64, pub y0: i64, pub x1: i64, pub y1: i64, pub net: usize }

#[derive(Debug, Clone)]
pub struct Inst { pub name: String, pub cell: String, pub x: i64, pub y: i64, pub flip: bool, pub w: i64, pub h: i64 }

pub struct Layout {
    /// layer names, bottom up (index = Shape::layer)
    pub layers: Vec<String>,
    pub shapes: Vec<Shape>,
    pub insts: Vec<Inst>,
    /// net names; 0 = VDD, 1 = VSS
    pub nets: Vec<String>,
    /// the net index of each signal
    pub net_of: HashMap<Bit, usize>,
    /// IO pin labels: (layer, x, y, name)
    pub labels: Vec<(u8, i64, i64, String)>,
    pub die: (i64, i64),
}

pub const LAYERS: [&str; 11] = ["li1", "mcon", "met1", "via", "met2", "via2", "met3", "via3", "met4", "via4", "met5"];

pub fn layer_index(n: &str) -> Option<u8> { LAYERS.iter().position(|l| *l == n).map(|i| i as u8) }

fn nm(x: f64) -> i64 { (x * 1000.0).round() as i64 }

/// cell instances: logic cells, fillers, taps (the DEF's components)
pub fn instances(o: &Output) -> Vec<Inst> {
    let tech = crate::pdk::tech();
    let pl = &o.placement;
    let (sw, rh) = (site_w(), row_h());
    let mut v = vec![];
    for (i, c) in o.mapped.cells.iter().enumerate() {
        let (r, x) = pl.pos[i];
        let (w, h) = dims(c);
        v.push(Inst { name: format!("c{}", i), cell: tech.cell_name(&c.typ).to_string(), x: nm(x as f64 * sw), y: nm(r as f64 * rh), flip: r % 2 == 1, w: nm(w as f64 * sw), h: nm(h as f64 * rh) });
    }
    for (k, &(r, x, w)) in o.pdn.fillers.iter().enumerate() {
        let (mut x, mut left) = (x, w);
        while left > 0 {
            let Some((fw, n)) = tech.fillers.iter().find(|f| f.0 <= left).cloned() else { break };
            v.push(Inst { name: format!("fill{}_{}", k, x), cell: n, x: nm(x as f64 * sw), y: nm(r as f64 * rh), flip: r % 2 == 1, w: nm(fw as f64 * sw), h: nm(rh) });
            x += fw;
            left -= fw;
        }
    }
    if let Some((tap, tw, _)) = &tech.tap {
        for (k, &(r, x)) in o.pdn.taps.iter().enumerate() {
            v.push(Inst { name: format!("tap{}", k), cell: tap.clone(), x: nm(x as f64 * sw), y: nm(r as f64 * rh), flip: r % 2 == 1, w: nm(*tw as f64 * sw), h: nm(rh) });
        }
    }
    v
}

/// an IO pin's shape on the top layer: 0.3 µm wide, reaching 0.8 µm in from its edge of the die
/// (0.24 µm², met4's minimum area)
pub fn pin_rect(x: i64, y: i64, w: i64, h: i64) -> (i64, i64, i64, i64) {
    let d = [x, w - x, y, h - y];
    let near = (0..4).min_by_key(|&k| d[k]).unwrap();
    match near {
        0 => (0, y - 150, 800, y + 150),
        1 => (w - 800, y - 150, w, y + 150),
        2 => (x - 150, 0, x + 150, 800),
        _ => (x - 150, h - 800, x + 150, h),
    }
}

pub fn build(o: &Output) -> Result<Layout, String> {
    let tech = crate::pdk::tech();
    let lef = tech.lef.as_ref().ok_or("the layout needs a LEF technology")?;
    let pl = &o.placement;
    let (sw, rh) = (site_w(), row_h());
    let tk = rh / TRACKS as f64;
    let (ux, uy) = (|x: u32| nm(x as f64 * sw + tech.track_x0), |y: u32| nm(y as f64 * tk + tech.track_y0));
    let li = |n: &str| layer_index(n).ok_or_else(|| format!("layer {} unknown", n));
    let width = |n: &str| lef.layer(n).map(|l| nm(l.width)).unwrap_or(140);
    let mut shapes = vec![];
    let mut nets: Vec<String> = vec!["VDD".into(), "VSS".into()];
    // a via definition's rectangles placed at (x, y)
    let put_via = |shapes: &mut Vec<Shape>, name: &str, x: i64, y: i64, net: usize| -> Result<(), String> {
        let v = lef.via(name).ok_or_else(|| format!("via {} not in the LEF", name))?;
        for r in &v.rects {
            let l = li(&r.layer)?;
            shapes.push(Shape { layer: l, x0: x + nm(r.x0), y0: y + nm(r.y0), x1: x + nm(r.x1), y1: y + nm(r.y1), net });
        }
        Ok(())
    };
    // a wire centred on a segment, extended by half its width at both ends
    let wire = |shapes: &mut Vec<Shape>, l: u8, w: i64, x0: i64, y0: i64, x1: i64, y1: i64, net: usize| {
        let h = w / 2;
        shapes.push(Shape { layer: l, x0: x0.min(x1) - h, y0: y0.min(y1) - h, x1: x0.max(x1) + h, y1: y0.max(y1) + h, net });
    };
    // ---- power: rails on met1, straps on the top grid layer, via stacks ----
    let rail_w = 480;
    let (rail, top) = (li(&tech.layers[0])?, li(&tech.layers[3])?);
    for r in 0..o.pdn.rails {
        let net = if r % 2 == 1 { 0 } else { 1 };
        let y = nm(r as f64 * rh);
        shapes.push(Shape { layer: rail, x0: 0, y0: y - rail_w / 2, x1: nm(pl.w), y1: y + rail_w / 2, net });
    }
    let strap_w = nm(pdn::STRAP_W as f64 * sw - 0.06);
    for &(x, vdd) in &o.pdn.straps {
        let cx = nm(x as f64 * sw + tech.track_x0 + (pdn::STRAP_W as f64 - 1.0) * sw / 2.0);
        shapes.push(Shape { layer: top, x0: cx - strap_w / 2, y0: 0, x1: cx + strap_w / 2, y1: nm(pl.h), net: if vdd { 0 } else { 1 } });
    }
    for &(x, y, vdd) in &o.pdn.vias {
        let (px, py) = (ux(x), nm((y / TRACKS) as f64 * rh));
        for l in 0..3 { put_via(&mut shapes, &tech.vias[l], px, py, if vdd { 0 } else { 1 })?; }
    }
    // ---- signal nets ----
    let mut stub: HashMap<(u32, u32), f64> = HashMap::new();
    for (i, c) in o.mapped.cells.iter().enumerate() {
        let Some(b) = tech.binding(&c.typ) else { continue };
        for (k, (p, _)) in c.conns.iter().enumerate() {
            if let Some(a) = b.access.iter().find(|a| a.0 == *p) { stub.insert(detail::pin_point(&o.mapped, pl, i, k), a.3); }
        }
    }
    let gl: Vec<u8> = (0..4).map(|l| li(&tech.layers[l])).collect::<Result<_, _>>()?;
    let gw: Vec<i64> = (0..4).map(|l| width(&tech.layers[l])).collect();
    let mut net_of: HashMap<Bit, usize> = HashMap::new();
    for n in &o.detail.nets {
        let ni = *net_of.entry(n.bit).or_insert_with(|| { nets.push(match n.bit { Bit::W(w) => format!("n{}", w), _ => "const".into() }); nets.len() - 1 });
        for &(l, x0, y0, x1, y1) in &n.segs { wire(&mut shapes, gl[l as usize], gw[l as usize], ux(x0), uy(y0), ux(x1), uy(y1), ni); }
        for &(l, x, y) in &n.vias {
            if l == 255 {
                let off = stub.get(&(x, y)).copied().unwrap_or(0.0);
                if off.is_nan() { continue; }
                let off = nm(off);
                if off != 0 { wire(&mut shapes, gl[0], gw[0], ux(x), uy(y), ux(x) + off, uy(y), ni); }
                put_via(&mut shapes, &tech.pin_via, ux(x) + off, uy(y), ni)?;
            } else {
                put_via(&mut shapes, &tech.vias[l as usize], ux(x), uy(y), ni)?;
            }
        }
    }
    // fill: pieces of one net on a metal layer that face each other closer than its
    // spacing (neighbouring via pads) get the gap between them filled, so the metal is one
    // smooth piece instead of two with a notch
    let mut fills = vec![];
    for name in &tech.layers {
        let li = li(name)?;
        let sp = lef.layer(name).map(|l| nm(l.spacing)).unwrap_or(0);
        // (in net order: the same layout gives the same file)
        let mut by_net: std::collections::BTreeMap<usize, Vec<Shape>> = Default::default();
        for sh in shapes.iter().filter(|q| q.layer == li && q.net >= 2) { by_net.entry(sh.net).or_default().push(*sh); }
        for (_, v) in by_net {
            for a in 0..v.len() {
                for b in a + 1..v.len() {
                    let (p, q) = (&v[a], &v[b]);
                    let gx = (q.x0 - p.x1).max(p.x0 - q.x1);
                    let gy = (q.y0 - p.y1).max(p.y0 - q.y1);
                    // side by side (their y ranges overlap) or one above the other (x ranges overlap)
                    if gy < 0 && gx > 0 && gx < sp {
                        fills.push(Shape { layer: li, x0: p.x1.min(q.x1), x1: p.x0.max(q.x0), y0: p.y0.min(q.y0), y1: p.y1.max(q.y1), net: p.net });
                    } else if gx < 0 && gy > 0 && gy < sp {
                        fills.push(Shape { layer: li, y0: p.y1.min(q.y1), y1: p.y0.max(q.y0), x0: p.x0.min(q.x0), x1: p.x1.max(q.x1), net: p.net });
                    }
                }
                if v.len() > 3000 { break; }
            }
        }
    }
    shapes.extend(fills);
    // IO pins: a square on the top grid layer at the pin's node, with a label
    let mut labels = vec![];
    for p in &pl.pins {
        let ni = *net_of.entry(p.bit).or_insert_with(|| { nets.push(p.name.clone()); nets.len() - 1 });
        let (x, y) = (nm(p.x + tech.track_x0), nm(p.y + tech.track_y0));
        let (x0, y0, x1, y1) = pin_rect(x, y, nm(pl.w), nm(pl.h));
        shapes.push(Shape { layer: top, x0, y0, x1, y1, net: ni });
        labels.push((top, x, y, p.name.clone()));
    }
    Ok(Layout { layers: LAYERS.iter().map(|s| s.to_string()).collect(), shapes, insts: instances(o), nets, net_of, labels, die: (nm(pl.w), nm(pl.h)) })
}
