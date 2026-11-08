#!/usr/bin/env python3
"""Mutation check of packages/freetype (the port of FreeType 2.4.11): apply one small change at a time to a source file of packages/freetype/src, run the
tests of packages/freetype/test and report whether a test notices (killed) or not (SURVIVED).

    python3 tools/mutate-freetype.py [--list] [--check] [--survivors=LOG] [substring of a mutant name ...]
    python3 tools/mutate-freetype.py --pick [--all] [--files=glyph.ts,interp.ts] [--from-log=FILE] [substring ...]   (which glyphs kill a surviving mutant: tools/ft-kill-pick.ts)

The mutants are a hand-picked list per file (calc, trig, cmap, size, bitmap, render, raster, outline, glyph, bytecode, and a few of the interpreter) plus ONE
generated mutant per instruction handler of the bytecode interpreter: `insXXX` that does nothing.  Every mutant must be killed except the ones with a reason
(the last argument of `m(...)`: why no input can tell the mutant from the original).  The tests that kill them are the oracle fixture (the nine real font faces,
tools/ft-picks.json's glyphs, the outlines, the bitmaps), the synthetic fonts of packages/freetype/test/synth.ts (random programs over all 119 instructions; the
shipped fonts enter 80 of them, tools/ft-opcode-census.ts) and the hand-derived unit tests.  A mutant that must be killed and survives makes the exit code 1; so does one
with a reason that is killed (the reason is out of date).  `--survivors=LOG` runs only the mutants that survived in an earlier run's output.  `--check` only verifies that every anchor text occurs exactly once.  `--pick` does not run the tests: it applies each mutant (those without a reason, or `--all`,
or the ones named) to a COPY of the sources and looks for glyphs of the nine fixture fonts on which the copy differs from the real package (tools/ft-kill-pick.ts);
the glyphs found are merged into tools/ft-picks.json, which `tools/verify-freetype.ts --record` adds to the fixture.  The source is restored after every mutant (also on Ctrl-C), but do not run
this with uncommitted edits in the mutated files you cannot afford to lose.  A full run (376 mutants) takes about 22 minutes (3.5 s per mutant); each mutant has a 60 s timeout.
"""
import os, re, resource, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUN = os.path.join(ROOT, 'node_modules/.bin/bun')
SRC = 'packages/freetype/src/'
TESTS = ['packages/freetype/test/']



def path_of(f):
    return os.path.join(ROOT, SRC + f)

# (file, name, original text, mutated text, why it may survive ('' = must be killed))
M = []


def m(f, name, a, b, why=''):
    M.append((f, name, a, b, why))

# ---- calc.ts: ftcalc.c as the exe's copy computes it
m('calc.ts', 'mulfix: the half is 0x7fff', 'Math.floor((p + 0x8000 + (p < 0 ? -1 : 0)) / 65536) | 0', 'Math.floor((p + 0x7fff + (p < 0 ? -1 : 0)) / 65536) | 0')
m('calc.ts', 'mulfix: a negative tie rounds up', 'Math.floor((p + 0x8000 + (p < 0 ? -1 : 0)) / 65536) | 0', 'Math.floor((p + 0x8000) / 65536) | 0')
m('calc.ts', 'mulfix: floor becomes trunc', 'Math.floor((p + 0x8000 + (p < 0 ? -1 : 0)) / 65536) | 0', 'Math.trunc((p + 0x8000 + (p < 0 ? -1 : 0)) / 65536) | 0')
m('calc.ts', 'mulfix, 64-bit product: a negative tie rounds up', '(a < 0 !== b < 0 ? -1n : 0n)', '0n')
m('calc.ts', 'mulfix, 64-bit product: the result is not wrapped to 32 bits', 'return Number(BigInt.asIntN(32, q));', 'return Number(q);')
m('calc.ts', 'multo64: the carry of the middle terms is dropped', 'const carry = i1 >= 4294967296 ? 1 : 0;', 'const carry = 0;', 'every caller passes an absolute value, at most 2^31, so each half is at most 0xFFFF and the high half of a number above 0x7FFFFFFF is 0x8000 with a zero low half: the sum of the two middle products is at most 2 * 0xFFFF * 0x7FFF = 0xFFFD0002 < 2^32 and never carries')
m('calc.ts', 'multo64: the carry of the low word is dropped', "lo += i1;\n  if (lo >= 4294967296) {\n    lo -= 4294967296;\n    hi += 1;\n  }\n  return [hi >>> 0, lo >>> 0];\n}\n\n/** FT_Add64", "lo += i1;\n  if (lo >= 4294967296) {\n    lo -= 4294967296;\n  }\n  return [hi >>> 0, lo >>> 0];\n}\n\n/** FT_Add64")
m('calc.ts', 'add64: the carry is dropped', "let hi = x[0] + y[0];\n  if (lo >= 4294967296) {\n    lo -= 4294967296;\n    hi += 1;\n  }", "let hi = x[0] + y[0];\n  if (lo >= 4294967296) {\n    lo -= 4294967296;\n  }")
m('calc.ts', 'div64by32: a quotient that does not fit is let through at hi == y', 'if (r >= y) return 0x7fffffff;', 'if (r > y) return 0x7fffffff;')
m('calc.ts', 'div64by32: 31 quotient bits', 'for (let i = 32; i > 0; i--) {', 'for (let i = 31; i > 0; i--) {')
m('calc.ts', 'abs32: INT_MIN becomes positive', 'return ((x ^ m) - m) | 0;', 'return (x ^ m) - m;')
m('calc.ts', 'muldiv: the fast path ends one value late (|a|, |b|)', 'if (ua > 46340 || ub > 46340 || uc > 176095) {', 'if (ua > 46341 || ub > 46340 || uc > 176095) {')
m('calc.ts', 'muldiv: the fast path ends one value late (|c|)', 'uc > 176095', 'uc > 176096')
m('calc.ts', 'muldiv: b == c does not return a', "c |= 0;\n  if (a === 0 || b === c) return a;\n  const s = a ^ b ^ c;\n  const ua = abs32(a);\n  const ub = abs32(b);\n  const uc = abs32(c);\n  let r: number;\n  if (ua > 46340 || ub > 46340 || uc > 176095) {", "c |= 0;\n  if (a === 0) return a;\n  const s = a ^ b ^ c;\n  const ua = abs32(a);\n  const ub = abs32(b);\n  const uc = abs32(c);\n  let r: number;\n  if (ua > 46340 || ub > 46340 || uc > 176095) {")
m('calc.ts', 'muldiv_no_round: b == c does not return a', "c |= 0;\n  if (a === 0 || b === c) return a;\n  const s = a ^ b ^ c;\n  const ua = abs32(a);\n  const ub = abs32(b);\n  const uc = abs32(c);\n  let r: number;\n  if (ua > 46340 || ub > 46340) {", "c |= 0;\n  if (a === 0) return a;\n  const s = a ^ b ^ c;\n  const ua = abs32(a);\n  const ub = abs32(b);\n  const uc = abs32(c);\n  let r: number;\n  if (ua > 46340 || ub > 46340) {")
m('calc.ts', 'muldiv: the sign is the sign bit of a ^ b ^ c, zero counts as negative', "  else r = 0x7fffffff;\n  return s < 0 ? -r | 0 : r;\n}\n\n/** FT_MulDiv_No_Round", "  else r = 0x7fffffff;\n  return s <= 0 ? -r | 0 : r;\n}\n\n/** FT_MulDiv_No_Round")
m('calc.ts', 'muldiv_no_round: the sign, zero counts as negative', "  else r = 0x7fffffff;\n  return s < 0 ? -r | 0 : r;\n}\n\n/**\n * FT_DivFix", "  else r = 0x7fffffff;\n  return s <= 0 ? -r | 0 : r;\n}\n\n/**\n * FT_DivFix")
m('calc.ts', 'muldiv: the rounding term is c', '(Math.imul(ua, ub) + (uc >> 1)) | 0) / uc)', '(Math.imul(ua, ub) + uc) | 0) / uc)')
m('calc.ts', 'muldiv: a 64-bit product is not rounded', 'const t = add64(multo64(ua >>> 0, ub >>> 0), [0, uc >> 1]);', 'const t = add64(multo64(ua >>> 0, ub >>> 0), [0, 0]);')
m('calc.ts', 'muldiv: a zero divisor gives 0', "  } else if (uc > 0) r = Math.trunc(((Math.imul(ua, ub) + (uc >> 1)) | 0) / uc) | 0;\n  else r = 0x7fffffff;", "  } else if (uc > 0) r = Math.trunc(((Math.imul(ua, ub) + (uc >> 1)) | 0) / uc) | 0;\n  else r = 0;")
m('calc.ts', 'muldiv_no_round: the quotient is rounded', 'r = Math.trunc(Math.imul(ua, ub) / uc) | 0;', 'r = Math.trunc((Math.imul(ua, ub) + (uc >> 1)) / uc) | 0;')
m('calc.ts', 'divfix: the half of b is not added (32-bit path)', 'q = Math.floor((((ub >> 1) + lo) >>> 0) / (ub >>> 0));', 'q = Math.floor((lo >>> 0) / (ub >>> 0));')
m('calc.ts', 'divfix: the half of b is not added (64-bit path)', 'const t = add64([hi >>> 0, lo], [0, (ub >> 1) >>> 0]);', 'const t = add64([hi >>> 0, lo], [0, 0]);')
m('calc.ts', 'divfix: a zero divisor gives 0', 'if (ub === 0) q = 0x7fffffff;', 'if (ub === 0) q = 0;')
m('calc.ts', 'divfix: the sign is that of b', 'const s = a ^ b;', 'const s = b;')
# ---- trig.ts
m('trig.ts', 'length: a vector on the y axis keeps its sign', 'if (x === 0) return y >= 0 ? y : -y | 0;', 'if (x === 0) return y;')
m('trig.ts', 'length: a vector on the x axis keeps its sign', 'if (y === 0) return x >= 0 ? x : -x | 0;', 'if (y === 0) return x;')
m('trig.ts', 'length: the CORDIC gain constant', 'const FT_TRIG_SCALE = 0x9b74eda8;', 'const FT_TRIG_SCALE = 0x9b74eda9;')
m('trig.ts', 'length: 22 CORDIC steps', 'for (let i = 0; i < 23; i++) {', 'for (let i = 0; i < 22; i++) {')
m('trig.ts', 'length: the result is not rounded', 'if (shift > 0) return (v.x + (1 << (shift - 1))) >> shift;', 'if (shift > 0) return v.x >> shift;')
m('trig.ts', 'length: the prenormalisation target is 26 bits', 'if (shift <= 27) {\n    shift = 27 - shift;', 'if (shift <= 26) {\n    shift = 27 - shift;', 'at a shift of 27 the first branch shifts by 0 and the second branch shifts by 0 as well (it returns -0, which every caller treats as 0)')
m('trig.ts', 'sqrt: 23 rounds', 'let count = 24;', 'let count = 23;')
m('trig.ts', 'transform: x uses yx', 'const xz = (mulFix(x, xx) + mulFix(y, xy)) | 0;', 'const xz = (mulFix(x, xx) + mulFix(y, yx)) | 0;')
m('trig.ts', 'transform: y uses xx', 'const yz = (mulFix(x, yx) + mulFix(y, yy)) | 0;', 'const yz = (mulFix(x, xx) + mulFix(y, yy)) | 0;')
# ---- cmap.ts
m('cmap.ts', 'format 4: the binary search skips a segment after a miss on the right', "if (code < start) max = mid;\n      else if (code > end) min = mid + 1;\n      else {\n        p += numSegs2;", "if (code < start) max = mid;\n      else if (code > end) min = mid + 2;\n      else {\n        p += numSegs2;")
m('cmap.ts', 'format 4: the delta is also added to glyph 0 (binary search)', "          gindex = b.u16(p);\n          if (gindex !== 0) gindex = (gindex + delta) & 0xffff;\n        } else gindex = (code + delta) & 0xffff;\n        break;\n      }\n    }\n    return gindex;\n  }\n}\n\nfunction validate6", "          gindex = b.u16(p);\n          gindex = (gindex + delta) & 0xffff;\n        } else gindex = (code + delta) & 0xffff;\n        break;\n      }\n    }\n    return gindex;\n  }\n}\n\nfunction validate6")
m('cmap.ts', 'format 4: the delta is also added to glyph 0 (linear search)', "          gindex = b.u16(pp);\n          if (gindex !== 0) gindex = (gindex + delta) & 0xffff;", "          gindex = b.u16(pp);\n          gindex = (gindex + delta) & 0xffff;")
m('cmap.ts', 'format 4: a glyph array entry is read without the code - start offset', 'p += offset + (code - start) * 2;\n          gindex = b.u16(p);', 'p += offset;\n          gindex = b.u16(p);')
m('cmap.ts', 'format 4: the delta is subtracted', '} else gindex = (code + delta) & 0xffff;\n        break;\n      }\n    }\n    return gindex;\n  }\n}\n\nfunction validate6', '} else gindex = (code - delta) & 0xffff;\n        break;\n      }\n    }\n    return gindex;\n  }\n}\n\nfunction validate6')
m('cmap.ts', 'format 4: codes above 0xFFFF are looked up', 'if (code >= 0x10000) return 0;\n    return this.flags', 'if (code >= 0x20000) return 0;\n    return this.flags', 'the end code of a segment is a 16-bit value, so a code above 0xFFFF is past every segment and the lookup ends with glyph 0 either way')
m('cmap.ts', 'format 4 validation: a segment may end before it starts', 'if (start > end) throw new Invalid();\n    if (start <= lastEnd && n > 0) {', 'if (start > end + 1) throw new Invalid();\n    if (start <= lastEnd && n > 0) {')
m('cmap.ts', 'format 4 validation: out-of-order segments are not flagged', 'if (lastStart > start || lastEnd > end) error |= TT_CMAP_FLAG_UNSORTED;', 'if (lastStart > start || lastEnd > end) error |= TT_CMAP_FLAG_OVERLAPPING;')
m('cmap.ts', 'format 6: the entry count is not checked against the table length', 'length < 10 + count * 2', 'length < 10 + count')
m('cmap.ts', 'format 6: the first code is an index', 'const idx = (code - start) >>> 0;', 'const idx = (code - start + 1) >>> 0;')
m('cmap.ts', 'format 12: the groups may overlap', 'if (n > 0 && start <= last) throw new Invalid();', 'if (n > 0 && start < last) throw new Invalid();')
m('cmap.ts', 'format 12: the glyph is counted from the end of the group', 'else return (b.u32(p + 8) + code - start) >>> 0;', 'else return (b.u32(p + 8) + end - code) >>> 0;')
m('cmap.ts', 'format 12: the search goes left on a miss on the right', "else if (code > end) min = mid + 1;\n      else return", "else if (code > end) min = mid + 2;\n      else return")
# ---- size.ts
m('size.ts', 'metrics: the ascender is rounded, not ceiled', 'm.ascender = pixCeil(mulFix(face.ascender, m.yScale));', 'm.ascender = pixRound(mulFix(face.ascender, m.yScale));')
m('size.ts', 'metrics: the descender is rounded, not floored', 'm.descender = pixFloor(mulFix(face.descender, m.yScale));', 'm.descender = pixRound(mulFix(face.descender, m.yScale));')
m('size.ts', 'metrics: the line height is ceiled', '\n  m.height = pixRound(mulFix(face.height, m.yScale));', '\n  m.height = pixCeil(mulFix(face.height, m.yScale));')
m('size.ts', 'metrics: the max advance is ceiled', '\n  m.maxAdvance = pixRound(mulFix(face.maxAdvanceWidth, m.xScale));', '\n  m.maxAdvance = pixCeil(mulFix(face.maxAdvanceWidth, m.xScale));')
m('size.ts', 'request: the width in pixels is rounded down', 'Math.trunc(i32(i32(r.width * r.horiResolution) + 36) / 72)', 'Math.trunc(i32(i32(r.width * r.horiResolution) + 35) / 72)')
m('size.ts', 'request: the height in pixels is rounded down', 'Math.trunc(i32(i32(r.height * r.vertResolution) + 36) / 72)', 'Math.trunc(i32(i32(r.height * r.vertResolution) + 35) / 72)')
m('size.ts', 'request: the ppem is truncated', 'm.xPpem = u16((scaledW + 32) >> 6);', 'm.xPpem = u16(scaledW >> 6);')
m('size.ts', 'request: the y ppem is truncated', 'm.yPpem = u16((scaledH + 32) >> 6);', 'm.yPpem = u16(scaledH >> 6);')
m('size.ts', 'request: the scale is not divided by the units per em', 'm.xScale = divFix(scaledW, w);', 'm.xScale = divFix(scaledW, w + 1);')
m('size.ts', 'select metrics: the strike ppem is truncated', 'm.xPpem = u16((bs.xPpem + 32) >> 6);', 'm.xPpem = u16(bs.xPpem >> 6);', "a strike's ppem is stored as ppem << 6 (tt_face_load_sbit_strikes), so adding 32 before the shift changes nothing")
m('size.ts', 'match size: the height is not compared', 'if (h !== pixRound(bs.yPpem)) continue;', 'if (false) continue;')
m('size.ts', 'match size: the width is not compared', 'if (w === pixRound(bs.xPpem) || ignoreWidth) return i;', 'if (true) return i;')
m('size.ts', 'tt size reset: the integer-ppem flag is another bit', 'if (face.header.flags & 8) {', 'if (face.header.flags & 4) {')
m('size.ts', 'tt size reset: the scaled ascender is ceiled', 'm.ascender = pixRound(mulFix(face.ascender, m.yScale));\n    m.descender = pixRound', 'm.ascender = pixCeil(mulFix(face.ascender, m.yScale));\n    m.descender = pixRound')
m('size.ts', 'tt size reset: the larger ppem is not the reference', 'if (m.xPpem >= m.yPpem) {', 'if (m.xPpem < m.yPpem) {')
m('size.ts', 'tt size reset: the y ratio', 'size.ttmetrics.yRatio = divFix(m.yPpem, m.xPpem);', 'size.ttmetrics.yRatio = divFix(m.xPpem, m.yPpem);')
m('size.ts', 'tt size reset: a changed size does not invalidate the cvt', 'size.cvtReady = false;\n  size.ttmetrics.valid = true;', 'size.ttmetrics.valid = true;')
m('size.ts', 'set char size: a height of 0 takes the width', 'else if (!charHeight) charHeight = charWidth;', 'else if (!charHeight) charHeight = 0;')
m('size.ts', 'set char size: less than a pixel is a pixel', 'if (charWidth < 64) charWidth = 64;', 'if (charWidth < 32) charWidth = 32;')
m('size.ts', 'set char size: the strike is chosen first', 'const idx = matchSize(face, req, false);\n    if (idx < 0 || idx > 0xffff) size.strikeIndex = 0xffffffff;', 'const idx = -1;\n    if (idx < 0 || idx > 0xffff) size.strikeIndex = 0xffffffff;')
# ---- bitmap.ts
m('bitmap.ts', 'embolden: the x strength is truncated, not rounded', 'let xstr = (xStrength + 32) >> 6;', 'let xstr = (xStrength + 31) >> 6;')
m('bitmap.ts', 'embolden: the y strength is truncated, not rounded', 'let ystr = (yStrength + 32) >> 6;', 'let ystr = (yStrength + 31) >> 6;')
m('bitmap.ts', 'embolden: the sum saturates at 254', 'const maxGray = bitmap.numGrays - 1;', 'const maxGray = bitmap.numGrays - 2;')
m('bitmap.ts', 'embolden: a sum above the maximum is let through', "if (buf[p + x]! + buf[p + x - i]! > maxGray) {\n            buf[p + x] = maxGray;\n            break;\n          }", "if (buf[p + x]! + buf[p + x - i]! > maxGray + 1) {\n            buf[p + x] = maxGray;\n            break;\n          }")
m('bitmap.ts', 'embolden: the pixel before it is not added', 'buf[p + x] = buf[p + x]! + buf[p + x - i]!;', 'buf[p + x] = buf[p + x]! + buf[p + x - 1]!;')
m('bitmap.ts', 'embolden: the pixels are visited from the left', 'for (let x = pitch - 1; x >= 0; x--) {', 'for (let x = 0; x < pitch; x++) {')
m('bitmap.ts', 'embolden: the rows below are or-ed, not the ones above', 'const q = p - bitmap.pitch * x;', 'const q = p + bitmap.pitch * x;')
m('bitmap.ts', 'embolden: the bitmap does not grow upwards', 'bitmap.rows += ystr;', 'bitmap.rows += ystr - 1;')
m('bitmap.ts', 'embolden: the bitmap does not grow to the right', 'bitmap.width += xstr;', 'bitmap.width += xstr - 1;')
m('bitmap.ts', 'embolden: mono strength is not clamped to 8', 'if (xstr > 8) xstr = 8;', 'if (xstr > 9) xstr = 9;')
m('bitmap.ts', 'embolden: LCD strength is doubled, not tripled', 'xstr *= 3;', 'xstr *= 2;')
m('bitmap.ts', 'embolden: LCD_V strength is doubled, not tripled', 'ystr *= 3;', 'ystr *= 2;')
m('bitmap.ts', 'embolden: mono or-s the previous byte with the wrong shift', 'buf[p + x] = buf[p + x]! | (buf[p + x - 1]! << (8 - i));', 'buf[p + x] = buf[p + x]! | (buf[p + x - 1]! << (7 - i));')
m('bitmap.ts', 'embolden: mono does not shift the pixel right', 'buf[p + x] = buf[p + x]! | (tmp >> i);', 'buf[p + x] = buf[p + x]! | (tmp >> (i + 1));')
m('bitmap.ts', 'assure: the old rows go to the top', 'out.set(buf.subarray(pitch * i, pitch * i + len), newPitch * (ypixels + i));', 'out.set(buf.subarray(pitch * i, pitch * i + len), newPitch * i);')
m('bitmap.ts', 'assure: a flow-up bitmap gets its new rows at the start', 'len), newPitch * i);', 'len), newPitch * (ypixels + i));')
m('bitmap.ts', 'assure: the padding right of the bitmap is not cleared', 'if (write < end) buf.fill(0, write, end);', '')
m('bitmap.ts', 'assure: the partial byte of the padding is not masked', 'buf[write] = buf[write]! & mask;', 'buf[write] = buf[write]!;')
m('bitmap.ts', 'assure: the mask keeps one bit too many', 'const mask = 0xff00 >> shift;', 'const mask = 0xff00 >> (shift - 1);')
m('bitmap.ts', 'assure: 2-bit pitch', 'newPitch = (width + xpixels + 3) >> 2;', 'newPitch = (width + xpixels + 2) >> 2;', 'GRAY2 / GRAY4 are not ported past this point: bitmapEmbolden throws for them (the exe never makes such a bitmap)')
m('bitmap.ts', 'assure: mono pitch', 'newPitch = (width + xpixels + 7) >> 3;', 'newPitch = (width + xpixels + 6) >> 3;')
m('bitmap.ts', 'copy: a flow-up bitmap is copied by its absolute pitch', 'const pitch = Math.abs(source.pitch);\n  const size = pitch * source.rows;', 'const pitch = source.pitch;\n  const size = pitch * source.rows;')
m('bitmap.ts', 'copy: the source is copied without its pixel mode', 'to.pixelMode = from.pixelMode;', '')
m('bitmap.ts', 'copy: the source is copied without its number of grays', 'to.numGrays = from.numGrays;', '')
# ---- render.ts
m('render.ts', 'smooth: the cbox is not floored on the left', 'const xMin = cbox.xMin & ~63;', 'const xMin = (cbox.xMin + 32) & ~63;')
m('render.ts', 'smooth: the cbox is not floored at the bottom', 'const yMin = cbox.yMin & ~63;', 'const yMin = (cbox.yMin + 32) & ~63;')
m('render.ts', 'smooth: the cbox is not ceiled on the right', 'const xMax = (cbox.xMax + 63) & ~63;', 'const xMax = (cbox.xMax + 62) & ~63;')
m('render.ts', 'smooth: the cbox is not ceiled at the top', 'const yMax = (cbox.yMax + 63) & ~63;', 'const yMax = (cbox.yMax + 62) & ~63;')
m('render.ts', 'smooth: a width of 0x7FFF is refused', 'if (width > 0x7fff || height > 0x7fff) return FtErr.Raster_Overflow;', 'if (width >= 0x7fff || height > 0x7fff) return FtErr.Raster_Overflow;')
m('render.ts', 'smooth: a height of 0x8000 is let through', 'if (width > 0x7fff || height > 0x7fff) return FtErr.Raster_Overflow;', 'if (width > 0x7fff || height > 0x8000) return FtErr.Raster_Overflow;')
m('render.ts', 'smooth: the width overflow of the cbox is not tested', 'if (xMin < 0 && xMax > INT_MAX + xMin) return FtErr.Raster_Overflow;', '')
m('render.ts', 'smooth: bitmap_left is the right edge', 'const xLeft = xMin >> 6;', 'const xLeft = xMax >> 6;')
m('render.ts', 'smooth: bitmap_top is the bottom edge', 'const yTop = yMax >> 6;', 'const yTop = yMin >> 6;')
m('render.ts', 'smooth: the pitch is padded to 4', 'const pitch = width;', 'const pitch = (width + 3) & ~3;')
m('render.ts', 'smooth: the outline stays shifted', 'outlineTranslate(outline, xShift, yShift);\n  if (error) {', 'if (error) {')
m('render.ts', 'smooth: the outline is shifted the wrong way', 'outlineTranslate(outline, -xShift, -yShift);', 'outlineTranslate(outline, xShift, yShift);')
m('render.ts', 'smooth: a failed render keeps the buffer', 'if (error) {\n    bitmap.buffer = null;', 'if (error) {\n    bitmap.buffer = bitmap.buffer;')
m('render.ts', 'smooth: the glyph stays an outline', 'slot.format = FT_GLYPH_FORMAT.BITMAP;\n  slot.bitmapLeft', 'slot.bitmapLeft')
m('render.ts', 'render: LIGHT is not turned into NORMAL', 'if (mode === FT_RENDER_MODE.NORMAL || mode === FT_RENDER_MODE.LIGHT) return smoothRender(slot);', 'if (mode === FT_RENDER_MODE.NORMAL) return smoothRender(slot);')
m('render.ts', 'render: a bitmap is rendered again', 'case FT_GLYPH_FORMAT.BITMAP:\n      return FtErr.Ok;', 'case FT_GLYPH_FORMAT.BITMAP:\n      return smoothRender(slot);')
# ---- outline.ts
m('outline.ts', 'check: an empty outline is invalid', 'if (nPoints === 0 && nContours === 0) return 0;', '')
m('outline.ts', 'check: an empty contour is valid', 'if (end <= end0 || end >= nPoints) return FtErr.Invalid_Argument;', 'if (end < end0 || end >= nPoints) return FtErr.Invalid_Argument;')
m('outline.ts', 'check: a contour may end past the points', 'if (end <= end0 || end >= nPoints) return FtErr.Invalid_Argument;', 'if (end <= end0 || end > nPoints) return FtErr.Invalid_Argument;', 'the last contour then ends at nPoints, and the check after the loop (`end !== nPoints - 1`) refuses it with the same error; an earlier one is followed by a larger end that is refused by this test')
m('outline.ts', 'check: the last contour need not end at the last point', 'if (end !== nPoints - 1) return FtErr.Invalid_Argument;', '')
m('outline.ts', 'cbox: the maximum is taken from y', 'if (x > xMax) xMax = x;', 'if (x > yMax) xMax = x;')
m('outline.ts', 'translate: y gets the x offset', 'p[2 * n + 1] = (p[2 * n + 1]! + yOffset) | 0;', 'p[2 * n + 1] = (p[2 * n + 1]! + xOffset) | 0;')
m('outline.ts', 'decompose: a contour that starts off the curve and ends on it keeps its last point', "vsx = vlx;\n        vsy = vly;\n        limit--;", "vsx = vlx;\n        vsy = vly;")
m('outline.ts', 'decompose: the start of an all-conic contour is not the midpoint', 'vsx = Math.trunc((vsx + vlx) / 2) | 0;\n        vsy = Math.trunc((vsy + vly) / 2) | 0;', 'vsx = vsx;\n        vsy = vsy;')
m('outline.ts', 'decompose: the implied on-curve point of two conics is not the midpoint', 'const mx = Math.trunc((vcx + vx) / 2) | 0;', 'const mx = vx;')
m('outline.ts', 'decompose: a cubic needs a second control point', "if (point + 1 > limit || (tags[tg + 1]! & 3) !== FT_CURVE_TAG.CUBIC) return FtErr.Invalid_Outline;", "if (point + 1 > limit) return FtErr.Invalid_Outline;")
m('outline.ts', 'decompose: a cubic may be the last point', "if (point + 1 > limit || (tags[tg + 1]! & 3) !== FT_CURVE_TAG.CUBIC) return FtErr.Invalid_Outline;", "if (point + 1 >= limit || (tags[tg + 1]! & 3) !== FT_CURVE_TAG.CUBIC) return FtErr.Invalid_Outline;")
m('outline.ts', 'decompose: a contour starting with a cubic point is accepted', 'if (tag === FT_CURVE_TAG.CUBIC) return FtErr.Invalid_Outline;\n    if (tag === FT_CURVE_TAG.CONIC) {', 'if (tag === FT_CURVE_TAG.CONIC) {')
m('outline.ts', 'decompose: a conic followed by a cubic is accepted', 'if (tag !== FT_CURVE_TAG.CONIC) return FtErr.Invalid_Outline;', '')
m('outline.ts', 'decompose: the contour is not closed with a line', 'if (!closed) error = f.lineTo(vsx, vsy);', 'if (!closed) error = 0;')
# ---- raster.ts: ftgrays.c, PIXEL_BITS = 8
EQ_BAND = 'the band is one scanline per cell row, so a line that only touches rows outside the band records nothing either way (tools/verify-freetype.ts: 1,440 outlines agree)'
m('raster.ts', 'scanline: the area of a one-cell run adds fx1 - fx2', 'Math.imul(fx1 + fx2, delta)', 'Math.imul(fx1 - fx2, delta)')
m('raster.ts', 'scanline: the first partial height starts from fx2', 'let p = Math.imul(ONE_PIXEL - fx1, y2 - y1);', 'let p = Math.imul(ONE_PIXEL - fx2, y2 - y1);')
m('raster.ts', 'scanline: a negative remainder does not lower the quotient', 'delta--;\n      mod = (mod + dx) | 0;', 'mod = (mod + dx) | 0;')
m('raster.ts', 'scanline: a negative lift remainder does not lower the lift', 'lift--;\n        rem = (rem + dx) | 0;', 'rem = (rem + dx) | 0;')
m('raster.ts', 'scanline: the error term starts without -dx', 'mod = (mod - dx) | 0;\n      while (ex1 !== ex2) {', 'while (ex1 !== ex2) {')
m('raster.ts', 'scanline: the error term carries at > 0', 'mod = (mod + rem) | 0;\n        if (mod >= 0) {\n          mod = (mod - dx) | 0;', 'mod = (mod + rem) | 0;\n        if (mod > 0) {\n          mod = (mod - dx) | 0;')
m('raster.ts', 'scanline: the last cell ignores first', 'Math.imul(fx2 + ONE_PIXEL - first, delta)', 'Math.imul(fx2 - first, delta)')
m('raster.ts', 'line: a line on the row above the band is drawn', 'if (min >= this.maxEy || max < this.minEy) {', 'if (min > this.maxEy || max < this.minEy) {', EQ_BAND)
m('raster.ts', 'line: a line ending on the first row of the band is culled', 'if (min >= this.maxEy || max < this.minEy) {', 'if (min >= this.maxEy || max <= this.minEy) {')
m('raster.ts', 'vertical line: twoFx is quadrupled', '((this.x - subpixels(ex)) << 1) | 0;', '((this.x - subpixels(ex)) << 2) | 0;')
m('raster.ts', 'vertical line: the first cover adds fy1', 'let delta = (first - fy1) | 0;', 'let delta = (first + fy1) | 0;')
m('raster.ts', 'vertical line: the middle cover of a line pointing down', 'delta = (first + first - ONE_PIXEL) | 0;', 'delta = (first - ONE_PIXEL) | 0;')
m('raster.ts', 'vertical line: the last cover', 'delta = (fy2 - ONE_PIXEL + first) | 0;', 'delta = (fy2 - first) | 0;')
m('raster.ts', 'line: the first partial width starts from fy1', 'let p = Math.imul(ONE_PIXEL - fy1, dx);', 'let p = Math.imul(fy1, dx);')
m('raster.ts', 'line: the first scanline ends on the wrong edge', 'this.renderScanline(ey1, this.x, fy1, x, first);', 'this.renderScanline(ey1, this.x, fy1, x, ONE_PIXEL - first);')
m('raster.ts', 'line: the error term carries at > 0', 'mod = (mod + rem) | 0;\n        if (mod >= 0) {\n          mod = (mod - dy) | 0;', 'mod = (mod + rem) | 0;\n        if (mod > 0) {\n          mod = (mod - dy) | 0;')
m('raster.ts', 'conic: flat below 1/3 pixel', 'let draw = dx < ONE_PIXEL / 4;', 'let draw = dx < ONE_PIXEL / 3;')
m('raster.ts', 'conic: the number of splits stops at 1/3 pixel', '} while (dx > ONE_PIXEL / 4);', '} while (dx > ONE_PIXEL / 3);')
m('raster.ts', 'conic: a conic on the row above the band is split', 'if (trunc(min) >= this.maxEy || trunc(max) < this.minEy) draw = true;', 'if (trunc(min) > this.maxEy || trunc(max) < this.minEy) draw = true;', EQ_BAND)
m('raster.ts', 'conic: a conic ending on the first row of the band is not split', 'if (trunc(min) >= this.maxEy || trunc(max) < this.minEy) draw = true;', 'if (trunc(min) >= this.maxEy || trunc(max) <= this.minEy) draw = true;')
m('raster.ts', 'conic: the halves are floored', 'const a = (v[(b + 3) * 2 + c] = Math.trunc((v[(b + 2) * 2 + c]! + t) / 2) | 0);', 'const a = (v[(b + 3) * 2 + c] = Math.floor((v[(b + 2) * 2 + c]! + t) / 2) | 0);', 'the outline is translated to the bottom left of its cbox first, so every coordinate is >= 0 and trunc == floor')
m('raster.ts', 'conic: the split point of the first half', 't = v[(b + 1) * 2 + c] = Math.trunc((v[b * 2 + c]! + t) / 2) | 0;', 't = v[(b + 1) * 2 + c] = Math.trunc((v[b * 2 + c]! + t + 1) / 2) | 0;')
m('raster.ts', 'cubic: the flatness limit is L / 5', 'const sLimit = Math.imul(L, ONE_PIXEL / 6);', 'const sLimit = Math.imul(L, ONE_PIXEL / 5);')
m('raster.ts', 'cubic: the length estimate weights the long side by 235', 'Math.imul(236, dx_)', 'Math.imul(235, dx_)')
m('raster.ts', 'cubic: a chord longer than 32768 is not split at once', 'if (L > 32767) split = true;', 'if (L > 32768) split = true;')
m('raster.ts', 'cubic: the first control point is not tested for flatness', 'if (s > sLimit) split = true;\n          else {\n            const dx2', 'if (false) split = true;\n          else {\n            const dx2')
m('raster.ts', 'cubic: the second control point is not tested for flatness', 's = abs((Math.imul(dy, dx2) - Math.imul(dx, dy2)) | 0);\n            if (s > sLimit) split = true;', 's = abs((Math.imul(dy, dx2) - Math.imul(dx, dy2)) | 0);\n            if (false) split = true;')
m('raster.ts', 'cubic: a control point behind the start does not force a split', '((Math.imul(dx1, (dx1 - dx) | 0) + Math.imul(dy1, (dy1 - dy) | 0)) | 0) > 0 ||', 'false ||')
m('raster.ts', 'cubic: a control point behind the end does not force a split', '((Math.imul(dx2, (dx2 - dx) | 0) + Math.imul(dy2, (dy2 - dy) | 0)) | 0) > 0\n            )', 'false\n            )')
m('raster.ts', 'cubic: a cubic on the row above the band is drawn whole', 'let draw = trunc(min) >= this.maxEy || trunc(max) < this.minEy;\n    for (;;) {', 'let draw = trunc(min) > this.maxEy || trunc(max) < this.minEy;\n    for (;;) {', EQ_BAND + ' (a cubic whose control polygon starts on the row above the band is drawn or split, both record nothing)')
m('raster.ts', 'cubic: a cubic ending on the first row of the band is drawn whole', 'let draw = trunc(min) >= this.maxEy || trunc(max) < this.minEy;\n    for (;;) {', 'let draw = trunc(min) >= this.maxEy || trunc(max) <= this.minEy;\n    for (;;) {')
m('raster.ts', 'cubic: the halves are floored', 'let a = (v[(b + 1) * 2 + k] = Math.trunc((v[b * 2 + k]! + c) / 2) | 0);', 'let a = (v[(b + 1) * 2 + k] = Math.floor((v[b * 2 + k]! + c) / 2) | 0);', 'every coordinate is >= 0 (the outline is translated to the bottom left of its cbox), so trunc == floor')
m('raster.ts', 'cubic: the centre point', 'v[(b + 3) * 2 + k] = Math.trunc((a + bb) / 2) | 0;', 'v[(b + 3) * 2 + k] = Math.trunc((a + bb + 1) / 2) | 0;')
m('raster.ts', 'span: the area is shifted by 8', 'let coverage = area >> (PIXEL_BITS * 2 + 1 - 8);', 'let coverage = area >> (PIXEL_BITS * 2 + 1 - 7);')
m('raster.ts', 'span: a negative coverage is not mirrored', 'if (coverage < 0) coverage = -coverage;', '')
m('raster.ts', 'span: even-odd keeps 8 bits', 'coverage &= 511;', 'coverage &= 255;')
m('raster.ts', 'span: even-odd folds at 257', 'if (coverage > 256) coverage = 512 - coverage;', 'if (coverage > 257) coverage = 512 - coverage;')
m('raster.ts', 'span: even-odd 256 is not clamped', 'else if (coverage === 256) coverage = 255;', '')
m('raster.ts', 'span: non-zero 256 is not clamped', '} else if (coverage >= 256) coverage = 255;', '} else if (coverage > 256) coverage = 255;')
m('raster.ts', 'span: x is not clamped to 32767', 'if (x >= 32767) x = 32767;', '', 'a bitmap is at most 0x7FFF wide (render.ts refuses more), so x stays below 32767')
m('raster.ts', 'span: neighbours of equal coverage are not merged', 'this.spanLen[last] = (this.spanLen[last]! + acount) & 0xffff;', 'this.spanLen[last] = (this.spanLen[last]! + acount - 1) & 0xffff;')
m('raster.ts', 'span: a row of 33 spans is kept', 'count >= FT_MAX_GRAY_SPANS', 'count > FT_MAX_GRAY_SPANS')
m('raster.ts', 'span: the span buffer is flushed on a new row only at the end', 'if (this.spanY !== y || count >= FT_MAX_GRAY_SPANS) {', 'if (count >= FT_MAX_GRAY_SPANS) {')
m('raster.ts', 'sweep: the run before a cell is one cell short', 'this.hline(x, yindex, Math.imul(cover, ONE_PIXEL * 2), cx - x);', 'this.hline(x, yindex, Math.imul(cover, ONE_PIXEL * 2), cx - x - 1);')
m('raster.ts', 'sweep: the cell area is added', 'const area = (Math.imul(cover, ONE_PIXEL * 2) - this.cellArea[cell]!) | 0;', 'const area = (Math.imul(cover, ONE_PIXEL * 2) + this.cellArea[cell]!) | 0;')
m('raster.ts', 'sweep: column 0 is not drawn', 'if (area !== 0 && cx >= 0) this.hline(cx, yindex, area, 1);', 'if (area !== 0 && cx > 0) this.hline(cx, yindex, area, 1);')
m('raster.ts', 'sweep: the trailing run is one cell short', 'if (cover !== 0) this.hline(x, yindex, Math.imul(cover, ONE_PIXEL * 2), this.countEx - x);', 'if (cover !== 0) this.hline(x, yindex, Math.imul(cover, ONE_PIXEL * 2), this.countEx - x - 1);')
m('raster.ts', 'sweep: the trailing run is not drawn', 'if (cover !== 0) this.hline(x, yindex, Math.imul(cover, ONE_PIXEL * 2), this.countEx - x);', '')
m('raster.ts', 'cbox: the right edge is not ceiled', 'this.maxEx = (this.maxEx + 63) >> 6;', 'this.maxEx = (this.maxEx + 62) >> 6;')
m('raster.ts', 'cbox: the top edge is not ceiled', 'this.maxEy = (this.maxEy + 63) >> 6;', 'this.maxEy = (this.maxEy + 62) >> 6;')
m('raster.ts', 'cell: a cell right of the band is not clamped', 'if (x > this.countEx) x = this.countEx;', '', 'setCell already clamps ex to maxEx, so findCell never sees x above countEx')
m('raster.ts', 'cell: a cell right of the bitmap is not clamped', 'if (ex > this.maxEx) ex = this.maxEx;\n    ex -= this.minEx;', 'ex -= this.minEx;', 'the outline is translated to the bottom left of its control box and the bitmap is as wide as that box (rounded up), so no point is right of the last column')
m('raster.ts', 'cell: the start cell is clamped to the band on the left', 'if (ex < this.minEx) ex = this.minEx - 1;', 'if (ex < this.minEx) ex = this.minEx;', 'the outline is translated to the bottom left of its cbox, so no point is left of minEx = 0')
m('raster.ts', 'cell: a cell is recorded with its area only', 'this.cellCover[c] = (this.cellCover[c]! + this.cover) | 0;', '')
m('raster.ts', 'render: a contour table that stops short is drawn', 'if (outline.nPoints !== outline.contours[outline.nContours - 1]! + 1) return FtErr.Invalid_Outline;', '')
m('raster.ts', 'render: the rows of cells are not emptied between glyphs', 'this.ycells.fill(-1, 0, this.ycount);', '')
m('raster.ts', 'render: the last cell of a contour is not recorded', 'const error = outlineDecompose(outline, funcs);\n    this.recordCell();', 'const error = outlineDecompose(outline, funcs);')
m('raster.ts', 'render: the cell of a new contour is not recorded', 'moveTo: (x: number, y: number): number => {\n        this.recordCell();', 'moveTo: (x: number, y: number): number => {')
m('raster.ts', 'render: the bitmap is written bottom-up from the wrong row', 'if (map.pitch >= 0) rowStart += (map.rows - 1) * map.pitch;', 'if (map.pitch >= 0) rowStart += map.rows * map.pitch;')
# ---- glyph.ts: tt_loader (ttgload.c) and FT_Load_Glyph
m('glyph.ts', 'hint: the origin is floored, not rounded', 'origin = (pixRound(origin) - origin) | 0;', 'origin = (pixFloor(origin) - origin) | 0;')
m('glyph.ts', 'hint: the origin is not moved', 'if (origin) translateArray(n, cur, 0, origin, 0);', '')
m('glyph.ts', 'hint: the advance phantom point is not rounded', 'cur[2 * (n - 3)] = pixRound(cur[2 * (n - 3)]!);', '')
m('glyph.ts', 'hint: the vertical phantom point is not rounded', 'cur[2 * (n - 1) + 1] = pixRound(cur[2 * (n - 1) + 1]!);', '')
m('glyph.ts', 'hint: the original points are not saved', 'if (nIns > 0) zone.org.set(cur.subarray(0, 2 * n));', '')
m('glyph.ts', 'hint: the scan mode goes to another bit', '(exec.GS.scanType << 5) & 0xff', '(exec.GS.scanType << 4) & 0xff')
m('glyph.ts', 'hint: the glyph program runs without its graphics state', 'exec.GS = cloneGraphicsState(L.size.GS);', '')
m('glyph.ts', 'hint: a composite takes the unscaled points as the originals', 'zone.orus.set(cur.subarray(0, 2 * n));', '')
m('glyph.ts', 'metrics: the device advance is in 1/32 pixels', 'if (w >= 0) glyph.metrics.horiAdvance = w << 6;', 'if (w >= 0) glyph.metrics.horiAdvance = w << 5;')
m('glyph.ts', 'metrics: the width', 'glyph.metrics.width = (bbox.xMax - bbox.xMin) | 0;', 'glyph.metrics.width = (bbox.xMax + bbox.xMin) | 0;')
m('glyph.ts', 'metrics: the height', 'glyph.metrics.height = (bbox.yMax - bbox.yMin) | 0;', 'glyph.metrics.height = (bbox.yMax + bbox.yMin) | 0;')
m('glyph.ts', 'metrics: the vertical advance of a font without vertical metrics', 'advance = face.os2.sTypoAscender - face.os2.sTypoDescender;', 'advance = face.os2.sTypoAscender + face.os2.sTypoDescender;')
m('glyph.ts', 'metrics: the vertical bearing', 'top = Math.trunc((advance - height) / 2) | 0;', 'top = Math.trunc((advance + height) / 2) | 0;')
m('glyph.ts', 'metrics: the vertical bearing X', 'glyph.metrics.vertBearingX = (glyph.metrics.horiBearingX - (Math.trunc(glyph.metrics.horiAdvance / 2) | 0)) | 0;', 'glyph.metrics.vertBearingX = glyph.metrics.horiBearingX;')
m('glyph.ts', 'grid fit: the bottom is ceiled', 'bottom = pixFloor((m.horiBearingY - m.height) | 0);', 'bottom = pixCeil((m.horiBearingY - m.height) | 0);')
m('glyph.ts', 'grid fit: the left bearing is rounded', 'm.horiBearingX = pixFloor(m.horiBearingX);\n    m.horiBearingY = pixCeil(m.horiBearingY);\n    m.width = (right - m.horiBearingX) | 0;', 'm.horiBearingX = pixRound(m.horiBearingX);\n    m.horiBearingY = pixCeil(m.horiBearingY);\n    m.width = (right - m.horiBearingX) | 0;')
m('glyph.ts', 'grid fit: the top bearing is floored', 'm.horiBearingY = pixCeil(m.horiBearingY);\n    m.width = (right - m.horiBearingX) | 0;', 'm.horiBearingY = pixFloor(m.horiBearingY);\n    m.width = (right - m.horiBearingX) | 0;')
m('glyph.ts', 'grid fit: the right edge is rounded', 'right = pixCeil((m.horiBearingX + m.width) | 0);', 'right = pixRound((m.horiBearingX + m.width) | 0);')
m('glyph.ts', 'grid fit: the advance is floored', 'm.horiAdvance = pixRound(m.horiAdvance);', 'm.horiAdvance = pixFloor(m.horiAdvance);')
m('glyph.ts', 'grid fit: an unhinted glyph is grid fitted', 'if (!(loadFlags & FT_LOAD.NO_HINTING)) gridFitMetrics(slot,', 'if (true) gridFitMetrics(slot,')
m('glyph.ts', 'load: HIGH_PRECISION up to 29 ppem', 'size.metrics.yPpem < 24', 'size.metrics.yPpem < 30')
m('glyph.ts', 'load: the linear advance is scaled by 65 / 64', 'slot.linearHoriAdvance = mulDiv(slot.linearHoriAdvance, m.xScale, 64);', 'slot.linearHoriAdvance = mulDiv(slot.linearHoriAdvance, m.xScale, 65);')
m('glyph.ts', 'load: the advance is the vertical one', 'slot.advance.x = slot.metrics.horiAdvance;', 'slot.advance.x = slot.metrics.vertAdvance;')
m('glyph.ts', 'load: the glyph is not checked', 'error = outlineCheck(slot.outline);\n    if (error) return error;', '', "FT_Outline_Check cannot fail on what the TrueType loader makes: a simple glyph with contours has at least one point and its contour ends are strictly increasing (the loader refuses others), the last one is the last point, and a composite shifts its components' ends by the points before them")
m('glyph.ts', 'simple glyph: the repeat flag is another bit', 'if (c & 8) {', 'if (c & 16) {')
m('glyph.ts', 'simple glyph: the x sign flag', 'if ((f & 16) === 0) y = -y;', 'if ((f & 16) !== 0) y = -y;')
m('glyph.ts', 'simple glyph: the y sign flag', 'if ((f & 32) === 0) y = -y;', 'if ((f & 32) !== 0) y = -y;')
m('glyph.ts', 'simple glyph: the on-curve flag is kept with the others', 'tags[pt0 + i] = f & TAG_ON;', 'tags[pt0 + i] = f & 7;')
m('glyph.ts', 'simple glyph: the instructions are loaded for an unhinted glyph too', 'if (isHinted(L.loadFlags)) {\n    L.glyph.controlLen = nIns;', 'if (true) {\n    L.glyph.controlLen = nIns;')
m('glyph.ts', 'simple glyph: the scaled points are not scaled', 'pts[2 * (pt0 + i)] = mulFix(pts[2 * (pt0 + i)]!, xScale);', 'pts[2 * (pt0 + i)] = pts[2 * (pt0 + i)]!;')
m('glyph.ts', 'composite: the offset is scaled by the y scale', 'x = mulFix(x, L.size.scaled.xScale);', 'x = mulFix(x, L.size.scaled.yScale);', 'the exe only requests square sizes: xScale == yScale')
m('glyph.ts', 'composite: the offset is not rounded to the grid', 'if (sg.flags & ROUND_XY_TO_GRID) {\n        x = pixRound(x);', 'if (false) {\n        x = pixRound(x);')
m('glyph.ts', 'composite: matched points are added, not subtracted', 'x = (baseVec[2 * k]! - baseVec[2 * l]!) | 0;', 'x = (baseVec[2 * k]! + baseVec[2 * l]!) | 0;')
m('glyph.ts', 'composite: the transform is applied to the whole glyph', 'for (let i = numBasePoints; i < numPoints; i++) vectorTransform', 'for (let i = 0; i < numPoints; i++) vectorTransform')
m('glyph.ts', 'composite: USE_MY_METRICS is inverted', 'if (!(sg.flags & USE_MY_METRICS)) {', 'if (sg.flags & USE_MY_METRICS) {')
m('glyph.ts', 'composite: the scaled offset uses the Mac scale', 'const macXScale = sqrtFixed((mulFix(sg.xx, sg.xx) | 0) + (mulFix(sg.xy, sg.xy) | 0));', 'const macXScale = sqrtFixed((mulFix(sg.xx, sg.xx) | 0) + (mulFix(sg.yx, sg.yx) | 0));')
m('glyph.ts', 'composite: the component instructions are read from another place', 'const nIns = b.u16(L.insPos);', 'const nIns = b.u16(L.insPos + 2);')
# ---- bytecode.ts / loader init: tt_size_run_fpgm / prep, tt_loader_init
m('bytecode.ts', 'prep: the graphics state it leaves is not kept', 'size.GS = { ...e.GS, dualVector', 'size.GS = { ...newDefaultGraphicsState(), dualVector')
m('bytecode.ts', 'size: the cvt is not scaled', 'size.cvt[i] = mulFix(face.cvt[i]!, size.ttmetrics.scale);', 'size.cvt[i] = face.cvt[i]!;')
m('bytecode.ts', 'size: the cvt is scaled by the wrong factor', 'size.cvt[i] = mulFix(face.cvt[i]!, size.ttmetrics.scale);', 'size.cvt[i] = mulFix(face.cvt[i]!, size.ttmetrics.scale - 256);')
m('bytecode.ts', 'size: the twilight zone is not cleared', 'tw.org[2 * i] = 0;', 'tw.org[2 * i] = 1;')
m('bytecode.ts', 'size: the storage is not cleared', 'size.storage.fill(0);', '')
m('bytecode.ts', 'fpgm: the font program is not run', 'if (!error) error = e.runIns();\n  }\n  if (!error) e.saveContext(size);', 'if (!error) error = 0;\n  }\n  if (!error) e.saveContext(size);')
m('bytecode.ts', 'prep: the control value program is not run', 'if (!error) error = e.runIns();\n  }\n  size.GS', 'if (!error) error = 0;\n  }\n  size.GS')
m('glyph.ts', 'loader init: the grayscale mode is not compared', 'if (grayscale !== exec.grayscale) {', 'if (false) {')
m('glyph.ts', 'loader init: INSTCTRL bit 1 does not switch hinting off', 'if (exec.GS.instructControl & 1) loadFlags |= FT_LOAD.NO_HINTING;', '')
m('glyph.ts', 'loader init: INSTCTRL bit 2 does not reset the graphics state', 'if (exec.GS.instructControl & 2) exec.GS = newDefaultGraphicsState();', '')
# ---- interp.ts: arithmetic and the most used instructions (every handler is also mutated to a no-op below)
m('interp.ts', 'round to grid: +31', 'val = (distance + compensation + 32) | 0;', 'val = (distance + compensation + 31) | 0;')
m('interp.ts', 'round to grid: a negative distance is ceiled', 'val = -pixRound((compensation - distance) | 0) | 0;', 'val = -pixCeil((compensation - distance) | 0) | 0;')
m('interp.ts', 'round to half grid: +31', 'val = (pixFloor((distance + compensation) | 0) + 32) | 0;', 'val = (pixFloor((distance + compensation) | 0) + 31) | 0;')
m('interp.ts', 'round down to grid: the mask keeps 5 bits', 'val = (distance + compensation) | 0;\n          if (distance && val > 0) val &= ~63;', 'val = (distance + compensation) | 0;\n          if (distance && val > 0) val &= ~31;')
m('interp.ts', 'round up to grid: +62', 'val = (distance + compensation + 63) | 0;', 'val = (distance + compensation + 62) | 0;')
m('interp.ts', 'round up to grid: a negative distance is floored', 'val = -pixCeil((compensation - distance) | 0) | 0;', 'val = -pixFloor((compensation - distance) | 0) | 0;')
m('interp.ts', 'round to double grid: +15', 'val = (distance + compensation + 16) | 0;', 'val = (distance + compensation + 15) | 0;')
m('interp.ts', 'round off: the compensation is not added', 'val = (distance + compensation) | 0;\n      if (distance && val < 0) val = 0;\n    } else {\n      val = (distance - compensation) | 0;', 'val = distance;\n      if (distance && val < 0) val = 0;\n    } else {\n      val = (distance - compensation) | 0;')
m('interp.ts', 'super round: the period mask', 'val = ((distance - this.phase + this.threshold + compensation) & -this.period) | 0;', 'val = ((distance - this.phase + this.threshold + compensation) & -(this.period >> 1)) | 0;')
m('interp.ts', 'tt mulfix14: the rounding half', 'mid = ((mid << 16) + (1 << 13)) >>> 0;', 'mid = ((mid << 16) + (1 << 12)) >>> 0;')
m('interp.ts', 'tt dotfix14: the rounding half', 'l = (lo3 + 0x2000) >>> 0;', 'l = (lo3 + 0x1fff) >>> 0;')
m('interp.ts', 'funcs: the shift of the projection of the free vector', ') >> 14;\n    if (g.projVector.x === 0x4000) this.funcProject', ') >> 13;\n    if (g.projVector.x === 0x4000) this.funcProject')
m('interp.ts', 'funcs: a nearly perpendicular vector is kept', 'if (abs(this.FdotP) < 0x400) this.FdotP = 0x4000;', 'if (abs(this.FdotP) < 0x3ff) this.FdotP = 0x4000;')
m('interp.ts', 'normalize: a short vector is scaled by 0x80', 'vx = Math.imul(vx, 0x100);', 'vx = Math.imul(vx, 0x80);')
m('interp.ts', 'normalize: the x of a long vector', 'vx = ttDivFix14(vx, w);\n    vy = ttDivFix14(vy, w);\n    w =', 'vx = ttDivFix14(vy, w);\n    vy = ttDivFix14(vy, w);\n    w =', 'the exe computes a unit vector from a vector of 0x10000 or more only for SPVFS / SFVFS with big arguments, which no glyph of the shipped fonts executes')
m('interp.ts', 'move: a move along x marks the point as touched in y', 'zone.cur[2 * point] = (zone.cur[2 * point]! + distance) | 0;\n        zone.tags[point]! |= TOUCH_X;', 'zone.cur[2 * point] = (zone.cur[2 * point]! + distance) | 0;\n        zone.tags[point]! |= TOUCH_Y;')
m('interp.ts', 'move: a move along y is made along x', 'zone.cur[2 * point + 1] = (zone.cur[2 * point + 1]! + distance) | 0;\n        zone.tags[point]! |= TOUCH_Y;', 'zone.cur[2 * point] = (zone.cur[2 * point]! + distance) | 0;\n        zone.tags[point]! |= TOUCH_Y;')
m('interp.ts', 'MDRP: the original distance is projected with the projection vector', 'if (this.GS.gep0 === 0 || this.GS.gep1 === 0) orgDist', 'if (this.GS.gep0 === 0 && this.GS.gep1 === 0) orgDist')
m('interp.ts', 'MDRP: the distance of scaled original points is not scaled', 'orgDist = this.dualProjectPts(v1, point, v2, rp0);\n          orgDist = mulFix(orgDist, this.metrics.xScale);', 'orgDist = this.dualProjectPts(v1, point, v2, rp0);')
m('interp.ts', 'MDRP: a negative distance gets a positive minimum', "} else if (distance > -minimumDistance) distance = -minimumDistance | 0;\n      }\n      orgDist = this.projectPts(", "} else if (distance > -minimumDistance) distance = minimumDistance | 0;\n      }\n      orgDist = this.projectPts(")
m('interp.ts', 'MDRP: the rounding bit is inverted', 'if ((this.opcode & 4) !== 0) distance = this.round(orgDist,', 'if ((this.opcode & 4) === 0) distance = this.round(orgDist,')
m('interp.ts', 'MDRP: rp0 is set by the wrong bit', 'this.GS.rp2 = point;\n    if ((this.opcode & 16) !== 0) this.GS.rp0 = point;\n  }\n\n  insMIRP', 'this.GS.rp2 = point;\n    if ((this.opcode & 8) !== 0) this.GS.rp0 = point;\n  }\n\n  insMIRP')
m('interp.ts', 'MIRP: auto flip tests the wrong sign', 'if ((orgDist ^ cvtDist) < 0) cvtDist = -cvtDist | 0;', 'if ((orgDist ^ cvtDist) > 0) cvtDist = -cvtDist | 0;')
m('interp.ts', 'MIRP: the cut-in is inverted', 'if (abs((cvtDist - orgDist) | 0) > controlValueCutin) cvtDist = orgDist;', 'if (abs((cvtDist - orgDist) | 0) < controlValueCutin) cvtDist = orgDist;')
m('interp.ts', 'MIRP: the cvt entry is read one off', 'else cvtDist = this.readCvt(cvtEntry - 1);', 'else cvtDist = this.readCvt(cvtEntry);')
m('interp.ts', 'IUP: untouched points are the ones skipped', 'while (point <= endPoint && (pts.tags[point]! & mask) === 0) point++;', 'while (point <= endPoint && (pts.tags[point]! & mask) !== 0) point++;')
m('interp.ts', 'IUP: x touches are tested with the y mask', 'if (this.opcode & 1) {\n      mask = TOUCH_X;\n      off = 0;', 'if (this.opcode & 1) {\n      mask = TOUCH_Y;\n      off = 0;')
m('interp.ts', 'DELTAP: a positive step is not shifted past zero', 'if (B >= 0) B++;\n          B = idiv(Math.imul(B, 64), 1 << this.GS.deltaShift);\n          this.move(this.zp0, A, B);', 'B = idiv(Math.imul(B, 64), 1 << this.GS.deltaShift);\n          this.move(this.zp0, A, B);')
m('interp.ts', 'DELTAP: the step is scaled by the wrong shift', 'B = idiv(Math.imul(B, 64), 1 << this.GS.deltaShift);\n          this.move(this.zp0, A, B);', 'B = idiv(Math.imul(B, 64), 1 << (this.GS.deltaShift + 1));\n          this.move(this.zp0, A, B);')
m('interp.ts', 'DELTAP: the second range starts at 15', 'case 0x71:\n            C += 16;', 'case 0x71:\n            C += 15;')
m('interp.ts', 'DELTAP: the third range starts at 31', 'case 0x72:\n            C += 32;', 'case 0x72:\n            C += 31;')
m('interp.ts', 'run: an instruction past the code is not an error', 'if (this.IP + this.length > this.codeSize) return this.codeOverflow();', '')
m('interp.ts', 'run: too few arguments are tolerated even when pedantic', 'if (this.pedanticHinting) {\n          this.error = FtErr.Too_Few_Arguments;\n          return this.errorExit();\n        }', '')
m('interp.ts', 'run: a failed program does not invalidate the cvt', "if (this.error && !this.instructionTrap) this.size!.cvtReady = false;", "if (false) this.size!.cvtReady = false;")


def handler_mutants():
    """one mutant per instruction handler of interp.ts: the handler returns at once"""
    src = open(path_of('interp.ts')).read()
    out = []
    for mo in re.finditer(r'^  (ins[A-Z][A-Za-z0-9]*)\((_?a): number\): void \{\n', src, re.M):
        name = mo.group(1)
        head = mo.group(0)
        out.append(('interp.ts', f'{name}: the handler does nothing', head, head + '    return;\n', ''))
    return out


PICKS = os.path.join(ROOT, 'tools/ft-picks.json')
WORK = '/tmp/ftmut'


def pick_mode(mutants, names, every, only=None, log=None):
    import json, shutil
    from concurrent.futures import ThreadPoolExecutor
    chosen = [mu for mu in mutants if (names and any(p in mu[1] for p in names)) or (not names and (every or not mu[4]))]
    if only:
        chosen = [mu for mu in chosen if mu[0] in only]
    if log:
        # the survivors of an earlier run (the log of `python3 tools/mutate-freetype.py`)
        gone = {m_.group(1) + ': ' + m_.group(2) for m_ in (re.match(r'SURVIVED  (\S+): (.*?)(   |$)', ln) for ln in open(log)) if m_ and '<-- not expected' in m_.string}
        chosen = [mu for mu in chosen if mu[0] + ': ' + mu[1] in gone]
    for i in (0, 1):
        shutil.rmtree(f'{WORK}/w{i}', ignore_errors=True)
    lock = __import__('threading').Lock()
    free = [0, 1]
    found = {}

    def one(mu):
        f, name, a, b, why = mu
        with lock:
            w = free.pop()
        try:
            d = f'{WORK}/w{w}'
            shutil.rmtree(d, ignore_errors=True)
            shutil.copytree(os.path.join(ROOT, SRC), d + '/src')
            path = f'{d}/src/{f}'
            text = open(path).read()
            assert text.count(a) == 1, name
            open(path, 'w').write(text.replace(a, b, 1))
            r = subprocess.run([BUN, 'run', 'tools/ft-kill-pick.ts', '--pkg', d, '--baseline', f'{WORK}/base', '--flags', '8,10', '--limit', '2'], cwd=ROOT, capture_output=True, text=True, timeout=1800)
            line = r.stdout.strip().splitlines()[-1] if r.stdout.strip() else ''
            try:
                res = json.loads(line)
            except Exception:
                res = {'error': (r.stderr or r.stdout)[-300:]}
            with lock:
                found[name] = res
                if res.get('picks'):
                    print(f'PICK   {f}: {name}: ' + ' '.join(f"{p['file']}#{p['face']}@{p['size']}/{p['flags']}:g{p['glyph']}" for p in res['picks']), flush=True)
                elif res.get('stateful'):
                    st = res['stateful']
                    print(f'STATE  {f}: {name}: only after other loads ({st["count"]}{"+" if st["count"] >= 200 else ""} differences, first {st["first"]["file"]}#{st["first"]["face"]}@{st["first"]["size"]}/{st["first"]["flags"]}:g{st["first"]["glyph"]})', flush=True)
                elif res.get('none'):
                    print(f'NONE   {f}: {name}: no glyph of the pool differs ({res["loads"]:,} loads)' + (f'   (expected: {why})' if why else ''), flush=True)
                else:
                    print(f'ERROR  {f}: {name}: {res}', flush=True)
        finally:
            with lock:
                free.append(w)

    with ThreadPoolExecutor(max_workers=2) as ex:
        list(ex.map(one, chosen))
    old = json.load(open(PICKS)) if os.path.exists(PICKS) else []
    seen = {(p['file'], p['face'], p['size'], p['glyph'], p['flags']) for p in old}
    for res in found.values():
        for p in res.get('picks', []):
            k = (p['file'], p['face'], p['size'], p['glyph'], p['flags'])
            if k not in seen:
                seen.add(k)
                old.append(p)
    old.sort(key=lambda p: (p['file'], p['face'], p['flags'], p['size'], p['glyph']))
    # one pick per line: a diff of the file then shows the picks a run added
    with open(PICKS, 'w') as fh:
        fh.write('[\n' + ',\n'.join('  ' + json.dumps(p, separators=(', ', ': ')) for p in old) + '\n]\n')
    none = [n for n, r in found.items() if r.get('none')]
    print(f'{len(chosen)} mutants: {sum(1 for r in found.values() if "picks" in r)} with picks, {len(none)} without ({len(old)} picks in {os.path.relpath(PICKS, ROOT)})')
    return 0


def limits():
    resource.setrlimit(resource.RLIMIT_AS, (8 * 2**30, 8 * 2**30))


def main():
    args = sys.argv[1:]
    mutants = M + handler_mutants()
    if '--list' in args:
        for f, name, a, b, why in mutants:
            print(f'{f:12s} {name}' + (f'   [survives: {why}]' if why else ''))
        print(f'{len(mutants)} mutants')
        return 0
    pick = [a for a in args if not a.startswith('--')]
    for a in args:
        if a.startswith('--survivors='):
            # only the mutants that survived in an earlier run (its log): to see which a new test now kills
            gone = {m_.group(1) + ': ' + m_.group(2) for m_ in (re.match(r'SURVIVED  (\S+): (.*?)(   |$)', ln) for ln in open(a.split('=', 1)[1])) if m_}
            mutants = [mu for mu in mutants if mu[0] + ': ' + mu[1] in gone]
    if '--pick' in args:
        opts = {a.split('=')[0]: a.split('=', 1)[1] for a in args if a.startswith('--') and '=' in a}
        return pick_mode(mutants, pick, '--all' in args, set(opts['--files'].split(',')) if '--files' in opts else None, opts.get('--from-log'))
    sources = {}
    errors = []
    for f, name, a, b, why in mutants:
        path = path_of(f)
        if path not in sources:
            sources[path] = open(path).read()
        if sources[path].count(a) != 1:
            errors.append(f'anchor found {sources[path].count(a)} times: {f}: {name}')
        if a == b:
            errors.append(f'no change: {name}')
    if errors:
        print('\n'.join(errors))
        return 2
    if '--check' in args:
        print(f'{len(mutants)} mutants, every anchor occurs exactly once')
        return 0
    bad = survived = run = stale = 0
    try:
        for f, name, a, b, why in mutants:
            if pick and not any(p in name for p in pick):
                continue
            path = path_of(f)
            orig = sources[path]
            open(path, 'w').write(orig.replace(a, b, 1))
            try:
                r = subprocess.run([BUN, 'test', *TESTS], cwd=ROOT, capture_output=True, text=True, timeout=60, preexec_fn=limits)
                killed = r.returncode != 0
            except subprocess.TimeoutExpired:
                killed = True
            finally:
                open(path, 'w').write(orig)
            run += 1
            if killed:
                if why:
                    # a reason to survive that no longer holds is out of date (a new test, a new picked glyph): say so
                    stale += 1
                    print(f'killed    {f}: {name}   <-- its reason to survive is out of date: {why}', flush=True)
                else:
                    print(f'killed    {f}: {name}', flush=True)
            else:
                survived += 1
                if why:
                    print(f'SURVIVED  {f}: {name}   (expected: {why})', flush=True)
                else:
                    bad += 1
                    print(f'SURVIVED  {f}: {name}   <-- not expected', flush=True)
    finally:
        for path, orig in sources.items():
            open(path, 'w').write(orig)
    print(f'{run} mutants: {run - survived} killed, {survived} survived ({survived - bad} expected, {bad} not)' + (f'; {stale} killed that were expected to survive' if stale else ''))
    return 1 if bad or stale else 0


if __name__ == '__main__':
    sys.exit(main())
