/**
 * Fixed-function pipeline emulation: the device state that matters for one draw is reduced to a `ProgramDesc` (and its string key),
 * from which WGSL for the vertex and the pixel stage is generated.  Layout conventions (see docs/ARCHITECTURE.md "D3D9 layer"):
 *
 *  - Matrices are uploaded exactly as D3D stores them (row-major, row vectors).  WGSL reads the 16 floats as four *columns*, i.e. as
 *    the transpose, and `M * v` with a column vector therefore equals D3D's `v * M`.  All generated code uses `M * v`.
 *  - Vertex attributes sit at fixed locations per semantic (vertex.ts); the interpolants between the stages are fixed too:
 *    location 0 = diffuse, 1 = specular, 2..9 = texture coordinate sets of the stages (set k at location 2 + k), 10 = fog factor
 *    (or eye depth for table fog).
 *  - Three uniform blocks (group 0): transforms, lighting (material + lights) and misc (texture factor, fog, alpha ref, stage constants).
 *  - Pixel stage: the D3D texture-stage cascade (D3DTOP_* / D3DTA_*) with per-stage saturation, then specular add, fog, alpha test.
 *  - The half-pixel offset: D3D9 rasterises with pixel centres on integer window coordinates, WebGPU with centres at +0.5, so every
 *    vertex is shifted by +0.5 px in window space (`pos.xy += (+w/vpW, -w/vpH)`), exactly like DXVK/wined3d do.
 */
import { D3DCMP, D3DDECLUSAGE, D3DFOG, D3DLIGHT, D3DMCS, D3DTA, D3DTOP, D3DTSS_TCI, D3DTTFF } from "./enums.ts";
import { LOC } from "./vertex.ts";
import type { BufferLayout } from "./vertex.ts";

export const MAX_STAGES = 8;
export const MAX_LIGHTS = 8;

/** Float offsets inside the three uniform blocks (all vec4/mat4 aligned). */
export const XFORM = { world: 0, view: 16, proj: 32, wv: 48, wvp: 64, nrm: 80, tex: 96, screen: 224, size: 228 } as const;
export const LIGHTB = { matDiffuse: 0, matAmbient: 4, matSpecular: 8, matEmissive: 12, matPower: 16, ambient: 20, lights: 24, lightStride: 28, size: 24 + 8 * 28 } as const;
export const MISC = { tfactor: 0, fogColor: 4, fogParams: 8, alphaRef: 12, stageConst: 16, lodBias: 48, size: 56 } as const;

export interface StageDesc {
  index: number;
  colorOp: number; colorArg0: number; colorArg1: number; colorArg2: number;
  alphaOp: number; alphaArg0: number; alphaArg1: number; alphaArg2: number;
  resultTemp: boolean;
  texCoordSet: number;
  tci: number;
  ttffCount: number;
  projected: boolean;
  hasTexture: boolean;
}

export type FogSource = "none" | "vertex" | "table" | "shader";

export interface ProgramDesc {
  layouts: BufferLayout[];
  /** pre-transformed vertices (D3DFVF_XYZRHW / POSITIONT) */
  rhw: boolean;
  /** the 4th position component is supplied (XYZW) */
  xyzw: boolean;
  lighting: boolean;
  /** D3DLIGHT_* of the enabled lights, in slot order */
  lights: number[];
  /** D3DMCS_* after applying D3DRS_COLORVERTEX: [diffuse, specular, ambient, emissive] */
  matSource: [number, number, number, number];
  specular: boolean;
  localViewer: boolean;
  normalize: boolean;
  fogSource: FogSource;
  /** D3DFOG_* used to turn depth into a factor (vertex/table fog) */
  fogMode: number;
  rangeFog: boolean;
  stages: StageDesc[];
  /** D3DCMP_* of the alpha test, 0 = disabled */
  alphaFunc: number;
  flatShade: boolean;
}

export function programKey(d: ProgramDesc): string {
  const parts: string[] = [];
  parts.push(d.layouts.flatMap((l) => l.attributes.map((a) => `${a.location}${a.format}`)).sort().join("."));
  parts.push(`${d.rhw ? "R" : ""}${d.xyzw ? "W" : ""}${d.lighting ? "L" : ""}${d.specular ? "S" : ""}${d.localViewer ? "V" : ""}${d.normalize ? "N" : ""}${d.flatShade ? "F" : ""}${d.rangeFog ? "G" : ""}`);
  if (d.lighting) parts.push(`${d.lights.join("")}/${d.matSource.join("")}`);
  parts.push(`fog${d.fogSource[0]}${d.fogMode}`);
  parts.push(`at${d.alphaFunc}`);
  for (const s of d.stages) {
    parts.push(`${s.index}:${s.colorOp},${s.colorArg0},${s.colorArg1},${s.colorArg2},${s.alphaOp},${s.alphaArg0},${s.alphaArg1},${s.alphaArg2},${s.resultTemp ? 1 : 0},${s.texCoordSet},${s.tci},${s.ttffCount},${s.projected ? 1 : 0},${s.hasTexture ? 1 : 0}`);
  }
  return parts.join("|");
}

const TEX_BINDING = (i: number): number => i * 2;
const SMP_BINDING = (i: number): number => i * 2 + 1;

const PRELUDE = /* wgsl */ `
struct XformBlock {
  world: mat4x4f, view: mat4x4f, proj: mat4x4f, wv: mat4x4f, wvp: mat4x4f, nrm: mat4x4f,
  tex: array<mat4x4f, 8>,
  screen: vec4f,
}
struct Light { diffuse: vec4f, specular: vec4f, ambient: vec4f, pos: vec4f, dir: vec4f, att: vec4f, spot: vec4f }
struct LightBlock {
  matDiffuse: vec4f, matAmbient: vec4f, matSpecular: vec4f, matEmissive: vec4f, matPower: vec4f, ambient: vec4f,
  lights: array<Light, 8>,
}
struct MiscBlock {
  tfactor: vec4f, fogColor: vec4f, fogParams: vec4f, alphaRef: vec4f,
  stageConst: array<vec4f, 8>,
  lodBias: array<vec4f, 2>,
}
@group(0) @binding(0) var<uniform> xf: XformBlock;
@group(0) @binding(1) var<uniform> lt: LightBlock;
@group(0) @binding(2) var<uniform> ms: MiscBlock;
`;

const texDecls = (d: ProgramDesc): string =>
  d.stages.filter((s) => s.hasTexture).map((s) => `@group(1) @binding(${TEX_BINDING(s.index)}) var tex${s.index}: texture_2d<f32>;\n@group(1) @binding(${SMP_BINDING(s.index)}) var smp${s.index}: sampler;`).join("\n");

const attr = (d: ProgramDesc, loc: number) => { for (const l of d.layouts) for (const a of l.attributes) if (a.location === loc) return a; return undefined; };
const wgslVec = (kind: "f32" | "u32" | "i32"): string => (kind === "f32" ? "vec4f" : kind === "u32" ? "vec4u" : "vec4i");
/** vec4f expression for an attribute input (integers converted, BGRA swizzled, missing components default as the hardware does). */
function attrExpr(a: { kind: "f32" | "u32" | "i32"; bgra: boolean }, name: string): string {
  const base = `in.${name}`;
  const f = a.kind === "f32" ? base : `vec4f(${base})`;
  return a.bgra ? `${f}.zyxw` : f;
}

/** Which stages need which interpolants. */
function usedTexCoordSets(d: ProgramDesc): Set<number> { return new Set(d.stages.map((s) => s.index)); }

export function generateWgsl(d: ProgramDesc): string {
  const vs = generateVertex(d);
  const fs = generateFragment(d);
  return `${PRELUDE}\n${texDecls(d)}\n${vs}\n${fs}`;
}

function varyings(d: ProgramDesc, forFragmentInput: boolean): string {
  const lines: string[] = [];
  lines.push(forFragmentInput ? "@builtin(position) fragCoord: vec4f," : "@builtin(position) pos: vec4f,");
  const flat = d.flatShade ? "@interpolate(flat, first) " : "";
  lines.push(`${flat}@location(0) c0: vec4f,`);
  lines.push(`${flat}@location(1) c1: vec4f,`);
  for (const s of d.stages) lines.push(`@location(${2 + s.index}) t${s.index}: vec4f,`);
  lines.push("@location(10) fog: f32,");
  return lines.join("\n  ");
}

// ------------------------------------------------------------------------------------------------ vertex stage
function generateVertex(d: ProgramDesc): string {
  const inputs: string[] = [];
  for (const l of d.layouts) for (const a of l.attributes) {
    const name = `a${a.location}`;
    inputs.push(`@location(${a.location}) ${name}: ${wgslVec(a.kind)},`);
  }
  const pos = attr(d, LOC.POSITION);
  const nrm = attr(d, LOC.NORMAL);
  const col0 = attr(d, LOC.COLOR0);
  const col1 = attr(d, LOC.COLOR1);
  const get = (a: NonNullable<ReturnType<typeof attr>>): string => attrExpr(a, `a${a.location}`);
  const needView = d.lighting || d.fogSource !== "none" || d.stages.some((s) => s.tci !== D3DTSS_TCI.PASSTHRU);
  const needNormal = d.lighting || d.stages.some((s) => s.tci !== D3DTSS_TCI.PASSTHRU && s.tci !== D3DTSS_TCI.CAMERASPACEPOSITION);

  const b: string[] = [];
  b.push("var o: VOut;");
  // ---- position
  if (!pos) b.push("let p = vec4f(0.0, 0.0, 0.0, 1.0);");
  else if (d.rhw) b.push(`let pr = ${get(pos)};`);
  else if (d.xyzw) b.push(`let p = ${get(pos)};`);
  else b.push(`let p = vec4f(${get(pos)}.xyz, 1.0);`);
  if (d.rhw) {
    b.push("let rw = 1.0 / pr.w;");
    b.push("var clip = vec4f((pr.x * xf.screen.x * 2.0 - 1.0) * rw, (1.0 - pr.y * xf.screen.y * 2.0) * rw, pr.z * rw, rw);");
  } else {
    b.push("var clip = xf.wvp * p;");
  }
  b.push("clip.x = clip.x + clip.w * xf.screen.x;");
  b.push("clip.y = clip.y - clip.w * xf.screen.y;");
  b.push("o.pos = clip;");
  if (needView && !d.rhw) b.push("let pv = (xf.wv * p).xyz;");
  else if (needView) b.push("let pv = vec3f(0.0);");
  if (needNormal) {
    if (nrm && !d.rhw) b.push(`var nv = (xf.nrm * vec4f(${get(nrm)}.xyz, 0.0)).xyz;`);
    else b.push("var nv = vec3f(0.0);");
    if (d.normalize) b.push("nv = select(vec3f(0.0), normalize(nv), dot(nv, nv) > 0.0);");
  }
  // ---- colours
  b.push(`let vcol0 = ${col0 ? get(col0) : "vec4f(1.0)"};`);
  b.push(`let vcol1 = ${col1 ? get(col1) : "vec4f(0.0)"};`);
  if (d.lighting && !d.rhw) {
    const src = (s: number, mat: string): string => (s === D3DMCS.COLOR1 ? "vcol0" : s === D3DMCS.COLOR2 ? "vcol1" : mat);
    b.push(`let mD = ${src(d.matSource[0], "lt.matDiffuse")};`);
    b.push(`let mS = ${src(d.matSource[1], "lt.matSpecular")};`);
    b.push(`let mA = ${src(d.matSource[2], "lt.matAmbient")};`);
    b.push(`let mE = ${src(d.matSource[3], "lt.matEmissive")};`);
    b.push("var accA = vec3f(0.0); var accD = vec3f(0.0); var accS = vec3f(0.0);");
    if (d.localViewer) b.push("let vdir = select(vec3f(0.0, 0.0, -1.0), normalize(-pv), dot(pv, pv) > 0.0);");
    else b.push("let vdir = vec3f(0.0, 0.0, -1.0);");
    d.lights.forEach((type, k) => {
      b.push("{");
      b.push(`  let L = lt.lights[${k}];`);
      if (type === D3DLIGHT.DIRECTIONAL) {
        b.push("  let ld = -L.dir.xyz; let att = 1.0; let spot = 1.0;");
      } else {
        b.push("  let toL = L.pos.xyz - pv; let dist = length(toL); let ld = toL / max(dist, 1e-20);");
        b.push("  var att = 0.0;");
        b.push("  if (dist <= L.dir.w) { att = 1.0 / (L.att.x + L.att.y * dist + L.att.z * dist * dist); }");
        if (type === D3DLIGHT.SPOT) {
          b.push("  let rho = dot(-ld, L.dir.xyz);");
          b.push("  var spot = 0.0;");
          b.push("  if (rho > L.spot.x) { spot = 1.0; } else if (rho > L.spot.y) { spot = pow((rho - L.spot.y) / (L.spot.x - L.spot.y), L.att.w); }");
        } else {
          b.push("  let spot = 1.0;");
        }
      }
      b.push("  let ndl = max(dot(nv, ld), 0.0);");
      b.push("  let k = att * spot;");
      b.push("  accA = accA + L.ambient.rgb * k;");
      b.push("  accD = accD + L.diffuse.rgb * (ndl * k);");
      if (d.specular) {
        b.push("  if (ndl > 0.0) { let h = ld + vdir; let hn = select(vec3f(0.0), normalize(h), dot(h, h) > 0.0); accS = accS + L.specular.rgb * (pow(max(dot(nv, hn), 0.0), lt.matPower.x) * k); }");
      }
      b.push("}");
    });
    b.push("o.c0 = vec4f(saturate(mE.rgb + mA.rgb * (lt.ambient.rgb + accA) + mD.rgb * accD), mD.a);");
    b.push(d.specular ? "o.c1 = vec4f(saturate(mS.rgb * accS), mS.a);" : "o.c1 = vec4f(0.0);");
  } else {
    b.push("o.c0 = vcol0;");
    b.push("o.c1 = vcol1;");
  }
  // ---- texture coordinates
  for (const s of d.stages) {
    const i = s.index;
    let src: string;
    switch (s.tci) {
      case D3DTSS_TCI.CAMERASPACENORMAL: src = "vec4f(nv, 1.0)"; break;
      case D3DTSS_TCI.CAMERASPACEPOSITION: src = "vec4f(pv, 1.0)"; break;
      case D3DTSS_TCI.CAMERASPACEREFLECTIONVECTOR: src = "vec4f(reflect(select(vec3f(0.0), normalize(pv), dot(pv, pv) > 0.0), nv), 1.0)"; break;
      case D3DTSS_TCI.SPHEREMAP:
        // D3D sphere map: r = reflect(normalize(pv), n); m = 2*sqrt(rx^2 + ry^2 + (rz+1)^2); (u, v) = (rx/m + 0.5, -ry/m + 0.5)
        src = "vec4f(sphereUV(select(vec3f(0.0), normalize(pv), dot(pv, pv) > 0.0), nv), 0.0, 1.0)";
        break;
      default: {
        const a = attr(d, LOC.TEXCOORD0 + s.texCoordSet);
        if (!a) src = "vec4f(0.0, 0.0, 0.0, 1.0)";
        else {
          // D3D fills the coordinate with (c0 .. c(n-1), 1, 0, ...): the component after the last supplied one is 1
          const n = a.components;
          const v = get(a);
          src = n >= 4 ? v : n === 3 ? `vec4f(${v}.xyz, 1.0)` : n === 2 ? `vec4f(${v}.xy, 1.0, 0.0)` : `vec4f(${v}.x, 1.0, 0.0, 0.0)`;
        }
      }
    }
    if (s.ttffCount > 0) b.push(`o.t${i} = xf.tex[${i}] * ${src};`);
    else b.push(`o.t${i} = ${src};`);
  }
  // ---- fog
  if (d.fogSource === "vertex" || d.fogSource === "table") {
    b.push(d.rangeFog ? "let fdepth = length(pv);" : "let fdepth = abs(pv.z);");
    if (d.fogSource === "table") b.push("o.fog = fdepth;");
    else b.push(`o.fog = ${fogFactor(d.fogMode, "fdepth")};`);
  } else {
    b.push("o.fog = 1.0;");
  }
  b.push("return o;");

  return `
struct VIn {
  ${inputs.join("\n  ")}
}
struct VOut {
  ${varyings(d, false)}
}
fn sphereUV(u: vec3f, n: vec3f) -> vec2f {
  let r = reflect(u, n);
  let m = 2.0 * sqrt(r.x * r.x + r.y * r.y + (r.z + 1.0) * (r.z + 1.0));
  return vec2f(r.x / m + 0.5, -r.y / m + 0.5);
}
@vertex fn vs_main(in: VIn) -> VOut {
  ${b.join("\n  ")}
}`;
}

function fogFactor(mode: number, depth: string): string {
  switch (mode) {
    case D3DFOG.EXP: return `saturate(exp(-(${depth}) * ms.fogParams.z))`;
    case D3DFOG.EXP2: return `saturate(exp(-(${depth} * ms.fogParams.z) * (${depth} * ms.fogParams.z)))`;
    default: return `saturate((ms.fogParams.y - ${depth}) / (ms.fogParams.y - ms.fogParams.x))`;
  }
}

// ---------------------------------------------------------------------------------------------- pixel stage
const ARG_NAMES: Record<number, string> = {
  [D3DTA.DIFFUSE]: "dif", [D3DTA.CURRENT]: "cur", [D3DTA.TFACTOR]: "tfc", [D3DTA.SPECULAR]: "spc", [D3DTA.TEMP]: "tmp",
};

/** vec4f expression for an argument; `alpha` selects whether ALPHAREPLICATE applies (colour args only). */
function argExpr(arg: number, stage: StageDesc, alpha: boolean): string {
  const sel = arg & D3DTA.SELECTMASK;
  let e = sel === D3DTA.TEXTURE ? `t${stage.index}` : sel === D3DTA.CONSTANT ? `kc${stage.index}` : ARG_NAMES[sel] ?? "cur";
  if (arg & D3DTA.COMPLEMENT) e = `(vec4f(1.0) - ${e})`;
  if (!alpha && (arg & D3DTA.ALPHAREPLICATE)) e = `vec4f(${e}.a)`;
  return e;
}

/** The combiner expression for one stage and channel group. `kind` is "c" (vec3f) or "a" (f32). */
function opExpr(op: number, kind: "c" | "a", stage: StageDesc, arg0: string, arg1: string, arg2: string): string {
  const sw = kind === "c" ? ".rgb" : ".a";
  const A0 = `${arg0}${sw}`, A1 = `${arg1}${sw}`, A2 = `${arg2}${sw}`;
  const one = kind === "c" ? "vec3f(1.0)" : "1.0";
  const half = kind === "c" ? "vec3f(0.5)" : "0.5";
  const blend = (f: string): string => `(${A1} * ${f} + ${A2} * (1.0 - ${f}))`;
  switch (op) {
    case D3DTOP.SELECTARG1: return A1;
    case D3DTOP.SELECTARG2: return A2;
    case D3DTOP.MODULATE: return `(${A1} * ${A2})`;
    case D3DTOP.MODULATE2X: return `(${A1} * ${A2} * 2.0)`;
    case D3DTOP.MODULATE4X: return `(${A1} * ${A2} * 4.0)`;
    case D3DTOP.ADD: return `(${A1} + ${A2})`;
    case D3DTOP.ADDSIGNED: return `(${A1} + ${A2} - ${half})`;
    case D3DTOP.ADDSIGNED2X: return `((${A1} + ${A2} - ${half}) * 2.0)`;
    case D3DTOP.SUBTRACT: return `(${A1} - ${A2})`;
    case D3DTOP.ADDSMOOTH: return `(${A1} + ${A2} * (${one} - ${A1}))`;
    case D3DTOP.BLENDDIFFUSEALPHA: return blend("dif.a");
    case D3DTOP.BLENDTEXTUREALPHA: return blend(`t${stage.index}.a`);
    case D3DTOP.BLENDFACTORALPHA: return blend("tfc.a");
    case D3DTOP.BLENDTEXTUREALPHAPM: return `(${A1} + ${A2} * (1.0 - t${stage.index}.a))`;
    case D3DTOP.BLENDCURRENTALPHA: return blend("cur.a");
    case D3DTOP.PREMODULATE: return A1;
    case D3DTOP.MODULATEALPHA_ADDCOLOR: return kind === "c" ? `(${A1} + ${arg1}.a * ${A2})` : A1;
    case D3DTOP.MODULATECOLOR_ADDALPHA: return kind === "c" ? `(${A1} * ${A2} + vec3f(${arg1}.a))` : A1;
    case D3DTOP.MODULATEINVALPHA_ADDCOLOR: return kind === "c" ? `((1.0 - ${arg1}.a) * ${A2} + ${A1})` : A1;
    case D3DTOP.MODULATEINVCOLOR_ADDALPHA: return kind === "c" ? `((vec3f(1.0) - ${A1}) * ${A2} + vec3f(${arg1}.a))` : A1;
    case D3DTOP.MULTIPLYADD: return `(${A0} + ${A1} * ${A2})`;
    case D3DTOP.LERP: return `(${A0} * ${A1} + (${one} - ${A0}) * ${A2})`;
    // bump mapping is not emulated: the stage passes its first argument through
    case D3DTOP.BUMPENVMAP: case D3DTOP.BUMPENVMAPLUMINANCE: return A1;
    default: return A1;
  }
}

function alphaTest(func: number): string {
  // D3D compares the 8-bit quantised alpha with the 0..255 reference
  const cmp = (op: string): string => `if (!(a8 ${op} ref8)) { discard; }`;
  const pre = "let a8 = floor(color.a * 255.0 + 0.5); let ref8 = ms.alphaRef.x;";
  switch (func) {
    case D3DCMP.NEVER: return "discard;";
    case D3DCMP.LESS: return `${pre} ${cmp("<")}`;
    case D3DCMP.EQUAL: return `${pre} ${cmp("==")}`;
    case D3DCMP.LESSEQUAL: return `${pre} ${cmp("<=")}`;
    case D3DCMP.GREATER: return `${pre} ${cmp(">")}`;
    case D3DCMP.NOTEQUAL: return `${pre} ${cmp("!=")}`;
    case D3DCMP.GREATEREQUAL: return `${pre} ${cmp(">=")}`;
    default: return "";
  }
}

function generateFragment(d: ProgramDesc): string {
  const b: string[] = [];
  b.push("let dif = i.c0; let spc = i.c1; let tfc = ms.tfactor;");
  b.push("var cur = dif; var tmp = vec4f(0.0);");
  for (const s of d.stages) {
    const i = s.index;
    b.push("{");
    // texture coordinate -> 2D sample position
    if (s.hasTexture) {
      let uv: string;
      // D3DTTFF_PROJECTED divides by the last of the `count` components (only meaningful for 3 and 4)
      if (s.projected && s.ttffCount >= 3) uv = `(i.t${i}.xy / i.t${i}.${s.ttffCount === 3 ? "z" : "w"})`;
      else uv = `i.t${i}.xy`;
      b.push(`  let t${i} = textureSampleBias(tex${i}, smp${i}, ${uv}, ms.lodBias[${i >> 2}][${i & 3}]);`);
    } else {
      b.push(`  let t${i} = vec4f(0.0, 0.0, 0.0, 1.0);`);
    }
    b.push(`  let kc${i} = ms.stageConst[${i}];`);
    const a0c = argExpr(s.colorArg0, s, false), a1c = argExpr(s.colorArg1, s, false), a2c = argExpr(s.colorArg2, s, false);
    const a0a = argExpr(s.alphaArg0, s, true), a1a = argExpr(s.alphaArg1, s, true), a2a = argExpr(s.alphaArg2, s, true);
    let color: string, alpha: string;
    if (s.colorOp === D3DTOP.DOTPRODUCT3) {
      b.push(`  let dp = saturate(dot((${a1c}.rgb - vec3f(0.5)) * 2.0, (${a2c}.rgb - vec3f(0.5)) * 2.0));`);
      b.push("  let res = vec4f(dp);");
    } else {
      color = opExpr(s.colorOp, "c", s, a0c, a1c, a2c);
      alpha = s.alphaOp === D3DTOP.DISABLE ? "cur.a" : opExpr(s.alphaOp, "a", s, a0a, a1a, a2a);
      b.push(`  let res = vec4f(saturate(${color}), saturate(${alpha}));`);
    }
    b.push(s.resultTemp ? "  tmp = res;" : "  cur = res;");
    b.push("}");
  }
  b.push("var color = cur;");
  if (d.specular) b.push("color = vec4f(saturate(color.rgb + spc.rgb), color.a);");
  if (d.fogSource !== "none") {
    const f = d.fogSource === "table" ? fogFactor(d.fogMode, "i.fog") : "saturate(i.fog)";
    b.push(`let ff = ${f};`);
    b.push("color = vec4f(mix(ms.fogColor.rgb, color.rgb, ff), color.a);");
  }
  if (d.alphaFunc && d.alphaFunc !== D3DCMP.ALWAYS) b.push(alphaTest(d.alphaFunc));
  b.push("return color;");
  return `
struct FIn {
  ${varyings(d, true)}
}
@fragment fn fs_main(i: FIn) -> @location(0) vec4f {
  ${b.join("\n  ")}
}`;
}

export const _internal = { usedTexCoordSets, D3DDECLUSAGE, D3DTTFF };
