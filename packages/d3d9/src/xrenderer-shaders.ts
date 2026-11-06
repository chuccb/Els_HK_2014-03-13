/**
 * The vertex shaders of XRenderer.fx (data041.kom, 1,555 lines of HLSL, `vs_1_1`) as WGSL for the emulated vertex stage (vshader.ts).
 *
 * The HLSL is shipped as source and compiled by D3DXCreateEffect at run time (x2.exe.c L434486 `CKTDGXRenderer::OnResetDevice`), so what the
 * exe runs is whatever fxc made of it; this port follows the HLSL statement by statement:
 *
 *  - families: `VertRealColor`, `VertCartoon`, `VertBlackEdge`, `VertColorEdge`, `Vert{X,Y,Z,Point}Flow{World,Local}`, each rigid and
 *    `VertSkinning*(iNumBones)` (1..4), the first four also with and without fog (`_NONFOG`);
 *  - `VS_Skin`: indices from `D3DCOLORtoUBYTE4(BlendIndices)`, 1 bone / 2-3 bones (weights 0..n-1, not renormalised) / 4 bones (the last weight
 *    is 1 - w0 - w1 - w2);
 *  - `mul(float3, float4x4)` (normals) is HLSL's implicit matrix truncation: the result is `v.x * row0 + v.y * row1 + v.z * row2`, so a normal is
 *    not translated; `mul(float4, float4x4)` is the usual row vector times matrix;
 *  - `VS_Fog`: `max(g_fFog.x + length(wPos - g_fEye) * g_fFog.y, g_fFog.z + wPos.y * g_fFog.w) - g_fDensity`, with `length` over all four components;
 *  - vs_1_1 clamps oFog and the colour outputs to [0, 1] (done by the device).
 *
 * The constant register file is laid out by this port (a real compile numbers the registers per shader, and nothing outside the effect sees
 * the numbers): see `XR`.  Matrices are stored as D3D stores them (register k of a matrix = row k) and used as `v * M`.
 * Verified in packages/d3d9/test/xrenderer.test.ts against CPU models written from the HLSL.
 */
import type { EmulatedVertexShader } from "./vshader.ts";

/** Constant register layout. */
export const XR = {
  /** g_amWorldPalette[20]: matrix k = registers 4k .. 4k+3 */
  PAL: 0, PALETTE_SIZE: 20,
  /** g_mWorldViewProj, g_mViewProj (4 registers each) */
  WVP: 80, VP: 84,
  COLOR: 88, LIGHTPOS: 89, OUTLINE: 90, FLOWPT: 91, TEXOFF: 92, FOG: 93, EYE: 94,
  /** (g_fTexOffSet2X, g_fTexOffSet2Y, g_fOutLineWide, g_fLightFlowImpact) */
  S0: 95,
  /** (g_fLightFlowWide, g_fDensity, 0, 0) */
  S1: 96,
  COUNT: 97,
} as const;

/** Register group -> the effect parameters it carries (what a shader that reads the group depends on). */
export const XR_GROUPS: Readonly<Record<string, readonly string[]>> = {
  PAL: ["g_amWorldPalette"], WVP: ["g_mWorldViewProj"], VP: ["g_mViewProj"],
  COLOR: ["g_Color"], LIGHTPOS: ["g_LightPos"], OUTLINE: ["g_OutLineColor"], FLOWPT: ["g_LightFlowPoint"], TEXOFF: ["g_TexOffSet01"],
  FOG: ["g_fFog"], EYE: ["g_fEye"],
  S0: ["g_fTexOffSet2X", "g_fTexOffSet2Y", "g_fOutLineWide", "g_fLightFlowImpact"], S1: ["g_fLightFlowWide", "g_fDensity"],
};

/**
 * FNV-1a of the token stream (comments, white space and macros removed) of every HLSL function of the shipped data041.kom/XRenderer.fx that this
 * file ports.  The effect refuses a file whose function has the same name but another body, so the port can never run with a meaning it was not written for.
 */
export const XR_FUNCTION_HASHES: Readonly<Record<string, number>> = {
  VS_Skin: 0x66cd3007,
  VS_Fog: 0xdc4f0aa8,
  VertRealColor_NONFOG: 0xee6c44ce,
  VertRealColor: 0x5d142919,
  VertSkinningRealColor_NONFOG: 0xd64c68ed,
  VertSkinningRealColor: 0x5da20930,
  VertCartoon_NONFOG: 0x97256a45,
  VertCartoon: 0xeda6168c,
  VertSkinningCartoon_NONFOG: 0x556d4ed1,
  VertSkinningCartoon: 0x79852660,
  VertBlackEdge_NONFOG: 0x324ad1af,
  VertBlackEdge: 0x43d99678,
  VertSkinningBlackEdge_NONFOG: 0x31026eb3,
  VertSkinningBlackEdge: 0xa499d092,
  VertColorEdge_NONFOG: 0xa8dfa3db,
  VertColorEdge: 0x4b8064d8,
  VertSkinningColorEdge_NONFOG: 0x14cf1c3b,
  VertSkinningColorEdge: 0xf4a3a746,
  VertXFlowWorld: 0xc551139e,
  VertSkinningXFlowWorld: 0x18a93261,
  VertYFlowWorld: 0x0dae6874,
  VertSkinningYFlowWorld: 0x65d1fc5b,
  VertZFlowWorld: 0x716c0bfa,
  VertSkinningZFlowWorld: 0x35a42825,
  VertPointFlowWorld: 0xd5096fa8,
  VertSkinningPointFlowWorld: 0xe6c50a5d,
  VertXFlowLocal: 0x7f70ea27,
  VertSkinningXFlowLocal: 0x92a09234,
  VertYFlowLocal: 0xf0a20251,
  VertSkinningYFlowLocal: 0x017a51c6,
  VertZFlowLocal: 0x742bfff7,
  VertSkinningZFlowLocal: 0x8c00f930,
  VertPointFlowLocal: 0xcc94d55d,
  VertSkinningPointFlowLocal: 0x897b787a,
};

export interface XRendererShader extends EmulatedVertexShader {
  /** register groups (keys of XR_GROUPS) the shader reads */
  readonly uses: readonly string[];
}

const HEADER = /* wgsl */ `
const R_PAL: u32 = ${XR.PAL}u; const R_WVP: u32 = ${XR.WVP}u; const R_VP: u32 = ${XR.VP}u;
const R_COLOR: u32 = ${XR.COLOR}u; const R_LIGHTPOS: u32 = ${XR.LIGHTPOS}u; const R_OUTLINE: u32 = ${XR.OUTLINE}u; const R_FLOWPT: u32 = ${XR.FLOWPT}u;
const R_TEXOFF: u32 = ${XR.TEXOFF}u; const R_FOG: u32 = ${XR.FOG}u; const R_EYE: u32 = ${XR.EYE}u; const R_S0: u32 = ${XR.S0}u; const R_S1: u32 = ${XR.S1}u;
// mul(float4, float4x4) with the matrix in registers b .. b+3 (its rows)
fn m4(v: vec4f, b: u32) -> vec4f { return v.x * vc[b] + v.y * vc[b + 1u] + v.z * vc[b + 2u] + v.w * vc[b + 3u]; }
// mul(float3, float4x4): the matrix is truncated to float3x4 (rows 0..2), the result has four components
fn m3(v: vec3f, b: u32) -> vec4f { return v.x * vc[b] + v.y * vc[b + 1u] + v.z * vc[b + 2u]; }
struct SkinOut { pos: vec4f, nor: vec4f }
fn vs_fog(wp: vec4f) -> f32 {
  let xpos = wp - vc[R_EYE];
  let xfog = vc[R_FOG].x + length(xpos) * vc[R_FOG].y;
  let yfog = vc[R_FOG].z + wp.y * vc[R_FOG].w;
  return max(xfog, yfog) + (-1.0 * vc[R_S1].y);
}
fn pal(index: i32) -> u32 { return R_PAL + u32(index) * 4u; }
`;

/** `VS_Skin( vInput, iNumBones )` for a given bone count. */
function skinFunction(nb: number): string {
  const head = `
fn skin(i: SIn) -> SkinOut {
  let ai = vec4i(vec4f(i.indices.z, i.indices.y, i.indices.x, i.indices.w) * 255.001953); // (int[4]) D3DCOLORtoUBYTE4(BlendIndices)
  let n = i.normal.xyz;
  let w = i.weights.xyz;
  var o: SkinOut;`;
  if (nb === 1) {
    return `${head}
  o.pos = vec4f(m4(i.pos, pal(ai.x)).xyz, 1.0);
  o.nor = m3(n, pal(ai.x));
  return o;
}`;
  }
  if (nb === 2 || nb === 3) {
    const loop: string[] = [];
    for (let b = 1; b < nb; b++) loop.push(`  pos = pos + m4(i.pos, pal(ai[${b}])).xyz * w[${b}];`, `  nor = nor + m3(n, pal(ai[${b}])) * w[${b}];`);
    return `${head}
  var pos = m4(i.pos, pal(ai.x)).xyz * w.x;
  var nor = m3(n, pal(ai.x)) * w.x;
${loop.join("\n")}
  o.pos = vec4f(pos, 1.0);
  o.nor = nor;
  return o;
}`;
  }
  return `${head}
  var last = 1.0 - w.x;
  var pos = m4(i.pos, pal(ai.x)).xyz * w.x;
  var nor = m3(n, pal(ai.x)) * w.x;
  for (var b = 1; b < 3; b = b + 1) {
    let fw = w[b];
    last = last - fw;
    pos = pos + m4(i.pos, pal(ai[b])).xyz * fw;
    nor = nor + m3(n, pal(ai[b])) * fw;
  }
  pos = pos + m4(i.pos, pal(ai.w)).xyz * last;
  nor = nor + m3(n, pal(ai.w)) * last;
  o.pos = vec4f(pos, 1.0);
  o.nor = nor;
  return o;
}`;
}

const NAME = /^Vert(Skinning)?(RealColor|Cartoon|BlackEdge|ColorEdge|(?:X|Y|Z|Point)Flow(?:World|Local))(_NONFOG)?$/;

/**
 * The emulated shader for one HLSL entry point of XRenderer.fx (`bones` = the `uniform int iNumBones` argument of the `VertSkinning*`
 * functions), or null when the function is not one the file defines.
 */
export function buildXRendererVertexShader(func: string, bones: number | null): XRendererShader | null {
  const m = NAME.exec(func);
  if (!m) return null;
  const skinned = m[1] !== undefined;
  const family = m[2]!;
  const flow = family.includes("Flow");
  const nofog = m[3] !== undefined;
  if (skinned !== (bones !== null)) return null;
  if (skinned && (bones! < 1 || bones! > 4)) return null;
  if (flow && nofog) return null;
  const fog = !flow && !nofog;

  const L: string[] = [];
  let diffuse = false, texCoords = 0;
  const texOffsets = (tex1: string): void => {
    texCoords = 3;
    L.push("o.t[0] = vec4f(i.tex[0].xy + vc[R_TEXOFF].xy, 0.0, 1.0);");
    L.push(`o.t[1] = ${tex1};`);
    L.push("o.t[2] = vec4f(i.tex[0].xy + vc[R_S0].xy, 0.0, 1.0);");
  };
  // world position (the HLSL's wPos) and, per family, the position output
  const world = (): void => { L.push(skinned ? "let sk = skin(i); let wpos = sk.pos;" : "let wpos = m4(i.pos, R_PAL);"); };

  switch (family) {
    case "RealColor":
      if (skinned) { world(); L.push("o.pos = m4(wpos, R_VP);"); }
      else { if (fog) world(); L.push("o.pos = m4(i.pos, R_WVP);"); }
      texOffsets("vec4f(i.tex[0].xy + vc[R_TEXOFF].zw, 0.0, 1.0)");
      L.push("o.c0 = vc[R_COLOR];"); diffuse = true;
      break;
    case "Cartoon":
      if (skinned) { world(); L.push("o.pos = m4(wpos, R_VP);", "let nor = normalize(sk.nor);"); }
      else { if (fog) world(); L.push("o.pos = m4(i.pos, R_WVP);", "let nor = normalize(m3(i.normal.xyz, R_PAL));"); }
      texOffsets("vec4f(vec2f(dot(nor, vc[R_LIGHTPOS])), 0.0, 1.0)");
      L.push("o.c0 = vc[R_COLOR];"); diffuse = true;
      break;
    case "BlackEdge": case "ColorEdge":
      if (skinned) { world(); L.push("let nor = sk.nor;"); }
      else { world(); L.push("let nor = m3(i.normal.xyz, R_PAL);"); }
      L.push("o.pos = m4(wpos + nor * vc[R_S0].z, R_VP);");
      if (family === "ColorEdge") { L.push("o.c0 = vc[R_OUTLINE];"); diffuse = true; }
      break;
    default: {
      // Vert{X,Y,Z,Point}Flow{World,Local}: the alpha of g_Color is divided by 1e-5 + distance / g_fLightFlowWide
      const axis = family[0]!; // X | Y | Z | P
      const local = family.endsWith("Local");
      if (skinned) L.push("let sk = skin(i);");
      if (!local) L.push(skinned ? "let wpos = sk.pos;" : "let wpos = m4(i.pos, R_PAL);");
      const src = local ? "i.pos" : "wpos";
      const d = axis === "P" ? `distance(${src}, vc[R_FLOWPT])` : `abs(${src}.${axis.toLowerCase()} - vc[R_S0].w)`;
      L.push("o.c0 = vc[R_COLOR];", `o.c0.w = o.c0.w / (0.00001 + (${d} / vc[R_S1].x));`);
      if (skinned) L.push("o.pos = m4(sk.pos, R_VP);");
      else L.push(local ? "o.pos = m4(i.pos, R_WVP);" : "o.pos = m4(wpos, R_VP);");
      diffuse = true;
    }
  }
  if (fog) L.push("o.fog = vs_fog(wpos);");

  const wgsl = `${HEADER}${skinned ? skinFunction(bones!) : ""}
fn user_vs(i: SIn) -> SOut {
  var o: SOut;
  ${L.join("\n  ")}
  return o;
}`;
  // register groups read: by the body, by vs_fog() (fog) and by skin() through pal() (the palette)
  const code = `${L.join("\n")}${fog ? " R_FOG R_EYE R_S1" : ""}${skinned ? " R_PAL" : ""}`;
  const uses = Object.keys(XR_GROUPS).filter((g) => new RegExp(`\\bR_${g}\\b`).test(code));
  return { name: `xr:${func}${bones !== null ? `(${bones})` : ""}`, wgsl, writes: { diffuse, specular: false, fog, texCoords }, uses };
}
