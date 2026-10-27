# musl's config.mak for Rv64Core (RV64IMAC, lp64: no F / D), built with clang; written by
# hand instead of musl's configure. linux/build.sh copies it to build/musl/config.mak and
# fills in @SRC@, @PREFIX@ and @LIBCC@ (the rv64imac/lp64 libgcc of riscv64-unknown-elf-gcc).
ARCH = riscv64
SUBARCH =
ASMSUBARCH =
srcdir = @SRC@
prefix = @PREFIX@
exec_prefix = $(prefix)
bindir = $(exec_prefix)/bin
libdir = $(prefix)/lib
includedir = $(prefix)/include
syslibdir = /lib
CC = clang --target=riscv64-unknown-linux-musl -march=rv64imac_zicsr_zifencei -mabi=lp64
CFLAGS =
CFLAGS_AUTO = -Os -pipe -fomit-frame-pointer -fno-unwind-tables -fno-asynchronous-unwind-tables -ffunction-sections -fdata-sections -w -Qunused-arguments
CFLAGS_C99FSE = -std=c99 -nostdinc -ffreestanding -frounding-math
CFLAGS_MEMOPS =
CFLAGS_NOSSP = -fno-stack-protector
CPPFLAGS =
LDFLAGS =
LDFLAGS_AUTO =
CROSS_COMPILE = llvm-
LIBCC = @LIBCC@
OPTIMIZE_GLOBS = internal/*.c malloc/*.c string/*.c
ALL_TOOLS =
TOOL_LIBS =
ADD_CFI = no
MALLOC_DIR = mallocng
SHARED_LIBS =
WRAPCC_GCC = gcc
WRAPCC_CLANG = clang
