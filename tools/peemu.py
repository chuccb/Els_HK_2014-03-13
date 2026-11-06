"""
Run functions of a 32-bit PE image (data/x2.exe) on the Unicorn CPU emulator: the oracle for pure functions of the exe.

    pip install --target /home/user/work/pycap unicorn pefile       (ELS_PYLIBS overrides that directory)

The image is mapped at its preferred base (x2.exe has no relocations, so the addresses of the IDA decompile are valid as they are), the
sections are copied in, and a call is made by hand: arguments pushed cdecl-style, a sentinel return address, `emu_start` until it is reached.
Nothing of Windows is emulated (no TEB, no loader, no heap): the imports a function uses have to be replaced by stubs -- patch the IAT slot
with the address of a code snippet (`PEEmu.stub`) and, when the stub needs more than a few instructions, hook that address from Python
(`PEEmu.hook`) -- see tools/oracle-optimizekeys.py for an example.
"""
import os, struct, sys

sys.path.insert(0, os.environ.get("ELS_PYLIBS", "/home/user/work/pycap"))
import pefile
from unicorn import *
from unicorn.x86_const import *

PAGE = 0x1000


def up(n, a=PAGE):
    return (n + a - 1) // a * a


class PEEmu:
    STACK_TOP = 0x0F000000
    STACK_SIZE = 0x400000
    HEAP_BASE = 0x20000000
    HEAP_SIZE = 0x08000000
    SENTINEL = 0x0E000000  # the return address of every call
    STUBS = 0x0B000000  # code snippets that replace imports

    def __init__(self, path):
        self.pe = pefile.PE(path, fast_load=True)
        self.base = self.pe.OPTIONAL_HEADER.ImageBase
        data = open(path, "rb").read()
        uc = self.uc = Uc(UC_ARCH_X86, UC_MODE_32)
        uc.mem_map(self.base, up(self.pe.OPTIONAL_HEADER.SizeOfImage))
        uc.mem_write(self.base, data[: self.pe.OPTIONAL_HEADER.SizeOfHeaders])
        for s in self.pe.sections:
            uc.mem_write(self.base + s.VirtualAddress, s.get_data())
        uc.mem_map(self.STACK_TOP - self.STACK_SIZE, self.STACK_SIZE)
        uc.mem_map(self.HEAP_BASE, self.HEAP_SIZE)
        uc.mem_map(self.SENTINEL, PAGE)
        uc.mem_map(self.STUBS, PAGE)
        self.heap_ptr = self.HEAP_BASE
        self.stub_ptr = self.STUBS
        self.last = []
        self._tracing = False
        uc.hook_add(UC_HOOK_MEM_UNMAPPED, self._unmapped)

    # ---- memory
    def _unmapped(self, uc, access, address, size, value, user):
        raise RuntimeError("unmapped access %d at 0x%x size %d (eip 0x%x)" % (access, address, size, uc.reg_read(UC_X86_REG_EIP)))

    def alloc(self, n, align=16):
        p = (self.heap_ptr + align - 1) // align * align
        self.heap_ptr = p + n
        assert self.heap_ptr < self.HEAP_BASE + self.HEAP_SIZE, "heap exhausted"
        return p

    def reset_heap(self):
        self.heap_ptr = self.HEAP_BASE

    def write(self, addr, b):
        self.uc.mem_write(addr, bytes(b))

    def read(self, addr, n):
        return bytes(self.uc.mem_read(addr, n))

    def u32(self, addr):
        return struct.unpack("<I", self.read(addr, 4))[0]

    def w32(self, addr, v):
        self.write(addr, struct.pack("<I", v & 0xFFFFFFFF))

    # ---- stubs
    def stub(self, iat_slot, code):
        """put `code` (bytes) in the stub area and make the import at `iat_slot` (an address in the IAT) point at it; returns its address"""
        addr = self.stub_ptr
        self.stub_ptr = (addr + len(code) + 15) // 16 * 16
        assert self.stub_ptr < self.STUBS + PAGE, "stub area full"
        self.uc.mem_write(addr, code)
        if iat_slot is not None:
            self.w32(iat_slot, addr)
        return addr

    def hook(self, addr, fn):
        """call fn(emu) before the instruction at `addr` runs (registers and memory may be changed)"""
        self.uc.hook_add(UC_HOOK_CODE, lambda uc, a, size, user: fn(self), begin=addr, end=addr)

    # ---- registers
    def reg(self, r):
        return self.uc.reg_read(r)

    def set_reg(self, r, v):
        self.uc.reg_write(r, v)

    def args(self, n):
        """the first n 32-bit stack arguments of a stdcall / cdecl function at its first instruction"""
        esp = self.reg(UC_X86_REG_ESP)
        return struct.unpack("<%dI" % n, self.read(esp + 4, 4 * n))

    # ---- calls
    def call(self, addr, args=(), max_insns=100_000_000):
        """cdecl call; returns EAX (the arguments are dropped by resetting ESP)"""
        uc = self.uc
        sp = self.STACK_TOP - 0x1000
        for a in reversed(args):
            sp -= 4
            uc.mem_write(sp, struct.pack("<I", a & 0xFFFFFFFF))
        sp -= 4
        uc.mem_write(sp, struct.pack("<I", self.SENTINEL))
        uc.reg_write(UC_X86_REG_ESP, sp)
        uc.reg_write(UC_X86_REG_EBP, 0)
        self.last = []
        h = None
        if self._tracing:
            def rec(uc_, address, size, user):
                self.last.append(address)
                if len(self.last) > 40:
                    self.last.pop(0)
            h = uc.hook_add(UC_HOOK_CODE, rec)
        try:
            uc.emu_start(addr, self.SENTINEL, count=max_insns)
        except UcError as e:
            raise RuntimeError("%s at eip 0x%x; last: %s" % (e, uc.reg_read(UC_X86_REG_EIP), " ".join("%x" % a for a in self.last[-12:])))
        finally:
            if h is not None:
                uc.hook_del(h)
        if uc.reg_read(UC_X86_REG_EIP) != self.SENTINEL:
            raise RuntimeError("did not return (eip 0x%x)" % uc.reg_read(UC_X86_REG_EIP))
        return uc.reg_read(UC_X86_REG_EAX)

    def trace(self, on=True):
        """keep the addresses of the last instructions of a call (for the error message when it fails)"""
        self._tracing = on
