// RAM disk for xv6 on Rv64Soc (replaces kernel/virtio_disk.c, same functions).
// The simulator loads the file system image (fs.img) at RAMDISK, just above the
// 128 MB that xv6 uses (PHYSTOP); vm.c maps it into the kernel page table.
// A read or write is a 1 KB copy, done at once (no interrupt).

#include "types.h"
#include "riscv.h"
#include "defs.h"
#include "param.h"
#include "memlayout.h"
#include "spinlock.h"
#include "sleeplock.h"
#include "fs.h"
#include "buf.h"

#define RAMDISK PHYSTOP

void
virtio_disk_init(void)
{
}

void
virtio_disk_rw(struct buf *b, int write)
{
  char *blk = (char *)(RAMDISK + (uint64)b->blockno * BSIZE);
  if(write)
    memmove(blk, b->data, BSIZE);
  else
    memmove(b->data, blk, BSIZE);
}

void
virtio_disk_intr(void)
{
}
