//! DEF reader (the parts veryl-eda writes): die area, rows, components,
//! pins, nets with their routed wires and vias. Used to check what the flow
//! wrote against the LEF: cells on rows and sites, inside the die, without
//! overlaps, every row covered, every net's pins listed.

#[derive(Debug, Clone, Default)]
pub struct Component { pub name: String, pub cell: String, pub x: i64, pub y: i64, pub orient: String }

#[derive(Debug, Clone, Default)]
pub struct Row { pub site: String, pub x: i64, pub y: i64, pub orient: String, pub count: i64, pub step: i64 }

/// a routed piece: wire (layer, width, points) or via (layer, point, via name)
#[derive(Debug, Clone)]
pub enum Route { Wire { layer: String, width: i64, pts: Vec<(i64, i64)> }, Via { layer: String, at: (i64, i64), via: String } }

#[derive(Debug, Clone, Default)]
pub struct Net { pub name: String, pub conns: Vec<(String, String)>, pub routes: Vec<Route> }

#[derive(Debug, Clone, Default)]
pub struct Pin { pub name: String, pub net: String, pub layer: String, pub at: (i64, i64) }

#[derive(Debug, Clone, Default)]
pub struct Def {
    pub design: String,
    pub dbu: i64,
    pub die: (i64, i64, i64, i64),
    pub rows: Vec<Row>,
    pub comps: Vec<Component>,
    pub pins: Vec<Pin>,
    pub nets: Vec<Net>,
    pub special: Vec<Net>,
}

fn tokens(src: &str) -> Vec<String> {
    let mut t = vec![];
    for line in src.lines() {
        let line = line.split('#').next().unwrap_or("");
        for w in line.split_whitespace() { t.push(w.to_string()); }
    }
    t
}

/// "( x y )" with "*" meaning the previous point's coordinate
fn point(t: &[String], i: &mut usize, prev: Option<(i64, i64)>) -> Option<(i64, i64)> {
    if t.get(*i).map(|s| s.as_str()) != Some("(") { return None; }
    let g = |s: &str, p: Option<i64>| if s == "*" { p.unwrap_or(0) } else { s.parse().unwrap_or(0) };
    let x = g(&t[*i + 1], prev.map(|p| p.0));
    let y = g(&t[*i + 2], prev.map(|p| p.1));
    // ( x y ) or ( x y ext )
    let mut j = *i + 3;
    while j < t.len() && t[j] != ")" { j += 1; }
    *i = j + 1;
    Some((x, y))
}

/// the ROUTED / NEW pieces of one net, up to its ';'
fn routes(t: &[String], i: &mut usize, special: bool) -> Vec<Route> {
    let mut out = vec![];
    while *i < t.len() && t[*i] != ";" {
        let w = t[*i].as_str();
        if w == "ROUTED" || w == "NEW" || w == "FIXED" || w == "COVER" {
            *i += 1;
            let layer = t[*i].clone();
            *i += 1;
            let width = if special { let v = t[*i].parse().unwrap_or(0); *i += 1; v } else { 0 };
            let mut pts = vec![];
            let mut prev = None;
            while let Some(p) = point(t, i, prev) { pts.push(p); prev = Some(p); }
            // a via name after the point
            if *i < t.len() && !matches!(t[*i].as_str(), ";" | "NEW" | "+") && pts.len() == 1 {
                out.push(Route::Via { layer, at: pts[0], via: t[*i].clone() });
                *i += 1;
            } else if !pts.is_empty() {
                out.push(Route::Wire { layer, width, pts });
            }
        } else { *i += 1; }
    }
    out
}

pub fn parse(src: &str) -> Result<Def, String> {
    let t = tokens(src);
    let mut d = Def { dbu: 1000, ..Default::default() };
    let mut i = 0;
    while i < t.len() {
        match t[i].as_str() {
            "DESIGN" => { d.design = t[i + 1].clone(); i += 2; }
            "UNITS" => { d.dbu = t[i + 3].parse().unwrap_or(1000); i += 4; }
            "DIEAREA" => {
                i += 1;
                let a = point(&t, &mut i, None).ok_or("DIEAREA")?;
                let b = point(&t, &mut i, None).ok_or("DIEAREA")?;
                d.die = (a.0, a.1, b.0, b.1);
            }
            "ROW" => {
                // ROW name site x y orient DO n BY 1 STEP sx sy ;
                d.rows.push(Row { site: t[i + 2].clone(), x: t[i + 3].parse().unwrap_or(0), y: t[i + 4].parse().unwrap_or(0), orient: t[i + 5].clone(), count: t[i + 7].parse().unwrap_or(0), step: t[i + 11].parse().unwrap_or(0) });
                while t[i] != ";" { i += 1; }
            }
            "COMPONENTS" => {
                while t[i] != ";" { i += 1; }
                i += 1;
                while t[i] != "END" {
                    // - name cell + PLACED ( x y ) orient ;
                    let mut c = Component { name: t[i + 1].clone(), cell: t[i + 2].clone(), ..Default::default() };
                    i += 3;
                    while t[i] != ";" {
                        if t[i] == "PLACED" || t[i] == "FIXED" {
                            i += 1;
                            let p = point(&t, &mut i, None).ok_or("component position")?;
                            c.x = p.0; c.y = p.1;
                            c.orient = t[i].clone();
                        }
                        i += 1;
                    }
                    i += 1;
                    d.comps.push(c);
                }
            }
            "PINS" => {
                while t[i] != ";" { i += 1; }
                i += 1;
                while t[i] != "END" {
                    let mut p = Pin { name: t[i + 1].clone(), ..Default::default() };
                    i += 2;
                    while t[i] != ";" {
                        match t[i].as_str() {
                            "NET" => { p.net = t[i + 1].clone(); i += 1; }
                            "LAYER" => { p.layer = t[i + 1].clone(); i += 1; }
                            "PLACED" | "FIXED" => { i += 1; p.at = point(&t, &mut i, None).ok_or("pin position")?; continue; }
                            _ => {}
                        }
                        i += 1;
                    }
                    i += 1;
                    d.pins.push(p);
                }
            }
            "NETS" | "SPECIALNETS" => {
                let special = t[i] == "SPECIALNETS";
                while t[i] != ";" { i += 1; }
                i += 1;
                while t[i] != "END" {
                    let mut n = Net { name: t[i + 1].clone(), ..Default::default() };
                    i += 2;
                    // connections ( comp pin ) until + or ;
                    while t[i] == "(" { n.conns.push((t[i + 1].clone(), t[i + 2].clone())); i += 4; }
                    n.routes = routes(&t, &mut i, special);
                    i += 1;
                    if special { d.special.push(n) } else { d.nets.push(n) }
                }
            }
            // END COMPONENTS / END NETS ...: not a new section
            "END" => i += 2,
            _ => i += 1,
        }
    }
    Ok(d)
}

/// placement problems of a DEF against the LEF: unknown cells, cells off the
/// rows / site grid / die, overlaps, and sites no component covers
pub fn check_placement(d: &Def, lef: &super::lef::Lef) -> Vec<String> {
    let mut bad = vec![];
    let Some(r0) = d.rows.first() else { return vec!["no rows".into()] };
    let site = lef.site(&r0.site).map(|s| ((s.w * d.dbu as f64).round() as i64, (s.h * d.dbu as f64).round() as i64));
    let Some((sw, sh)) = site else { return vec![format!("site {} not in the LEF", r0.site)] };
    let nrows = d.rows.len();
    let nsites = r0.count as usize;
    let mut occ = vec![vec![0u8; nsites]; nrows];
    for c in &d.comps {
        let Some(m) = lef.macro_(&c.cell) else { bad.push(format!("{}: cell {} not in the LEF", c.name, c.cell)); continue };
        let (w, h) = ((m.w * d.dbu as f64).round() as i64, (m.h * d.dbu as f64).round() as i64);
        if (c.x - r0.x) % sw != 0 || (c.y - r0.y) % sh != 0 { bad.push(format!("{} off the site grid at ({}, {})", c.name, c.x, c.y)); continue; }
        if c.x < d.die.0 || c.y < d.die.1 || c.x + w > d.die.2 || c.y + h > d.die.3 { bad.push(format!("{} outside the die", c.name)); continue; }
        let (row, s0) = (((c.y - r0.y) / sh) as usize, ((c.x - r0.x) / sw) as usize);
        let rows_h = (h / sh).max(1) as usize;
        if rows_h == 1 && d.rows.get(row).map(|r| r.orient != c.orient) == Some(true) { bad.push(format!("{} orientation {} on a {} row", c.name, c.orient, d.rows[row].orient)); }
        for r in row..row + rows_h {
            for s in s0..s0 + (w / sw) as usize {
                if r >= nrows || s >= nsites { continue; }
                if occ[r][s] > 0 { bad.push(format!("{} overlaps at row {} site {}", c.name, r, s)); }
                occ[r][s] += 1;
            }
        }
    }
    let empty: usize = occ.iter().map(|r| r.iter().filter(|o| **o == 0).count()).sum();
    if empty > 0 { bad.push(format!("{} sites without a cell or filler", empty)); }
    bad
}
