//! Index sequence of a generate-for loop, shared by the simulator and
//! veryl-eda: `for i in a..b`, `a..=b`, `rev`, `step += k` (also -=, *=,
//! <<=, >>=; the loop runs while the index stays inside the range).

pub fn for_indices(from: u128, to: u128, inclusive: bool, rev: bool, step: Option<(&str, u128)>) -> Result<Vec<u128>, String> {
    let end = if inclusive { to.checked_add(1).ok_or("generate range too large")? } else { to };
    let mut v = vec![];
    let mut i = from;
    while i >= from && i < end {
        v.push(i);
        if v.len() > 1 << 20 { return Err("generate loop runs away".into()); }
        let next = match step {
            None | Some(("+=", _)) => i.checked_add(step.map(|s| s.1).unwrap_or(1)),
            Some(("-=", k)) => i.checked_sub(k),
            Some(("*=", k)) => i.checked_mul(k),
            Some(("<<=", k)) => i.checked_shl(k as u32),
            Some((">>=", k)) => i.checked_shr(k as u32),
            Some((op, _)) => return Err(format!("generate step `{}` is not supported", op)),
        };
        match next { Some(n) if n != i => i = n, _ => break }
    }
    if rev { v.reverse(); }
    Ok(v)
}
