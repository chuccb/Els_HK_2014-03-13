#!/usr/bin/env python3
"""Mutation check of the MPEG-1 decoder: apply one small change at a time to packages/assets/src/mpeg1.ts or mpeg1-tables.ts, run
packages/assets/test/mpeg1.test.ts and report whether a test notices (KILLED) or not (SURVIVED).  40 mutants: the oddification
(mismatch control), the dequantiser shifts, the rounding of the half-pel and bidirectional averages, the chroma vector rounding, the
predictor resets (DC, forward / backward vectors; slice start, skipped and intra macroblocks), address escapes, level escapes, the
zigzag, reference order and single entries of the VLC / matrix tables (FINDINGS section 13.3).

    python3 tools/mutate-mpeg1.py [substring of a mutant name ...]

The sources are restored after every mutant (also on Ctrl-C), but do not run it with uncommitted edits in those two files you cannot
afford to lose.  Needs `bun` in ./node_modules/.bin (no GPU); about a minute.  Exit code 1 if a mutant survives.
"""
import os, re, subprocess, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'packages/assets/src/mpeg1.ts')
TAB = os.path.join(ROOT, 'packages/assets/src/mpeg1-tables.ts')
orig=open(SRC).read(); orig_tab=open(TAB).read()
M=[
 ("no oddification", SRC, "      if (v !== 0 && (v & 1) === 0) v--; // mismatch control: every coefficient is odd", "      // none"),
 ("intra shift 4", SRC, "(level * qs * matrix[i]!) >> 3", "(level * qs * matrix[i]!) >> 4"),
 ("inter without +1", SRC, "(((level << 1) + 1) * qs * matrix[i]!) >> 4", "(((level << 1)) * qs * matrix[i]!) >> 4"),
 ("chroma mv floor", SRC, "const cfx = (fx / 2) | 0, cfy = (fy / 2) | 0, cbx = (bx / 2) | 0, cby = (by / 2) | 0;", "const cfx = fx >> 1, cfy = fy >> 1, cbx = bx >> 1, cby = by >> 1;"),
 ("halfpel x no rounding", SRC, "else if (hx && !hy) for (let c = 0; c < size; c++, o++) out[q++] = (ref[o]! + ref[o + 1]! + 1) >> 1;", "else if (hx && !hy) for (let c = 0; c < size; c++, o++) out[q++] = (ref[o]! + ref[o + 1]!) >> 1;"),
 ("halfpel y no rounding", SRC, "else if (!hx && hy) for (let c = 0; c < size; c++, o++) out[q++] = (ref[o]! + ref[o + stride]! + 1) >> 1;", "else if (!hx && hy) for (let c = 0; c < size; c++, o++) out[q++] = (ref[o]! + ref[o + stride]!) >> 1;"),
 ("halfpel xy rounding 1", SRC, "ref[o + stride + 1]! + 2) >> 2;", "ref[o + stride + 1]! + 1) >> 2;"),
 ("bidirectional no rounding", SRC, "(this.tmp[r * size + c]! + this.tmp2[r * size + c]! + 1) >> 1", "(this.tmp[r * size + c]! + this.tmp2[r * size + c]!) >> 1"),
 ("mv no wrap", SRC, "if (v < -16 * f) v += 32 * f; else if (v > 16 * f - 1) v -= 32 * f;", ""),
 ("skipped B always forward", SRC, "this.predict(p, mbx, mby, flags || MB_FORWARD, this.mvF[0]!, this.mvF[1]!, this.mvB[0]!, this.mvB[1]!);", "this.predict(p, mbx, mby, MB_FORWARD, this.mvF[0]!, this.mvF[1]!, this.mvB[0]!, this.mvB[1]!);"),
 ("no dc reset on non-intra", SRC, "    } else {\n      this.dcPred[0] = this.dcPred[1] = this.dcPred[2] = 128;\n      if (p.type === 2) this.predict", "    } else {\n      if (p.type === 2) this.predict"),
 ("no dc reset on skipped", SRC, "    this.dcPred[0] = this.dcPred[1] = this.dcPred[2] = 128;\n    const mbx = addr % this.mbW, mby = (addr / this.mbW) | 0;\n    this.stats.skipped++;", "    const mbx = addr % this.mbW, mby = (addr / this.mbW) | 0;\n    this.stats.skipped++;"),
 ("no dc reset at slice start", SRC, "    this.dcPred[0] = this.dcPred[1] = this.dcPred[2] = 128;\n    this.mvF[0] = this.mvF[1] = this.mvB[0] = this.mvB[1] = 0;\n    this.prevFlags = 0;", "    this.mvF[0] = this.mvF[1] = this.mvB[0] = this.mvB[1] = 0;\n    this.prevFlags = 0;"),
 ("no mv reset at slice start", SRC, "    this.dcPred[0] = this.dcPred[1] = this.dcPred[2] = 128;\n    this.mvF[0] = this.mvF[1] = this.mvB[0] = this.mvB[1] = 0;\n    this.prevFlags = 0;", "    this.dcPred[0] = this.dcPred[1] = this.dcPred[2] = 128;\n    this.prevFlags = 0;"),
 ("qscale not updated by MB_QUANT", SRC, "      this.qscale = br.read(5);\n      if (this.qscale === 0) throw new Mpeg1Error(\"quantiser_scale 0\");\n      st.quantChanges++;", "      br.read(5);\n      st.quantChanges++;"),
 ("no intra mv reset", SRC, "      cbp = 63;\n      this.mvF[0] = this.mvF[1] = this.mvB[0] = this.mvB[1] = 0;", "      cbp = 63;"),
 ("P no-vector keeps predictor", SRC, "else if (p.type === 2) this.mvF[0] = this.mvF[1] = 0; // P without a vector: zero, and the predictor is reset", "// kept"),
 ("full-pel ignored", SRC, "fx = this.mvF[0]! * (p.fullPelF ? 2 : 1); fy = this.mvF[1]! * (p.fullPelF ? 2 : 1);", "fx = this.mvF[0]!; fy = this.mvF[1]!;"),
 ("backward full-pel ignored", SRC, "bx = this.mvB[0]! * (p.fullPelB ? 2 : 1); by = this.mvB[1]! * (p.fullPelB ? 2 : 1);", "bx = this.mvB[0]!; by = this.mvB[1]!;"),
 ("address escape 32", SRC, "incr += 33; this.stats.addrEscapes++;", "incr += 32; this.stats.addrEscapes++;"),
 ("slice first increment ignored", SRC, "if (first) addr += incr - 1; // the slice starts further right", "if (first) addr += 0;"),
 ("no inter first-coefficient shortcut", SRC, "if (first && !intra && br.peek(1) === 1) {", "if (false) {"),
 ("dc diff sign", SRC, "if (!(diff & (1 << (size - 1)))) diff -= (1 << size) - 1;", "if (!(diff & (1 << (size - 1)))) diff = -diff;"),
 ("escape 128 branch", SRC, "else if (level === 128) level = br.read(8) - 256;", "else if (level === 128) level = -128;"),
 ("escape >128 branch", SRC, "else if (level > 128) level -= 256;", ""),
 ("held reference output immediately", SRC, "    if (this.held) out.push(this.held);\n    this.held = p.frame;", "    out.push(p.frame);\n    this.held = null;"),
 ("B uses swapped refs", SRC, "const forward = type === 2 ? this.refNew : type === 3 ? this.refOld : null;\n    const backward = type === 3 ? this.refNew : null;", "const forward = type === 2 ? this.refNew : type === 3 ? this.refNew : null;\n    const backward = type === 3 ? this.refOld : null;"),
 ("zero weight idct W3", SRC, "const W1 = 22725, W2 = 21407, W3 = 19266,", "const W1 = 22725, W2 = 21407, W3 = 19267,"),
 ("idct column rounding", SRC, "((1 << (COL_SHIFT - 1)) / W4 | 0)", "0"),
 ("intra dc x4", SRC, "b[0] = this.dcPred[comp]! * 8;", "b[0] = this.dcPred[comp]! * 4;"),
 ("clamp 2047 -> 1023", SRC, "b[ZIGZAG[i]!] = v < -2048 ? -2048 : v > 2047 ? 2047 : v;", "b[ZIGZAG[i]!] = v < -1024 ? -1024 : v > 1023 ? 1023 : v;"),
 ("cbp bit order", SRC, "if (!(cbp & (32 >> i))) continue;", "if (!(cbp & (1 << i))) continue;"),
 ("chroma DC table", SRC, "const size = br.vlc(index < 4 ? VLC_DC_LUMA : VLC_DC_CHROMA);", "const size = br.vlc(VLC_DC_LUMA);"),
 ("zigzag", SRC, "z.push(y * 8 + x);", "z.push(x * 8 + y);"),
 ("table: run/level entry", TAB, "[0xa, 10, 0, 7]", "[0xa, 10, 0, 8]"),
 ("table: mb type P", TAB, "[2, 5, MB_QUANT | MB_FORWARD | MB_PATTERN]", "[2, 5, MB_QUANT | MB_FORWARD]"),
 ("table: mv code", TAB, "[0x3, 6]", "[0x2, 6]"),
 ("table: cbp entry", TAB, "[0xb, 5],", "[0xc, 5],"),
 ("table: B type", TAB, "[2, 3, MB_BACKWARD]", "[2, 3, MB_FORWARD]"),
 ("table: default intra matrix", TAB, "8, 16, 19, 22, 26, 27, 29, 34,", "8, 16, 19, 22, 26, 27, 29, 35,"),
]
only = sys.argv[1:] 
res=[]
for name, path, old, new in M:
    if only and not any(o in name for o in only): continue
    txt = orig if path==SRC else orig_tab
    if old not in txt:
        print("MISSING", name); continue
    mut = txt.replace(old, new, 1)
    open(path,'w').write(mut)
    try:
        r = subprocess.run(['./node_modules/.bin/bun','test','packages/assets/test/mpeg1.test.ts'], cwd=ROOT, capture_output=True, text=True, timeout=120)
        out = r.stdout + r.stderr
        m = re.search(r'(\d+) fail', out)
        failed = int(m.group(1)) if m else 0
        if r.returncode != 0 and not m: failed = -1
        res.append((name, failed))
        print(("KILLED  " if failed else "SURVIVED"), name, failed, flush=True)
    finally:
        open(SRC,'w').write(orig); open(TAB,'w').write(orig_tab)
survivors = [n for n, f in res if f == 0]
print("%d mutants, %d killed, survivors:" % (len(res), len(res) - len(survivors)), survivors)
sys.exit(1 if survivors else 0)
