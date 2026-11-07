import { beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { KomArchive, fileSource } from "@els/kom";
import { FtFace, setCharSize } from "../src/index.ts";
import { compactGlyph, faceInfo, indicesDigest, portCalc, portEmbolden, portGlyph, portRaster, sizeInfo, type CalcKind } from "./probe.ts";

/**
 * Replays fixtures/oracle.json: what x2.exe's own FreeType 2.4.11 answered (tools/oracle-freetype.py runs its machine code under the Unicorn emulator;
 * `tools/verify-freetype.ts --record` wrote the file) against the port.  Rule 3b of docs/PORTING_RULES.md: the exe's code is the expectation, so the values
 * are not derived from the port.  tools/verify-freetype.ts runs the same comparison live and over far larger corpora.
 */
const fx = JSON.parse(readFileSync(join(import.meta.dir, "fixtures/oracle.json"), "utf8"));
const dataDir = join(import.meta.dir, "../../../data");

async function fontBytes(file: string): Promise<Uint8Array> {
  if (file.startsWith("kom:")) {
    const [, komFile, name] = file.split(":");
    const kom = await KomArchive.open(fileSource(join(dataDir, komFile!)));
    const entry = kom.entries.find((e) => e.name.toLowerCase() === name)!;
    return await kom.read(entry);
  }
  return new Uint8Array(readFileSync(join(dataDir, file)));
}

const faces = new Map<string, FtFace>();
beforeAll(async () => {
  for (const [name, spec] of Object.entries<any>(fx.fonts)) faces.set(name, FtFace.open(await fontBytes(spec.file), spec.face));
});

const same = (a: unknown, b: unknown): boolean => Bun.deepEquals(a, b, true);

describe("the exe's FreeType, recorded", () => {
  test("the fixture has the sizes it is meant to", () => {
    expect(Object.keys(fx.fonts).length).toBe(9);
    expect(fx.glyphs.length).toBeGreaterThan(700);
    expect(fx.chars.length).toBe(9);
    expect(fx.raster.length).toBe(109);
    expect(fx.embolden.length).toBe(192);
    expect(fx.calc.length).toBe(7);
  });

  test("face info", () => {
    const bad: string[] = [];
    for (const [name, rec] of Object.entries<any>(fx.faces)) if (!same(faceInfo(faces.get(name)!), rec.info)) bad.push(name);
    expect(bad).toEqual([]);
  });

  test("size metrics at 13 / 15 / 17 / 28 px", () => {
    const bad: string[] = [];
    let n = 0;
    for (const [name, rec] of Object.entries<any>(fx.faces)) {
      const face = faces.get(name)!;
      for (const [size, s] of Object.entries<any>(rec.sizes)) {
        expect(setCharSize(face, Number(size) << 6, 0, 72, 72)).toBe(0);
        n++;
        if (!same(sizeInfo(face), s.metrics)) bad.push(`${name}@${size}`);
      }
    }
    expect(n).toBe(36);
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
      if (face.getCharIndex(g.code) !== g.glyph) bad.push(`${g.font} U+${g.code.toString(16)}: char index`);
      const got = compactGlyph(portGlyph(face, g.glyph, g.flags, g.render, true));
      if (!same(got, g.expect)) bad.push(`${g.font}@${g.size} flags ${g.flags} glyph ${g.glyph}`);
      if (g.flags === 8) hinted++;
    }
    expect(hinted).toBeGreaterThan(300);
    expect(bad).toEqual([]);
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
