/**
 * The texture-stage cascade against an independent CPU model of the D3D9 formulas (docs: "Texture Blending", D3DTOP).
 * One 1x1 texture, constant vertex colours, many 6x6 cells on one A8R8G8B8 target (so that alpha is observable).
 */
import { describe, expect, test } from "bun:test";
import { D3DCLEAR, D3DFMT, D3DRS, D3DTA, D3DTOP, D3DTSS } from "../src/index.ts";
import { argb, drawRhwQuad, gpuAvailable, initFixed, makeTexture, newD3D9, pointSample, snap } from "./gpu-helper.ts";

const HAVE_GPU = await gpuAvailable();
const gpuTest = HAVE_GPU ? test : test.skip;

type V = [number, number, number, number];
const clamp = (x: number): number => Math.min(1, Math.max(0, x));

interface Inputs { dif: V; spc: V; tex: V; tf: V; k: V }
interface StageSpec { cop: number; ca0: number; ca1: number; ca2: number; aop: number; aa0: number; aa1: number; aa2: number; resultTemp?: boolean }

/** CPU reference of one stage (docs formulas). `cur`/`tmp` in, new `cur`/`tmp` out. */
function refStage(s: StageSpec, inp: Inputs, cur: V, tmp: V): { cur: V; tmp: V } {
  const pick = (a: number, alpha: boolean): V => {
    const sel = a & 0xf;
    let v: V = sel === D3DTA.DIFFUSE ? inp.dif : sel === D3DTA.CURRENT ? cur : sel === D3DTA.TEXTURE ? inp.tex : sel === D3DTA.TFACTOR ? inp.tf : sel === D3DTA.SPECULAR ? inp.spc : sel === D3DTA.TEMP ? tmp : inp.k;
    if (a & D3DTA.COMPLEMENT) v = v.map((x) => 1 - x) as V;
    if (!alpha && (a & D3DTA.ALPHAREPLICATE)) v = [v[3], v[3], v[3], v[3]];
    return v;
  };
  const c0 = pick(s.ca0, false), c1 = pick(s.ca1, false), c2 = pick(s.ca2, false);
  const a0 = pick(s.aa0, true), a1 = pick(s.aa1, true), a2 = pick(s.aa2, true);
  const out: V = [0, 0, 0, 0];
  const op = (kind: "c" | "a", o: number, x0: V, x1: V, x2: V, ch: number): number => {
    const A0 = x0[ch]!, A1 = x1[ch]!, A2 = x2[ch]!;
    const bl = (f: number): number => A1 * f + A2 * (1 - f);
    switch (o) {
      case D3DTOP.SELECTARG1: return A1;
      case D3DTOP.SELECTARG2: return A2;
      case D3DTOP.MODULATE: return A1 * A2;
      case D3DTOP.MODULATE2X: return A1 * A2 * 2;
      case D3DTOP.MODULATE4X: return A1 * A2 * 4;
      case D3DTOP.ADD: return A1 + A2;
      case D3DTOP.ADDSIGNED: return A1 + A2 - 0.5;
      case D3DTOP.ADDSIGNED2X: return (A1 + A2 - 0.5) * 2;
      case D3DTOP.SUBTRACT: return A1 - A2;
      case D3DTOP.ADDSMOOTH: return A1 + A2 - A1 * A2;
      case D3DTOP.BLENDDIFFUSEALPHA: return bl(inp.dif[3]);
      case D3DTOP.BLENDTEXTUREALPHA: return bl(inp.tex[3]);
      case D3DTOP.BLENDFACTORALPHA: return bl(inp.tf[3]);
      case D3DTOP.BLENDTEXTUREALPHAPM: return A1 + A2 * (1 - inp.tex[3]);
      case D3DTOP.BLENDCURRENTALPHA: return bl(cur[3]);
      case D3DTOP.MODULATEALPHA_ADDCOLOR: return kind === "c" ? x1[ch]! + x1[3] * A2 : A1;
      case D3DTOP.MODULATECOLOR_ADDALPHA: return kind === "c" ? A1 * A2 + x1[3] : A1;
      case D3DTOP.MODULATEINVALPHA_ADDCOLOR: return kind === "c" ? (1 - x1[3]) * A2 + A1 : A1;
      case D3DTOP.MODULATEINVCOLOR_ADDALPHA: return kind === "c" ? (1 - A1) * A2 + x1[3] : A1;
      case D3DTOP.MULTIPLYADD: return A0 + A1 * A2;
      case D3DTOP.LERP: return A0 * A1 + (1 - A0) * A2;
      default: throw new Error(`op ${o}`);
    }
  };
  if (s.cop === D3DTOP.DOTPRODUCT3) {
    const d = clamp(4 * ((c1[0] - 0.5) * (c2[0] - 0.5) + (c1[1] - 0.5) * (c2[1] - 0.5) + (c1[2] - 0.5) * (c2[2] - 0.5)));
    out[0] = out[1] = out[2] = out[3] = d;
  } else {
    for (let ch = 0; ch < 3; ch++) out[ch] = clamp(op("c", s.cop, c0, c1, c2, ch));
    out[3] = s.aop === D3DTOP.DISABLE ? cur[3] : clamp(op("a", s.aop, a0, a1, a2, 3));
  }
  return s.resultTemp ? { cur, tmp: out } : { cur: out, tmp };
}

const bytes = (v: V): number[] => v.map((x) => x);
const q = (v: number): number => Math.round(v * 255);

describe("texture stage cascade vs CPU model", () => {
  const inp: Inputs = {
    dif: [200 / 255, 100 / 255, 50 / 255, 180 / 255],
    spc: [0, 0, 0, 0],
    tex: [60 / 255, 160 / 255, 220 / 255, 120 / 255],
    tf: [90 / 255, 30 / 255, 240 / 255, 100 / 255],
    k: [10 / 255, 250 / 255, 130 / 255, 70 / 255],
  };
  const ops = [
    D3DTOP.SELECTARG1, D3DTOP.SELECTARG2, D3DTOP.MODULATE, D3DTOP.MODULATE2X, D3DTOP.MODULATE4X, D3DTOP.ADD, D3DTOP.ADDSIGNED, D3DTOP.ADDSIGNED2X,
    D3DTOP.SUBTRACT, D3DTOP.ADDSMOOTH, D3DTOP.BLENDDIFFUSEALPHA, D3DTOP.BLENDTEXTUREALPHA, D3DTOP.BLENDFACTORALPHA, D3DTOP.BLENDTEXTUREALPHAPM,
    D3DTOP.BLENDCURRENTALPHA, D3DTOP.MODULATEALPHA_ADDCOLOR, D3DTOP.MODULATECOLOR_ADDALPHA, D3DTOP.MODULATEINVALPHA_ADDCOLOR, D3DTOP.MODULATEINVCOLOR_ADDALPHA,
    D3DTOP.DOTPRODUCT3, D3DTOP.MULTIPLYADD, D3DTOP.LERP,
  ];

  gpuTest("every D3DTOP with several argument selectors/modifiers (single stage)", async () => {
    const dev = await newD3D9(64, 64, { backBufferFormat: D3DFMT.A8R8G8B8 });
    initFixed(dev);
    const tex = makeTexture(dev, 1, 1, [60, 160, 220, 120]);
    dev.SetTexture(0, tex);
    pointSample(dev);
    dev.SetRenderState(D3DRS.TEXTUREFACTOR, argb(100, 90, 30, 240));
    dev.SetTextureStageState(0, D3DTSS.CONSTANT, argb(70, 10, 250, 130));
    const cases: { s: StageSpec; name: string }[] = [];
    const argSets: [number, number, number][] = [
      [D3DTA.TFACTOR, D3DTA.TEXTURE, D3DTA.DIFFUSE],
      [D3DTA.DIFFUSE, D3DTA.TEXTURE | D3DTA.COMPLEMENT, D3DTA.TFACTOR],
      [D3DTA.CONSTANT, D3DTA.TEXTURE | D3DTA.ALPHAREPLICATE, D3DTA.CURRENT],
    ];
    for (const op of ops) for (const [a0, a1, a2] of argSets) {
      // the alpha op mirrors the colour op except for the colour-only ones, which are invalid on alpha
      const colorOnly = [D3DTOP.MODULATEALPHA_ADDCOLOR, D3DTOP.MODULATECOLOR_ADDALPHA, D3DTOP.MODULATEINVALPHA_ADDCOLOR, D3DTOP.MODULATEINVCOLOR_ADDALPHA, D3DTOP.DOTPRODUCT3].includes(op as never);
      cases.push({ name: `${op}/${a0},${a1},${a2}`, s: { cop: op, ca0: a0, ca1: a1, ca2: a2, aop: colorOnly ? D3DTOP.SELECTARG1 : op, aa0: a0 & ~D3DTA.ALPHAREPLICATE, aa1: a1 & ~D3DTA.ALPHAREPLICATE, aa2: a2 & ~D3DTA.ALPHAREPLICATE } });
    }
    expect(cases.length).toBe(66);
    const cell = 6, perRow = 10;
    dev.Clear(null, D3DCLEAR.TARGET | D3DCLEAR.ZBUFFER, argb(0, 0, 0, 0), 1, 0);
    cases.forEach((c, i) => {
      const x = (i % perRow) * cell, y = Math.floor(i / perRow) * cell;
      const s = c.s;
      dev.SetTextureStageState(0, D3DTSS.COLOROP, s.cop); dev.SetTextureStageState(0, D3DTSS.COLORARG0, s.ca0); dev.SetTextureStageState(0, D3DTSS.COLORARG1, s.ca1); dev.SetTextureStageState(0, D3DTSS.COLORARG2, s.ca2);
      dev.SetTextureStageState(0, D3DTSS.ALPHAOP, s.aop); dev.SetTextureStageState(0, D3DTSS.ALPHAARG0, s.aa0); dev.SetTextureStageState(0, D3DTSS.ALPHAARG1, s.aa1); dev.SetTextureStageState(0, D3DTSS.ALPHAARG2, s.aa2);
      drawRhwQuad(dev, x, y, x + cell, y + cell, argb(180, 200, 100, 50), [0, 0, 1, 1]);
    });
    const img = await snap(dev);
    expect(await dev.takeErrorsAsync()).toEqual([]);
    img.save("cascade-single");
    let bad = 0;
    const msgs: string[] = [];
    cases.forEach((c, i) => {
      const x = (i % perRow) * cell + 3, y = Math.floor(i / perRow) * cell + 3;
      // stage 0: CURRENT = diffuse
      const r = refStage(c.s, inp, inp.dif, [0, 0, 0, 0]).cur;
      const got = img.at(x, y);
      const exp = [q(r[0]), q(r[1]), q(r[2]), q(r[3])];
      const ok = Math.abs(got.r - exp[0]!) <= 2 && Math.abs(got.g - exp[1]!) <= 2 && Math.abs(got.b - exp[2]!) <= 2 && Math.abs(got.a - exp[3]!) <= 2;
      if (!ok) { bad++; msgs.push(`${c.name}: got ${got.r},${got.g},${got.b},${got.a} expected ${exp.join(",")}`); }
    });
    expect(msgs).toEqual([]);
    expect(bad).toBe(0);
  });

  gpuTest("two-stage cascade with TEMP result register", async () => {
    const dev = await newD3D9(16, 16, { backBufferFormat: D3DFMT.A8R8G8B8 });
    initFixed(dev);
    dev.SetTexture(0, makeTexture(dev, 1, 1, [60, 160, 220, 120]));
    dev.SetTexture(1, makeTexture(dev, 1, 1, [250, 20, 120, 200]));
    pointSample(dev, 0); pointSample(dev, 1);
    dev.SetRenderState(D3DRS.TEXTUREFACTOR, argb(100, 90, 30, 240));
    // stage 0: TEMP = ADD(TEXTURE, TFACTOR) ; stage 1: CURRENT = MODULATE(TEXTURE1, TEMP)
    const st0: StageSpec = { cop: D3DTOP.ADD, ca0: 1, ca1: D3DTA.TEXTURE, ca2: D3DTA.TFACTOR, aop: D3DTOP.SELECTARG1, aa0: 1, aa1: D3DTA.TEXTURE, aa2: 1, resultTemp: true };
    const st1: StageSpec = { cop: D3DTOP.MODULATE, ca0: 1, ca1: D3DTA.TEXTURE, ca2: D3DTA.TEMP, aop: D3DTOP.MODULATE, aa0: 1, aa1: D3DTA.TEXTURE, aa2: D3DTA.TEMP };
    const set = (n: number, s: StageSpec): void => {
      dev.SetTextureStageState(n, D3DTSS.COLOROP, s.cop); dev.SetTextureStageState(n, D3DTSS.COLORARG1, s.ca1); dev.SetTextureStageState(n, D3DTSS.COLORARG2, s.ca2);
      dev.SetTextureStageState(n, D3DTSS.ALPHAOP, s.aop); dev.SetTextureStageState(n, D3DTSS.ALPHAARG1, s.aa1); dev.SetTextureStageState(n, D3DTSS.ALPHAARG2, s.aa2);
      dev.SetTextureStageState(n, D3DTSS.RESULTARG, s.resultTemp ? D3DTA.TEMP : D3DTA.CURRENT);
    };
    set(0, st0); set(1, st1);
    dev.SetTextureStageState(1, D3DTSS.TEXCOORDINDEX, 0);
    dev.Clear(null, D3DCLEAR.TARGET | D3DCLEAR.ZBUFFER, 0, 1, 0);
    drawRhwQuad(dev, 0, 0, 16, 16, argb(180, 200, 100, 50), [0, 0, 1, 1]);
    const img = await snap(dev);
    const dif: V = [200 / 255, 100 / 255, 50 / 255, 180 / 255];
    const i2: Inputs = { dif, spc: [0, 0, 0, 0], tex: [60 / 255, 160 / 255, 220 / 255, 120 / 255], tf: [90 / 255, 30 / 255, 240 / 255, 100 / 255], k: [0, 0, 0, 0] };
    let r = refStage(st0, i2, dif, [0, 0, 0, 0]);
    r = refStage(st1, { ...i2, tex: [250 / 255, 20 / 255, 120 / 255, 200 / 255] }, r.cur, r.tmp);
    const got = img.at(8, 8);
    expect([got.r, got.g, got.b, got.a].map((x, i) => Math.abs(x - q(r.cur[i]!)) <= 2)).toEqual([true, true, true, true]);
    expect(await dev.takeErrorsAsync()).toEqual([]);
  });

  gpuTest("untextured geometry under the default stage state shows the diffuse colour (SDK tutorial behaviour)", async () => {
    const dev = await newD3D9(8, 8, { backBufferFormat: D3DFMT.A8R8G8B8 });
    initFixed(dev);
    dev.Clear(null, D3DCLEAR.TARGET | D3DCLEAR.ZBUFFER, 0, 1, 0);
    drawRhwQuad(dev, 0, 0, 8, 8, argb(200, 10, 20, 30));
    const p = (await snap(dev)).at(4, 4);
    expect(p).toEqual({ r: 10, g: 20, b: 30, a: 200 });
  });
});
