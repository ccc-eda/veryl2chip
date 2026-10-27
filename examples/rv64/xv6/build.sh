#!/usr/bin/env bash
# xv6-riscv for Rv64Soc: copies the official xv6 (MIT license) into xv6/build, makes three
# changes and builds kernel/kernel and fs.img with riscv64-unknown-elf-gcc.
#   xv6/build.sh            XV6 = the xv6-riscv checkout (default /Users/Shared/ccc/xv6-riscv;
#                           get it with: git clone https://github.com/mit-pdos/xv6-riscv)
# The changes:
#   1. -march=rv64gc -> rv64ima_zicsr_zifencei -mabi=lp64 (Rv64Core has no C / F / D extension)
#   2. kernel/virtio_disk.c -> xv6/ramdisk.c: the file system image sits in RAM at PHYSTOP
#   3. kernel/vm.c maps that RAM disk (2 MB) instead of the virtio registers
# Run: sim/obj/rv64sim -m 0 -l 0x88000000:xv6/build/fs.img xv6/build/kernel/kernel
set -euo pipefail
cd "$(dirname "$0")"
XV6=${XV6:-/Users/Shared/ccc/xv6-riscv}
[ -d "$XV6/kernel" ] || { echo "no xv6-riscv at $XV6 (git clone https://github.com/mit-pdos/xv6-riscv)"; exit 1; }
mkdir -p build
rsync -a --delete --exclude .git "$XV6"/ build/
cd build
sed -i.orig 's/-march=rv64gc/-march=rv64ima_zicsr_zifencei -mabi=lp64/g' Makefile
cp ../ramdisk.c kernel/virtio_disk.c
sed -i.orig 's|kvmmap(kpgtbl, VIRTIO0, VIRTIO0, PGSIZE, PTE_R \| PTE_W);|kvmmap(kpgtbl, PHYSTOP, PHYSTOP, 2 * 1024 * 1024, PTE_R \| PTE_W); // RAM disk (Rv64Soc)|' kernel/vm.c
grep -q "RAM disk (Rv64Soc)" kernel/vm.c || { echo "vm.c: the virtio mapping line was not found"; exit 1; }
rm -f Makefile.orig kernel/vm.c.orig
make -s TOOLPREFIX=riscv64-unknown-elf- kernel/kernel fs.img 2>&1 | grep -v "^nmeta\|^balloc\|^init" || true
ls -l kernel/kernel fs.img | awk '{print $5, $9}'
