import { beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FtFace, FtLibrary, setCharSize } from "../src/index.ts";
import { compactGlyph, faceInfo, fontBytes, glyphDigest, indicesDigest, portCalc, portEmbolden, portGlyph, portRaster, sha1, sizeInfo, type CalcKind } from "./probe.ts";
import { synthFont } from "./synth.ts";

/**
 * Replays fixtures/oracle.json: what x2.exe's own FreeType 2.4.11 answered (tools/oracle-freetype.py runs its machine code under the Unicorn emulator;
 * `tools/verify-freetype.ts --record` wrote the file) against the port.  Rule 3b of docs/PORTING_RULES.md: the exe's code is the expectation, so the values
 * are not derived from the port.  tools/verify-freetype.ts runs the same comparison live and over far larger corpora.
 */
const fx = JSON.parse(readFileSync(join(import.meta.dir, "fixtures/oracle.json"), "utf8"));
const dataDir = join(import.meta.dir, "../../../data");

const faces = new Map<string, FtFace>();
beforeAll(async () => {
  for (const [name, spec] of Object.entries<any>(fx.fonts)) faces.set(name, FtFace.open(await fontBytes(dataDir, spec.file), spec.face));
});

const same = (a: unknown, b: unknown): boolean => Bun.deepEquals(a, b, true);

describe("the exe's FreeType, recorded", () => {
  test("the fixture has the sizes it is meant to", () => {
    expect(Object.keys(fx.fonts).length).toBe(9);
    expect(fx.glyphs.length).toBeGreaterThan(700);
    expect(fx.chars.length).toBe(9);
    expect(fx.raster.length).toBe(111);
    expect(fx.embolden.length).toBe(192);
    expect(fx.calc.length).toBe(7);
  });

  test("face info", () => {
    const bad: string[] = [];
    for (const [name, rec] of Object.entries<any>(fx.faces)) if (!same(faceInfo(faces.get(name)!), rec.info)) bad.push(name);
    expect(bad).toEqual([]);
  });

  test("size metrics at 13 / 15 / 17 / 28 px (and at the other sizes the picked glyphs are loaded at)", () => {
    const bad: string[] = [];
    let core = 0;
    for (const [name, rec] of Object.entries<any>(fx.faces)) {
      const face = faces.get(name)!;
      for (const [size, s] of Object.entries<any>(rec.sizes)) {
        expect(setCharSize(face, Number(size) << 6, 0, 72, 72)).toBe(0);
        if ([13, 15, 17, 28].includes(Number(size))) core++;
        if (!same(sizeInfo(face), s.metrics)) bad.push(`${name}@${size}`);
      }
    }
    expect(core).toBe(36);
    expect(bad).toEqual([]);
  });

  test("character index of U+0 .. U+2FFFF", () => {
    for (const c of fx.chars) {
      const face = faces.get(c.font)!;
      const [lo, hi, step] = c.range as number[];
      const got: number[] = [];
      for (let code = lo!; code <= hi!; code += step!) got.push(face.getCharIndex(code));
      const { font, range, ...want } = c;
      expect({ font, ...indicesDigest(got) }).toEqual({ font, ...want });
    }
  });

  test("hinted and unhinted glyphs: loaded, then rendered", () => {
    const bad: string[] = [];
    let job = -1;
    let hinted = 0;
    for (const g of fx.glyphs) {
      const face = faces.get(g.font)!;
      // the oracle sets the size at the start of each job; the interpreter's state (cvt, storage) depends on that history
      if (g.job !== job) {
        job = g.job;
        setCharSize(face, g.size << 6, 0, 72, 72);
      }
      // a glyph picked by number (tools/ft-picks.json) has no character code
      if (g.code !== undefined && face.getCharIndex(g.code) !== g.glyph) bad.push(`${g.font} U+${g.code.toString(16)}: char index`);
      const got = compactGlyph(portGlyph(face, g.glyph, g.flags, g.render, true));
      if (!same(got, g.expect)) bad.push(`${g.font}@${g.size} flags ${g.flags} glyph ${g.glyph}`);
      if (g.flags === 8) hinted++;
    }
    expect(hinted).toBeGreaterThan(300);
    expect(bad).toEqual([]);
  });

  test("synthetic fonts: random glyph programs, composites, an INSTCTRL prep (test/synth.ts), every glyph at 9 / 13 / 22 px", () => {
    // one library for all of them, loaded in the order of the recording: the interpreter's state (cvt, storage, twilight zone, the graphics state the last
    // program left) is shared by every load
    const lib = new FtLibrary();
    const bad: string[] = [];
    let loads = 0;
    for (const font of fx.synth.fonts) {
      const built = synthFont(font.spec);
      expect(sha1(built.bytes)).toBe(font.sha1);
      expect(built.nGlyphs).toBe(font.nGlyphs);
      const face = FtFace.open(built.bytes, 0, lib);
      for (const job of font.jobs) {
        expect(setCharSize(face, job.size << 6, 0, 72, 72)).toBe(0);
        const want = job.digests.split(" ");
        expect(want.length).toBe(font.nGlyphs);
        for (let gi = 0; gi < font.nGlyphs; gi++) {
          loads++;
          if (glyphDigest(portGlyph(face, gi, job.flags, null, true)) !== want[gi]) bad.push(`${font.spec.name}@${job.size} flags 0x${job.flags.toString(16)} glyph ${gi}`);
        }
      }
    }
    expect(loads).toBe(15885);
    expect(bad.slice(0, 20)).toEqual([]);
  });

  test("emboldened bitmaps (FT_Bitmap_Copy + FT_Bitmap_Embolden)", () => {
    const bad: number[] = [];
    fx.embolden.forEach((e: any, i: number) => {
      if (!same(portEmbolden(e.b, e.xstr, e.ystr), e.expect)) bad.push(i);
    });
    expect(bad).toEqual([]);
  });

  test("synthetic outlines through the smooth rasterizer", () => {
    const face = faces.get("MSJH")!;
    setCharSize(face, 16 << 6, 0, 72, 72);
    const bad: number[] = [];
    fx.raster.forEach((r: any, i: number) => {
      if (!same(portRaster(face, r.outline), r.expect)) bad.push(i);
    });
    // the refused outlines are refused the same way: the decomposer's error comes back as 1, a contour table that stops short as FT_Err_Invalid_Outline
    expect(new Set(fx.raster.map((r: any) => r.expect.render_err).filter(Boolean))).toEqual(new Set([1, 0x14]))
    expect(bad).toEqual([]);
  });

  test("integer helpers: MulFix, MulDiv, MulDiv_No_Round, DivFix, SqrtFixed, Vector_Length, Vector_Transform", () => {
    const bad: string[] = [];
    for (const c of fx.calc) {
      c.args.forEach((a: number[], i: number) => {
        if (!same(portCalc(c.kind as CalcKind, a), c.results[i])) bad.push(`${c.kind}(${a.join(", ")})`);
      });
    }
    expect(bad).toEqual([]);
  });
});
