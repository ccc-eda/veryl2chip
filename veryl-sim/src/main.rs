fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    veryl_sim::cli::main(&args);
}
