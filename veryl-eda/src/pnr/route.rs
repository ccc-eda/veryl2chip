//! Routing on the chipdb wire graph: negotiated congestion (PathFinder) with
//! A* searches. Every chip net (wire) can carry one signal; a pip into a wire
//! sets that wire's input mux. Global signals are routed from their source to
//! a `fabout` that feeds a global network, which then reaches the tiles'
//! clock / set-reset muxes directly.

use super::chipdb::Chip;
use std::cmp::Ordering;
use std::collections::{BinaryHeap, HashMap, HashSet};

type R<T> = Result<T, String>;

pub struct RNet {
    pub name: String,
    pub src: u32,
    pub sinks: Vec<u32>,
    /// global network to use: (fabout wire, global wire, sinks reached straight from the global)
    pub global: Option<(u32, u32, Vec<u32>)>,
}

#[derive(PartialEq)]
struct Item(f32, u32);
impl Eq for Item {}
impl Ord for Item {
    fn cmp(&self, o: &Self) -> Ordering { o.0.partial_cmp(&self.0).unwrap_or(Ordering::Equal) }
}
impl PartialOrd for Item {
    fn partial_cmp(&self, o: &Self) -> Option<Ordering> { Some(self.cmp(o)) }
}

/// pips used by each net (indices into chip.pips; u32::MAX - g = hardwired fabout -> global g)
pub fn route(chip: &Chip, nets: &[RNet], extra_pips: &[(u32, u32)], verbose: bool) -> R<Vec<Vec<u32>>> {
    let n = chip.net_box.len();
    // hardwired fabout -> global edges, as pseudo pips
    let mut extra_fanout: HashMap<u32, Vec<(u32, u32)>> = HashMap::new();
    for (i, &(s, d)) in extra_pips.iter().enumerate() { extra_fanout.entry(s).or_default().push((u32::MAX - i as u32, d)); }
    let pip_dst = |p: u32| -> u32 { if p >= u32::MAX - extra_pips.len() as u32 { extra_pips[(u32::MAX - p) as usize].1 } else { chip.pips[p as usize].dst } };
    let pip_src = |p: u32| -> u32 { if p >= u32::MAX - extra_pips.len() as u32 { extra_pips[(u32::MAX - p) as usize].0 } else { chip.pips[p as usize].src } };

    // wires that are some net's source or sink may only be used by that net
    let mut owner: Vec<i32> = vec![-1; n];
    for (i, net) in nets.iter().enumerate() {
        for &w in std::iter::once(&net.src).chain(net.sinks.iter()) { owner[w as usize] = i as i32; }
        if let Some((f, g, gs)) = &net.global { for &w in [f, g].into_iter().chain(gs.iter()) { owner[w as usize] = i as i32; } }
    }
    let mut occ: Vec<u16> = vec![0; n];
    let mut hist: Vec<f32> = vec![0.0; n];
    let mut routes: Vec<Vec<u32>> = vec![vec![]; nets.len()];
    let mut nodes_of: Vec<Vec<u32>> = vec![vec![]; nets.len()];
    let mut dist: Vec<f32> = vec![f32::INFINITY; n];
    let mut prev: Vec<u32> = vec![u32::MAX; n];
    let mut seen: Vec<u32> = vec![0; n];
    let mut gen = 0u32;
    let mut pres = 0.5f32;
    let center = |w: u32| { let b = chip.net_box[w as usize]; ((b.0 + b.2) as f32 / 2.0, (b.1 + b.3) as f32 / 2.0) };
    let tdist = |w: u32, tx: f32, ty: f32| -> f32 {
        let b = chip.net_box[w as usize];
        let dx = if tx < b.0 as f32 { b.0 as f32 - tx } else if tx > b.2 as f32 { tx - b.2 as f32 } else { 0.0 };
        let dy = if ty < b.1 as f32 { b.1 as f32 - ty } else if ty > b.3 as f32 { ty - b.3 as f32 } else { 0.0 };
        dx + dy
    };
    let mut order: Vec<usize> = (0..nets.len()).collect();
    order.sort_by_key(|i| std::cmp::Reverse(nets[*i].sinks.len()));

    for iter in 0..200 {
        for &ni in &order {
            let net = &nets[ni];
            // reroute only nets touching an overused wire (all nets in the first pass)
            if iter > 0 && !nodes_of[ni].iter().any(|w| occ[*w as usize] > 1) { continue; }
            for &w in &nodes_of[ni] { occ[w as usize] -= 1; }
            nodes_of[ni].clear();
            routes[ni].clear();
            // route tree: membership set + insertion order (keeps runs deterministic)
            let mut tree: HashSet<u32> = HashSet::new();
            let mut tree_order: Vec<u32> = vec![net.src];
            tree.insert(net.src);
            let mut todo: Vec<u32> = net.sinks.clone();
            if let Some((fab, glb, gsinks)) = &net.global {
                todo.retain(|s| !gsinks.contains(s));
                todo.insert(0, *fab);
                // the global reaches its sinks through their input mux
                let _ = glb;
            }
            // nearest sinks first
            let (sx, sy) = center(net.src);
            todo[usize::from(net.global.is_some())..].sort_by(|a, b| {
                let (ax, ay) = center(*a); let (bx, by) = center(*b);
                ((ax - sx).abs() + (ay - sy).abs()).partial_cmp(&((bx - sx).abs() + (by - sy).abs())).unwrap()
            });
            for (k, &sink) in todo.iter().enumerate() {
                if tree.contains(&sink) { continue; }
                gen += 1;
                let (tx, ty) = center(sink);
                let mut heap = BinaryHeap::new();
                for &t in &tree_order {
                    dist[t as usize] = 0.0;
                    prev[t as usize] = u32::MAX;
                    seen[t as usize] = gen;
                    heap.push(Item(tdist(t, tx, ty) * 0.3, t));
                }
                let mut found = false;
                while let Some(Item(_, u)) = heap.pop() {
                    if u == sink { found = true; break; }
                    let du = dist[u as usize];
                    let fan = chip.fanout[u as usize].iter().map(|p| (*p, chip.pips[*p as usize].dst))
                        .chain(extra_fanout.get(&u).into_iter().flatten().copied());
                    for (p, v) in fan {
                        let o = owner[v as usize];
                        if o >= 0 && o != ni as i32 { continue; }
                        let over = occ[v as usize] as f32;
                        let c = (1.0 + hist[v as usize]) * (1.0 + pres * over);
                        let nd = du + c;
                        if seen[v as usize] != gen || nd < dist[v as usize] {
                            seen[v as usize] = gen;
                            dist[v as usize] = nd;
                            prev[v as usize] = p;
                            heap.push(Item(nd + tdist(v, tx, ty) * 0.3, v));
                        }
                    }
                }
                if !found { return Err(format!("net {}: cannot reach {}", net.name, chip.label(sink))); }
                // walk back to the tree
                let mut v = sink;
                while !tree.contains(&v) {
                    let p = prev[v as usize];
                    routes[ni].push(p);
                    tree.insert(v);
                    tree_order.push(v);
                    v = pip_src(p);
                }
                if k == 0 {
                    if let Some((fab, glb, gsinks)) = &net.global {
                        // fabout -> global, then straight into each global sink's mux
                        let gp = extra_fanout.get(fab).and_then(|v| v.iter().find(|(_, d)| d == glb)).ok_or("fabout does not drive that global")?.0;
                        routes[ni].push(gp);
                        tree.insert(*glb);
                        tree_order.push(*glb);
                        for &gs in gsinks {
                            let p = chip.fanout[*glb as usize].iter().copied().find(|p| chip.pips[*p as usize].dst == gs)
                                .ok_or_else(|| format!("{} cannot be driven by a global", chip.label(gs)))?;
                            routes[ni].push(p);
                            tree.insert(gs);
                            tree_order.push(gs);
                        }
                    }
                }
            }
            for &p in &routes[ni] {
                let d = pip_dst(p);
                occ[d as usize] += 1;
                nodes_of[ni].push(d);
            }
        }
        let over: Vec<usize> = (0..n).filter(|w| occ[*w] > 1).collect();
        if verbose { eprintln!("  route iteration {}: {} overused wires", iter + 1, over.len()); }
        if over.is_empty() {
            let _ = extra_pips;
            return Ok(routes);
        }
        for w in over { hist[w] += 0.5 * (occ[w] - 1) as f32; }
        pres *= 1.8;
    }
    Err("routing did not converge".into())
}
