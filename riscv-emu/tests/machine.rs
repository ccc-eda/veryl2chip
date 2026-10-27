//! riscv-emu on its own (a hand-assembled program, compressed instructions), and with
//! the programs of examples/rv64 when they are there: the official riscv-tests
//! (RISCV_TESTS, default /Users/Shared/ccc/riscv-tests) and Linux (examples/rv64/linux/build).

use riscv_emu::{cpu::expand, Machine, Stop, RAM_BASE, RAM_SIZE};

fn words(w: &[u32]) -> Vec<u8> { w.iter().flat_map(|x| x.to_le_bytes()).collect() }

#[test]
fn hello_and_finish() {
    let mut m = Machine::new(1 << 20);
    m.load(RAM_BASE, &words(&[
        0x100002b7, // lui t0, 0x10000      (the UART)
        0x04800313, // li t1, 'H'
        0x00628023, // sb t1, 0(t0)
        0x06900313, // li t1, 'i'
        0x00628023, // sb t1, 0(t0)
        0x001002b7, // lui t0, 0x100        (the finisher)
        0x00005337, // lui t1, 5
        0x55530313, // addi t1, t1, 0x555
        0x0062a023, // sw t1, 0(t0)
        0x0000006f, // j .
    ])).unwrap();
    assert_eq!(m.run(100), Stop::Finished);
    assert_eq!(m.take_output(), b"Hi");
    assert_eq!(m.bus.finished, Some(0x5555));
    assert_eq!(m.instret, 9);
}

#[test]
fn compressed() {
    // c.addi a0, 1; c.li a0, -1; c.mv a0, a1; c.add a0, a1; c.lw a0, 0(a1); c.sdsp ra, 8(sp); c.jr ra; c.ebreak
    for (c, w) in [(0x0505, 0x00150513), (0x557d, 0xfff00513), (0x852e, 0x00b00533), (0x952e, 0x00b50533), (0x4188, 0x0005a503),
                   (0xe406, 0x00113423), (0x8082, 0x00008067), (0x9002, 0x00100073)] {
        assert_eq!(expand(c), Some(w), "0x{:04x}", c);
    }
    assert_eq!(expand(0x0000), None);
}

fn riscv_tests_dir() -> Option<std::path::PathBuf> {
    let d = std::path::PathBuf::from(std::env::var("RISCV_TESTS").unwrap_or("/Users/Shared/ccc/riscv-tests".into())).join("isa");
    d.is_dir().then_some(d)
}

#[test]
fn riscv_tests() {
    let Some(dir) = riscv_tests_dir() else { eprintln!("no riscv-tests: skipped"); return };
    let (mut pass, mut fail) = (0, vec![]);
    let mut names: Vec<_> = std::fs::read_dir(&dir).unwrap().map(|e| e.unwrap().path()).collect();
    names.sort();
    for p in names {
        let n = p.file_name().unwrap().to_string_lossy().to_string();
        if !(n.starts_with("rv64") && (n.contains("-p-") || n.contains("-v-"))) || n.ends_with(".dump") || n.ends_with("-ma_data") { continue; }
        let mut m = Machine::new(RAM_SIZE);
        m.load_program(&std::fs::read(&p).unwrap()).unwrap();
        m.run(5_000_000);
        if m.bus.tohost_val == 1 { pass += 1; } else { fail.push(format!("{}: tohost 0x{:x}", n, m.bus.tohost_val)); }
    }
    assert!(fail.is_empty(), "{:?}", fail);
    assert!(pass > 150, "{} passed", pass);
    eprintln!("riscv-tests: {} passed", pass);
}

/// boot Linux (OpenSBI + Linux + busybox) to the shell and type a command
#[test]
fn linux_shell() {
    let f = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../examples/rv64/linux/build/opensbi/platform/generic/firmware/fw_payload.bin");
    let Ok(img) = std::fs::read(&f) else { eprintln!("no Linux build: skipped"); return };
    let mut m = Machine::new(RAM_SIZE);
    m.load(RAM_BASE, &img).unwrap();
    let mut out = String::new();
    let t = std::time::Instant::now();
    while !out.ends_with("rv64:~$ ") && m.instret < 400_000_000 {
        m.run(1_000_000);
        out += &String::from_utf8_lossy(&m.take_output());
    }
    assert!(out.ends_with("rv64:~$ "), "no prompt: {}", &out[out.len().saturating_sub(500)..]);
    let booted = m.instret;
    m.input(b"echo $((6 * 7)); uname -m\r");
    while !out.contains("riscv64\r\n") && m.instret < booted + 50_000_000 {
        m.run(100_000);
        out += &String::from_utf8_lossy(&m.take_output());
    }
    assert!(out.contains("\n42\r\n") && out.contains("riscv64"), "{}", &out[out.len().saturating_sub(300)..]);
    eprintln!("Linux: shell after {} M instructions, {:.1} s", booted / 1_000_000, t.elapsed().as_secs_f64());
}
