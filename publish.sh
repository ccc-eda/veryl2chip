#!/usr/bin/env bash
# Publish the two Rust crates to crates.io:
#   veryl2chip-sim  (veryl-sim/, command `veryl-sim`)
#   veryl2chip-eda  (veryl-eda/, command `veryl-eda`; depends on veryl2chip-sim)
#
#   ./publish.sh          dry run: checks, tests and `cargo publish --dry-run`; uploads nothing
#   ./publish.sh --yes    publish for real (needs `cargo login` once, a clean git tree on main)
#
# Versions come from the Cargo.toml files; bump them (and the version of the
# veryl2chip-sim dependency in veryl-eda/Cargo.toml) before publishing again.
# A crate whose version is already on crates.io is skipped, so the script can
# be rerun after a partial failure. veryl-wasm is only for the web build and is
# not published. crates.io versions are permanent: they can be yanked, never
# deleted or overwritten.
set -euo pipefail
cd "$(dirname "$0")"

REAL=false
case "${1:-}" in
    --yes) REAL=true ;;
    "") ;;
    *) echo "usage: $0 [--yes]"; exit 2 ;;
esac

die() { echo "error: $*" >&2; exit 1; }
field() { sed -n "s/^$2 = \"\(.*\)\"/\1/p" "$1/Cargo.toml" | head -1; }

SIM_NAME=$(field veryl-sim name); SIM_VER=$(field veryl-sim version)
EDA_NAME=$(field veryl-eda name); EDA_VER=$(field veryl-eda version)
DEP_VER=$(sed -n 's/^veryl-sim = .*version = "\([^"]*\)".*/\1/p' veryl-eda/Cargo.toml)
echo "== $SIM_NAME $SIM_VER, $EDA_NAME $EDA_VER $( $REAL && echo '(PUBLISH)' || echo '(dry run)')"

# ---- checks
[ "$DEP_VER" = "$SIM_VER" ] || die "veryl-eda depends on $SIM_NAME $DEP_VER but veryl-sim/Cargo.toml is $SIM_VER"
if $REAL; then
    [ "$(git rev-parse --abbrev-ref HEAD)" = main ] || die "not on main"
    git diff --quiet && git diff --cached --quiet || die "uncommitted changes (commit them first)"
fi

# is NAME VERSION already on crates.io?
published() { cargo info "$1@$2" > /dev/null 2>&1; }

# ---- tests
echo "== tests"
(cd veryl-sim && cargo build --release -q && cargo run --release -q -- examples/counter.veryl | tail -1)
(cd veryl-eda && cargo test --release -q 2>&1 | grep "test result" | head -1)

# ---- veryl2chip-sim
dry=(--dry-run --allow-dirty)
$REAL && dry=()
if published "$SIM_NAME" "$SIM_VER"; then
    echo "== $SIM_NAME $SIM_VER is already on crates.io: skipped"
else
    echo "== cargo publish ${dry[*]:-} ($SIM_NAME $SIM_VER)"
    (cd veryl-sim && cargo publish "${dry[@]+"${dry[@]}"}")
fi

# ---- veryl2chip-eda (cargo publish waits until veryl2chip-sim shows up in the index)
if published "$EDA_NAME" "$EDA_VER"; then
    echo "== $EDA_NAME $EDA_VER is already on crates.io: skipped"
elif ! $REAL && ! published "$SIM_NAME" "$SIM_VER"; then
    # a dry run of veryl2chip-eda needs veryl2chip-sim on crates.io; until then, list what would be packaged
    echo "== $EDA_NAME: $SIM_NAME $SIM_VER is not on crates.io yet, so only listing the package"
    (cd veryl-eda && cargo package --list --allow-dirty | grep -v '^\.' | tr '\n' ' '; echo)
else
    echo "== cargo publish ${dry[*]:-} ($EDA_NAME $EDA_VER)"
    (cd veryl-eda && cargo publish "${dry[@]+"${dry[@]}"}")
fi

if $REAL; then
    # tags follow the repository's vX.Y style: 1.1.0 -> v1.1, 1.1.2 -> v1.1.2
    tag="v${EDA_VER%.0}"
    if git rev-parse -q --verify "refs/tags/$tag" > /dev/null; then
        echo "== tag $tag already exists"
    else
        git tag -a "$tag" -m "$SIM_NAME $SIM_VER, $EDA_NAME $EDA_VER on crates.io"
        echo "== tagged $tag (push it with: git push origin $tag)"
    fi
    echo "== done: cargo install $SIM_NAME $EDA_NAME"
else
    echo "== dry run OK; publish with: $0 --yes"
fi
