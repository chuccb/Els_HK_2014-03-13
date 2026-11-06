/**
 * XRenderer.fx: the effect emulation (effect.ts) and the WGSL ports of its `vs_1_1` shaders (xrenderer-shaders.ts), on the shipped
 * file (data041.kom) and the real device.  Expectations are computed from the HLSL on the CPU (see the model functions below); where a number
 * comes from the exe it is said so (technique / parameter names: tables off_3362652C / off_336265C4 of x2.exe).
 */
import { describe, expect, test } from "bun:test";
import { KomArchive, fileSource } from "@els/kom";
import {
  D3DCLEAR, D3DCULL, D3DDECLTYPE, D3DDECLUSAGE, D3DFOG, D3DFVF, D3DPT, D3DRS, D3DSAMP, D3DTA, D3DTOP, D3DTS, D3DTS_WORLD, D3DTSS, D3DTTFF, D3DXERR_INVALIDDATA, D3DERR_INVALIDCALL,
  D3DXCreateEffect, D3DXFX, DeviceStateManager, VS_REGISTERS, XR, XR_FUNCTION_HASHES, matIdentity, matMultiply, matRotationY, matRotationZ, matTranslation, parseEffect,
} from "../src/index.ts";
import type { D3DXEffect, Direct3DDevice9, EmulatedVertexShader, ID3DXEffectStateManager, VertexElement } from "../src/index.ts";
import { argb, gpuAvailable, makeTexture, newD3D9, near, packVertices, snap } from "./gpu-helper.ts";
import type { Image } from "./gpu-helper.ts";

const HAVE_GPU = await gpuAvailable();
const gpuTest = HAVE_GPU ? test : test.skip;

const kom = await KomArchive.open(fileSource("data/data041.kom"));
const FX_BYTES = await kom.read(kom.entries.find((e) => e.name.toUpperCase() === "XRENDERER.FX")!);

/** the 19 technique names and 19 parameter names the exe asks for (x2.exe tables off_3362652C and off_336265C4, in table order) */
const TECHNIQUES = [
  "REAL_COLOR", "CARTOON_BLACK_EDGE", "CARTOON_COLOR_EDGE", "CARTOON", "ADD_CARTOON_BLACK_EDGE", "ADD_CARTOON_COLOR_EDGE", "ADD_CARTOON", "BLACK_EDGE", "COLOR_EDGE",
  "LIGHT_FLOW_WORLD_X", "LIGHT_FLOW_WORLD_Y", "LIGHT_FLOW_WORLD_Z", "LIGHT_FLOW_WORLD_POINT", "LIGHT_FLOW_LOCAL_X", "LIGHT_FLOW_LOCAL_Y", "LIGHT_FLOW_LOCAL_Z", "LIGHT_FLOW_LOCAL_POINT",
  "CARTOON_FADE", "CARTOON_FADE_NONTEX",
];
const PARAMETERS = [
  "g_mViewProj", "g_mWorldViewProj", "g_Color", "g_TexOffSet01", "g_LightPos", "g_OutLineColor", "g_LightFlowPoint", "g_fTexOffSet2X", "g_fTexOffSet2Y", "g_fOutLineWide",
  "g_fLightFlowImpact", "g_fLightFlowWide", "g_bFog", "g_fFog", "g_fEye", "g_fColor", "g_fDensity", "g_amWorldPalette", "g_iShaderIndex",
];

// ------------------------------------------------------------------------------------------------------ helpers
interface Call { op: string; a: number; b: number; c: number }
/** a state manager that records what the effect does (and forwards it to the device) */
function recorder(dev: Direct3DDevice9 | null): { mgr: ID3DXEffectStateManager; calls: Call[]; shaders: string[] } {
  const calls: Call[] = [];
  const shaders: string[] = [];
  const mgr: ID3DXEffectStateManager = {
    SetRenderState: (s, v) => { calls.push({ op: "RS", a: s, b: v, c: 0 }); return dev ? dev.SetRenderState(s, v) : 0; },
    SetTextureStageState: (st, t, v) => { calls.push({ op: "TSS", a: st, b: t, c: v }); return dev ? dev.SetTextureStageState(st, t, v) : 0; },
    SetSamplerState: (st, t, v) => { calls.push({ op: "SAMP", a: st, b: t, c: v }); return dev ? dev.SetSamplerState(st, t, v) : 0; },
    SetVertexShader: (s) => { shaders.push(s?.def.name ?? "null"); calls.push({ op: "VS", a: shaders.length - 1, b: 0, c: 0 }); return dev ? dev.SetVertexShader(s) : 0; },
    SetVertexShaderConstantF: (r, d, n) => { calls.push({ op: "VSC", a: r, b: n, c: 0 }); return dev ? dev.SetVertexShaderConstantF(r, d, n) : 0; },
  };
  return { mgr, calls, shaders };
}

function create(dev: Direct3DDevice9): D3DXEffect {
  const r = D3DXCreateEffect(dev, FX_BYTES, D3DXFX.NOT_CLONEABLE);
  expect(r.errors).toBeNull();
  expect(r.hr).toBe(0);
  return r.effect!;
}

const W = 64, H = 64;
const BG = [10, 20, 30] as const;
/** D3D9 pixel centres sit on integer window coordinates: pixel i is at NDC x = -1 + 2i/W, pixel row j at NDC y = 1 - 2j/H */
const ndcX = (i: number): number => -1 + (2 * i) / W;
const ndcY = (j: number): number => 1 - (2 * j) / H;
/** first / last pixel column whose centre lies in [x0, x1) */
const spanX = (x0: number, x1: number): [number, number] => [Math.ceil(((x0 + 1) * W) / 2), Math.ceil(((x1 + 1) * W) / 2) - 1];
const ndcRowOf = (y: number): number => Math.round(((1 - y) * H) / 2);

interface Scene { dev: Direct3DDevice9; fx: D3DXEffect; P: (name: string) => NonNullable<ReturnType<D3DXEffect["GetParameterByName"]>> }

async function scene(): Promise<Scene> {
  const dev = await newD3D9(W, H);
  const fx = create(dev);
  fx.SetStateManager(new DeviceStateManager(dev));
  const P = (n: string): NonNullable<ReturnType<D3DXEffect["GetParameterByName"]>> => { const h = fx.GetParameterByName(null, n); if (!h) throw new Error(`no parameter ${n}`); return h; };
  dev.Clear(null, D3DCLEAR.TARGET | D3DCLEAR.ZBUFFER, argb(255, BG[0], BG[1], BG[2]), 1, 0);
  dev.SetRenderState(D3DRS.CULLMODE, D3DCULL.NONE);
  dev.SetRenderState(D3DRS.LIGHTING, 0);
  fx.SetMatrix(P("g_mViewProj"), matIdentity());
  fx.SetMatrix(P("g_mWorldViewProj"), matIdentity());
  fx.SetMatrixArray(P("g_amWorldPalette"), matIdentity(), 1);
  fx.SetVector(P("g_Color"), [1, 1, 1, 1]);
  return { dev, fx, P };
}

/** what CKTDGXRenderer::_CommitChanges computes (x2.exe.c L434781): bone count clamped to 4, +5 with fog unless the technique is a light flow */
const shaderIndex = (bones: number, fog: boolean, flow = false): number => Math.min(bones, 4) + (fog && !flow ? 5 : 0);

function run(fx: D3DXEffect, technique: string, perPass: (pass: number) => void): void {
  const h = fx.GetTechniqueByName(technique);
  expect(h).not.toBeNull();
  expect(fx.SetTechnique(h!)).toBe(0);
  const b = fx.Begin(7);
  expect(b.hr).toBe(0);
  for (let p = 0; p < b.passes; p++) {
    expect(fx.BeginPass(p)).toBe(0);
    expect(fx.CommitChanges()).toBe(0);
    perPass(p);
    expect(fx.EndPass()).toBe(0);
  }
  expect(fx.End()).toBe(0);
}

/** the static mesh vertex of the exe: FVF XYZ | NORMAL | TEX1 */
const RIGID_FVF = D3DFVF.XYZ | D3DFVF.NORMAL | D3DFVF.TEX1;
type RigidVertex = [number, number, number, number, number, number, number, number];
const rv = (x: number, y: number, z: number, n: [number, number, number] = [0, 0, 1], uv: [number, number] = [0.125, 0.5]): RigidVertex => [x, y, z, n[0], n[1], n[2], uv[0], uv[1]];
function drawRigid(dev: Direct3DDevice9, verts: number[][]): void {
  const { bytes, stride } = packVertices(RIGID_FVF, verts);
  dev.SetFVF(RIGID_FVF);
  expect(dev.DrawPrimitiveUP(D3DPT.TRIANGLELIST, verts.length / 3, bytes, stride)).toBe(0);
}
/** a triangle that covers the whole render target, all vertices carrying `normal` and `uv` */
const bigTriangle = (n: [number, number, number] = [0, 0, 1], uv: [number, number] = [0.125, 0.5], z = 0.5): RigidVertex[] => [rv(-3, -3, z, n, uv), rv(9, -3, z, n, uv), rv(-3, 9, z, n, uv)];

/** a W x 1 point-sampled, clamped texture (A8R8G8B8) */
function strip(dev: Direct3DDevice9, colors: number[][]): ReturnType<typeof makeTexture> {
  return makeTexture(dev, colors.length, 1, colors.flatMap((c) => [c[0]!, c[1]!, c[2]!, c[3] ?? 255]));
}
const TEXELS = [[255, 0, 0], [0, 200, 100], [60, 60, 240], [250, 250, 250]];

function pixel(img: Image, x = W / 2, y = H / 2): [number, number, number] { const p = img.at(x, y); return [p.r, p.g, p.b]; }
function expectColor(got: [number, number, number], want: number[], tol = 2): void {
  for (let i = 0; i < 3; i++) if (!near(got[i]!, want[i]!, tol)) throw new Error(`colour ${got} != ${want.map((x) => +x.toFixed(1))} (tolerance ${tol})`);
}
/** the first and last column of row `y` whose colour differs from the background by more than `thr` */
function rowSpan(img: Image, y: number, thr = 40): [number, number] | null {
  let lo = -1, hi = -1;
  for (let x = 0; x < img.width; x++) { const p = img.at(x, y); if (Math.abs(p.r - BG[0]) + Math.abs(p.g - BG[1]) + Math.abs(p.b - BG[2]) > thr) { if (lo < 0) lo = x; hi = x; } }
  return lo < 0 ? null : [lo, hi];
}

// ================================================================================================================== the file
describe("XRenderer.fx: parsing and effect objects", () => {
  test("the shipped file defines what the exe looks up", () => {
    const p = parseEffect(new TextDecoder("latin1").decode(FX_BYTES));
    expect(p.params.map((x) => x.name).sort()).toEqual([...PARAMETERS].sort());
    expect(p.techniques.map((t) => t.name).sort()).toEqual([...TECHNIQUES].sort());
    expect(p.shaderArrays.map((a) => `${a.name}:${a.entries.length}`).sort()).toEqual([
      "vsArrayBlackEdge11:10", "vsArrayCartoon11:10", "vsArrayColorEdge11:10", "vsArrayPointFlowLocal11:5", "vsArrayPointFlowWorld11:5", "vsArrayRealColor11:10",
      "vsArrayXFlowLocal11:5", "vsArrayXFlowWorld11:5", "vsArrayYFlowLocal11:5", "vsArrayYFlowWorld11:5", "vsArrayZFlowLocal11:5", "vsArrayZFlowWorld11:5",
    ]);
    // every function of the file is one the port has a hash for (so none can change unnoticed)
    expect(p.functions.map((f) => f.name).sort()).toEqual(Object.keys(XR_FUNCTION_HASHES).sort());
    for (const f of p.functions) expect(f.hash).toBe(XR_FUNCTION_HASHES[f.name]!);
    const palette = p.params.find((x) => x.name === "g_amWorldPalette")!;
    expect([palette.type, palette.array]).toEqual(["float4x4", XR.PALETTE_SIZE]);
    // pass counts: the toon techniques with an outline have two passes
    const passes = Object.fromEntries(p.techniques.map((t) => [t.name, t.passes.length]));
    for (const t of TECHNIQUES) expect(passes[t]).toBe(/^(ADD_)?CARTOON_(BLACK|COLOR)_EDGE$/.test(t) ? 2 : 1);
  });

  gpuTest("handles by name, like CKTDGXRenderer::OnResetDevice (GetTechniqueByName x19, GetParameterByName x19)", async () => {
    const dev = await newD3D9(8, 8);
    const fx = create(dev);
    for (const t of TECHNIQUES) expect(fx.GetTechniqueByName(t)).not.toBeNull();
    for (const p of PARAMETERS) expect(fx.GetParameterByName(null, p)).not.toBeNull();
    expect(fx.GetTechniqueByName("NOPE")).toBeNull();
    expect(fx.GetParameterByName(null, "g_nope")).toBeNull();
    expect(fx.GetDesc()).toEqual({ Parameters: 19, Techniques: 19, Functions: 0 });
    expect(fx.SetTechnique(fx.GetTechniqueByName("REAL_COLOR")!)).toBe(0);
    expect(fx.GetCurrentTechnique().name).toBe("REAL_COLOR");
  });

  gpuTest("a file the port cannot reproduce is refused, with a message", async () => {
    const dev = await newD3D9(8, 8);
    const text = new TextDecoder("latin1").decode(FX_BYTES);
    const bad = (src: string): { hr: number; errors: string | null } => D3DXCreateEffect(dev, src);
    // a function this port does not know
    const a = bad(text.replaceAll("VertCartoon_NONFOG", "VertCartoonMystery"));
    expect(a.hr).toBe(D3DXERR_INVALIDDATA);
    expect(a.errors).toContain("VertCartoonMystery");
    // a known function whose body changed
    const changed = text.replace("o.Diffuse = g_OutLineColor;", "o.Diffuse = g_Color;");
    expect(changed).not.toBe(text);
    const b0 = bad(changed);
    expect(b0.hr).toBe(D3DXERR_INVALIDDATA);
    expect(b0.errors).toContain("differs from the XRenderer.fx this port was written from");
    // ... comments, white space and layout do not matter
    expect(bad(`/* hi */\n${text.replaceAll("\t", "  ").replaceAll("\n", "\n\n")}// bye`).hr).toBe(0);
    // an entry point that is used but not defined
    const gone = bad(text.replace("VertCartoon_NONFOG", "Missing_NONFOG").replace("VertCartoon_NONFOG", "Missing_NONFOG"));
    expect(gone.hr).toBe(D3DXERR_INVALIDDATA);
    // a state assignment it cannot do
    const c = bad(text.replace("CullMode\t\t\t= CW;", "FrobnicateMode = CW;"));
    expect(c.hr).toBe(D3DXERR_INVALIDDATA);
    expect(c.errors).toContain("Frobnicate");
    expect(bad("technique T { pass p { ColorOp[0] = Sideways; } }").hr).toBe(D3DXERR_INVALIDDATA);
    expect(bad("float4 x; ").hr).toBe(D3DXERR_INVALIDDATA); // no technique
    expect(bad("technique T { pass p { ColorOp[0] = Modulate; ").hr).toBe(D3DXERR_INVALIDDATA); // truncated
  });
});

// ============================================================================================ what the passes do to the device
describe("XRenderer.fx: state assignments, through the state manager", () => {
  const rs = (c: Call[]): Record<number, number> => Object.fromEntries(c.filter((x) => x.op === "RS").map((x) => [x.a, x.b]));
  const tss = (c: Call[], stage: number): Record<number, number> => Object.fromEntries(c.filter((x) => x.op === "TSS" && x.a === stage).map((x) => [x.b, x.c]));

  gpuTest("REAL_COLOR: stage 0 modulates texture and diffuse, stages 1 / 2 pass the colour on; fog follows g_bFog / g_fColor", async () => {
    const dev = await newD3D9(8, 8);
    const fx = create(dev);
    const { mgr, calls, shaders } = recorder(null);
    fx.SetStateManager(mgr);
    fx.SetBool(fx.GetParameterByName(null, "g_bFog")!, true);
    fx.SetVector(fx.GetParameterByName(null, "g_fColor")!, [0.2, 0.4, 0.6, 1]);
    fx.SetTechnique(fx.GetTechniqueByName("REAL_COLOR")!);
    expect(fx.Begin(7)).toEqual({ hr: 0, passes: 1 });
    expect(fx.BeginPass(0)).toBe(0);
    expect(tss(calls, 0)).toEqual({
      [D3DTSS.ALPHAOP]: D3DTOP.MODULATE, [D3DTSS.ALPHAARG1]: D3DTA.TEXTURE, [D3DTSS.ALPHAARG2]: D3DTA.DIFFUSE,
      [D3DTSS.COLOROP]: D3DTOP.MODULATE, [D3DTSS.COLORARG1]: D3DTA.TEXTURE, [D3DTSS.COLORARG2]: D3DTA.DIFFUSE,
    });
    expect(tss(calls, 1)).toEqual({ [D3DTSS.ALPHAOP]: D3DTOP.SELECTARG1, [D3DTSS.ALPHAARG1]: D3DTA.CURRENT, [D3DTSS.COLOROP]: D3DTOP.SELECTARG1, [D3DTSS.COLORARG1]: D3DTA.CURRENT, [D3DTSS.COLORARG2]: D3DTA.TEXTURE });
    // stage 2: ColorOp is not assigned (the device keeps its value)
    expect(tss(calls, 2)).toEqual({ [D3DTSS.ALPHAOP]: D3DTOP.SELECTARG1, [D3DTSS.ALPHAARG1]: D3DTA.CURRENT, [D3DTSS.COLORARG1]: D3DTA.CURRENT, [D3DTSS.COLORARG2]: D3DTA.TEXTURE });
    expect(rs(calls)).toEqual({ [D3DRS.FOGENABLE]: 1, [D3DRS.FOGVERTEXMODE]: 3 /* LINEAR */, [D3DRS.FOGCOLOR]: 0xff336699 /* (0.2, 0.4, 0.6, 1) rounded to nearest */ });
    expect(shaders).toEqual(["xr:VertRealColor_NONFOG"]); // g_iShaderIndex = 0 (the default, as the exe's OnResetDevice sets it)
    // the order of the file: texture stages first, then the vertex shader, then the fog states
    expect(calls.findIndex((c) => c.op === "VS")).toBeGreaterThan(calls.findIndex((c) => c.op === "TSS" && c.a === 2));
    expect(calls.findIndex((c) => c.op === "RS")).toBeGreaterThan(calls.findIndex((c) => c.op === "VS"));
    fx.EndPass(); fx.End();
  });

  gpuTest("CARTOON_BLACK_EDGE: pass 0 is the toon shading, pass 1 draws the inverted hull in TFACTOR black", async () => {
    const dev = await newD3D9(8, 8);
    const fx = create(dev);
    const { mgr, calls, shaders } = recorder(null);
    fx.SetStateManager(mgr);
    fx.SetTechnique(fx.GetTechniqueByName("CARTOON_BLACK_EDGE")!);
    expect(fx.Begin(7)).toEqual({ hr: 0, passes: 2 });
    fx.BeginPass(0);
    expect(tss(calls, 1)[D3DTSS.COLOROP]).toBe(D3DTOP.MODULATE);
    expect(calls.filter((c) => c.op === "SAMP")).toEqual([{ op: "SAMP", a: 1, b: D3DSAMP.ADDRESSU, c: 3 /* CLAMP */ }]);
    expect(shaders).toEqual(["xr:VertCartoon_NONFOG"]);
    fx.EndPass();
    calls.length = 0;
    fx.BeginPass(1);
    expect(rs(calls)).toEqual({ [D3DRS.TEXTUREFACTOR]: 0xff000000, [D3DRS.CULLMODE]: D3DCULL.CW, [D3DRS.FOGENABLE]: 0, [D3DRS.FOGVERTEXMODE]: 3, [D3DRS.FOGCOLOR]: 0 });
    expect(tss(calls, 0)).toEqual({ [D3DTSS.ALPHAOP]: D3DTOP.SELECTARG1, [D3DTSS.ALPHAARG1]: D3DTA.TFACTOR, [D3DTSS.COLOROP]: D3DTOP.SELECTARG1, [D3DTSS.COLORARG1]: D3DTA.TFACTOR });
    expect(tss(calls, 1)).toEqual({ [D3DTSS.COLOROP]: D3DTOP.DISABLE, [D3DTSS.ALPHAOP]: D3DTOP.DISABLE });
    expect(tss(calls, 2)).toEqual({ [D3DTSS.COLOROP]: D3DTOP.DISABLE, [D3DTSS.ALPHAOP]: D3DTOP.DISABLE });
    expect(shaders).toEqual(["xr:VertCartoon_NONFOG", "xr:VertBlackEdge_NONFOG"]);
    fx.EndPass(); fx.End();
  });

  gpuTest("LIGHT_FLOW_*: additive alpha blending, no fog states, the flow shader family of the technique", async () => {
    const dev = await newD3D9(8, 8);
    const fx = create(dev);
    const { mgr, calls, shaders } = recorder(null);
    fx.SetStateManager(mgr);
    const want: Record<string, string> = {
      LIGHT_FLOW_WORLD_X: "VertXFlowWorld", LIGHT_FLOW_WORLD_Y: "VertYFlowWorld", LIGHT_FLOW_WORLD_Z: "VertZFlowWorld", LIGHT_FLOW_WORLD_POINT: "VertPointFlowWorld",
      LIGHT_FLOW_LOCAL_X: "VertXFlowLocal", LIGHT_FLOW_LOCAL_Y: "VertYFlowLocal", LIGHT_FLOW_LOCAL_Z: "VertZFlowLocal", LIGHT_FLOW_LOCAL_POINT: "VertPointFlowLocal",
    };
    for (const [t, fn] of Object.entries(want)) {
      calls.length = 0; shaders.length = 0;
      fx.SetTechnique(fx.GetTechniqueByName(t)!);
      expect(fx.Begin(7)).toEqual({ hr: 0, passes: 1 });
      fx.BeginPass(0);
      expect(rs(calls)).toEqual({ [D3DRS.ALPHABLENDENABLE]: 1, [D3DRS.SRCBLEND]: 5 /* SRCALPHA */, [D3DRS.DESTBLEND]: 7 /* DESTALPHA */ });
      expect(tss(calls, 0)).toEqual({ [D3DTSS.ALPHAOP]: D3DTOP.ADD, [D3DTSS.ALPHAARG1]: D3DTA.CURRENT, [D3DTSS.ALPHAARG2]: D3DTA.DIFFUSE, [D3DTSS.COLORARG1]: D3DTA.DIFFUSE });
      expect(shaders).toEqual([`xr:${fn}`]);
      fx.EndPass(); fx.End();
    }
  });

  gpuTest("CommitChanges re-evaluates what depends on a changed parameter, and only that", async () => {
    const dev = await newD3D9(8, 8);
    const fx = create(dev);
    const { mgr, calls, shaders } = recorder(null);
    fx.SetStateManager(mgr);
    const P = (n: string) => fx.GetParameterByName(null, n)!;
    fx.SetTechnique(fx.GetTechniqueByName("REAL_COLOR")!);
    fx.Begin(7);
    fx.BeginPass(0);
    calls.length = 0; shaders.length = 0;
    expect(fx.CommitChanges()).toBe(0);
    expect(calls).toEqual([]); // nothing changed: nothing is sent
    // a constant of the shader in use: just that register
    fx.SetVector(P("g_Color"), [0.5, 0.5, 0.5, 0.5]);
    fx.CommitChanges();
    expect(calls).toEqual([{ op: "VSC", a: XR.COLOR, b: 1, c: 0 }]);
    // a constant the shader does not read: nothing
    calls.length = 0;
    fx.SetVector(P("g_LightPos"), [1, 2, 3, 4]);
    fx.SetVector(P("g_fEye"), [1, 2, 3, 4]);
    fx.CommitChanges();
    expect(calls).toEqual([]);
    // g_bFog: the three fog states are not re-sent but FogEnable is (it is the only one depending on the parameter)
    fx.SetBool(P("g_bFog"), true);
    fx.CommitChanges();
    expect(calls).toEqual([{ op: "RS", a: D3DRS.FOGENABLE, b: 1, c: 0 }]);
    // g_iShaderIndex: another shader, all the constants it reads are uploaded
    calls.length = 0;
    fx.SetInt(P("g_iShaderIndex"), 7); // 2 bones with fog
    fx.CommitChanges();
    expect(shaders).toEqual(["xr:VertSkinningRealColor(2)"]);
    expect(calls.filter((c) => c.op === "VSC").map((c) => [c.a, c.b])).toEqual([
      [XR.PAL, 80], [XR.VP, 4], [XR.COLOR, 1], [XR.TEXOFF, 1], [XR.FOG, 1], [XR.EYE, 1], [XR.S0, 1], [XR.S1, 1],
    ]);
    // an index outside the array is an error, like D3DX's bounds check
    fx.SetInt(P("g_iShaderIndex"), 10);
    expect(fx.CommitChanges()).toBe(D3DERR_INVALIDCALL);
    fx.EndPass(); fx.End();
  });

  gpuTest("the call protocol: Begin / BeginPass / CommitChanges / EndPass / End must nest", async () => {
    const dev = await newD3D9(8, 8);
    const fx = create(dev);
    const P = (n: string) => fx.GetParameterByName(null, n)!;
    expect(fx.BeginPass(0)).toBe(D3DERR_INVALIDCALL);
    expect(fx.CommitChanges()).toBe(D3DERR_INVALIDCALL);
    expect(fx.EndPass()).toBe(D3DERR_INVALIDCALL);
    expect(fx.End()).toBe(D3DERR_INVALIDCALL);
    expect(fx.Begin(0).hr).toBe(0);
    expect(fx.Begin(0).hr).toBe(D3DERR_INVALIDCALL);
    expect(fx.SetTechnique(fx.GetTechniqueByName("CARTOON")!)).toBe(D3DERR_INVALIDCALL); // not between Begin and End
    expect(fx.BeginPass(1)).toBe(D3DERR_INVALIDCALL); // one pass only
    expect(fx.BeginPass(0)).toBe(0);
    expect(fx.BeginPass(0)).toBe(D3DERR_INVALIDCALL);
    expect(fx.End()).toBe(D3DERR_INVALIDCALL); // pass still open
    expect(fx.EndPass()).toBe(0);
    expect(fx.End()).toBe(0);
    // parameter setters check types and sizes
    expect(fx.SetMatrix(P("g_amWorldPalette"), matIdentity())).toBe(D3DERR_INVALIDCALL); // an array needs SetMatrixArray
    expect(fx.SetMatrixArray(P("g_amWorldPalette"), new Float32Array(21 * 16), 21)).toBe(D3DERR_INVALIDCALL);
    expect(fx.SetMatrixArray(P("g_amWorldPalette"), new Float32Array(16), 2)).toBe(D3DERR_INVALIDCALL);
    expect(fx.SetMatrixArray(P("g_amWorldPalette"), new Float32Array(20 * 16), 20)).toBe(0);
    expect(fx.SetVector(P("g_fFog"), [1, 2, 3])).toBe(D3DERR_INVALIDCALL);
    expect(fx.SetFloat(P("g_Color"), 1)).toBe(D3DERR_INVALIDCALL);
    expect(fx.SetInt(P("g_fDensity"), 3)).toBe(0); // an int into a float
    expect(fx.GetFloat(P("g_fDensity"))).toEqual({ hr: 0, value: 3 });
    expect(fx.SetBool(P("g_bFog"), true)).toBe(0);
    expect(fx.GetBool(P("g_bFog"))).toEqual({ hr: 0, value: true });
    expect(fx.GetInt(P("g_iShaderIndex"))).toEqual({ hr: 0, value: 0 });
    const other = create(dev);
    expect(fx.SetFloat(other.GetParameterByName(null, "g_fDensity")!, 1)).toBe(D3DERR_INVALIDCALL); // a handle of another effect
  });

  gpuTest("without a state manager the effect writes to the device and puts back what it changed, unless told not to", async () => {
    const dev = await newD3D9(8, 8);
    const fx = create(dev);
    dev.SetRenderState(D3DRS.FOGENABLE, 0);
    dev.SetTextureStageState(1, D3DTSS.COLOROP, D3DTOP.DISABLE);
    dev.SetSamplerState(1, D3DSAMP.ADDRESSU, 1);
    fx.SetBool(fx.GetParameterByName(null, "g_bFog")!, true);
    fx.SetMatrix(fx.GetParameterByName(null, "g_mWorldViewProj")!, matIdentity());
    fx.SetTechnique(fx.GetTechniqueByName("CARTOON")!);
    fx.Begin(0);
    fx.BeginPass(0);
    expect(dev.GetRenderState(D3DRS.FOGENABLE).value).toBe(1);
    expect(dev.GetTextureStageState(1, D3DTSS.COLOROP).value).toBe(D3DTOP.MODULATE);
    expect(dev.GetSamplerState(1, D3DSAMP.ADDRESSU).value).toBe(3);
    expect(dev.GetVertexShader()?.def.name).toBe("xr:VertCartoon_NONFOG");
    expect(dev.GetVertexShaderConstantF(XR.WVP, 1).data[0]).toBe(1);
    fx.EndPass();
    fx.End();
    expect(dev.GetRenderState(D3DRS.FOGENABLE).value).toBe(0);
    expect(dev.GetTextureStageState(1, D3DTSS.COLOROP).value).toBe(D3DTOP.DISABLE);
    expect(dev.GetSamplerState(1, D3DSAMP.ADDRESSU).value).toBe(1);
    expect(dev.GetVertexShader()).toBeNull();
    expect(dev.GetVertexShaderConstantF(XR.WVP, 1).data[0]).toBe(0);
    // the exe's flags (7 = do not save state, shader state, sampler state): everything stays
    fx.Begin(7); fx.BeginPass(0); fx.EndPass(); fx.End();
    expect(dev.GetTextureStageState(1, D3DTSS.COLOROP).value).toBe(D3DTOP.MODULATE);
    expect(dev.GetVertexShader()?.def.name).toBe("xr:VertCartoon_NONFOG");
  });

  gpuTest("Begin's flags are three independent bits: D3DXFX_DONOTSAVESTATE (1), DONOTSAVESHADERSTATE (2), DONOTSAVESAMPLERSTATE (4)", async () => {
    for (const flags of [1, 2, 4, 3, 5, 6]) {
      const dev = await newD3D9(8, 8);
      const fx = create(dev);
      fx.SetMatrix(fx.GetParameterByName(null, "g_mWorldViewProj")!, matIdentity());
      fx.SetTechnique(fx.GetTechniqueByName("CARTOON")!);
      expect(fx.Begin(flags).hr).toBe(0);
      fx.BeginPass(0);
      fx.EndPass();
      fx.End();
      const state = dev.GetTextureStageState(1, D3DTSS.COLOROP).value === D3DTOP.MODULATE; // render / texture stage state kept
      const sampler = dev.GetSamplerState(1, D3DSAMP.ADDRESSU).value === 3; // sampler state kept
      const shader = dev.GetVertexShader() !== null; // shader and its constants kept
      expect([state, shader, sampler]).toEqual([!!(flags & 1), !!(flags & 2), !!(flags & 4)]);
      expect(dev.GetVertexShaderConstantF(XR.WVP, 1).data[0]).toBe(flags & 2 ? 1 : 0);
    }
  });
});

// ================================================================================================= vertex shaders at work
describe("XRenderer.fx: rigid shaders", () => {
  gpuTest("REAL_COLOR: texture x g_Color, the three texture coordinate outputs and their offsets", async () => {
    const { dev, fx, P } = await scene();
    const tex = strip(dev, TEXELS);
    for (let s = 0; s < 3; s++) { dev.SetTexture(s, tex); }
    fx.SetVector(P("g_Color"), [0.5, 1, 0.25, 1]);
    fx.SetVector(P("g_TexOffSet01"), [0.25, 0, 0.5, 0]); // xy -> stage 0 (texel 1), zw -> stage 1 (texel 2)
    fx.SetFloat(P("g_fTexOffSet2X"), 0.75); // stage 2 (texel 3)
    fx.SetFloat(P("g_fTexOffSet2Y"), 0);
    const tri = bigTriangle();
    // (a) stage 0 as the pass sets it: texel 1 times g_Color
    run(fx, "REAL_COLOR", () => drawRigid(dev, tri));
    expectColor(pixel(await snap(dev)), [0 * 0.5, 200 * 1, 100 * 0.25]);
    // (b) stage 1 reads its texture at Tex1 (the exe overrides stage states between BeginPass and the draw too)
    run(fx, "REAL_COLOR", () => {
      dev.SetTextureStageState(1, D3DTSS.COLOROP, D3DTOP.SELECTARG1);
      dev.SetTextureStageState(1, D3DTSS.COLORARG1, D3DTA.TEXTURE);
      drawRigid(dev, tri);
    });
    expectColor(pixel(await snap(dev)), [60, 60, 240]);
    // (c) stage 2 at Tex2
    run(fx, "REAL_COLOR", () => {
      dev.SetTextureStageState(2, D3DTSS.COLOROP, D3DTOP.SELECTARG1);
      dev.SetTextureStageState(2, D3DTSS.COLORARG1, D3DTA.TEXTURE);
      drawRigid(dev, tri);
    });
    expectColor(pixel(await snap(dev)), [250, 250, 250]);
    expect(await dev.takeErrorsAsync()).toEqual([]);
  });

  gpuTest("REAL_COLOR: alpha = texture alpha x g_Color.a; position = WorldViewProj", async () => {
    const { dev, fx, P } = await scene();
    dev.SetTexture(0, strip(dev, [[200, 100, 50, 128]]));
    dev.SetRenderState(D3DRS.ALPHABLENDENABLE, 1);
    dev.SetRenderState(D3DRS.SRCBLEND, 5);
    dev.SetRenderState(D3DRS.DESTBLEND, 6);
    fx.SetVector(P("g_Color"), [1, 1, 1, 0.5]);
    // g_mWorldViewProj scales by 1/2 and moves right by 1/4: a quad of [-1, 1] covers [-0.25, 0.75]
    fx.SetMatrix(P("g_mWorldViewProj"), matMultiply(new Float32Array([0.5, 0, 0, 0, 0, 0.5, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]), matTranslation(0.25, 0, 0)));
    const q = [rv(-1.01, -1.01, 0.5), rv(1.01, -1.01, 0.5), rv(-1.01, 1.01, 0.5), rv(1.01, -1.01, 0.5), rv(1.01, 1.01, 0.5), rv(-1.01, 1.01, 0.5)];
    run(fx, "REAL_COLOR", () => drawRigid(dev, q));
    const img = await snap(dev);
    const a = (128 / 255) * 0.5;
    expectColor(pixel(img), [200 * a + BG[0] * (1 - a), 100 * a + BG[1] * (1 - a), 50 * a + BG[2] * (1 - a)]);
    const [x0, x1] = spanX(0.5 * -1.01 + 0.25, 0.5 * 1.01 + 0.25); // the quad [-1.01, 1.01] scaled by 1/2 and moved right by 1/4: [-0.255, 0.755]
    expect(rowSpan(img, H / 2, 6)).toEqual([x0, x1]);
    expect(await dev.takeErrorsAsync()).toEqual([]);
  });

  gpuTest("CARTOON: the ramp is indexed by dot(normalize(n * palette[0]), g_LightPos); normals are rotated, never translated", async () => {
    const { dev, fx, P } = await scene();
    const ramp = [10, 40, 80, 120, 160, 200, 230, 250].map((v) => [v, v, v]);
    dev.SetTexture(0, strip(dev, [[255, 255, 255]]));
    dev.SetTexture(1, strip(dev, ramp));
    // palette[0]: rotation about Y by 90 degrees and a translation; the matrix of the position is WVP = palette[0] (view / projection are identity)
    const pal0 = matMultiply(matRotationY(Math.PI / 2), matTranslation(0.05, 0, 0));
    fx.SetMatrixArray(P("g_amWorldPalette"), pal0, 1);
    fx.SetMatrix(P("g_mWorldViewProj"), matIdentity());
    fx.SetVector(P("g_LightPos"), [0.9, 0, 0.1, 0.5]);
    // n = (0, 0, 3) -> rotated to (3, 0, 0) -> normalised (1, 0, 0): d = 0.9 -> ramp texel floor(0.9 * 8) = 7... (u = 0.9 is in the last quarter)
    run(fx, "CARTOON", () => drawRigid(dev, bigTriangle([0, 0, 3])));
    let c = pixel(await snap(dev));
    expectColor(c, [ramp[Math.floor(0.9 * 8)]![0]!, ramp[Math.floor(0.9 * 8)]![0]!, ramp[Math.floor(0.9 * 8)]![0]!]);
    // a different light: d = 0.3 -> texel 2
    dev.Clear(null, D3DCLEAR.TARGET | D3DCLEAR.ZBUFFER, argb(255, 0, 0, 0), 1, 0);
    fx.SetVector(P("g_LightPos"), [0.3, 0.7, 0.1, 9]);
    run(fx, "CARTOON", () => drawRigid(dev, bigTriangle([0, 0, 3])));
    c = pixel(await snap(dev));
    expectColor(c, [ramp[2]![0]!, ramp[2]![0]!, ramp[2]![0]!]);
    // negative d clamps to the first texel (AddressU[1] = Clamp)
    dev.Clear(null, D3DCLEAR.TARGET | D3DCLEAR.ZBUFFER, argb(255, 0, 0, 0), 1, 0);
    fx.SetVector(P("g_LightPos"), [-1, 0, 0, 0]);
    run(fx, "CARTOON", () => drawRigid(dev, bigTriangle([0, 0, 3])));
    expectColor(pixel(await snap(dev)), [10, 10, 10]);
    expect(dev.GetSamplerState(1, D3DSAMP.ADDRESSU).value).toBe(3);
    // ADD_CARTOON adds the ramp to the lit colour: texture (255) * g_Color + ramp
    dev.Clear(null, D3DCLEAR.TARGET | D3DCLEAR.ZBUFFER, argb(255, 0, 0, 0), 1, 0);
    fx.SetVector(P("g_LightPos"), [0.9, 0, 0.1, 0]);
    fx.SetVector(P("g_Color"), [0.5, 0.25, 0, 1]);
    run(fx, "ADD_CARTOON", () => drawRigid(dev, bigTriangle([0, 0, 3])));
    expectColor(pixel(await snap(dev)), [Math.min(255, 128 + 250), Math.min(255, 64 + 250), 250]);
    expect(await dev.takeErrorsAsync()).toEqual([]);
  });

  gpuTest("CARTOON_FADE blends texture and diffuse by the diffuse alpha; the _NONTEX variant is the diffuse colour", async () => {
    const { dev, fx, P } = await scene();
    dev.SetTexture(0, strip(dev, [[200, 100, 50]]));
    fx.SetVector(P("g_Color"), [0.2, 0.4, 0.8, 0.25]);
    run(fx, "CARTOON_FADE", () => drawRigid(dev, bigTriangle()));
    const a = 0.25;
    expectColor(pixel(await snap(dev)), [200 * a + 51 * (1 - a), 100 * a + 102 * (1 - a), 50 * a + 204 * (1 - a)]);
    dev.Clear(null, D3DCLEAR.TARGET | D3DCLEAR.ZBUFFER, argb(255, 0, 0, 0), 1, 0);
    run(fx, "CARTOON_FADE_NONTEX", () => drawRigid(dev, bigTriangle()));
    expectColor(pixel(await snap(dev)), [51, 102, 204]);
  });

  gpuTest("BLACK_EDGE / COLOR_EDGE: the hull is pushed out along the unnormalised normal by g_fOutLineWide, back faces only (CullMode CW)", async () => {
    const { dev, fx, P } = await scene();
    fx.SetFloat(P("g_fOutLineWide"), 0.26);
    fx.SetVector(P("g_OutLineColor"), [0, 1, 0, 1]);
    // a quad [-0.5, 0.5]^2 whose corner normals point outwards: the corners move by (+-0.26, +-0.26)
    const c = (x: number, y: number): RigidVertex => rv(x, y, 0.5, [Math.sign(x), Math.sign(y), 0]);
    const quad = [c(-0.5, -0.5), c(0.5, -0.5), c(-0.5, 0.5), c(0.5, -0.5), c(0.5, 0.5), c(-0.5, 0.5)]; // counter-clockwise on screen: a back face under CullMode CW
    const reversed = [quad[0]!, quad[2]!, quad[1]!, quad[3]!, quad[5]!, quad[4]!];
    const [x0, x1] = spanX(-0.76, 0.76);
    for (const [technique, want] of [["BLACK_EDGE", [0, 0, 0]], ["COLOR_EDGE", [0, 255, 0]]] as [string, number[]][]) {
      dev.Clear(null, D3DCLEAR.TARGET | D3DCLEAR.ZBUFFER, argb(255, BG[0], BG[1], BG[2]), 1, 0);
      run(fx, technique, () => drawRigid(dev, quad));
      let img = await snap(dev);
      expectColor(pixel(img), want);
      expect(rowSpan(img, H / 2, 15)).toEqual([x0, x1]);
      // the other winding is culled
      dev.Clear(null, D3DCLEAR.TARGET | D3DCLEAR.ZBUFFER, argb(255, BG[0], BG[1], BG[2]), 1, 0);
      run(fx, technique, () => drawRigid(dev, reversed));
      img = await snap(dev);
      expect(rowSpan(img, H / 2, 15)).toBeNull();
    }
    expect(await dev.takeErrorsAsync()).toEqual([]);
  });
});

// ======================================================================================================== skinning
/** the vertex of the exe's skinned meshes after ConvertToSkinnedMesh: FVF 4380 turned into a declaration whose BLENDINDICES is a D3DCOLOR (x2.exe.c L428466) */
const SKIN_DECL: VertexElement[] = [
  { stream: 0, offset: 0, type: D3DDECLTYPE.FLOAT3, method: 0, usage: D3DDECLUSAGE.POSITION, usageIndex: 0 },
  { stream: 0, offset: 12, type: D3DDECLTYPE.FLOAT3, method: 0, usage: D3DDECLUSAGE.BLENDWEIGHT, usageIndex: 0 },
  { stream: 0, offset: 24, type: D3DDECLTYPE.D3DCOLOR, method: 0, usage: D3DDECLUSAGE.BLENDINDICES, usageIndex: 0 },
  { stream: 0, offset: 28, type: D3DDECLTYPE.FLOAT3, method: 0, usage: D3DDECLUSAGE.NORMAL, usageIndex: 0 },
  { stream: 0, offset: 40, type: D3DDECLTYPE.FLOAT2, method: 0, usage: D3DDECLUSAGE.TEXCOORD, usageIndex: 0 },
];
const SKIN_STRIDE = 48;
interface SkinVertex { p: [number, number, number]; w: [number, number, number]; idx: [number, number, number, number]; n: [number, number, number]; uv: [number, number] }
const sv = (p: [number, number, number], w: [number, number, number], idx: [number, number, number, number], n: [number, number, number] = [0, 0, 1], uv: [number, number] = [0.125, 0.5]): SkinVertex => ({ p, w, idx, n, uv });
function packSkinned(vs: SkinVertex[]): Uint8Array {
  const out = new Uint8Array(vs.length * SKIN_STRIDE);
  const dv = new DataView(out.buffer);
  vs.forEach((v, i) => {
    const o = i * SKIN_STRIDE;
    [...v.p, ...v.w].forEach((x, k) => dv.setFloat32(o + k * 4, x, true));
    // a D3DCOLOR dword is 0xAARRGGBB: bone k is stored in byte k (B, G, R, A), which is what D3DCOLORtoUBYTE4 puts back into x, y, z, w
    v.idx.forEach((x, k) => dv.setUint8(o + 24 + k, x));
    v.n.forEach((x, k) => dv.setFloat32(o + 28 + k * 4, x, true));
    v.uv.forEach((x, k) => dv.setFloat32(o + 40 + k * 4, x, true));
  });
  return out;
}
function drawSkinned(dev: Direct3DDevice9, vs: SkinVertex[]): void {
  const { hr, decl } = dev.CreateVertexDeclaration(SKIN_DECL);
  expect(hr).toBe(0);
  expect(dev.SetVertexDeclaration(decl)).toBe(0);
  expect(dev.DrawPrimitiveUP(D3DPT.TRIANGLELIST, vs.length / 3, packSkinned(vs), SKIN_STRIDE)).toBe(0);
}
/** a quad (two triangles, counter-clockwise on screen) [x0, x1] x [y0, y1] at z 0.5 in the given bones / weights */
function skinQuad(x0: number, x1: number, y0: number, y1: number, w: [number, number, number], idx: [number, number, number, number], n: [number, number, number] = [0, 0, 1]): SkinVertex[] {
  const a = sv([x0, y0, 0.5], w, idx, n), b = sv([x1, y0, 0.5], w, idx, n), c = sv([x0, y1, 0.5], w, idx, n), d = sv([x1, y1, 0.5], w, idx, n);
  return [a, b, c, b, d, c];
}
function setPalette(fx: D3DXEffect, P: Scene["P"], slots: Record<number, Float32Array>, fill: Float32Array = matTranslation(-0.9, 0, 0)): void {
  const pal = new Float32Array(XR.PALETTE_SIZE * 16);
  for (let i = 0; i < XR.PALETTE_SIZE; i++) pal.set(slots[i] ?? fill, i * 16);
  expect(fx.SetMatrixArray(P("g_amWorldPalette"), pal, XR.PALETTE_SIZE)).toBe(0);
}
/** row vector times the 4x4 (D3D rows), as HLSL `mul(float3, float4x4)` does it: w is not part of the vector */
const mulN = (v: [number, number, number], m: ArrayLike<number>): [number, number, number, number] =>
  [0, 1, 2, 3].map((j) => v[0] * m[j]! + v[1] * m[4 + j]! + v[2] * m[8 + j]!) as [number, number, number, number];

describe("XRenderer.fx: skinning (1-4 bones, D3DCOLOR indices, palette of 20)", () => {
  // bone translations (x): bone k of a vertex is palette[idx[k]]; the unused slots hold a decoy that sends the quad off screen
  const T = [-0.2, 0.4, 0.8, 1.2];
  const IDX: [number, number, number, number] = [3, 7, 12, 19];
  /**
   * What the vertex stores for n bones: 1 bone ignores the weights, 2 and 3 bones use w0, w1 (, w2) as they are, 4 bones use w0, w1, w2 and what is left of 1 for the last
   * one.  VS_Skin never normalises, so a real vertex has weights that add up to 1.
   */
  const WEIGHTS: Record<number, [number, number, number]> = { 1: [0, 0, 0], 2: [0.25, 0.75, 0], 3: [0.25, 0.25, 0.5], 4: [0.25, 0.25, 0.25] };
  const shift = (bones: number): number => {
    const w = WEIGHTS[bones]!;
    if (bones === 1) return T[0]!;
    const ws = bones === 4 ? [w[0], w[1], w[2], 1 - w[0] - w[1] - w[2]] : w.slice(0, bones);
    return ws.reduce((sum, x, k) => sum + x! * T[k]!, 0);
  };

  for (const fog of [false, true]) {
    gpuTest(`position: ${fog ? "with" : "without"} fog, 1 to 4 bones blend the palette entries the indices name`, async () => {
      const { dev, fx, P } = await scene();
      const slots: Record<number, Float32Array> = {};
      IDX.forEach((slot, k) => { slots[slot] = matTranslation(T[k]!, 0, 0); });
      setPalette(fx, P, slots);
      dev.SetTexture(0, strip(dev, [[200, 100, 50]]));
      if (fog) {
        fx.SetBool(P("g_bFog"), true);
        fx.SetVector(P("g_fFog"), [1, 0, 1, 0]); // factor 1: no fog, but the fog variant of the shader runs
        fx.SetVector(P("g_fColor"), [0, 0, 1, 1]);
      }
      const h = 0.2037;
      for (let bones = 1; bones <= 4; bones++) {
        dev.Clear(null, D3DCLEAR.TARGET | D3DCLEAR.ZBUFFER, argb(255, BG[0], BG[1], BG[2]), 1, 0);
        fx.SetInt(P("g_iShaderIndex"), shaderIndex(bones, fog));
        run(fx, "REAL_COLOR", () => drawSkinned(dev, skinQuad(-h, h, -0.5, 0.5, WEIGHTS[bones]!, IDX)));
        const img = await snap(dev);
        const [x0, x1] = spanX(-h + shift(bones), h + shift(bones));
        expect(rowSpan(img, H / 2, 40)).toEqual([x0, x1]);
        expectColor(pixel(img, Math.round((x0 + x1) / 2)), [200, 100, 50]);
      }
      expect(await dev.takeErrorsAsync()).toEqual([]);
    });
  }

  gpuTest("normals: blended with the same weights, then normalised, then dotted with g_LightPos (CARTOON)", async () => {
    const { dev, fx, P } = await scene();
    const rz = matRotationZ(Math.PI / 2);
    // two bones, weights (1/2, 1/2): palette[2] = identity, palette[5] = a quarter turn about z (the viewport centre stays inside the quad)
    setPalette(fx, P, { 2: matIdentity(), 5: rz });
    const ramp = [10, 40, 80, 120, 160, 200, 230, 250].map((v) => [v, v, v]);
    dev.SetTexture(0, strip(dev, [[255, 255, 255]]));
    dev.SetTexture(1, strip(dev, ramp));
    const n: [number, number, number] = [3, 0, 0]; // not a unit vector: it is the normalised blend that counts
    const L: [number, number, number, number] = [0, 1, 0, 0.7];
    fx.SetVector(P("g_LightPos"), L);
    // model: blend, normalise (4 components, w = n . column 3 = 0), dot
    const blend = [0, 1, 2, 3].map((j) => 0.5 * mulN(n, matIdentity())[j]! + 0.5 * mulN(n, rz)[j]!);
    const len = Math.hypot(...blend);
    const d = (blend[0]! * L[0] + blend[1]! * L[1] + blend[2]! * L[2] + blend[3]! * L[3]) / len;
    expect(d).toBeCloseTo(0.7071, 3);
    const texel = ramp[Math.floor(d * 8)]![0]!;
    expect(texel).toBe(200);
    expect(ramp[Math.floor(0.5 * 8)]![0]).toBe(160); // an un-normalised blend would have read another texel
    const w2: [number, number, number] = [0.5, 0.5, 0];
    const big: SkinVertex[] = [sv([-3, -3, 0.5], w2, [2, 5, 0, 0], n), sv([9, -3, 0.5], w2, [2, 5, 0, 0], n), sv([-3, 9, 0.5], w2, [2, 5, 0, 0], n)];
    for (const fog of [false, true]) {
      dev.Clear(null, D3DCLEAR.TARGET | D3DCLEAR.ZBUFFER, argb(255, 0, 0, 0), 1, 0);
      fx.SetBool(P("g_bFog"), fog);
      fx.SetVector(P("g_fFog"), [1, 0, 1, 0]);
      fx.SetInt(P("g_iShaderIndex"), shaderIndex(2, fog));
      run(fx, "CARTOON", () => drawSkinned(dev, big));
      expectColor(pixel(await snap(dev)), [texel, texel, texel]);
    }
    expect(await dev.takeErrorsAsync()).toEqual([]);
  });

  gpuTest("every vertex shader of the file compiles and draws (12 arrays, 80 entries)", async () => {
    const { dev, fx, P } = await scene();
    const slots: Record<number, Float32Array> = {};
    for (let i = 0; i < XR.PALETTE_SIZE; i++) slots[i] = matIdentity();
    setPalette(fx, P, slots);
    dev.SetTexture(0, strip(dev, [[200, 100, 50]]));
    dev.SetTexture(1, strip(dev, [[100, 100, 100]]));
    fx.SetFloat(P("g_fLightFlowWide"), 1000);
    fx.SetFloat(P("g_fOutLineWide"), 0.01);
    fx.SetVector(P("g_fFog"), [1, 0, 1, 0]);
    const w: [number, number, number] = [0.25, 0.25, 0.25];
    const quad = skinQuad(-0.3, 0.3, -0.3, 0.3, w, [0, 1, 2, 3]); // (with 2 or 3 bones the weights add up to less than 1: smaller, still on screen)
    const sets: [string, number][] = [
      ["REAL_COLOR", 10], ["CARTOON", 10], ["BLACK_EDGE", 10], ["COLOR_EDGE", 10],
      ...["WORLD", "LOCAL"].flatMap((sp) => ["X", "Y", "Z", "POINT"].map((ax): [string, number] => [`LIGHT_FLOW_${sp}_${ax}`, 5])),
    ];
    let count = 0;
    for (const [technique, n] of sets) {
      for (let index = 0; index < n; index++) {
        dev.Clear(null, D3DCLEAR.TARGET | D3DCLEAR.ZBUFFER, argb(255, BG[0], BG[1], BG[2]), 1, 0);
        fx.SetBool(P("g_bFog"), index >= 5);
        fx.SetInt(P("g_iShaderIndex"), index);
        run(fx, technique, () => drawSkinned(dev, quad));
        count++;
        const errors = await dev.takeErrorsAsync();
        if (errors.length) throw new Error(`${technique} index ${index}: ${errors.join("; ")}`);
        // the shaded techniques put something on screen (the flow techniques depend on blending, which this test does not set up)
        if (!technique.startsWith("LIGHT_FLOW") && technique !== "COLOR_EDGE") {
          const p = (await snap(dev)).at(W / 2, H / 2);
          expect(Math.abs(p.r - BG[0]) + Math.abs(p.g - BG[1]) + Math.abs(p.b - BG[2])).toBeGreaterThan(20);
        }
      }
    }
    expect(count).toBe(80);
  });
});

// ============================================================================================================= fog
describe("XRenderer.fx: vertex fog (VS_Fog -> oFog -> FogColor)", () => {
  const SRC = [200, 100, 50];
  const FOG = [51, 102, 153]; // g_fColor = (0.2, 0.4, 0.6, 1)
  const mix = (f: number): number[] => SRC.map((c, i) => f * c + (1 - f) * FOG[i]!);
  async function fogScene(): Promise<Scene> {
    const s = await scene();
    s.dev.SetTexture(0, strip(s.dev, [SRC]));
    s.fx.SetBool(s.P("g_bFog"), true);
    s.fx.SetInt(s.P("g_iShaderIndex"), shaderIndex(0, true));
    s.fx.SetVector(s.P("g_fColor"), [0.2, 0.4, 0.6, 1]);
    s.fx.SetVector(s.P("g_fEye"), [0, 0, 0.5, 1]);
    return s;
  }

  gpuTest("a constant factor: max(x, z) - g_fDensity", async () => {
    const { dev, fx, P } = await fogScene();
    fx.SetVector(P("g_fFog"), [0.8, 0, 0.3, 0]);
    fx.SetFloat(P("g_fDensity"), 0.1);
    run(fx, "REAL_COLOR", () => drawRigid(dev, bigTriangle()));
    expectColor(pixel(await snap(dev)), mix(0.7));
    // the other branch of max()
    dev.Clear(null, D3DCLEAR.TARGET | D3DCLEAR.ZBUFFER, argb(255, 0, 0, 0), 1, 0);
    fx.SetVector(P("g_fFog"), [0.1, 0, 0.9, 0]);
    run(fx, "REAL_COLOR", () => drawRigid(dev, bigTriangle()));
    expectColor(pixel(await snap(dev)), mix(0.8));
    // fully fogged / not fogged at all: clamped
    dev.Clear(null, D3DCLEAR.TARGET | D3DCLEAR.ZBUFFER, argb(255, 0, 0, 0), 1, 0);
    fx.SetVector(P("g_fFog"), [-3, 0, -3, 0]);
    run(fx, "REAL_COLOR", () => drawRigid(dev, bigTriangle()));
    expectColor(pixel(await snap(dev)), FOG);
    dev.Clear(null, D3DCLEAR.TARGET | D3DCLEAR.ZBUFFER, argb(255, 0, 0, 0), 1, 0);
    fx.SetVector(P("g_fFog"), [7, 0, 7, 0]);
    run(fx, "REAL_COLOR", () => drawRigid(dev, bigTriangle()));
    expectColor(pixel(await snap(dev)), SRC);
    expect(await dev.takeErrorsAsync()).toEqual([]);
  });

  gpuTest("distance from g_fEye: x + length(wPos - eye) * y (linear fog from 0 to 4: x = 1, y = -1/4)", async () => {
    const { dev, fx, P } = await fogScene();
    fx.SetVector(P("g_fFog"), [1, -0.25, -10, 0]);
    fx.SetFloat(P("g_fDensity"), 0);
    // an equilateral triangle on the circle of radius 1.5 around the eye: every vertex has the same factor 1 - 1.5 / 4
    const at = (deg: number): RigidVertex => rv(1.5 * Math.cos((deg * Math.PI) / 180), 1.5 * Math.sin((deg * Math.PI) / 180), 0.5);
    run(fx, "REAL_COLOR", () => drawRigid(dev, [at(90), at(210), at(330)]));
    expectColor(pixel(await snap(dev)), mix(0.625));
    // `length(wPos - g_fEye)` is the length of a float4: an eye with w = 0 sees the positions (w = 1) one unit further away
    dev.Clear(null, D3DCLEAR.TARGET | D3DCLEAR.ZBUFFER, argb(255, 0, 0, 0), 1, 0);
    fx.SetVector(P("g_fEye"), [0, 0, 0.5, 0]);
    run(fx, "REAL_COLOR", () => drawRigid(dev, [at(90), at(210), at(330)]));
    expectColor(pixel(await snap(dev)), mix(1 - Math.hypot(1.5, 1) / 4));
    fx.SetVector(P("g_fEye"), [0, 0, 0.5, 1]);
    // the eye moves with the constant: the same triangle seen from (1.5, 0, 0.5)
    dev.Clear(null, D3DCLEAR.TARGET | D3DCLEAR.ZBUFFER, argb(255, 0, 0, 0), 1, 0);
    fx.SetVector(P("g_fEye"), [1.5, 0, 0.5, 1]);
    run(fx, "REAL_COLOR", () => drawRigid(dev, [at(180 - 60), at(180 + 60), at(180)].map((v) => rv(v[0] * 0.5, v[1] * 0.5, 0.5)))); // radius 0.75 around (0, 0): distance to the eye 1.5 +- 0.75
    const img = await snap(dev);
    // the fog factor is interpolated between the vertices: 1 - d / 4 at each, with d measured to (1.5, 0, 0.5)
    const vs = [at(120), at(240), at(180)].map((v) => [v[0] * 0.5, v[1] * 0.5]);
    const f = vs.map((v) => 1 - Math.hypot(v[0]! - 1.5, v[1]!) / 4);
    expect(f.every((x) => x > 0.4 && x < 0.9)).toBe(true);
    // a pixel inside: barycentric interpolation of the three factors
    const cx = (vs[0]![0]! + vs[1]![0]! + vs[2]![0]!) / 3, cy = (vs[0]![1]! + vs[1]![1]! + vs[2]![1]!) / 3;
    const px = Math.round(((cx + 1) * W) / 2), py = Math.round(((1 - cy) * H) / 2);
    const x = ndcX(px), y = ndcY(py);
    const [a, b, c] = vs as [number[], number[], number[]];
    const den = (b[1]! - c[1]!) * (a[0]! - c[0]!) + (c[0]! - b[0]!) * (a[1]! - c[1]!);
    const l1 = ((b[1]! - c[1]!) * (x - c[0]!) + (c[0]! - b[0]!) * (y - c[1]!)) / den;
    const l2 = ((c[1]! - a[1]!) * (x - c[0]!) + (a[0]! - c[0]!) * (y - c[1]!)) / den;
    const want = l1 * f[0]! + l2 * f[1]! + (1 - l1 - l2) * f[2]!;
    expectColor(pixel(img, px, py), mix(want), 3);
  });

  gpuTest("height: z + wPos.y * w, per pixel row (negative factors clamp to full fog)", async () => {
    const { dev, fx, P } = await fogScene();
    fx.SetVector(P("g_fFog"), [-10, 0, 0.2, 0.5]);
    fx.SetFloat(P("g_fDensity"), 0);
    run(fx, "REAL_COLOR", () => drawRigid(dev, bigTriangle()));
    const img = await snap(dev);
    for (const row of [8, 16, 24, 36, 44, 56]) {
      const y = ndcY(row);
      expectColor(pixel(img, 32, row), mix(Math.max(0, Math.min(1, 0.2 + 0.5 * y))), 2.5);
    }
  });

  gpuTest("light flow ignores fog; so does a technique run with g_bFog false", async () => {
    const { dev, fx, P } = await fogScene();
    fx.SetVector(P("g_fFog"), [-3, 0, -3, 0]); // everything fogged...
    fx.SetBool(P("g_bFog"), false);
    fx.SetInt(P("g_iShaderIndex"), 0);
    run(fx, "REAL_COLOR", () => drawRigid(dev, bigTriangle()));
    expectColor(pixel(await snap(dev)), SRC); // ... unless FogEnable is off
  });
});

// ================================================================================================= light flow
describe("XRenderer.fx: LIGHT_FLOW_* (alpha = g_Color.a / (1e-5 + distance / g_fLightFlowWide), blended SRCALPHA / DESTALPHA)", () => {
  const t = [0.25, -0.125, 0.0625]; // palette[0] = g_mWorldViewProj = translation: world = local + t
  const A0 = 0.15, WIDE = 0.5, D = 0.25;
  const BGF = [20, 40, 60];

  for (const space of ["WORLD", "LOCAL"] as const) {
    for (const axis of ["X", "Y", "Z", "POINT"] as const) {
      gpuTest(`${space} ${axis}`, async () => {
        const { dev, fx, P } = await scene();
        dev.Clear(null, D3DCLEAR.TARGET | D3DCLEAR.ZBUFFER, argb(255, BGF[0]!, BGF[1]!, BGF[2]!), 1, 0);
        dev.SetTextureStageState(0, D3DTSS.COLOROP, D3DTOP.SELECTARG1); // the pass sets ColorArg1[0] = Diffuse but leaves ColorOp to the caller
        const tm = matTranslation(t[0]!, t[1]!, t[2]!);
        fx.SetMatrixArray(P("g_amWorldPalette"), tm, 1);
        fx.SetMatrix(P("g_mWorldViewProj"), tm);
        fx.SetVector(P("g_Color"), [1, 0.5, 0.25, A0]);
        fx.SetFloat(P("g_fLightFlowWide"), WIDE);
        const impact = axis === "Z" ? 0.5 : 0.1;
        fx.SetFloat(P("g_fLightFlowImpact"), impact);
        const pt = [0.3, 0.1, 0.4, 1];
        fx.SetVector(P("g_LightFlowPoint"), pt);
        // vertices in the space the technique measures in, all at distance D from the impact plane / point
        const vals = [impact + D, impact - D, impact + D];
        let R: number[][];
        if (axis === "X") R = [[vals[0]!, -0.5, 0.4], [vals[1]!, 0, 0.4], [vals[2]!, 0.5, 0.4]];
        else if (axis === "Y") R = [[-0.5, vals[0]!, 0.4], [0, vals[1]!, 0.4], [0.5, vals[2]!, 0.4]];
        else if (axis === "Z") R = [[-0.5, -0.5, vals[0]!], [0.5, 0, vals[1]!], [-0.5, 0.5, vals[2]!]];
        else R = [0, 120, 240].map((a) => [pt[0]! + D * Math.cos((a * Math.PI) / 180), pt[1]! + D * Math.sin((a * Math.PI) / 180), pt[2]!]);
        const L = R.map((r) => (space === "WORLD" ? [r[0]! - t[0]!, r[1]! - t[1]!, r[2]! - t[2]!] : r));
        const Wd = L.map((l) => [l[0]! + t[0]!, l[1]! + t[1]!]);
        run(fx, `LIGHT_FLOW_${space}_${axis}`, () => drawRigid(dev, L.map((l) => rv(l[0]!, l[1]!, l[2]!))));
        const img = await snap(dev);
        const cx = (Wd[0]![0]! + Wd[1]![0]! + Wd[2]![0]!) / 3, cy = (Wd[0]![1]! + Wd[1]![1]! + Wd[2]![1]!) / 3;
        // Diffuse.a = A0 / (1e-5 + D / WIDE), saturated; AlphaOp[0] = Add(Current, Diffuse): twice that; blend: src * a + dst * 1 (the target has no alpha: DESTALPHA = 1)
        const da = Math.min(1, A0 / (0.00001 + D / WIDE)), a = Math.min(1, 2 * da);
        const want = [255 * a + BGF[0]!, 127.5 * a + BGF[1]!, 63.75 * a + BGF[2]!];
        expectColor(pixel(img, Math.round(((cx + 1) * W) / 2), Math.round(((1 - cy) * H) / 2)), want, 3);
        expect(await dev.takeErrorsAsync()).toEqual([]);
      });
    }
  }

  for (const space of ["WORLD", "LOCAL"] as const) {
    gpuTest(`skinned ${space} X: measured at the skinned position (WORLD) or at the stored one (LOCAL)`, async () => {
      const { dev, fx, P } = await scene();
      dev.Clear(null, D3DCLEAR.TARGET | D3DCLEAR.ZBUFFER, argb(255, BGF[0]!, BGF[1]!, BGF[2]!), 1, 0);
      dev.SetTextureStageState(0, D3DTSS.COLOROP, D3DTOP.SELECTARG1);
      // two bones, weights 1/2 and 1/2: palette[1] = identity, palette[4] = translation (0.5, 0, 0): every vertex moves by +0.25 in x
      setPalette(fx, P, { 1: matIdentity(), 4: matTranslation(0.5, 0, 0) });
      fx.SetVector(P("g_Color"), [1, 0.5, 0.25, A0]);
      fx.SetFloat(P("g_fLightFlowWide"), WIDE);
      fx.SetFloat(P("g_fLightFlowImpact"), 0.1);
      fx.SetInt(P("g_iShaderIndex"), 2);
      // the vertices are D = 0.25 away from the plane x = 0.1 in the space that is measured, so the alpha is constant over the triangle
      const measured = [0.1 + D, 0.1 - D, 0.1 + D];
      const xs = measured.map((x) => (space === "WORLD" ? x - 0.25 : x)); // stored x
      const w: [number, number, number] = [0.5, 0.5, 0];
      const verts = xs.map((x, i) => sv([x, [-0.5, 0, 0.5][i]!, 0.5], w, [1, 4, 0, 0]));
      run(fx, `LIGHT_FLOW_${space}_X`, () => drawSkinned(dev, verts));
      const img = await snap(dev);
      const a = Math.min(1, 2 * Math.min(1, A0 / (0.00001 + D / WIDE)));
      const cx = (xs[0]! + xs[1]! + xs[2]!) / 3 + 0.25; // the screen position is the skinned one in both techniques
      expectColor(pixel(img, Math.round(((cx + 1) * W) / 2), H / 2), [255 * a + BGF[0]!, 127.5 * a + BGF[1]!, 63.75 * a + BGF[2]!], 3);
      expect(await dev.takeErrorsAsync()).toEqual([]);
    });
  }
});

// ==================================================================================== the device hook (vshader.ts)
describe("emulated vertex shaders: SetVertexShader / SetVertexShaderConstantF on the device", () => {
  const FLAT: EmulatedVertexShader = {
    name: "t:flat", writes: { diffuse: true, specular: false, fog: false, texCoords: 1 },
    wgsl: `fn user_vs(i: SIn) -> SOut {
  var o: SOut;
  o.pos = vec4f(i.pos.xyz + vc[0].xyz, i.pos.w);
  o.c0 = vc[1];
  o.t[0] = vec4f(i.tex[0].xy, 0.0, 1.0);
  return o;
}`,
  };
  const XYZ_TEX = D3DFVF.XYZ | D3DFVF.TEX1;
  const quad = (x0: number, x1: number, y0 = -0.5, y1 = 0.5, z = 0.5): number[][] => [[x0, y0, z, 0.125, 0.5], [x1, y0, z, 0.125, 0.5], [x0, y1, z, 0.125, 0.5], [x1, y0, z, 0.125, 0.5], [x1, y1, z, 0.125, 0.5], [x0, y1, z, 0.125, 0.5]];
  function drawFvf(dev: Direct3DDevice9, fvf: number, verts: number[][]): void {
    const { bytes, stride } = packVertices(fvf, verts);
    dev.SetFVF(fvf);
    expect(dev.DrawPrimitiveUP(D3DPT.TRIANGLELIST, verts.length / 3, bytes, stride)).toBe(0);
  }
  async function vsDevice(def: EmulatedVertexShader, warnings: string[] = []): Promise<Direct3DDevice9> {
    const dev = await newD3D9(W, H, { warn: (m: string) => warnings.push(m) });
    const { hr, shader } = dev.CreateEmulatedVertexShader(def);
    expect(hr).toBe(0);
    expect(dev.SetVertexShader(shader)).toBe(0);
    dev.Clear(null, D3DCLEAR.TARGET | D3DCLEAR.ZBUFFER, argb(255, BG[0], BG[1], BG[2]), 1, 0);
    dev.SetRenderState(D3DRS.CULLMODE, D3DCULL.NONE);
    return dev;
  }

  gpuTest("constants are read per draw: two draws of one frame see two different register files", async () => {
    const dev = await vsDevice(FLAT);
    dev.SetVertexShaderConstantF(0, [-0.5, 0, 0, 0, 1, 0, 0, 1], 2); // offset, colour (red)
    drawFvf(dev, XYZ_TEX, quad(0, 0.4));
    dev.SetVertexShaderConstantF(1, [0, 1, 0, 1], 1); // colour (green)
    dev.SetVertexShaderConstantF(0, [0.5, 0, 0, 0], 1);
    drawFvf(dev, XYZ_TEX, quad(0, 0.4));
    const img = await snap(dev);
    expectColor(pixel(img, Math.round(((-0.3 + 1) * W) / 2)), [255, 0, 0]);
    expectColor(pixel(img, Math.round(((0.7 + 1) * W) / 2)), [0, 255, 0]);
    expect(rowSpan(img, H / 2, 40)).toEqual([spanX(-0.5, -0.1)[0], spanX(0.5, 0.9)[1]]);
    expect(await dev.takeErrorsAsync()).toEqual([]);
  });

  gpuTest("register file access: ranges, bounds, partial updates", async () => {
    const dev = await newD3D9(8, 8);
    expect(dev.GetVertexShaderConstantF(0, 256).data.every((x) => x === 0)).toBe(true);
    expect(dev.SetVertexShaderConstantF(3, [1, 2, 3, 4, 5, 6, 7, 8], 2)).toBe(0);
    expect(Array.from(dev.GetVertexShaderConstantF(2, 4).data)).toEqual([0, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 0, 0, 0, 0]);
    expect(dev.SetVertexShaderConstantF(255, [9, 9, 9, 9], 1)).toBe(0);
    expect(dev.SetVertexShaderConstantF(256, [9, 9, 9, 9], 1)).toBe(D3DERR_INVALIDCALL);
    expect(dev.SetVertexShaderConstantF(255, [9, 9, 9, 9, 9, 9, 9, 9], 2)).toBe(D3DERR_INVALIDCALL);
    expect(dev.SetVertexShaderConstantF(-1, [9, 9, 9, 9], 1)).toBe(D3DERR_INVALIDCALL);
    expect(dev.SetVertexShaderConstantF(0, [1, 2, 3], 1)).toBe(D3DERR_INVALIDCALL); // too little data
    expect(dev.GetVertexShaderConstantF(250, 7).hr).toBe(D3DERR_INVALIDCALL);
    expect(VS_REGISTERS).toBe(256);
    // Reset puts everything back, like any other state
    const { shader } = dev.CreateEmulatedVertexShader(FLAT);
    dev.SetVertexShader(shader);
    expect(dev.GetVertexShader()).toBe(shader);
    expect(dev.Reset(8, 8)).toBe(0);
    expect(dev.GetVertexShader()).toBeNull();
    expect(dev.GetVertexShaderConstantF(3, 2).data.every((x) => x === 0)).toBe(true);
    // a shader needs its entry point
    expect(dev.CreateEmulatedVertexShader({ name: "t:bad", wgsl: "fn main() {}", writes: { diffuse: false, specular: false, fog: false, texCoords: 0 } }).hr).toBe(D3DERR_INVALIDCALL);
  });

  gpuTest("inputs by semantic: a missing element reads (0, 0, 0, 1); D3DCOLOR arrives as (r, g, b, a)", async () => {
    const dev = await vsDevice({
      name: "t:inputs", writes: { diffuse: true, specular: false, fog: false, texCoords: 0 },
      wgsl: `fn user_vs(i: SIn) -> SOut {
  var o: SOut;
  o.pos = i.pos;
  o.c0 = vec4f(i.normal.w, i.weights.w, i.tex[3].w, 1.0);
  return o;
}`,
    });
    const tri = [[-1, -1, 0.5], [3, -1, 0.5], [-1, 3, 0.5]];
    drawFvf(dev, D3DFVF.XYZ, tri); // no normal, weights or texture coordinates at all: the w of each is 1
    expectColor(pixel(await snap(dev)), [255, 255, 255]);
    // the vertex colour: argb(255, 200, 100, 50) is r = 200, g = 100, b = 50
    const dev2 = await vsDevice({
      name: "t:diffuse", writes: { diffuse: true, specular: false, fog: false, texCoords: 0 },
      wgsl: `fn user_vs(i: SIn) -> SOut { var o: SOut; o.pos = i.pos; o.c0 = i.color0; return o; }`,
    });
    drawFvf(dev2, D3DFVF.XYZ | D3DFVF.DIFFUSE, tri.map((p) => [...p, argb(255, 200, 100, 50)]));
    expectColor(pixel(await snap(dev2)), [200, 100, 50]);
    // normal and texture coordinate sets by index
    const dev3 = await vsDevice({
      name: "t:normal", writes: { diffuse: true, specular: false, fog: false, texCoords: 0 },
      wgsl: `fn user_vs(i: SIn) -> SOut { var o: SOut; o.pos = i.pos; o.c0 = vec4f(i.normal.xyz, 1.0) * vec4f(1.0, 1.0, 1.0, 1.0) * 0.5 + vec4f(i.tex[1].xy, 0.0, 0.0) * 0.5; return o; }`,
    });
    drawFvf(dev3, D3DFVF.XYZ | D3DFVF.NORMAL | D3DFVF.TEX2, tri.map((p) => [...p, 0.2, 0.4, 0.8, 0.1, 0.1, 0.5, 0.25]));
    expectColor(pixel(await snap(dev3)), [255 * (0.1 + 0.25), 255 * (0.2 + 0.125), 255 * 0.4], 3);
    expect(await dev.takeErrorsAsync()).toEqual([]);
    expect(await dev2.takeErrorsAsync()).toEqual([]);
    expect(await dev3.takeErrorsAsync()).toEqual([]);
  });

  gpuTest("outputs: oD0 is saturated, oT[i] feeds stage i (TEXCOORDINDEX and the texture transform are fixed-function vertex state: ignored)", async () => {
    const dev = await vsDevice({
      name: "t:out", writes: { diffuse: true, specular: false, fog: false, texCoords: 2 },
      wgsl: `fn user_vs(i: SIn) -> SOut {
  var o: SOut;
  o.pos = i.pos;
  o.c0 = vec4f(2.0, -1.0, 0.5, 1.5);
  o.t[0] = vec4f(0.625, 0.5, 0.0, 1.0);
  return o;
}`,
    });
    const tri = [[-1, -1, 0.5, 0.125, 0.5], [3, -1, 0.5, 0.125, 0.5], [-1, 3, 0.5, 0.125, 0.5]];
    dev.SetTexture(0, strip(dev, TEXELS));
    // stage 0 shows the diffuse colour alone first
    dev.SetTextureStageState(0, D3DTSS.COLOROP, D3DTOP.SELECTARG1);
    dev.SetTextureStageState(0, D3DTSS.COLORARG1, D3DTA.DIFFUSE);
    drawFvf(dev, XYZ_TEX, tri);
    expectColor(pixel(await snap(dev)), [255, 0, 128]);
    // the texture: oT[0] = (0.625, 0.5) -> texel 2, whatever the vertex carries, whatever TEXCOORDINDEX / the texture transform say
    dev.SetTextureStageState(0, D3DTSS.COLORARG1, D3DTA.TEXTURE);
    dev.SetTextureStageState(0, D3DTSS.TEXCOORDINDEX, 1);
    dev.SetTextureStageState(0, D3DTSS.TEXTURETRANSFORMFLAGS, D3DTTFF.COUNT2);
    dev.SetTransform(D3DTS.TEXTURE0, matTranslation(0.25, 0, 0));
    drawFvf(dev, XYZ_TEX, tri);
    expectColor(pixel(await snap(dev)), [60, 60, 240]);
    expect(await dev.takeErrorsAsync()).toEqual([]);
  });

  gpuTest("the fixed-function vertex stage is bypassed (transforms, lighting) until SetVertexShader(null)", async () => {
    const dev = await vsDevice(FLAT);
    dev.SetTransform(D3DTS_WORLD, matTranslation(0.5, 0, 0));
    dev.SetRenderState(D3DRS.LIGHTING, 1);
    dev.SetVertexShaderConstantF(1, [1, 1, 1, 1], 1);
    drawFvf(dev, XYZ_TEX, quad(-0.5, 0));
    let img = await snap(dev);
    expect(rowSpan(img, H / 2, 40)).toEqual(spanX(-0.5, 0));
    // back to the fixed function pipeline: the world matrix applies
    dev.Clear(null, D3DCLEAR.TARGET | D3DCLEAR.ZBUFFER, argb(255, BG[0], BG[1], BG[2]), 1, 0);
    dev.SetVertexShader(null);
    dev.SetRenderState(D3DRS.LIGHTING, 0);
    drawFvf(dev, XYZ_TEX, quad(-0.5, 0));
    img = await snap(dev);
    expect(rowSpan(img, H / 2, 40)).toEqual(spanX(0, 0.5));
    expect(await dev.takeErrorsAsync()).toEqual([]);
  });

  gpuTest("oFog drives the fog blend when FogEnable is on, FogVertexMode is not NONE and the shader writes it", async () => {
    const warnings: string[] = [];
    const fogging: EmulatedVertexShader = {
      name: "t:fog", writes: { diffuse: true, specular: false, fog: true, texCoords: 0 },
      wgsl: `fn user_vs(i: SIn) -> SOut { var o: SOut; o.pos = i.pos; o.c0 = vec4f(1.0, 0.0, 0.0, 1.0); o.fog = vc[0].x; return o; }`,
    };
    const dev = await vsDevice(fogging, warnings);
    const tri = [[-1, -1, 0.5, 0, 0], [3, -1, 0.5, 0, 0], [-1, 3, 0.5, 0, 0]];
    dev.SetTextureStageState(0, D3DTSS.COLOROP, D3DTOP.SELECTARG1);
    dev.SetTextureStageState(0, D3DTSS.COLORARG1, D3DTA.DIFFUSE);
    dev.SetVertexShaderConstantF(0, [0.25, 0, 0, 0], 1);
    dev.SetRenderState(D3DRS.FOGCOLOR, argb(255, 0, 0, 255));
    const fogged = [255 * 0.25, 0, 255 * 0.75];
    const red = [255, 0, 0];
    const draw = async (): Promise<[number, number, number]> => {
      dev.Clear(null, D3DCLEAR.TARGET | D3DCLEAR.ZBUFFER, argb(255, 0, 0, 0), 1, 0);
      drawFvf(dev, XYZ_TEX, tri);
      return pixel(await snap(dev));
    };
    expectColor(await draw(), red); // FogEnable off
    dev.SetRenderState(D3DRS.FOGENABLE, 1);
    dev.SetRenderState(D3DRS.FOGVERTEXMODE, D3DFOG.LINEAR);
    expectColor(await draw(), fogged);
    dev.SetVertexShaderConstantF(0, [1, 0, 0, 0], 1); // factor 1: no fog
    expectColor(await draw(), red);
    dev.SetVertexShaderConstantF(0, [-1, 0, 0, 0], 1); // factor -1: clamped, all fog
    expectColor(await draw(), [0, 0, 255]);
    dev.SetVertexShaderConstantF(0, [0.25, 0, 0, 0], 1);
    dev.SetRenderState(D3DRS.FOGVERTEXMODE, D3DFOG.NONE);
    expectColor(await draw(), red); // no vertex fog mode
    dev.SetRenderState(D3DRS.FOGVERTEXMODE, D3DFOG.LINEAR);
    // a shader that does not write oFog leaves the colour alone
    const plain = dev.CreateEmulatedVertexShader({ ...fogging, name: "t:nofog", writes: { ...fogging.writes, fog: false } }).shader;
    dev.SetVertexShader(plain);
    expectColor(await draw(), red);
    expect(warnings).toEqual([]);
    // table fog needs the view depth of the vertex, which a shader does not give: not emulated, said once
    dev.SetVertexShader(dev.CreateEmulatedVertexShader(fogging).shader);
    dev.SetRenderState(D3DRS.FOGTABLEMODE, D3DFOG.LINEAR);
    expectColor(await draw(), red);
    await draw();
    expect(warnings).toEqual(["table fog together with a vertex shader is not emulated"]);
    expect(await dev.takeErrorsAsync()).toEqual([]);
  });

  gpuTest("a shader that does not compile is reported through the device's error queue", async () => {
    const dev = await vsDevice({ name: "t:broken", writes: { diffuse: false, specular: false, fog: false, texCoords: 0 }, wgsl: `fn user_vs(i: SIn) -> SOut { return missing_symbol; }` });
    drawFvf(dev, XYZ_TEX, quad(-0.5, 0.5));
    await snap(dev);
    const errors = await dev.takeErrorsAsync();
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join("\n")).toContain("missing_symbol");
  });
});
