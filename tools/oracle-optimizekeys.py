#!/usr/bin/env python3
"""
x2.exe's own `OptimizeKeys` (0x32988610, the key reducer of the KAC loader) on the Unicorn CPU emulator: the oracle of
packages/engine/src/kac-keys.ts, run by tools/verify-optimizekeys.ts.

    pip install --target /home/user/work/pycap unicorn pefile
    python3 tools/oracle-optimizekeys.py CASES.bin RESULTS.bin

The exe's code runs as it is; what it imports is replaced by stubs:
  * VCRUNTIME `memmove` (Python), UCRT `ceil` (x87 `frndint` with round-up), `_libm_sse2_sqrt_precise` (`sqrtsd`), `_CIatan2` (`fpatan`), and `_libm_sse2_sin_precise`
    (Python's `math.sin` on the double in xmm0);
  * `D3DXQuaternionNormalize` / `D3DXQuaternionMultiply`, models in double precision with a float store (the same formulas as
    packages/d3d9/src/d3dx-math.ts; the real functions are CPU-dependent dispatch thunks in d3dx9_43.dll, so they cannot be run as they are).
So what the oracle checks is the logic of `OptimizeKeys` (which keys are kept, and the interpolation / tolerance arithmetic), not those two D3DX
functions.  The CRT feature flag byte at 0x3362A958 is set so that the float -> int helper takes its scalar path (Unicorn has no AVX-512).

The scale reducer reads two stack slots it never initialises (see the header of kac-keys.ts).  For every case the oracle writes the two values it
is given into [esp+48h] / [esp+8Ch] of OptimizeKeys' frame right after CorrectVectorKeyOrder has returned; the value 0xFFFFFFFF in the `signA` field
leaves the stack as the emulated CorrectVectorKeyOrder left it.

File formats (little endian):
  cases   = "OKC1" u32 n { f32 tolerance, u32 signA, u32 signB, u32 nScale, u32 nTrans, u32 nRot, f32[nScale*4], f32[nTrans*4], f32[nRot*5] }
  results = "OKR1" u32 n { u32 nScale, u32 nTrans, u32 nRot, f32[nScale*4], f32[nTrans*4], f32[nRot*5] }
  (vector key = time, x, y, z; quaternion key = time, x, y, z, w)
"""
import math, os, struct, sys, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from peemu import *

EXE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "x2.exe")
OPTIMIZE_KEYS = 0x32988610
AFTER_FIRST_CORRECT = 0x3298863A  # `mov eax, [edi]` right after `call CorrectVectorKeyOrder; add esp, 8` of the scale channel
IAT = {"qnormalize": 0x3348FB44, "qmultiply": 0x3348FB88, "sin": 0x3348F898, "ceil": 0x3348F890, "sqrt": 0x3348F874, "atan2": 0x3348F870, "memmove": 0x3348F720}
FLAGS_ADDR = 0x3362A958
SLOT_A, SLOT_B = 0x48, 0x8C  # [esp+..] of the two sign accumulators


def f32(x):
    try:
        return struct.unpack("<f", struct.pack("<f", x))[0]
    except OverflowError:
        return math.copysign(math.inf, x)


class KeysOracle:
    def __init__(self, exe=EXE):
        self.emu = emu = PEEmu(exe)
        emu.stub(IAT["ceil"], bytes.fromhex("83EC04" "D93C24" "668B0424" "660D0008" "6625FFFB" "6689442402" "D96C2402" "DD442408" "D9FC" "D92C24" "83C404" "C3"))
        emu.stub(IAT["sqrt"], bytes.fromhex("F20F51C0C3"))
        emu.stub(IAT["atan2"], bytes.fromhex("D9F3C3"))
        emu.hook(emu.stub(IAT["sin"], b"\xC3"), self._sin)
        emu.hook(emu.stub(IAT["qnormalize"], bytes.fromhex("C20800")), self._qnormalize)  # ret 8
        emu.hook(emu.stub(IAT["qmultiply"], bytes.fromhex("C20C00")), self._qmultiply)  # ret 12
        emu.hook(emu.stub(IAT["memmove"], b"\xC3"), self._memmove)  # cdecl: the sort's insertion step moves keys
        emu.write(FLAGS_ADDR, bytes([emu.read(FLAGS_ADDR, 1)[0] | 0x20]))
        self.sign = None
        emu.hook(AFTER_FIRST_CORRECT, self._sign_garbage)

    def _sin(self, emu):
        x = struct.unpack("<d", emu.reg(UC_X86_REG_XMM0).to_bytes(16, "little")[:8])[0]
        r = math.sin(x) if math.isfinite(x) else math.nan
        emu.set_reg(UC_X86_REG_XMM0, int.from_bytes(struct.pack("<d", r) + bytes(8), "little"))

    def _memmove(self, emu):
        dst, src, n = emu.args(3)
        emu.write(dst, emu.read(src, n))
        emu.set_reg(UC_X86_REG_EAX, dst)

    def _qnormalize(self, emu):
        out, src = emu.args(2)
        x, y, z, w = struct.unpack("<4f", emu.read(src, 16))
        n = math.sqrt(x * x + y * y + z * z + w * w)
        r = (0.0, 0.0, 0.0, 0.0) if n == 0 else (f32(x / n), f32(y / n), f32(z / n), f32(w / n))
        emu.write(out, struct.pack("<4f", *r))
        emu.set_reg(UC_X86_REG_EAX, out)

    def _qmultiply(self, emu):
        # D3DXQuaternionMultiply(out, q1, q2) is the Hamilton product q2 * q1 (the x87 body at 0x100334A0 of d3dx9_43.dll)
        out, a, b = emu.args(3)
        ax, ay, az, aw = struct.unpack("<4f", emu.read(a, 16))
        bx, by, bz, bw = struct.unpack("<4f", emu.read(b, 16))
        r = (
            f32(bw * ax + bx * aw + by * az - bz * ay),
            f32(bw * ay - bx * az + by * aw + bz * ax),
            f32(bw * az + bx * ay - by * ax + bz * aw),
            f32(bw * aw - bx * ax - by * ay - bz * az),
        )
        emu.write(out, struct.pack("<4f", *r))
        emu.set_reg(UC_X86_REG_EAX, out)

    def _sign_garbage(self, emu):
        if self.sign is None:
            return
        esp = emu.reg(UC_X86_REG_ESP)
        emu.w32(esp + SLOT_A, self.sign[0])
        emu.w32(esp + SLOT_B, self.sign[1])

    def run(self, tol, sign, scales, trans, rots):
        """scales / trans: list of (t, x, y, z) tuples, rots: list of (t, x, y, z, w); returns the three reduced lists"""
        emu = self.emu
        emu.reset_heap()
        self.sign = None if sign[0] == 0xFFFFFFFF else sign

        def pack(keys, size):
            p = emu.alloc(size * max(1, len(keys)) + 64)
            for i, k in enumerate(keys):
                emu.write(p + size * i, struct.pack("<%df" % (size // 4), *k))
            return p

        arrays = [(pack(scales, 16), len(scales), 16), (pack(trans, 16), len(trans), 16), (pack(rots, 20), len(rots), 20)]
        cells = emu.alloc(32)
        for i, (p, n, sz) in enumerate(arrays):
            emu.w32(cells + 8 * i, p)
            emu.w32(cells + 8 * i + 4, p + n * sz)
        emu.call(OPTIMIZE_KEYS, [cells, cells + 4, cells + 8, cells + 12, cells + 16, cells + 20, struct.unpack("<I", struct.pack("<f", tol))[0]])
        out = []
        for i, (p, n, sz) in enumerate(arrays):
            s, e = emu.u32(cells + 8 * i), emu.u32(cells + 8 * i + 4)
            assert (e - s) % sz == 0 and s >= p and e <= p + n * sz, "bad range"
            out.append([struct.unpack("<%df" % (sz // 4), emu.read(s + sz * k, sz)) for k in range((e - s) // sz)])
        return out


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    data = open(sys.argv[1], "rb").read()
    assert data[:4] == b"OKC1", "not a cases file"
    n, = struct.unpack_from("<I", data, 4)
    pos = 8
    oracle = KeysOracle()
    out = [b"OKR1", struct.pack("<I", n)]
    t0 = time.time()
    for c in range(n):
        tol, sa, sb, ns, nt, nr = struct.unpack_from("<f5I", data, pos)
        pos += 24

        def take(count, width):
            nonlocal pos
            vals = struct.unpack_from("<%df" % (count * width), data, pos)
            pos += 4 * count * width
            return [vals[i * width:(i + 1) * width] for i in range(count)]

        s, t, r = take(ns, 4), take(nt, 4), take(nr, 5)
        rs, rt, rr = oracle.run(tol, (sa, sb), s, t, r)
        out.append(struct.pack("<3I", len(rs), len(rt), len(rr)))
        for k in rs + rt + rr:
            out.append(struct.pack("<%df" % len(k), *k))
    open(sys.argv[2], "wb").write(b"".join(out))
    print("%d cases in %.1f s" % (n, time.time() - t0), file=sys.stderr)


if __name__ == "__main__":
    main()
