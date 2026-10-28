//! Timing constraints: the common subset of SDC (Synopsys Design Constraints).
//!
//! ```text
//! create_clock -name clk -period 10 [get_ports i_clk]     (no port: a virtual clock for the IO)
//! set_input_delay 2 -clock clk [get_ports {i_a i_b}]      (also [all_inputs], wildcards *)
//! set_output_delay 1.5 -clock clk [all_outputs]
//! set_false_path -from [get_ports i_rst]
//! set_false_path -to [get_ports o_led*]
//! set_multicycle_path 2 -setup -from [get_ports i_slow]
//! ```
//!
//! Times in ns. Objects are ports (a bus name stands for all its bits, `name[3]` for one).
//! Exceptions are exact for paths from input ports (a false path's input launches nothing,
//! a multicycle one launches n - 1 periods early) and to output ports (not checked / n periods);
//! the flattened, mapped netlist has no register names to constrain paths between registers.

#[derive(Debug, Clone, PartialEq)]
pub struct Clock { pub name: String, pub period: f64, pub port: Option<String> }

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Constraints {
    pub clocks: Vec<Clock>,
    /// (delay ns, clock name, objects)
    pub input_delay: Vec<(f64, Option<String>, Vec<String>)>,
    pub output_delay: Vec<(f64, Option<String>, Vec<String>)>,
    /// (from objects, to objects); an empty list: any
    pub false_paths: Vec<(Vec<String>, Vec<String>)>,
    /// (cycles, from objects, to objects)
    pub multicycle: Vec<(u32, Vec<String>, Vec<String>)>,
}

/// SDC words: brackets and braces kept as their own tokens, except a bit index inside a name (`i_b[1]`)
fn tokens(line: &str) -> Vec<String> {
    let mut t = vec![];
    let mut cur = String::new();
    let mut index = false;
    for c in line.chars() {
        match c {
            '[' if !cur.is_empty() => { cur.push(c); index = true; }
            ']' if index => { cur.push(c); index = false; }
            '[' | ']' | '{' | '}' => { if !cur.is_empty() { t.push(std::mem::take(&mut cur)); } t.push(c.to_string()); }
            c if c.is_whitespace() => { if !cur.is_empty() { t.push(std::mem::take(&mut cur)); } }
            c => cur.push(c),
        }
    }
    if !cur.is_empty() { t.push(cur); }
    t
}

/// an object list starting at t[i]: `[get_ports a]`, `[get_ports {a b}]`, `[all_inputs]`, `[all_outputs]`, or a bare name;
/// the objects and the index after them
fn objects(t: &[String], i: usize) -> Result<(Vec<String>, usize), String> {
    match t.get(i).map(|s| s.as_str()) {
        Some("[") => {
            let close = (i..t.len()).find(|&k| t[k] == "]").ok_or("missing ]")?;
            let inner: Vec<&String> = t[i + 1..close].iter().filter(|s| *s != "{" && *s != "}").collect();
            match inner.first().map(|s| s.as_str()) {
                Some("get_ports") | Some("get_pins") | Some("get_clocks") => Ok((inner[1..].iter().filter(|s| !s.starts_with('-')).map(|s| s.to_string()).collect(), close + 1)),
                Some("all_inputs") => Ok((vec!["<inputs>".into()], close + 1)),
                Some("all_outputs") => Ok((vec!["<outputs>".into()], close + 1)),
                Some(c) => Err(format!("[{} ...] is not supported (get_ports, all_inputs, all_outputs)", c)),
                None => Ok((vec![], close + 1)),
            }
        }
        Some("{") => {
            let close = (i..t.len()).find(|&k| t[k] == "}").ok_or("missing }")?;
            Ok((t[i + 1..close].to_vec(), close + 1))
        }
        Some(s) => Ok((vec![s.to_string()], i + 1)),
        None => Ok((vec![], i)),
    }
}

pub fn parse(text: &str) -> Result<Constraints, String> {
    let mut c = Constraints::default();
    // continuation lines (\ at the end) joined; comments dropped
    let joined = text.replace("\\\n", " ");
    for (n, raw) in joined.lines().enumerate() {
        let line = raw.split('#').next().unwrap_or("").trim();
        if line.is_empty() { continue; }
        let err = |e: String| format!("line {}: {}", n + 1, e);
        let t = tokens(line);
        let num = |s: Option<&String>| -> Result<f64, String> { s.and_then(|x| x.parse::<f64>().ok()).ok_or_else(|| err(format!("a number expected in '{}'", line))) };
        match t[0].as_str() {
            "create_clock" => {
                let (mut name, mut period, mut port) = (None, None, None);
                let mut i = 1;
                while i < t.len() {
                    match t[i].as_str() {
                        "-name" => { name = t.get(i + 1).cloned(); i += 2; }
                        "-period" => { period = Some(num(t.get(i + 1))?); i += 2; }
                        "-waveform" => { let (_, j) = objects(&t, i + 1).map_err(err)?; i = j; }
                        "-add" => i += 1,
                        _ => { let (o, j) = objects(&t, i).map_err(err)?; port = o.into_iter().next(); i = j; }
                    }
                }
                let period = period.ok_or_else(|| err("create_clock needs -period".into()))?;
                if period <= 0.0 { return Err(err("the clock period must be positive".into())); }
                let name = name.or_else(|| port.clone()).unwrap_or_else(|| format!("clk{}", c.clocks.len()));
                c.clocks.push(Clock { name, period, port });
            }
            "set_input_delay" | "set_output_delay" => {
                let mut delay = None;
                let mut clock = None;
                let mut objs = vec![];
                let mut i = 1;
                while i < t.len() {
                    match t[i].as_str() {
                        "-clock" => { let (o, j) = objects(&t, i + 1).map_err(err)?; clock = o.into_iter().next(); i = j; }
                        "-max" | "-min" | "-add_delay" | "-clock_fall" | "-rise" | "-fall" => i += 1,
                        s if delay.is_none() && s.parse::<f64>().is_ok() => { delay = s.parse().ok(); i += 1; }
                        _ => { let (o, j) = objects(&t, i).map_err(err)?; objs.extend(o); i = j; }
                    }
                }
                let d = (delay.ok_or_else(|| err(format!("{} needs a delay", t[0])))?, clock, objs);
                if t[0] == "set_input_delay" { c.input_delay.push(d) } else { c.output_delay.push(d) }
            }
            "set_false_path" | "set_multicycle_path" => {
                let (mut from, mut to, mut cycles) = (vec![], vec![], 1u32);
                let mut i = 1;
                while i < t.len() {
                    match t[i].as_str() {
                        "-from" => { let (o, j) = objects(&t, i + 1).map_err(err)?; from.extend(o); i = j; }
                        "-to" => { let (o, j) = objects(&t, i + 1).map_err(err)?; to.extend(o); i = j; }
                        "-through" => return Err(err("-through is not supported".into())),
                        "-setup" | "-hold" | "-start" | "-end" => i += 1,
                        s => { cycles = s.parse().map_err(|_| err(format!("unexpected '{}'", s)))?; i += 1; }
                    }
                }
                if from.is_empty() && to.is_empty() { return Err(err(format!("{} needs -from or -to", t[0]))); }
                if t[0] == "set_false_path" { c.false_paths.push((from, to)) } else { c.multicycle.push((cycles.max(1), from, to)) }
            }
            // accepted, not used: the units are ns; uncertainty, transitions, loads
            "set_units" | "set_clock_uncertainty" | "set_input_transition" | "set_load" | "set_driving_cell" | "current_design" | "set_clock_transition" | "set_propagated_clock" => {}
            w => return Err(err(format!("{} is not supported", w))),
        }
    }
    Ok(c)
}

/// does object pattern `pat` (a port name, bus name or wildcard, or <inputs> / <outputs>) name the bit `bit` of
/// port `port` (`input`: its direction)?
pub fn matches(pat: &str, port: &str, bit: Option<usize>, input: bool) -> bool {
    if pat == "<inputs>" { return input; }
    if pat == "<outputs>" { return !input; }
    let full = match bit { Some(k) => format!("{}[{}]", port, k), None => port.to_string() };
    glob(pat, &full) || glob(pat, port)
}

fn glob(p: &str, s: &str) -> bool {
    match p.find('*') {
        None => p == s,
        Some(k) => {
            let (pre, rest) = (&p[..k], &p[k + 1..]);
            if !s.starts_with(pre) { return false; }
            let s = &s[pre.len()..];
            (0..=s.len()).any(|j| s.is_char_boundary(j) && glob(rest, &s[j..]))
        }
    }
}

thread_local! {
    static CUR: std::cell::RefCell<Option<std::rc::Rc<Constraints>>> = const { std::cell::RefCell::new(None) };
}

/// the constraints of the running flow (None: none given, Fmax only)
pub fn current() -> Option<std::rc::Rc<Constraints>> { CUR.with(|c| c.borrow().clone()) }
pub fn set(c: Option<Constraints>) { CUR.with(|x| *x.borrow_mut() = c.map(std::rc::Rc::new)); }

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parse_subset() {
        let c = parse("# a comment\ncreate_clock -name clk -period 10 [get_ports i_clk]\ncreate_clock -name io -period 20\n\
            set_input_delay 2 -clock clk [get_ports {i_a i_b[1]}]\nset_output_delay 1.5 -clock io [all_outputs]\n\
            set_false_path -from [get_ports i_rst]\nset_multicycle_path 2 -setup -to [get_ports o_*]\n").unwrap();
        assert_eq!(c.clocks, vec![Clock { name: "clk".into(), period: 10.0, port: Some("i_clk".into()) }, Clock { name: "io".into(), period: 20.0, port: None }]);
        assert_eq!(c.input_delay, vec![(2.0, Some("clk".into()), vec!["i_a".into(), "i_b[1]".into()])]);
        assert_eq!(c.output_delay, vec![(1.5, Some("io".into()), vec!["<outputs>".into()])]);
        assert_eq!(c.false_paths, vec![(vec!["i_rst".into()], vec![])]);
        assert_eq!(c.multicycle, vec![(2, vec![], vec!["o_*".into()])]);
        assert!(matches("i_a", "i_a", Some(3), true) && matches("i_b[1]", "i_b", Some(1), true) && !matches("i_b[1]", "i_b", Some(0), true));
        assert!(matches("o_*", "o_led", Some(0), false) && matches("<outputs>", "x", None, false) && !matches("<outputs>", "x", None, true));
        assert!(parse("create_clock -name c [get_ports x]").is_err());
        assert!(parse("set_max_delay 3 -to x").unwrap_err().contains("not supported"));
    }
}
