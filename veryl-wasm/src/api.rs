//! The requests the web front end can make.

use serde_json::{json, Value};

type R<T> = Result<T, String>;

fn files(v: &Value) -> R<Vec<(String, String)>> {
    let a = v.get("files").and_then(|f| f.as_array()).ok_or("missing files")?;
    a.iter().map(|f| {
        let name = f.get("name").and_then(|x| x.as_str()).ok_or("file without name")?;
        let src = f.get("src").and_then(|x| x.as_str()).ok_or("file without src")?;
        Ok((name.to_string(), src.to_string()))
    }).collect()
}

pub fn dispatch(v: &Value) -> R<Value> {
    let cmd = v.get("cmd").and_then(|c| c.as_str()).ok_or("missing cmd")?;
    match cmd {
        "version" => Ok(json!({ "ok": true, "version": env!("CARGO_PKG_VERSION") })),
        "list" => {
            let m = veryl_sim::list(&files(v)?)?;
            Ok(json!({ "ok": true, "modules": m.iter().map(|(n, t)| json!({ "name": n, "test": t })).collect::<Vec<_>>() }))
        }
        "simulate" => {
            let top = v.get("top").and_then(|t| t.as_str());
            let max_time = v.get("max_time").and_then(|t| t.as_u64()).unwrap_or(1_000_000);
            let vcd = v.get("vcd").and_then(|t| t.as_bool()).unwrap_or(false);
            let r = veryl_sim::run(&files(v)?, top, max_time, vcd, false)?;
            Ok(json!({
                "ok": true,
                "log": r.log,
                "tops": r.tops.iter().map(|t| json!({ "name": t.name, "fails": t.fails, "finished": t.finished })).collect::<Vec<_>>(),
                "vcd": r.vcd.iter().map(|(t, s)| json!({ "top": t, "text": s })).collect::<Vec<_>>(),
            }))
        }
        c => Err(format!("unknown command '{}'", c)),
    }
}
