#!/usr/bin/env bash
# Test the whole project; every step runs even after a failure, with a summary at the end.
#
#   ./test.sh          what CI runs: veryl-sim, cargo test of veryl-eda, the tutorial's flow, npm test
#   ./test.sh --full   + veryl-eda/test.sh: yosys formal equivalence with `veryl build`, the FPGA flows
#                        and the own place & route's co-simulation (needs OSS CAD Suite; tens of minutes)
#
# npm test runs on web/dist as built: run ./build.sh first after changing Rust or TypeScript.
# Place & route needs IceStorm's chipdb-5k.txt; without one, it is taken from web/dist/chipdb.js.
set -uo pipefail
cd "$(dirname "$0")"
ROOT=$(pwd)

FULL=false
case "${1:-}" in
    --full) FULL=true ;;
    "") ;;
    *) echo "usage: $0 [--full]"; exit 2 ;;
esac

LOG=$(mktemp -d)
results=()
fail=0
# run NAME COMMAND...: output to the terminal and $LOG/NAME.log
run() {
    local name=$1; shift
    echo
    echo "== $name"
    local t0=$SECONDS
    # set -e inside the step: its first failing command fails it (not inside an `if`, which would disable that)
    ( set -e; "$@" ) 2>&1 | tee "$LOG/$name.log"
    if [ "${PIPESTATUS[0]}" = 0 ]; then
        results+=("PASS  $name ($((SECONDS - t0)) s)")
    else
        results+=("FAIL  $name ($((SECONDS - t0)) s, log: $LOG/$name.log)")
        fail=1
    fi
}

# the chip database for place and route
if [ -z "${VERYL_EDA_CHIPDB:-}" ]; then
    for c in /usr/local/share/icebox/chipdb-5k.txt /usr/share/icebox/chipdb-5k.txt /opt/homebrew/share/icebox/chipdb-5k.txt \
             /Users/Shared/ccc/oss-cad-suite/share/icebox/chipdb-5k.txt "$HOME/oss-cad-suite/share/icebox/chipdb-5k.txt"; do
        [ -f "$c" ] && export VERYL_EDA_CHIPDB=$c && break
    done
fi
if [ -z "${VERYL_EDA_CHIPDB:-}" ] && [ -f web/dist/chipdb.js ]; then
    node web/test/chipdb.mjs "$LOG/chipdb-5k.txt" && export VERYL_EDA_CHIPDB=$LOG/chipdb-5k.txt
fi

t0=$SECONDS

veryl_sim() {
    cd "$ROOT/veryl-sim"
    cargo build --release
    cargo run --release -q -- examples/counter.veryl
}
run veryl-sim veryl_sim

eda_tests() {
    cd "$ROOT/veryl-eda"
    cargo test --release
    cargo build --release
}
run veryl-eda eda_tests

run tutorial "$ROOT/tutorial/check.sh"

web_tests() {
    cd "$ROOT/web"
    [ -d node_modules ] || npm ci
    npm test
}
if command -v node > /dev/null; then
    run web web_tests
else
    results+=("SKIP  web (Node.js not installed)")
fi

if $FULL; then
    run veryl-eda-full "$ROOT/veryl-eda/test.sh"
fi

echo
echo "== summary ($((SECONDS - t0)) s)"
printf '   %s\n' "${results[@]}"
[ $fail = 0 ] && echo "== all passed" || echo "== FAILED"
exit $fail
