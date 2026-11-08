/**
 * The world the glyph-font tests run in: the three font files `CKTDGFreeTypeFont::Load` looks for (the font itself, `JhengHeiBold`,
 * `GULIM`) installed from a table of members, every glyph a box (testfont.ts) so that the metrics follow from the numbers below.
 *
 * At 16 px (unitsPerEm 1024: 64 font units to the pixel) the glyphs of `MAIN` measure:
 *
 * | glyph | advance | box (px: x, y) | bitmap | bearing X / Y | ascender 13 px, so yOff |
 * |---|---|---|---|---|---|
 * | A | 10 | 1..9, 0..10 | 8 x 10 | 1 / 10 | 3 |
 * | B | 12 | 2..10, -1..11 | 8 x 12 | 2 / 11 | 2 |
 * | space | 6 | none | 0 x 0 | 0 / 0 | 13 |
 * | # | 8 | 1..7, 0..10 | 6 x 10 | 1 / 10 | 3 |
 * | W | 8 | 0..16, 0..5 | 16 x 5 | 0 / 5 | 8 |
 */
import { StringTable } from "@els/assets";
import type { MassFileSource } from "@els/host";
import { CKTDGFreeTypeFont } from "../src/freetypefont.ts";
import { setup } from "./harness.ts";
import { rig } from "./rig.ts";
import { boxFont } from "./testfont.ts";
import type { BoxGlyph } from "./testfont.ts";

const g = (char: string, advance: number, box?: [number, number, number, number]): BoxGlyph => ({ char, advance, box });

/** the font of the tests: ascender 800 (13 px at 16: 832 in 26.6) */
export const MAIN = boxFont({
  ascender: 800,
  descender: -200,
  glyphs: [
    g("A", 640, [64, 0, 576, 640]),
    g("B", 768, [128, -64, 640, 704]),
    g(" ", 384),
    g("#", 512, [64, 0, 448, 640]),
    // wider than its advance: the bitmap (16) is what counts
    g("W", 512, [0, 0, 1024, 320]),
    // wider than a cell (32 px against 18)
    g("M", 640, [0, 0, 2048, 320]),
    // taller than a cell, rising 24 px over the ascender (13)
    g("T", 640, [64, -512, 576, 1536]),
  ],
});

/** `JhengHeiBold`: ascender 700 (11 px at 16: 704): a B of its own (the first face wins) and a C */
export const SUB = boxFont({
  ascender: 700,
  descender: -300,
  glyphs: [g("B", 896, [0, 0, 896, 640]), g("C", 704, [64, 0, 640, 512])],
});

/** `GULIM`: ascender 900 (15 px at 16: 960): a C of its own (the sub face wins) and a D */
export const KOR = boxFont({
  ascender: 900,
  descender: -100,
  glyphs: [g("C", 1024, [0, 0, 1024, 1024]), g("D", 512, [0, 0, 512, 512])],
});

/** the letters a-z, all one box: more characters than the 16 cells of a 120 px font */
export const LETTERS = boxFont({
  ascender: 800,
  descender: -200,
  glyphs: [..."abcdefghijklmnopqrstuvwxyz"].map((c) => g(c, 640, [64, 0, 576, 640])),
});

/** 700 characters (U+0100 ...), all one box: more than the 689 cells of a font whose cell is 19 */
export const HUGE = boxFont({
  ascender: 800,
  descender: -200,
  glyphs: Array.from({ length: 700 }, (_, i) => g(String.fromCharCode(0x100 + i), 640, [64, 0, 576, 640])),
});

export const NOT_A_FONT = new Uint8Array(64).fill(7);

export interface FontFiles {
  /** the bytes of `BOXFONT` (`box.ttf`): undefined = `MAIN`, null = not installed */
  main?: Uint8Array | null;
  /** `JhengHeiBold` (`sub.ttf`): undefined = `SUB` */
  sub?: Uint8Array | null;
  /** `GULIM` (`kor.ttf`): undefined = `KOR` */
  kor?: Uint8Array | null;
}

export interface FontWorldOptions {
  /** draw on the recorder (a 1536 x 1536 back buffer: scale (1.5, 2)); false: no device, scale 1 */
  device?: boolean;
  backBuffer?: { width: number; height: number };
}

/** a world with the three fonts installed (the way `CX2Main::InstallFont` does) and a clock the test sets */
export function fontWorld(files: FontFiles = {}, opts: FontWorldOptions = {}) {
  const members = new Map<string, Uint8Array>();
  const put = (name: string, bytes: Uint8Array | null | undefined, dflt: Uint8Array): void => {
    const b = bytes === undefined ? dflt : bytes;
    if (b) members.set(name, b);
  };
  put("BOX.TTF", files.main, MAIN);
  put("SUB.TTF", files.sub, SUB);
  put("KOR.TTF", files.kor, KOR);
  const source: MassFileSource = { has: (n) => members.has(n), read: (n) => members.get(n) };
  const clock = { now: 5000 };
  const tickCount = () => clock.now;
  const device = opts.device ?? true;
  const s = device ? rig({ source, tickCount, ...(opts.backBuffer ? { backBuffer: opts.backBuffer } : {}) }) : { ...setup(new StringTable([]), { source, tickCount }), dev: null };
  const w = s.w;
  if (members.has("BOX.TTF")) w.main.InstallFont("BOXFONT", "box.ttf");
  if (members.has("SUB.TTF")) w.main.InstallFont("JhengHeiBold", "sub.ttf");
  if (members.has("KOR.TTF")) w.main.InstallFont("GULIM", "kor.ttf");
  w.devices.massFiles.log.entries.length = 0;
  w.messageBoxes.length = 0;
  s.dev?.log.splice(0);
  /** a glyph font (not loaded: `Load` is what the tests look at) */
  const font = (size: number, outline = 0, enlarge = 1, noRes = false, rhw = true, name = "BOXFONT") => new CKTDGFreeTypeFont(name, size, outline, rhw, 400, enlarge, noRes, w.fontManager);
  return { ...s, clock, font };
}

/** the vertices of the quads `Buffering` wrote to a page: `[x, y, z, rhw, color, u, v]` (stride 28) or `[x, y, z, color, u, v]` (24) */
export function pageQuads(ft: CKTDGFreeTypeFont, page: number): number[][][] {
  const buf = ft.m_apPageVertex[page]!;
  const per = ft.m_bRHW ? 7 : 6;
  const f = new Float32Array(buf);
  const u = new Uint32Array(buf);
  const out: number[][][] = [];
  for (let q = 0; q < ft.m_iCandidate[page]!; q++) {
    const quad: number[][] = [];
    for (let k = 0; k < 6; k++) {
      const at = (q * 6 + k) * per;
      quad.push(Array.from({ length: per }, (_, j) => (j === per - 3 ? u[at + j]! : f[at + j]!)));
    }
    out.push(quad);
  }
  return out;
}

/** the six vertices of a glyph quad as `Buffering` writes them (RHW): the corners (x0, y0) .. (x1, y1) with the texture (u0, v0) .. (u1, v1) */
export function rhwQuad(x0: number, y0: number, x1: number, y1: number, u0: number, v0: number, u1: number, v1: number, color: number): number[][] {
  const v = (x: number, y: number, u: number, vv: number) => [x, y, 0, 1, color, u, vv];
  return [v(x0, y0, u0, v0), v(x1, y0, u1, v0), v(x0, y1, u0, v1), v(x1, y0, u1, v0), v(x1, y1, u1, v1), v(x0, y1, u0, v1)];
}

/** the same for a font that is not RHW: z 0.5 and no rhw */
export function xyzQuad(x0: number, y0: number, x1: number, y1: number, u0: number, v0: number, u1: number, v1: number, color: number): number[][] {
  const v = (x: number, y: number, u: number, vv: number) => [x, y, 0.5, color, u, vv];
  return [v(x0, y0, u0, v0), v(x1, y0, u1, v0), v(x0, y1, u0, v1), v(x1, y0, u1, v0), v(x1, y1, u1, v1), v(x0, y1, u0, v1)];
}
