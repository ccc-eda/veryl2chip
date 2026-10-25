//! WebAssembly interface: plain C ABI, JSON in / JSON out, no imports.
//!
//!   ptr = alloc(n); write request bytes; out = call(ptr, n);
//!   read result_len() bytes at `out` (JSON); dealloc(ptr, n)
//!
//! A panic traps the instance; `panic_message` (written by the panic hook
//! before the trap) tells the caller why.

use serde_json::{json, Value};
use std::cell::RefCell;

mod api;

thread_local! {
    static RESULT: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
    static PANIC: RefCell<String> = const { RefCell::new(String::new()) };
}

#[no_mangle]
pub extern "C" fn alloc(n: usize) -> *mut u8 {
    let mut v = Vec::<u8>::with_capacity(n.max(1));
    let p = v.as_mut_ptr();
    std::mem::forget(v);
    p
}

/// # Safety
/// `p` must come from `alloc(n)` with the same `n`.
#[no_mangle]
pub unsafe extern "C" fn dealloc(p: *mut u8, n: usize) {
    drop(Vec::from_raw_parts(p, 0, n.max(1)));
}

#[no_mangle]
pub extern "C" fn result_len() -> usize { RESULT.with(|r| r.borrow().len()) }

#[no_mangle]
pub extern "C" fn panic_message() -> *const u8 {
    let s = PANIC.with(|p| p.borrow().clone());
    RESULT.with(|r| { *r.borrow_mut() = s.into_bytes(); r.borrow().as_ptr() })
}

/// # Safety
/// `p` must point to `n` readable bytes.
#[no_mangle]
pub unsafe extern "C" fn call(p: *const u8, n: usize) -> *const u8 {
    std::panic::set_hook(Box::new(|info| {
        let msg = match info.payload().downcast_ref::<&str>() {
            Some(s) => s.to_string(),
            None => info.payload().downcast_ref::<String>().cloned().unwrap_or_else(|| "panic".into()),
        };
        let loc = info.location().map(|l| format!(" ({}:{})", l.file(), l.line())).unwrap_or_default();
        PANIC.with(|p| *p.borrow_mut() = format!("internal error: {}{}", msg, loc));
    }));
    let req = std::slice::from_raw_parts(p, n);
    let out: Value = match serde_json::from_slice::<Value>(req) {
        Ok(v) => match api::dispatch(&v) { Ok(r) => r, Err(e) => json!({ "ok": false, "error": e }) },
        Err(e) => json!({ "ok": false, "error": format!("bad request: {}", e) }),
    };
    let bytes = serde_json::to_vec(&out).unwrap_or_default();
    RESULT.with(|r| { *r.borrow_mut() = bytes; r.borrow().as_ptr() })
}
