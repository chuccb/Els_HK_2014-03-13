#!/usr/bin/env python3
"""
x2.exe's own FreeType 2.4.11 (statically linked at 0x32831000..: `FT_New_Library` 0x32835EE0 says 2, 4, 11) on the Unicorn CPU emulator: the oracle of
packages/freetype, run by tools/verify-freetype.ts.

    pip install --target /home/user/work/pycap unicorn pefile
    python3 tools/oracle-freetype.py JOBS.json RESULTS.jsonl

The exe's code runs as it is.  Only what it takes from the C runtime is replaced (memcpy / memmove / memset / str* / _setjmp3 / longjmp as Python hooks on the
import thunks; any other import that is called stops the run with its name) and the allocator: the `FT_Memory` the library is made with (the exe makes
its own with `FT_New_Memory`, 0x32870130, a CRT `malloc`) is three hooked `ret`s with a free list, so the heap never grows with the glyphs loaded.
Unlike the CRT's malloc the blocks it hands out are ZEROED: FT_Bitmap_Embolden (2.4.11) allocates its new buffer with FT_QALLOC_MULT, i.e. uninitialised, and
reads the margins it added, so in the exe the result there depends on stale heap bytes; the oracle and the port both mean "zeroed".
The library is set up the way the exe does it (`FT_Init_FreeType` 0x32831A20: `FT_New_Library`, then `FT_Add_Default_Modules` 0x328319F0, 18 modules).

JOBS.json:
  { "fonts":  { NAME: { "path": FILE, "face": N } },
    "jobs":   [ { "font": NAME, "size": PIXELS, "flags": LOAD_FLAGS, "render": MODE | null, "codes": [CHARCODE...] | "glyphs": [GLYPH INDEX...],
                  "outline": BOOL, "hres": 72, "vres": 72 },
                { "embolden": { "rows", "width", "pitch", "pixel_mode", "hex" }, "xstr": 26.6, "ystr": 26.6 },
                { "font": NAME, "char_range": [LO, HI, STEP] }                      # FT_Get_Char_Index only, no size needed
                { "font": NAME, "raster": { "points": [[x, y]...], "tags": [...], "contours": [...], "flags": N } },   # FT_Render_Glyph(NORMAL) of a synthetic outline
                { "calc": "mulfix" | "muldiv" | "muldiv_no_round" | "divfix" | "sqrtfixed", "args": [[a, b(, c)]...] },
                { "calc": "veclen", "args": [[x, y]...] },                          # FT_Vector_Length
                { "calc": "vtransform", "args": [[x, y, xx, xy, yx, yy]...] } ] }  # FT_Vector_Transform: results are [x, y] pairs
RESULTS.jsonl: one line per font (its face and size metrics, `size` = the size of the job), then one line per glyph:
  { "font", "size", "code", "glyph", "load_err", "render_err", "metrics": [8 ints of FT_Glyph_Metrics], "linear": [hori, vert], "advance": [x, y], "format",
    "bitmap": { "rows", "width", "pitch", "mode", "left", "top", "hex" }, "outline": { "contours": [...], "points": [[x, y]...], "tags": [...] } }
and one line per embolden job, a last line {"stats": {"glyphs", "longjmps"}} (a longjmp = the gray rasterizer bisected a band); a raster job answers { "raster": true, "render_err", "bitmap": { rows, width, pitch, mode, left, top, sha1, hex (only up to 4 KB) } }.

Offsets (ILP32, FreeType 2.4.11 structs; checked against the exe's own accesses in CKTDGFreeTypeFont::CharToSystemTexture 0x328DA300):
  FT_FaceRec  num_faces 0, face_index 4, face_flags 8, num_glyphs 16, num_charmaps 36, bbox 52, units_per_EM 68 (u16), ascender 70, descender 72, height 74,
              max_advance_width 76, max_advance_height 78, underline_position 80, underline_thickness 82 (i16), glyph 84, size 88, charmap 92
  FT_SizeRec  metrics 12: x_ppem 12, y_ppem 14 (u16), x_scale 16, y_scale 20, ascender 24, descender 28, height 32, max_advance 36
  FT_GlyphSlotRec  metrics 24 (8 longs: width, height, horiBearingX, horiBearingY, horiAdvance, vertBearingX, vertBearingY, vertAdvance), linearHoriAdvance 56,
              linearVertAdvance 60, advance 64, format 72, bitmap 76 (rows, width, pitch, buffer, num_grays u16 @92, pixel_mode u8 @94), bitmap_left 100,
              bitmap_top 104, outline 108 (n_contours i16, n_points i16, points, tags, contours, flags)
"""
import json, os, struct, sys, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from peemu import *

EXE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "x2.exe")
FT_NEW_LIBRARY, FT_ADD_DEFAULT_MODULES = 0x32835EE0, 0x328319F0
FT_NEW_MEMORY_FACE, FT_SET_CHAR_SIZE, FT_GET_CHAR_INDEX = 0x328377B0, 0x32832950, 0x32832A70
FT_LOAD_GLYPH, FT_RENDER_GLYPH, FT_DONE_FACE = 0x328350B0, 0x32834780, 0x32835BF0
FT_BITMAP_EMBOLDEN, FT_BITMAP_COPY, FT_BITMAP_NEW = 0x32837EE0, 0x32837840, 0x32837800
FT_CALC = {"mulfix": 0x32831CE0, "muldiv": 0x32831B90, "muldiv_no_round": 0x32831C50, "divfix": 0x32831D10, "sqrtfixed": 0x32831F90}
FT_VECTOR_LENGTH, FT_VECTOR_TRANSFORM = 0x32833C90, 0x328333A0
TRAP = 0x0B100000  # one 4-byte `ret` per import
MEMSTUB = 0x0B200000


def cstr(emu, p):
    out = b""
    while True:
        c = emu.read(p + len(out), 1)
        if c == b"\0":
            return out
        out += c


class FtOracle:
    def __init__(self, exe=EXE):
        self.emu = emu = PEEmu(exe)
        uc = emu.uc
        pe = emu.pe
        pe.parse_data_directories()
        self.names = {}
        uc.mem_map(TRAP, 0x10000)
        for e in pe.DIRECTORY_ENTRY_IMPORT:
            for imp in e.imports:
                nm = imp.name.decode() if imp.name else "#%d" % imp.ordinal
                at = TRAP + len(self.names) * 4
                self.names[at] = (e.dll.decode(), nm)
                uc.mem_write(at, b"\xC3\x90\x90\x90")
                emu.w32(imp.address, at)
        self.impl = {
            "memcpy": self._memcpy, "memmove": self._memcpy, "memset": self._memset, "memchr": self._memchr, "strlen": self._strlen,
            "strcmp": self._strcmp, "strncmp": self._strncmp, "strstr": self._strstr, "strchr": self._strchr, "strrchr": self._strrchr,
            "strncpy": self._strncpy, "_setjmp3": self._setjmp3, "longjmp": self._longjmp,
        }
        uc.hook_add(UC_HOOK_CODE, self._trap, begin=TRAP, end=TRAP + len(self.names) * 4)
        # the allocator: the FT_Memory handed to FT_New_Library
        self.blocks, self.free = {}, {}
        self.longjmps = 0
        uc.mem_map(MEMSTUB, 0x1000)
        uc.mem_write(MEMSTUB, b"\xC3" * 64)
        emu.hook(MEMSTUB, self._h_alloc)
        emu.hook(MEMSTUB + 16, self._h_free)
        emu.hook(MEMSTUB + 32, self._h_realloc)
        memory = emu.alloc(16)
        emu.write(memory, struct.pack("<IIII", 0, MEMSTUB, MEMSTUB + 16, MEMSTUB + 32))
        pl = emu.alloc(4)
        err = emu.call(FT_NEW_LIBRARY, (memory, pl))
        assert err == 0, "FT_New_Library: %d" % err
        self.lib = emu.u32(pl)
        emu.call(FT_ADD_DEFAULT_MODULES, (self.lib,))
        self.faces = {}

    # ---- C runtime
    def _arg(self, n):
        return self.emu.u32(self.emu.reg(UC_X86_REG_ESP) + 4 + 4 * n)

    def _ret(self, v):
        self.emu.set_reg(UC_X86_REG_EAX, v & 0xFFFFFFFF)

    def _trap(self, uc, address, size, user):
        dll, nm = self.names[address]
        f = self.impl.get(nm)
        if f is None:
            raise RuntimeError("import %s!%s called (return to 0x%x)" % (dll, nm, self.emu.u32(self.emu.reg(UC_X86_REG_ESP))))
        f()

    def _memcpy(self):
        d, s, n = self._arg(0), self._arg(1), self._arg(2)
        if n:
            self.emu.write(d, self.emu.read(s, n))
        self._ret(d)

    def _memset(self):
        d, c, n = self._arg(0), self._arg(1), self._arg(2)
        if n:
            self.emu.write(d, bytes([c & 255]) * n)
        self._ret(d)

    def _memchr(self):
        a, c, n = self._arg(0), self._arg(1) & 255, self._arg(2)
        i = self.emu.read(a, n).find(bytes([c]))
        self._ret(0 if i < 0 else a + i)

    def _strlen(self):
        self._ret(len(cstr(self.emu, self._arg(0))))

    def _strcmp(self):
        x, y = cstr(self.emu, self._arg(0)), cstr(self.emu, self._arg(1))
        self._ret(0 if x == y else (-1 if x < y else 1))

    def _strncmp(self):
        n = self._arg(2)
        x, y = cstr(self.emu, self._arg(0))[:n], cstr(self.emu, self._arg(1))[:n]
        self._ret(0 if x == y else (-1 if x < y else 1))

    def _strstr(self):
        a = self._arg(0)
        i = cstr(self.emu, a).find(cstr(self.emu, self._arg(1)))
        self._ret(0 if i < 0 else a + i)

    def _strchr(self):
        a = self._arg(0)
        i = (cstr(self.emu, a) + b"\0").find(bytes([self._arg(1) & 255]))
        self._ret(0 if i < 0 else a + i)

    def _strrchr(self):
        a = self._arg(0)
        i = (cstr(self.emu, a) + b"\0").rfind(bytes([self._arg(1) & 255]))
        self._ret(0 if i < 0 else a + i)

    def _strncpy(self):
        d, n = self._arg(0), self._arg(2)
        x = cstr(self.emu, self._arg(1))[:n]
        self.emu.write(d, x + bytes(n - len(x)))
        self._ret(d)

    def _setjmp3(self):
        """save what a longjmp must restore: the callee-saved registers, the stack pointer of the caller and the return address (first 6 dwords of the
        jmp_buf; the exe's gray rasterizer is the only FreeType code that jumps, to bisect a band whose cells do not fit its pool)"""
        emu = self.emu
        esp = emu.reg(UC_X86_REG_ESP)
        emu.write(self._arg(0), struct.pack("<6I", emu.reg(UC_X86_REG_EBX), emu.reg(UC_X86_REG_ESI), emu.reg(UC_X86_REG_EDI), emu.reg(UC_X86_REG_EBP), esp, emu.u32(esp)))
        self._ret(0)

    def _longjmp(self):
        """the trap's own `ret` then pops the saved return address, so the _setjmp3 call returns a second time, with `value` (1 if 0)"""
        emu = self.emu
        self.longjmps += 1
        ebx, esi, edi, ebp, esp, ret = struct.unpack("<6I", emu.read(self._arg(0), 24))
        value = self._arg(1) or 1
        emu.set_reg(UC_X86_REG_EBX, ebx)
        emu.set_reg(UC_X86_REG_ESI, esi)
        emu.set_reg(UC_X86_REG_EDI, edi)
        emu.set_reg(UC_X86_REG_EBP, ebp)
        emu.write(esp, struct.pack("<I", ret))
        emu.set_reg(UC_X86_REG_ESP, esp)
        self._ret(value)

    # ---- the FT_Memory
    def _alloc(self, n):
        n = max(16, (n + 15) // 16 * 16)
        lst = self.free.get(n)
        p = lst.pop() if lst else self.emu.alloc(n, 16)
        self.blocks[p] = n
        self.emu.write(p, bytes(n))
        return p

    def _release(self, p):
        if p:
            self.free.setdefault(self.blocks.pop(p), []).append(p)

    def _h_alloc(self, emu):
        self._ret(self._alloc(self._arg(1)))

    def _h_free(self, emu):
        self._release(self._arg(1))

    def _h_realloc(self, emu):
        cur, new, p = self._arg(1), self._arg(2), self._arg(3)
        q = self._alloc(new)
        if p:
            self.emu.write(q, self.emu.read(p, min(self.blocks[p], new)))
            self._release(p)
        self._ret(q)

    # ---- the FreeType API
    def open_face(self, name, path, index):
        emu = self.emu
        data = open(path, "rb").read()
        base = emu.alloc(len(data) + 64, 4096)
        emu.write(base, data)
        pf = emu.alloc(4)
        err = emu.call(FT_NEW_MEMORY_FACE, (self.lib, base, len(data), index, pf))
        assert err == 0, "FT_New_Memory_Face(%s): %d" % (path, err)
        face = emu.u32(pf)
        self.faces[name] = face
        return face

    def s16(self, a):
        return struct.unpack("<h", self.emu.read(a, 2))[0]

    def u16(self, a):
        return struct.unpack("<H", self.emu.read(a, 2))[0]

    def s32(self, a):
        return struct.unpack("<i", self.emu.read(a, 4))[0]

    def face_info(self, face):
        w = lambda o: self.s32(face + o)
        return {
            "num_faces": w(0), "face_index": w(4), "face_flags": w(8), "style_flags": w(12), "num_glyphs": w(16), "num_charmaps": w(36),
            "bbox": list(struct.unpack("<4i", self.emu.read(face + 52, 16))),
            "units_per_EM": self.u16(face + 68), "ascender": self.s16(face + 70), "descender": self.s16(face + 72), "height": self.s16(face + 74),
            "max_advance_width": self.s16(face + 76), "max_advance_height": self.s16(face + 78),
            "underline_position": self.s16(face + 80), "underline_thickness": self.s16(face + 82),
        }

    def set_char_size(self, face, w26, h26, hres, vres):
        return self.emu.call(FT_SET_CHAR_SIZE, (face, w26, h26, hres, vres))

    def size_info(self, face):
        s = self.emu.u32(face + 88)
        return {
            "x_ppem": self.u16(s + 12), "y_ppem": self.u16(s + 14), "x_scale": self.s32(s + 16), "y_scale": self.s32(s + 20),
            "ascender": self.s32(s + 24), "descender": self.s32(s + 28), "height": self.s32(s + 32), "max_advance": self.s32(s + 36),
        }

    def char_index(self, face, code):
        return self.emu.call(FT_GET_CHAR_INDEX, (face, code))

    def bitmap_state(self, slot, with_pixels=True):
        emu = self.emu
        rows, width, pitch, buf = struct.unpack("<iiiI", emu.read(slot + 76, 16))
        mode = emu.read(slot + 94, 1)[0]
        d = {"rows": rows, "width": width, "pitch": pitch, "mode": mode, "left": self.s32(slot + 100), "top": self.s32(slot + 104)}
        if with_pixels:
            d["hex"] = emu.read(buf, rows * abs(pitch)).hex() if buf and rows else ""
        return d

    def outline_state(self, slot):
        emu = self.emu
        nc, npts = self.s16(slot + 108), self.s16(slot + 110)
        pts, tags, conts, flags = struct.unpack("<IIII", emu.read(slot + 112, 16))
        return {
            "contours": list(struct.unpack("<%dh" % nc, emu.read(conts, 2 * nc))) if nc > 0 else [],
            "points": [list(p) for p in struct.iter_unpack("<ii", emu.read(pts, 8 * npts))] if npts > 0 else [],
            "tags": list(emu.read(tags, npts)) if npts > 0 else [],
            "flags": flags,
        }

    def load(self, face, glyph, flags, render=None, outline=False, pixels=True):
        emu = self.emu
        slot = emu.u32(face + 84)
        err = emu.call(FT_LOAD_GLYPH, (face, glyph, flags))
        r = {"glyph": glyph, "load_err": err, "render_err": None}
        if err:
            return r
        r["metrics"] = list(struct.unpack("<8i", emu.read(slot + 24, 32)))
        r["linear"] = [self.s32(slot + 56), self.s32(slot + 60)]
        r["advance"] = list(struct.unpack("<2i", emu.read(slot + 64, 8)))
        r["format"] = emu.u32(slot + 72)
        if outline and r["format"] == 0x6F75746C:  # 'outl'
            r["outline"] = self.outline_state(slot)
        if render is not None:
            r["render_err"] = emu.call(FT_RENDER_GLYPH, (slot, render))
            if r["render_err"] == 0:
                r["bitmap"] = self.bitmap_state(slot, pixels)
                r["metrics_after"] = list(struct.unpack("<8i", emu.read(slot + 24, 32)))
        return r

    def raster(self, font, ol):
        """FT_Render_Glyph(NORMAL) of a synthetic outline: the glyph slot of `font`, after a real FT_Load_Glyph (so its internals are in place), with its
        outline fields pointed at the given arrays.  This reaches what no shipped font does (cubic segments, FT_OUTLINE_EVEN_ODD_FILL, invalid tags) and
        outlines with far more cells than the rasterizer's 16 KB pool holds (it renders in bands and bisects them)."""
        import hashlib
        emu = self.emu
        face = self.faces[font]
        slot = emu.u32(face + 84)
        assert self.set_char_size(face, 16 << 6, 0, 72, 72) == 0
        assert emu.call(FT_LOAD_GLYPH, (face, ol.get("glyph", 1), 10)) == 0
        pts, tags, conts = ol["points"], ol["tags"], ol["contours"]
        n, nc = len(pts), len(conts)
        pbuf, tbuf, cbuf = self._alloc(8 * n + 8), self._alloc(n + 8), self._alloc(2 * nc + 8)
        if n:
            emu.write(pbuf, struct.pack("<%di" % (2 * n), *[v for p in pts for v in p]))
            emu.write(tbuf, bytes(tags))
        if nc:
            emu.write(cbuf, struct.pack("<%dh" % nc, *conts))
        emu.write(slot + 108, struct.pack("<hhIIII", nc, n, pbuf, tbuf, cbuf, ol.get("flags", 0)))
        emu.write(slot + 72, struct.pack("<I", 0x6F75746C))
        r = {"raster": True, "render_err": emu.call(FT_RENDER_GLYPH, (slot, 0))}
        if r["render_err"] == 0:
            b = self.bitmap_state(slot, True)
            data = bytes.fromhex(b.pop("hex"))
            b["sha1"] = hashlib.sha1(data).hexdigest()
            if len(data) <= 4096:
                b["hex"] = data.hex()
            r["bitmap"] = b
        for p in (pbuf, tbuf, cbuf):
            self._release(p)
        return r

    def embolden(self, bm, xstr, ystr):
        """FT_Bitmap_New + the pixels of `bm` copied in (FT_Bitmap_Copy) + FT_Bitmap_Embolden"""
        emu = self.emu
        data = bytes.fromhex(bm["hex"])
        src = emu.alloc(24)
        buf = emu.alloc(max(len(data), 1) + 16)
        emu.write(buf, data)
        # FT_Bitmap: rows, width, pitch, buffer, num_grays (u16), pixel_mode (u8), palette_mode (u8), palette
        emu.write(src, struct.pack("<iiiIHBBI", bm["rows"], bm["width"], bm["pitch"], buf, 256, bm["pixel_mode"], 0, 0))
        dst = emu.alloc(24)
        emu.call(FT_BITMAP_NEW, (dst,))
        err = emu.call(FT_BITMAP_COPY, (self.lib, src, dst))
        if err:
            return {"err": err}
        err = emu.call(FT_BITMAP_EMBOLDEN, (self.lib, dst, xstr, ystr))
        rows, width, pitch, pbuf = struct.unpack("<iiiI", emu.read(dst, 16))
        mode = emu.read(dst + 18, 1)[0]
        return {"err": err, "rows": rows, "width": width, "pitch": pitch, "mode": mode, "hex": emu.read(pbuf, rows * abs(pitch)).hex() if rows else ""}


def main():
    jobs_path, out_path = sys.argv[1], sys.argv[2]
    spec = json.load(open(jobs_path))
    o = FtOracle()
    t0 = time.time()
    n = 0
    with open(out_path, "w") as out:
        for name, f in spec.get("fonts", {}).items():
            face = o.open_face(name, f["path"], f.get("face", 0))
            out.write(json.dumps({"font": name, "info": o.face_info(face)}) + "\n")
        for job in spec["jobs"]:
            if "calc" in job:
                res = []
                if job["calc"] == "veclen":
                    buf = o.emu.alloc(16)
                    for x, y in job["args"]:
                        o.emu.write(buf, struct.pack("<ii", x, y))
                        v = o.emu.call(FT_VECTOR_LENGTH, (buf,))
                        res.append(v - (1 << 32) if v & 0x80000000 else v)
                    out.write(json.dumps({"calc": job["calc"], "results": res}) + "\n")
                    continue
                if job["calc"] == "vtransform":
                    buf = o.emu.alloc(32)
                    for x, y, xx, xy, yx, yy in job["args"]:
                        o.emu.write(buf, struct.pack("<2i", x, y))
                        o.emu.write(buf + 8, struct.pack("<4i", xx, xy, yx, yy))
                        o.emu.call(FT_VECTOR_TRANSFORM, (buf, buf + 8))
                        res.append(list(struct.unpack("<2i", o.emu.read(buf, 8))))
                    out.write(json.dumps({"calc": job["calc"], "results": res}) + "\n")
                    continue
                fn = FT_CALC[job["calc"]]
                for a in job["args"]:
                    v = o.emu.call(fn, tuple(x & 0xFFFFFFFF for x in a))
                    res.append(v - (1 << 32) if v & 0x80000000 else v)
                out.write(json.dumps({"calc": job["calc"], "results": res}) + "\n")
                continue
            if "char_range" in job:
                face = o.faces[job["font"]]
                lo, hi, step = job["char_range"]
                out.write(json.dumps({"font": job["font"], "char_range": job["char_range"], "glyphs": [o.char_index(face, c) for c in range(lo, hi + 1, step)]}) + "\n")
                continue
            if "raster" in job:
                out.write(json.dumps(o.raster(job["font"], job["raster"])) + "\n")
                continue
            if "embolden" in job:
                r = o.embolden(job["embolden"], job["xstr"], job["ystr"])
                r["embolden"] = True
                out.write(json.dumps(r) + "\n")
                continue
            face = o.faces[job["font"]]
            err = o.set_char_size(face, job["size"] << 6, 0, job.get("hres", 72), job.get("vres", 72))
            out.write(json.dumps({"font": job["font"], "size": job["size"], "set_err": err, "metrics": o.size_info(face), "info": o.face_info(face)}) + "\n")
            if err:
                continue
            codes = job.get("codes")
            glyphs = job.get("glyphs")
            for i in range(len(codes) if codes is not None else len(glyphs)):
                if codes is not None:
                    gi = o.char_index(face, codes[i])
                    r = {"code": codes[i]}
                    if gi == 0:
                        r.update({"glyph": 0, "missing": True})
                        r.update(font=job["font"], size=job["size"])
                        out.write(json.dumps(r) + "\n")
                        continue
                else:
                    gi, r = glyphs[i], {}
                r.update(o.load(face, gi, job["flags"], job.get("render"), job.get("outline", False)))
                r.update(font=job["font"], size=job["size"])
                out.write(json.dumps(r) + "\n")
                n += 1
        out.write(json.dumps({"stats": {"glyphs": n, "longjmps": o.longjmps}}) + "\n")
    print("%d glyphs in %.1f s" % (n, time.time() - t0), file=sys.stderr)


if __name__ == "__main__":
    main()
