#!/usr/bin/env python3
# The exchange area (linux/getfiles) from files on the command line, so the board's /root
# gets them at boot, as the IDE does: "VERYLFS <bytes>" in a 512-byte block, then a tar.
#   python3 linux/mkarea.py -o area.img board/main.py board/blink.sh blink
#   ../../riscv-emu/target/release/rvemu -l 0x8F000000:area.img linux/build/opensbi/platform/generic/firmware/fw_payload.bin
# Executable files (an ELF from v2c cc --linux) keep their x bit.
import io, os, sys, tarfile

args = sys.argv[1:]
if len(args) < 3 or args[0] != '-o':
    sys.exit('usage: mkarea.py -o AREA FILE...')
out, files = args[1], args[2:]
b = io.BytesIO()
with tarfile.open(fileobj=b, mode='w', format=tarfile.USTAR_FORMAT) as t:
    for f in files:
        data = open(f, 'rb').read()
        i = tarfile.TarInfo(os.path.basename(f))
        i.size = len(data)
        i.mode = 0o755 if os.access(f, os.X_OK) or data[:4] == b'\x7fELF' else 0o644
        t.addfile(i, io.BytesIO(data))
tar = b.getvalue()
if len(tar) + 512 > 16 << 20:
    sys.exit('mkarea.py: the files do not fit the 16 MB exchange area')
open(out, 'wb').write(('VERYLFS %d\n' % len(tar)).encode().ljust(512, b'\0') + tar)
print(f'{out}: {len(files)} file(s), {len(tar)} bytes')
