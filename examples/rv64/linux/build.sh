#!/usr/bin/env bash
# Linux on Rv64Soc: OpenSBI (fw_payload: firmware + device tree + kernel) with a minimal
# Linux 6.12 (RV64IMAC, Sv39, no FPU, one hart) whose initramfs holds only linux/init.c.
#   linux/build.sh       -> linux/build/opensbi/platform/generic/firmware/fw_payload.bin
#   sim/obj/rv64sim -m 0 linux/build/opensbi/platform/generic/firmware/fw_payload.bin
#
# Sources (outside the repo; LINUX / OPENSBI pick other directories):
#   git clone --depth 1 https://github.com/riscv-software-src/opensbi /Users/Shared/ccc/opensbi
#   git clone --depth 1 --branch v6.12 --filter=blob:none --no-checkout https://github.com/torvalds/linux /Users/Shared/ccc/linux
#   cd /Users/Shared/ccc/linux && git sparse-checkout init --no-cone && cp <repo>/examples/rv64/linux/sparse-checkout .git/info/ && git checkout v6.12
# (the sparse checkout keeps the kernel at ~300 MB: every Kconfig / Makefile, but only the drivers used here)
#
# Tools: LLVM (clang + ld.lld, Homebrew llvm / lld: the GNU riscv64-unknown-elf linker makes
# neither shared objects (the vDSO) nor PIEs (OpenSBI)), riscv64-unknown-elf-gcc (init), dtc,
# GNU make / sed / coreutils and bison 3 (Homebrew). On macOS the kernel's host tools also need
# <elf.h> (musl's, from the RISC-V toolchain) and <byteswap.h> (written here), and -D_UUID_T.
set -euo pipefail
cd "$(dirname "$0")"
HERE=$PWD
LINUX=${LINUX:-/Users/Shared/ccc/linux}
OPENSBI=${OPENSBI:-/Users/Shared/ccc/opensbi}
B=$HERE/build
mkdir -p "$B/kernel" "$B/hostinc"
for d in /opt/homebrew/opt/llvm/bin /opt/homebrew/opt/lld/bin /opt/homebrew/opt/coreutils/libexec/gnubin \
         /opt/homebrew/opt/gnu-sed/libexec/gnubin /opt/homebrew/opt/make/libexec/gnubin /opt/homebrew/opt/bison/bin; do
    [ -d "$d" ] && PATH=$d:$PATH
done
export PATH

# device tree
dtc -q -I dts -O dtb -o "$B/rv64soc.dtb" rv64soc.dts

# /init and the initramfs
riscv64-unknown-elf-gcc -march=rv64imac_zicsr -mabi=lp64 -O2 -static -nostdlib -ffreestanding -fno-builtin \
    -e _start -Wl,--build-id=none -o "$B/init" init.c
cat > "$B/initramfs.list" <<LIST
dir /dev 0755 0 0
nod /dev/console 0600 0 0 c 5 1
dir /proc 0755 0 0
dir /sys 0755 0 0
file /init $B/init 0755 0 0
LIST

# host headers missing on macOS
if [ "$(uname)" = Darwin ]; then
    ELF=$(ls /opt/homebrew/Cellar/riscv-gnu-toolchain/*/riscv64-unknown-elf/include/elf.h 2>/dev/null | head -1)
    [ -n "$ELF" ] || { echo "need an elf.h (riscv-gnu-toolchain)"; exit 1; }
    echo "#include \"$ELF\"" > "$B/hostinc/elf.h"
    printf '#ifndef _BYTESWAP_H\n#define _BYTESWAP_H\n#define bswap_16(x) __builtin_bswap16(x)\n#define bswap_32(x) __builtin_bswap32(x)\n#define bswap_64(x) __builtin_bswap64(x)\n#endif\n' > "$B/hostinc/byteswap.h"
    HOST=(HOSTCC=/usr/bin/clang HOSTCXX=/usr/bin/clang++ HOSTLD=/usr/bin/ld "HOSTCFLAGS=-I$B/hostinc -D_UUID_T -D__GETHOSTUUID_H")
else
    HOST=()
fi
K=(make -C "$LINUX" O="$B/kernel" ARCH=riscv LLVM=1 "${HOST[@]}")

# kernel: tinyconfig + rv64soc.config + the initramfs
"${K[@]}" -s tinyconfig > /dev/null
"$LINUX/scripts/kconfig/merge_config.sh" -m -O "$B/kernel" "$B/kernel/.config" rv64soc.config > /dev/null
"$LINUX/scripts/config" --file "$B/kernel/.config" --set-str INITRAMFS_SOURCE "$B/initramfs.list"
"${K[@]}" -s olddefconfig > /dev/null
"${K[@]}" -s -j8 Image > "$B/kernel.log" 2>&1 || { grep -E "error|Error" "$B/kernel.log" | head -20; exit 1; }
echo "kernel: $(wc -c < "$B/kernel/arch/riscv/boot/Image") bytes"

# OpenSBI with the device tree and the kernel (FW_PAYLOAD); rv64imac: Rv64Core has no F / D
make -C "$OPENSBI" -s O="$B/opensbi" PLATFORM=generic LLVM=1 PLATFORM_RISCV_ISA=rv64imac_zicsr_zifencei PLATFORM_RISCV_ABI=lp64 \
    FW_FDT_PATH="$B/rv64soc.dtb" FW_PAYLOAD_PATH="$B/kernel/arch/riscv/boot/Image" \
    platform-cflags-y=-Wno-error=sometimes-uninitialized -j8 > "$B/opensbi.log" 2>&1 || { grep -iE "error" "$B/opensbi.log" | head; exit 1; }
ls -l "$B/opensbi/platform/generic/firmware/fw_payload.bin" | awk '{print "fw_payload.bin:", $5, "bytes"}'
