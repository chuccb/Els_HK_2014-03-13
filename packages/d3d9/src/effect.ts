/**
 * `ID3DXEffect` for XRenderer.fx (the only effect the exe loads; docs/FINDINGS.md 12.1 / 12.7).
 *
 * D3DX compiles the shipped HLSL source at run time; this port reads the *same file* (`D3DXCreateEffect(device, source, ...)`), takes the
 * parameters, the techniques, the passes, every state assignment and the vertex shader arrays from it, and replaces only what cannot be
 * recovered from text - the compiled `vs_1_1` code - by the WGSL of `xrenderer-shaders.ts`, selected by the HLSL entry point and its
 * `iNumBones` argument.  A file that names an entry point this port does not know, or whose function bodies differ from the ones the port was
 * written from (a hash of each function's tokens, `XR_FUNCTION_HASHES`), is refused (`D3DXERR_INVALIDDATA`), so the file cannot silently
 * run with a different meaning.  Supported state assignments are the render / texture-stage / sampler states below plus `VertexShader`, with the
 * right-hand sides the file uses: enumerators, integer literals, `(parameter)` and `(vsArray[parameter])`.
 *
 * What the engine relies on (x2.exe.c: CKTDGXRenderer BeginRender 432699, DrawFrame 433537, _CommitChanges 434781):
 *  - `SetStateManager(mgr)`: every state the passes set goes through the manager (CKTDGEffectStateManager), in source order, and the effect itself
 *    does not save or restore anything; `Begin(.., 7)` = D3DXFX_DONOTSAVESTATE | SHADERSTATE | SAMPLERSTATE.
 *  - `BeginPass(i)` applies all assignments of the pass and uploads the constants of the vertex shader it selected (through the manager's
 *    `SetVertexShaderConstantF`, which the engine's manager only records; the engine flushes the dirty range to the device itself).
 *  - `CommitChanges()` re-evaluates the assignments that depend on parameters changed since (so `SetInt(g_iShaderIndex)` + `CommitChanges` switches the
 *    vertex shader, `SetBool(g_bFog)` the fog enable) and uploads the changed constants of the shader in use (all of them after a shader change).
 * Without a state manager the effect writes to the device and, unless the Begin flags say otherwise, puts back what it changed at `End`.
 *
 * Assumptions without a native oracle (no D3DX here): the register numbers (XR in xrenderer-shaders.ts), that D3DX re-evaluates only
 * assignments whose parameters changed, `FogColor` from a float4 = D3DXCOLOR to DWORD (round to nearest), `SetMatrix` on a matrix array fails.
 */
import { D3DBLEND, D3DBLENDOP, D3DCMP, D3DCULL, D3DFOG, D3DRS, D3DSAMP, D3DTA, D3DTADDRESS, D3DTEXF, D3DTOP, D3DTSS, D3DZB } from "./enums.ts";
import { D3DERR_INVALIDCALL, D3DXERR_INVALIDDATA, D3D_OK } from "./hresult.ts";
import { floatToDword } from "./state.ts";
import type { Direct3DDevice9 } from "./device.ts";
import type { Direct3DVertexShader9 } from "./vshader.ts";
import { buildXRendererVertexShader, XR, XR_FUNCTION_HASHES, XR_GROUPS } from "./xrenderer-shaders.ts";
import type { XRendererShader } from "./xrenderer-shaders.ts";

/** `D3DXFX_*` flags of `ID3DXEffect::Begin` and `D3DXCreateEffect`. */
export const D3DXFX = { DONOTSAVESTATE: 1, DONOTSAVESHADERSTATE: 2, DONOTSAVESAMPLERSTATE: 4, NOT_CLONEABLE: 2048 } as const;

/** The states an effect can route through `ID3DXEffectStateManager` that XRenderer.fx uses (the interface has more: textures, transforms, lights, pixel shaders ...). */
export interface ID3DXEffectStateManager {
  SetRenderState(state: number, value: number): number;
  SetSamplerState(sampler: number, type: number, value: number): number;
  SetTextureStageState(stage: number, type: number, value: number): number;
  SetVertexShader(shader: Direct3DVertexShader9 | null): number;
  /** `data` holds `count` float4 registers */
  SetVertexShaderConstantF(start: number, data: Float32Array, count: number): number;
}

/** An opaque `D3DXHANDLE`. */
export interface D3DXHandle { readonly kind: "technique" | "pass" | "parameter"; readonly name: string; readonly owner: D3DXEffect }

// ------------------------------------------------------------------------------------------------------ the FX subset
interface Tok { t: "id" | "num" | "p"; v: string }

type Expr =
  | { k: "num"; v: number }
  | { k: "id"; name: string }
  | { k: "idx"; name: string; index: Expr }
  | { k: "group"; e: Expr };

interface Assignment { state: string; index: number; expr: Expr; deps: string[] }
interface PassDef { name: string; assignments: Assignment[] }
interface TechniqueDef { name: string; passes: PassDef[] }
type ParamType = "float" | "float4" | "float4x4" | "int" | "bool";
interface ParamDef { name: string; type: ParamType; array: number; init: number[]; semantic: string | null }
interface ShaderArray { name: string; entries: { func: string; arg: number | null }[] }
/** a function of the file: FNV-1a of its tokens (comments, white space and macros are gone), so a changed body is noticed */
interface FunctionDef { name: string; hash: number }
export interface ParsedEffect { params: ParamDef[]; techniques: TechniqueDef[]; shaderArrays: ShaderArray[]; functions: FunctionDef[] }

function hashTokens(tokens: readonly Tok[]): number {
  let h = 0x811c9dc5;
  for (const t of tokens) {
    for (let i = 0; i < t.v.length; i++) h = Math.imul(h ^ t.v.charCodeAt(i), 0x01000193) >>> 0;
    h = Math.imul(h ^ 0x20, 0x01000193) >>> 0;
  }
  return h;
}

class FxError extends Error {}

/** Comments out, `#define` / `#undef` / `#ifdef` / `#ifndef` / `#else` / `#endif` handled, macros expanded while tokenising. */
function tokenize(source: string): Tok[] {
  const text = source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
  const defines = new Map<string, string>();
  const lines: string[] = [];
  const stack: { active: boolean; taken: boolean }[] = [];
  const active = (): boolean => stack.every((s) => s.active);
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*#\s*(\w+)\s*(.*)$/.exec(line);
    if (!m) { lines.push(active() ? line : ""); continue; }
    const [, dir, rest] = m as unknown as [string, string, string];
    switch (dir) {
      case "define": if (active()) { const d = /^(\w+)(\(?)\s*(.*)$/.exec(rest.trim()); if (!d || d[2]) throw new FxError(`unsupported macro definition: ${line.trim()}`); defines.set(d[1]!, d[3]!); } break;
      case "undef": if (active()) defines.delete(rest.trim()); break;
      case "ifdef": case "ifndef": { const on = defines.has(rest.trim()) === (dir === "ifdef"); stack.push({ active: on, taken: on }); break; }
      case "else": { const s = stack[stack.length - 1]; if (!s) throw new FxError("#else without #if"); s.active = !s.taken; s.taken = true; break; }
      case "endif": if (!stack.pop()) throw new FxError("#endif without #if"); break;
      default: if (active()) throw new FxError(`unsupported preprocessor directive: ${line.trim()}`);
    }
    lines.push("");
  }
  if (stack.length) throw new FxError("unterminated #if");
  const toks: Tok[] = [];
  const scan = (s: string, depth: number): void => {
    const re = /([A-Za-z_]\w*)|(0[xX][0-9a-fA-F]+|\d+\.\d*(?:[eE][+-]?\d+)?[fF]?|\.\d+[fF]?|\d+)|(\s+)|(.)/g;
    for (let m = re.exec(s); m; m = re.exec(s)) {
      if (m[1] !== undefined) {
        const body = defines.get(m[1]);
        if (body !== undefined) { if (depth > 8) throw new FxError(`macro ${m[1]} expands recursively`); scan(body, depth + 1); } else toks.push({ t: "id", v: m[1] });
      } else if (m[2] !== undefined) toks.push({ t: "num", v: m[2] });
      else if (m[4] !== undefined) toks.push({ t: "p", v: m[4] });
    }
  };
  scan(lines.join("\n"), 0);
  return toks;
}

const numberValue = (v: string): number => (/^0[xX]/.test(v) ? Number.parseInt(v, 16) : Number.parseFloat(v));

const PARAM_TYPES: Record<string, { type: ParamType; comps: number }> = {
  float: { type: "float", comps: 1 }, float4: { type: "float4", comps: 4 }, float4x4: { type: "float4x4", comps: 16 }, int: { type: "int", comps: 1 }, bool: { type: "bool", comps: 1 },
};

/** The structure of an effect file: parameters, `VertexShader` arrays and techniques; function bodies and structs are skipped. */
export function parseEffect(source: string): ParsedEffect {
  const toks = tokenize(source);
  let pos = 0;
  const peek = (o = 0): Tok | undefined => toks[pos + o];
  const fail = (msg: string): never => { throw new FxError(`${msg} near '${toks.slice(Math.max(0, pos - 3), pos + 4).map((t) => t.v).join(" ")}'`); };
  const expect = (v: string): Tok => { const t = toks[pos]; if (!t || t.v !== v) fail(`expected '${v}'`); return toks[pos++]!; };
  const ident = (): string => { const t = toks[pos]; if (!t || t.t !== "id") fail("expected an identifier"); return toks[pos++]!.v; };
  const skipBlock = (): void => { // at '{'
    let depth = 0;
    do { const t = toks[pos++]; if (!t) fail("unterminated block"); if (t!.v === "{") depth++; else if (t!.v === "}") depth--; } while (depth > 0);
  };

  const parseExpr = (deps: string[]): Expr => {
    const t = toks[pos];
    if (!t) return fail("unexpected end of file");
    if (t.v === "(") { pos++; const e = parseExpr(deps); expect(")"); return { k: "group", e }; }
    if (t.t === "num") { pos++; return { k: "num", v: numberValue(t.v) }; }
    if (t.t === "id") {
      pos++;
      if (peek()?.v === "[") { pos++; const index = parseExpr(deps); expect("]"); deps.push(...exprParams(index)); return { k: "idx", name: t.v, index }; }
      deps.push(t.v);
      return { k: "id", name: t.v };
    }
    return fail("bad expression");
  };
  const exprParams = (e: Expr): string[] => (e.k === "id" ? [e.name] : e.k === "group" ? exprParams(e.e) : e.k === "idx" ? exprParams(e.index) : []);

  const params: ParamDef[] = [], techniques: TechniqueDef[] = [], shaderArrays: ShaderArray[] = [], functions: FunctionDef[] = [];
  while (pos < toks.length) {
    const t = toks[pos]!;
    if (t.v === ";") { pos++; continue; }
    if (t.v === "technique") {
      pos++;
      const tech: TechniqueDef = { name: ident(), passes: [] };
      expect("{");
      while (peek()?.v !== "}") {
        expect("pass");
        const pass: PassDef = { name: ident(), assignments: [] };
        expect("{");
        while (peek()?.v !== "}") {
          const state = ident();
          let index = 0;
          if (peek()?.v === "[") { pos++; const n = toks[pos++]; if (!n || n.t !== "num") fail("expected a state index"); index = numberValue(n!.v); expect("]"); }
          expect("=");
          const deps: string[] = [];
          const expr = parseExpr(deps);
          expect(";");
          pass.assignments.push({ state, index, expr, deps });
        }
        expect("}");
        tech.passes.push(pass);
      }
      expect("}");
      techniques.push(tech);
    } else if (t.v === "struct") {
      pos++; ident();
      skipBlock();
    } else if (t.v === "VertexShader" && toks[pos + 2]?.v === "[") {
      pos++;
      const arr: ShaderArray = { name: ident(), entries: [] };
      expect("["); pos++; expect("]"); expect("="); expect("{");
      while (peek()?.v !== "}") {
        expect("compile"); ident(); // the profile (vs_1_1)
        const func = ident();
        expect("(");
        const args: number[] = [];
        while (peek()?.v !== ")") { const a = toks[pos++]; if (!a || a.t !== "num") fail("expected a numeric argument"); args.push(numberValue(a!.v)); if (peek()?.v === ",") pos++; }
        expect(")");
        arr.entries.push({ func, arg: args.length ? args[0]! : null });
        if (peek()?.v === ",") pos++;
      }
      expect("}"); expect(";");
      shaderArrays.push(arr);
    } else {
      // a declaration (global variable) or a function; find which
      const start = pos;
      let isConst = false;
      if (t.v === "const") { isConst = true; pos++; }
      const typeName = ident();
      const name = ident();
      if (peek()?.v === "(") { // function: skip the parameter list, an optional semantic, the body
        let depth = 0;
        do { const x = toks[pos++]; if (!x) fail("unterminated parameter list"); if (x!.v === "(") depth++; else if (x!.v === ")") depth--; } while (depth > 0);
        while (peek() && peek()!.v !== "{") pos++;
        skipBlock();
        functions.push({ name, hash: hashTokens(toks.slice(start, pos)) });
        continue;
      }
      let array = 0;
      if (peek()?.v === "[") { pos++; const n = toks[pos++]; if (!n || n.t !== "num") fail("expected an array size"); array = numberValue(n!.v); expect("]"); }
      let semantic: string | null = null;
      if (peek()?.v === ":") { pos++; semantic = ident(); }
      const init: number[] = [];
      if (peek()?.v === "=") {
        pos++;
        const v = toks[pos++];
        if (v && (v.v === "true" || v.v === "false")) init.push(v.v === "true" ? 1 : 0);
        else if (v && v.t === "num") init.push(numberValue(v.v));
        else if (v && v.v === "-") { const n = toks[pos++]; init.push(-numberValue(n?.v ?? "NaN")); }
        else { pos = start; fail("unsupported initializer"); }
      }
      expect(";");
      const pt = PARAM_TYPES[typeName];
      if (!isConst && pt) params.push({ name, type: pt.type, array, init, semantic });
    }
  }
  return { params, techniques, shaderArrays, functions };
}

// ------------------------------------------------------------------------------------------------------ state table
type StateType = "bool" | "int" | "float" | "color" | "enum";
interface StateDef { kind: "rs" | "tss" | "samp"; id: number; type: StateType; names?: Record<string, number> }

const RS: [string, number, StateType, Record<string, number>?][] = [
  ["alphablendenable", D3DRS.ALPHABLENDENABLE, "bool"], ["srcblend", D3DRS.SRCBLEND, "enum", D3DBLEND], ["destblend", D3DRS.DESTBLEND, "enum", D3DBLEND],
  ["blendop", D3DRS.BLENDOP, "enum", D3DBLENDOP], ["cullmode", D3DRS.CULLMODE, "enum", D3DCULL],
  ["fogenable", D3DRS.FOGENABLE, "bool"], ["fogvertexmode", D3DRS.FOGVERTEXMODE, "enum", D3DFOG], ["fogtablemode", D3DRS.FOGTABLEMODE, "enum", D3DFOG],
  ["fogcolor", D3DRS.FOGCOLOR, "color"], ["fogstart", D3DRS.FOGSTART, "float"], ["fogend", D3DRS.FOGEND, "float"], ["fogdensity", D3DRS.FOGDENSITY, "float"],
  ["texturefactor", D3DRS.TEXTUREFACTOR, "color"],
  ["zenable", D3DRS.ZENABLE, "enum", D3DZB], ["zwriteenable", D3DRS.ZWRITEENABLE, "bool"], ["zfunc", D3DRS.ZFUNC, "enum", D3DCMP],
  ["alphatestenable", D3DRS.ALPHATESTENABLE, "bool"], ["alphafunc", D3DRS.ALPHAFUNC, "enum", D3DCMP], ["alpharef", D3DRS.ALPHAREF, "int"],
  ["lighting", D3DRS.LIGHTING, "bool"], ["specularenable", D3DRS.SPECULARENABLE, "bool"],
];
const TSS: [string, number, StateType, Record<string, number>?][] = [
  ["colorop", D3DTSS.COLOROP, "enum", D3DTOP], ["colorarg0", D3DTSS.COLORARG0, "enum", D3DTA], ["colorarg1", D3DTSS.COLORARG1, "enum", D3DTA], ["colorarg2", D3DTSS.COLORARG2, "enum", D3DTA],
  ["alphaop", D3DTSS.ALPHAOP, "enum", D3DTOP], ["alphaarg0", D3DTSS.ALPHAARG0, "enum", D3DTA], ["alphaarg1", D3DTSS.ALPHAARG1, "enum", D3DTA], ["alphaarg2", D3DTSS.ALPHAARG2, "enum", D3DTA],
  ["resultarg", D3DTSS.RESULTARG, "enum", D3DTA], ["texcoordindex", D3DTSS.TEXCOORDINDEX, "int"], ["texturetransformflags", D3DTSS.TEXTURETRANSFORMFLAGS, "int"],
];
const SAMP: [string, number, StateType, Record<string, number>?][] = [
  ["addressu", D3DSAMP.ADDRESSU, "enum", D3DTADDRESS], ["addressv", D3DSAMP.ADDRESSV, "enum", D3DTADDRESS], ["addressw", D3DSAMP.ADDRESSW, "enum", D3DTADDRESS],
  ["minfilter", D3DSAMP.MINFILTER, "enum", D3DTEXF], ["magfilter", D3DSAMP.MAGFILTER, "enum", D3DTEXF], ["mipfilter", D3DSAMP.MIPFILTER, "enum", D3DTEXF],
];
const STATES = new Map<string, StateDef>();
for (const [list, kind] of [[RS, "rs"], [TSS, "tss"], [SAMP, "samp"]] as const) for (const [n, id, type, names] of list) STATES.set(n, { kind, id, type, ...(names ? { names } : {}) });

const BOOL_NAMES: Record<string, number> = { FALSE: 0, TRUE: 1 };

// ------------------------------------------------------------------------------------------------------ the effect
interface Param { def: ParamDef; data: Float32Array; handle: D3DXHandle; group: string | null }

/** Register groups: first register and register count. */
const GROUP_REGS: Record<string, [number, number]> = {
  PAL: [XR.PAL, XR.PALETTE_SIZE * 4], WVP: [XR.WVP, 4], VP: [XR.VP, 4], COLOR: [XR.COLOR, 1], LIGHTPOS: [XR.LIGHTPOS, 1], OUTLINE: [XR.OUTLINE, 1], FLOWPT: [XR.FLOWPT, 1],
  TEXOFF: [XR.TEXOFF, 1], FOG: [XR.FOG, 1], EYE: [XR.EYE, 1], S0: [XR.S0, 1], S1: [XR.S1, 1],
};
const SCALAR_SLOT: Record<string, [string, number]> = {
  g_fTexOffSet2X: ["S0", 0], g_fTexOffSet2Y: ["S0", 1], g_fOutLineWide: ["S0", 2], g_fLightFlowImpact: ["S0", 3], g_fLightFlowWide: ["S1", 0], g_fDensity: ["S1", 1],
};

/** `D3DXCOLOR::operator DWORD`: each channel `(DWORD)(c * 255 + 0.5)` clamped to 0..255. */
function colorToDword(r: number, g: number, b: number, a: number): number {
  const c = (x: number): number => (x >= 1 ? 255 : x <= 0 ? 0 : Math.trunc(Math.fround(Math.fround(x * 255) + 0.5)));
  return (((c(a) << 24) | (c(r) << 16) | (c(g) << 8) | c(b)) >>> 0);
}

export class D3DXEffect {
  private readonly params = new Map<string, Param>();
  private readonly techniques: { def: TechniqueDef; handle: D3DXHandle; passHandles: D3DXHandle[] }[] = [];
  private readonly shaders = new Map<string, (XRendererShader & { object: Direct3DVertexShader9 })[]>();
  private manager: ID3DXEffectStateManager | null = null;
  private technique: D3DXEffect["techniques"][number];
  private began = false;
  private beginFlags = 0;
  private pass = -1;
  /** parameters changed since the pass assignments that depend on them were evaluated */
  private dirtyParams = new Set<string>();
  /** register groups changed since they were last uploaded */
  private dirtyGroups = new Set<string>();
  private shader: (XRendererShader & { object: Direct3DVertexShader9 }) | null = null;
  private uploadedFor: unknown = null;
  private saver: SavingManager | null = null;
  private released = false;

  constructor(readonly device: Direct3DDevice9, parsed: ParsedEffect) {
    for (const def of parsed.params) {
      const comps = PARAM_TYPES[def.type === "float4x4" ? "float4x4" : def.type]!.comps * Math.max(1, def.array);
      const data = new Float32Array(comps);
      def.init.forEach((v, i) => { data[i] = v; });
      const group = XR_GROUPS_BY_PARAM.get(def.name) ?? null;
      this.params.set(def.name, { def, data, handle: { kind: "parameter", name: def.name, owner: this }, group });
    }
    // the port is only valid for the HLSL it was written from: every function it knows must still have its body
    const defined = new Map(parsed.functions.map((f) => [f.name, f.hash]));
    for (const [name, hash] of defined) {
      const want = XR_FUNCTION_HASHES[name];
      if (want !== undefined && want !== hash) throw new FxError(`function ${name} differs from the XRenderer.fx this port was written from`);
    }
    for (const arr of parsed.shaderArrays) {
      const list = arr.entries.map((e) => {
        if (!defined.has(e.func)) throw new FxError(`function ${e.func} used by ${arr.name} is not defined`);
        const s = buildXRendererVertexShader(e.func, e.arg);
        if (!s) throw new FxError(`unsupported vertex shader function ${e.func}(${e.arg ?? ""}) in ${arr.name}`);
        const made = device.CreateEmulatedVertexShader(s);
        if (!made.shader) throw new FxError(`cannot create ${e.func}`);
        return Object.assign({}, s, { object: made.shader });
      });
      this.shaders.set(arr.name, list);
    }
    for (const def of parsed.techniques) {
      for (const p of def.passes) for (const a of p.assignments) this.checkAssignment(a);
      const handle: D3DXHandle = { kind: "technique", name: def.name, owner: this };
      this.techniques.push({ def, handle, passHandles: def.passes.map((p) => ({ kind: "pass", name: p.name, owner: this })) });
    }
    if (!this.techniques.length) throw new FxError("the file defines no technique");
    this.technique = this.techniques[0]!;
    for (const name of this.params.keys()) this.touchName(name);
  }

  // ---- creation-time validation (D3DX reports these when it compiles the file)
  private checkAssignment(a: Assignment): void {
    const name = a.state.toLowerCase();
    if (name === "vertexshader") {
      const e = unwrap(a.expr);
      if (e.k !== "idx" || !this.shaders.has(e.name)) throw new FxError(`VertexShader must index a vertex shader array`);
      const index = unwrap(e.index);
      if (index.k !== "num" && !(index.k === "id" && this.params.has(index.name))) throw new FxError("unsupported vertex shader index");
      return;
    }
    const def = STATES.get(name);
    if (!def) throw new FxError(`unsupported state assignment '${a.state}'`);
    const e = unwrap(a.expr);
    if (e.k === "num") return;
    if (e.k === "idx") throw new FxError(`state '${a.state}' cannot take an array element`);
    const up = e.name.toUpperCase();
    if (this.params.has(e.name) || def.names?.[up] !== undefined || BOOL_NAMES[up] !== undefined) return;
    throw new FxError(`unknown value '${e.name}' for state '${a.state}'`);
  }

  // ---- description / lookup
  GetDesc(): { Parameters: number; Techniques: number; Functions: number } { return { Parameters: this.params.size, Techniques: this.techniques.length, Functions: 0 }; }
  GetTechniqueByName(name: string): D3DXHandle | null { return this.techniques.find((t) => t.def.name === name)?.handle ?? null; }
  GetTechnique(index: number): D3DXHandle | null { return this.techniques[index]?.handle ?? null; }
  GetPass(technique: D3DXHandle, index: number): D3DXHandle | null { return this.techniques.find((t) => t.handle === technique)?.passHandles[index] ?? null; }
  GetParameterByName(parent: D3DXHandle | null, name: string): D3DXHandle | null { return parent ? null : this.params.get(name)?.handle ?? null; }
  GetParameter(parent: D3DXHandle | null, index: number): D3DXHandle | null { return parent ? null : [...this.params.values()][index]?.handle ?? null; }
  GetCurrentTechnique(): D3DXHandle { return this.technique.handle; }
  SetTechnique(handle: D3DXHandle): number {
    const t = this.techniques.find((x) => x.handle === handle);
    if (!t || this.began) return D3DERR_INVALIDCALL;
    this.technique = t;
    return D3D_OK;
  }
  SetStateManager(manager: ID3DXEffectStateManager | null): number { this.manager = manager; return D3D_OK; }
  GetStateManager(): ID3DXEffectStateManager | null { return this.manager; }
  OnLostDevice(): number { return D3D_OK; }
  OnResetDevice(): number { return D3D_OK; }
  Release(): number { this.released = true; return 0; }
  get isReleased(): boolean { return this.released; }

  // ---- parameters
  private param(handle: D3DXHandle | null): Param | null {
    if (!handle || handle.kind !== "parameter" || handle.owner !== this) return null;
    return this.params.get(handle.name) ?? null;
  }
  private touch(p: Param): void {
    this.touchName(p.def.name);
    this.dirtyParams.add(p.def.name);
  }
  private touchName(name: string): void {
    const g = this.params.get(name)?.group;
    if (g) this.dirtyGroups.add(g);
  }
  SetMatrix(h: D3DXHandle, m: ArrayLike<number>): number {
    const p = this.param(h);
    if (!p || p.def.type !== "float4x4" || p.def.array > 0 || m.length < 16) return D3DERR_INVALIDCALL;
    for (let i = 0; i < 16; i++) p.data[i] = m[i]!;
    this.touch(p);
    return D3D_OK;
  }
  /** `count` matrices, 16 floats each, into the array (or the single matrix when count is 1) */
  SetMatrixArray(h: D3DXHandle, m: ArrayLike<number>, count: number): number {
    const p = this.param(h);
    if (!p || p.def.type !== "float4x4" || count < 0 || count > Math.max(1, p.def.array) || m.length < count * 16) return D3DERR_INVALIDCALL;
    for (let i = 0; i < count * 16; i++) p.data[i] = m[i]!;
    this.touch(p);
    return D3D_OK;
  }
  SetVector(h: D3DXHandle, v: ArrayLike<number>): number {
    const p = this.param(h);
    if (!p || p.def.type !== "float4" || v.length < 4) return D3DERR_INVALIDCALL;
    for (let i = 0; i < 4; i++) p.data[i] = v[i]!;
    this.touch(p);
    return D3D_OK;
  }
  SetFloat(h: D3DXHandle, f: number): number { return this.setScalar(h, f); }
  SetInt(h: D3DXHandle, n: number): number { return this.setScalar(h, n | 0); }
  SetBool(h: D3DXHandle, b: boolean | number): number { return this.setScalar(h, b ? 1 : 0); }
  private setScalar(h: D3DXHandle, v: number): number {
    const p = this.param(h);
    if (!p || p.def.array > 0) return D3DERR_INVALIDCALL;
    switch (p.def.type) {
      case "float": p.data[0] = v; break;
      case "int": p.data[0] = Math.trunc(v); break;
      case "bool": p.data[0] = v !== 0 ? 1 : 0; break;
      default: return D3DERR_INVALIDCALL;
    }
    this.touch(p);
    return D3D_OK;
  }
  GetFloat(h: D3DXHandle): { hr: number; value: number } { const p = this.param(h); return p && p.def.array === 0 && p.data.length >= 1 && p.def.type !== "float4" && p.def.type !== "float4x4" ? { hr: D3D_OK, value: p.data[0]! } : { hr: D3DERR_INVALIDCALL, value: 0 }; }
  GetInt(h: D3DXHandle): { hr: number; value: number } { const r = this.GetFloat(h); return { hr: r.hr, value: Math.trunc(r.value) }; }
  GetBool(h: D3DXHandle): { hr: number; value: boolean } { const r = this.GetFloat(h); return { hr: r.hr, value: r.value !== 0 }; }
  GetVector(h: D3DXHandle): { hr: number; value: Float32Array } { const p = this.param(h); return p && p.def.type === "float4" ? { hr: D3D_OK, value: p.data.slice() } : { hr: D3DERR_INVALIDCALL, value: new Float32Array(4) }; }
  GetMatrixArray(h: D3DXHandle, count: number): { hr: number; value: Float32Array } {
    const p = this.param(h);
    return p && p.def.type === "float4x4" && count <= Math.max(1, p.def.array) ? { hr: D3D_OK, value: p.data.slice(0, count * 16) } : { hr: D3DERR_INVALIDCALL, value: new Float32Array(0) };
  }

  // ---- rendering
  /** `Begin(flags)`: the number of passes of the current technique. */
  Begin(flags: number): { hr: number; passes: number } {
    if (this.began) return { hr: D3DERR_INVALIDCALL, passes: 0 };
    this.began = true;
    this.beginFlags = flags;
    this.pass = -1;
    this.saver = this.manager ? null : new SavingManager(this.device, flags);
    return { hr: D3D_OK, passes: this.technique.def.passes.length };
  }
  BeginPass(pass: number): number {
    if (!this.began || this.pass >= 0 || pass < 0 || pass >= this.technique.def.passes.length) return D3DERR_INVALIDCALL;
    this.pass = pass;
    const def = this.technique.def.passes[pass]!;
    let hr = D3D_OK;
    this.shader = null;
    for (const a of def.assignments) { const r = this.apply(a); if (r < 0) hr = r; }
    this.dirtyParams.clear();
    this.uploadConstants(true);
    if (hr < 0) { this.pass = -1; return hr; }
    return D3D_OK;
  }
  CommitChanges(): number {
    if (!this.began || this.pass < 0) return D3DERR_INVALIDCALL;
    const def = this.technique.def.passes[this.pass]!;
    let hr = D3D_OK;
    if (this.dirtyParams.size) {
      for (const a of def.assignments) if (a.deps.some((d) => this.dirtyParams.has(d))) { const r = this.apply(a); if (r < 0) hr = r; }
      this.dirtyParams.clear();
    }
    this.uploadConstants(false);
    return hr;
  }
  EndPass(): number {
    if (!this.began || this.pass < 0) return D3DERR_INVALIDCALL;
    this.pass = -1;
    return D3D_OK;
  }
  End(): number {
    if (!this.began || this.pass >= 0) return D3DERR_INVALIDCALL;
    this.began = false;
    this.saver?.restore();
    this.saver = null;
    return D3D_OK;
  }
  get flagsOfBegin(): number { return this.beginFlags; }

  private get sm(): ID3DXEffectStateManager { return this.manager ?? this.saver!; }

  private apply(a: Assignment): number {
    const name = a.state.toLowerCase();
    if (name === "vertexshader") {
      const e = unwrap(a.expr) as Extract<Expr, { k: "idx" }>;
      const list = this.shaders.get(e.name)!;
      const index = this.evalInt(unwrap(e.index));
      const shader = list[index];
      if (!shader) return D3DERR_INVALIDCALL;
      this.shader = shader;
      return this.sm.SetVertexShader(shader.object);
    }
    const def = STATES.get(name)!;
    const value = this.evalState(def, unwrap(a.expr));
    switch (def.kind) {
      case "rs": return this.sm.SetRenderState(def.id, value);
      case "tss": return this.sm.SetTextureStageState(a.index, def.id, value);
      default: return this.sm.SetSamplerState(a.index, def.id, value);
    }
  }
  private evalInt(e: PlainExpr): number {
    if (e.k === "num") return Math.trunc(e.v);
    if (e.k === "id") { const p = this.params.get(e.name); if (p && p.def.array === 0) return Math.trunc(p.data[0]!); }
    return -1;
  }
  private evalState(def: StateDef, e: PlainExpr): number {
    if (e.k === "num") return e.v >>> 0;
    if (e.k !== "id") return 0;
    const p = this.params.get(e.name);
    if (p) {
      switch (def.type) {
        case "bool": return p.data[0] !== 0 ? 1 : 0;
        case "float": return floatToDword(p.data[0]!);
        case "color": return p.def.type === "float4" ? colorToDword(p.data[0]!, p.data[1]!, p.data[2]!, p.data[3]!) : (Math.trunc(p.data[0]!) >>> 0);
        default: return Math.trunc(p.data[0]!) >>> 0;
      }
    }
    const up = e.name.toUpperCase();
    const table = def.names ?? BOOL_NAMES;
    return (table[up] ?? BOOL_NAMES[up] ?? 0) >>> 0;
  }

  /** Upload the constant register groups the vertex shader in use reads: all of them (`all`, or the shader changed) or those changed since. */
  private uploadConstants(all: boolean): void {
    const s = this.shader;
    if (!s) return;
    const everything = all || this.uploadedFor !== s;
    this.uploadedFor = s;
    for (const g of s.uses) {
      if (!everything && !this.dirtyGroups.has(g)) continue;
      const [reg, count] = GROUP_REGS[g]!;
      this.sm.SetVertexShaderConstantF(reg, this.groupData(g, count), count);
      this.dirtyGroups.delete(g);
    }
  }
  private groupData(group: string, count: number): Float32Array {
    const out = new Float32Array(count * 4);
    const names = XR_GROUPS[group]!;
    if (group === "S0" || group === "S1") {
      for (const n of names) { const [, comp] = SCALAR_SLOT[n]!; out[comp] = this.params.get(n)?.data[0] ?? 0; }
      return out;
    }
    out.set(this.params.get(names[0]!)?.data.subarray(0, count * 4) ?? []);
    return out;
  }
}

const XR_GROUPS_BY_PARAM = new Map<string, string>();
for (const [g, names] of Object.entries(XR_GROUPS)) for (const n of names) XR_GROUPS_BY_PARAM.set(n, g);

type PlainExpr = Exclude<Expr, { k: "group" }>;
function unwrap(e: Expr): PlainExpr { while (e.k === "group") e = e.e; return e; }

/**
 * The manager an effect uses when none was set: writes to the device and remembers the first value of every state it touches, so that `End`
 * can put them back (unless the Begin flags ask for the state not to be saved).
 */
class SavingManager implements ID3DXEffectStateManager {
  private readonly rs = new Map<number, number>();
  private readonly tss = new Map<number, number>();
  private readonly samp = new Map<number, number>();
  private vsSaved = false;
  private vs: Direct3DVertexShader9 | null = null;
  private readonly constants = new Map<number, Float32Array>();
  constructor(private readonly device: Direct3DDevice9, private readonly flags: number) {}
  SetRenderState(state: number, value: number): number {
    if (!(this.flags & D3DXFX.DONOTSAVESTATE) && !this.rs.has(state)) this.rs.set(state, this.device.GetRenderState(state).value);
    return this.device.SetRenderState(state, value);
  }
  SetTextureStageState(stage: number, type: number, value: number): number {
    const key = stage * 64 + type;
    if (!(this.flags & D3DXFX.DONOTSAVESTATE) && !this.tss.has(key)) this.tss.set(key, this.device.GetTextureStageState(stage, type).value);
    return this.device.SetTextureStageState(stage, type, value);
  }
  SetSamplerState(sampler: number, type: number, value: number): number {
    const key = sampler * 64 + type;
    if (!(this.flags & D3DXFX.DONOTSAVESAMPLERSTATE) && !this.samp.has(key)) this.samp.set(key, this.device.GetSamplerState(sampler, type).value);
    return this.device.SetSamplerState(sampler, type, value);
  }
  SetVertexShader(shader: Direct3DVertexShader9 | null): number {
    if (!(this.flags & D3DXFX.DONOTSAVESHADERSTATE) && !this.vsSaved) { this.vs = this.device.GetVertexShader(); this.vsSaved = true; }
    return this.device.SetVertexShader(shader);
  }
  SetVertexShaderConstantF(start: number, data: Float32Array, count: number): number {
    if (!(this.flags & D3DXFX.DONOTSAVESHADERSTATE)) for (let r = start; r < start + count; r++) if (!this.constants.has(r)) this.constants.set(r, this.device.GetVertexShaderConstantF(r, 1).data);
    return this.device.SetVertexShaderConstantF(start, data, count);
  }
  restore(): void {
    for (const [k, v] of this.rs) this.device.SetRenderState(k, v);
    for (const [k, v] of this.tss) this.device.SetTextureStageState(Math.floor(k / 64), k % 64, v);
    for (const [k, v] of this.samp) this.device.SetSamplerState(Math.floor(k / 64), k % 64, v);
    if (this.vsSaved) this.device.SetVertexShader(this.vs);
    for (const [r, v] of this.constants) this.device.SetVertexShaderConstantF(r, v, 1);
  }
}

/** `ID3DXEffectStateManager` that forwards to the device (no mirror, no restore). */
export class DeviceStateManager implements ID3DXEffectStateManager {
  constructor(private readonly device: Direct3DDevice9) {}
  SetRenderState(state: number, value: number): number { return this.device.SetRenderState(state, value); }
  SetSamplerState(sampler: number, type: number, value: number): number { return this.device.SetSamplerState(sampler, type, value); }
  SetTextureStageState(stage: number, type: number, value: number): number { return this.device.SetTextureStageState(stage, type, value); }
  SetVertexShader(shader: Direct3DVertexShader9 | null): number { return this.device.SetVertexShader(shader); }
  SetVertexShaderConstantF(start: number, data: Float32Array, count: number): number { return this.device.SetVertexShaderConstantF(start, data, count); }
}

/**
 * `D3DXCreateEffect(device, data, size, defines, include, flags, pool, &effect, &errors)` for XRenderer.fx.  `data` is the file (UTF-8 / ASCII).
 * The result carries the compile messages in `errors` (null when there are none), like the `ID3DXBuffer` of the original.
 */
export function D3DXCreateEffect(device: Direct3DDevice9, data: Uint8Array | string, _flags = 0): { hr: number; effect: D3DXEffect | null; errors: string | null } {
  const source = typeof data === "string" ? data : new TextDecoder("latin1").decode(data);
  try {
    return { hr: D3D_OK, effect: new D3DXEffect(device, parseEffect(source)), errors: null };
  } catch (e) {
    if (e instanceof FxError) return { hr: D3DXERR_INVALIDDATA, effect: null, errors: e.message };
    throw e;
  }
}
