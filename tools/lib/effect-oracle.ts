/**
 * An independent reading of the two effect-script languages, for `tools/verify-effects.ts`.
 *
 * There is no native oracle for the particle / XMeshPlayer parsers (they only exist inside x2.exe), so the check is a second
 * implementation that shares no code with the port in `packages/assets`: the shipped scripts are strictly line oriented (one
 * statement per line, at most one `=` per line, nothing after a `{`/`}` on the same line - `verify-effects.ts` counts the
 * exceptions), so a line scanner with a few regular expressions can rebuild the same models without a tokenizer or a state machine.
 * Where the port walks tokens with the exe's quirks, this works on text; a parser bug (wrong field, wrong time range, dropped
 * statement, swapped min/max) shows up as a difference, a misreading of the decompile does not (both would have to be wrong the
 * same way: the field tables below were written from the decompile again, not copied).
 *
 * What it takes from the port: the model types, the defaults (`newParticleSequence`, `newXMeshTemplet`, which are a transcription of
 * the constructors and are checked by the unit tests) and the enum tables.
 */

import {
  BILLBOARD_TYPES, D3DBLEND_NAMES, D3DCULL_NAMES, DEG2RAD, PARTICLE_MESH_RENDER_TYPES, PARTICLE_TYPES, RENDER_TYPES,
  XMESH_CARTOON_TEX_TYPES, XMESH_LIFE_TYPES, XMESH_MESH_TYPES, XSKIN_ANIM_PLAYTYPES, cInt, f32, newParticleSequence,
  newXMeshTemplet,
} from "@els/assets";
import type { Color4, MinMax, ParticleEvent, ParticleSequence, Vec2, Vec3, XMeshEvent, XMeshTemplet } from "@els/assets";

export interface Statement { line: number; lhs: string; rhs: string }
export interface ScannedBlock { name: string; line: number; statements: Statement[] }
export interface Scan {
  kind: "particle" | "xmeshplayer";
  name: string;
  version: string;
  blocks: ScannedBlock[];
  /** non-blank lines (after comment removal) of the main block that are neither braces, headers nor `lhs = rhs` statements */
  stray: { line: number; text: string }[];
  /** non-blank lines after the closing brace of the main block (the exe never reads them) */
  trailing: number;
  /** bytes >= 0x80 outside comments */
  nonAsciiOutsideComments: number;
  /** lines holding more than one `=`, or a brace together with other text */
  crowdedLines: number;
}

/**
 * Removes the comment of a line: `//` anywhere outside a string, `--` where a token starts (the exe's tokenizer does the same).
 * Returns the code and whether it had to cut something.
 */
export function stripComment(line: string): string {
  let inStr = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (c === '"') inStr = !inStr;
    else if (!inStr) {
      if (c === "/" && line[i + 1] === "/") return line.slice(0, i);
      if (c === "-" && line[i + 1] === "-" && (i === 0 || /\s/.test(line[i - 1]!))) return line.slice(0, i);
    }
  }
  return line;
}

const HEADER = /^(particlesystem|xmeshplayer)\s+"([^"]*)"\s+(\S+?)\s*(\{)?$/i;
const BLOCK_START = /^(eventsequence|templet)\s+"([^"]*)"\s*(\{)?$/i;

/** Splits a script into the main block's `eventsequence` / `templet` blocks and their `lhs = rhs` statements. */
export function scanLines(bytes: Uint8Array): Scan {
  const text = Buffer.from(bytes).toString("latin1");
  const scan: Scan = {
    kind: "particle", name: "", version: "", blocks: [], stray: [], trailing: 0, nonAsciiOutsideComments: 0, crowdedLines: 0,
  };
  // 0 = before the header, 1 = header seen (waiting for its brace), 2 = in the system block, 3 = block header seen (waiting for brace),
  // 4 = in a block, 5 = main block closed
  let state = 0;
  let cur: ScannedBlock | undefined;
  const lines = text.split("\n");
  for (let n = 0; n < lines.length; n++) {
    const code = stripComment(lines[n]!.replace(/\r$/, "")).trim();
    for (let k = 0; k < code.length; k++) if (code.charCodeAt(k) >= 0x80) scan.nonAsciiOutsideComments++;
    if (code === "") continue;
    const stray = () => scan.stray.push({ line: n + 1, text: code });
    if (state === 5) { scan.trailing++; continue; }
    if ((code.match(/=/g) ?? []).length > 1) scan.crowdedLines++;
    switch (state) {
      case 0: {
        const m = HEADER.exec(code);
        if (!m) { stray(); break; }
        scan.kind = m[1]!.toLowerCase() === "particlesystem" ? "particle" : "xmeshplayer";
        scan.name = m[2]!;
        scan.version = m[3]!;
        state = m[4] ? 2 : 1;
        break;
      }
      case 1:
        if (code === "{") state = 2; else stray();
        break;
      case 2: {
        if (code === "}") { state = 5; break; }
        const m = BLOCK_START.exec(code);
        if (!m) { stray(); break; }
        cur = { name: m[2]!, line: n + 1, statements: [] };
        scan.blocks.push(cur);
        state = m[3] ? 4 : 3;
        break;
      }
      case 3:
        if (code === "{") state = 4; else stray();
        break;
      default: { // 4
        if (code === "}") { state = 2; break; }
        const eq = code.indexOf("=");
        if (eq < 0 || code === "{") { stray(); break; }
        if (/[{}]/.test(code.replace(/"[^"]*"/g, ""))) scan.crowdedLines++;
        cur!.statements.push({ line: n + 1, lhs: code.slice(0, eq).trim(), rhs: code.slice(eq + 1).trim() });
      }
    }
  }
  return scan;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Values

type Range = { min: number; max: number };

const NUM_PREFIX = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/;

/** `_atof` + store to float, the long way round: a regex for the numeric prefix, then `parseFloat`. */
function num(text: string): number {
  const m = NUM_PREFIX.exec(text.trim());
  return f32(m ? parseFloat(m[0]) : 0);
}

function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "(") depth++;
    else if (s[i] === ")") depth--;
    else if (s[i] === "," && depth === 0) { out.push(s.slice(start, i)); start = i + 1; }
  }
  out.push(s.slice(start));
  return out.map((x) => x.trim());
}

/** `1.5` or `Random(a, b)` */
function range(text: string): Range {
  const m = /^random\s*\(\s*([^,()]+?)\s*,\s*([^,()]+?)\s*\)$/i.exec(text.trim());
  if (m) return { min: num(m[1]!), max: num(m[2]!) };
  const v = num(text);
  return { min: v, max: v };
}

/** `XYZ(..)`, `XY(..)` or `RGBA(..)` with the given component count */
function tuple<T extends readonly number[]>(text: string, name: string, n: number): MinMax<T> {
  const m = new RegExp(`^${name}\\s*\\((.*)\\)$`, "i").exec(text.trim());
  if (!m) throw new Error(`expected ${name}(...) in "${text}"`);
  const parts = splitTop(m[1]!);
  if (parts.length !== n) throw new Error(`expected ${n} components in "${text}"`);
  const rs = parts.map(range);
  return { min: rs.map((r) => r.min), max: rs.map((r) => r.max) } as unknown as MinMax<T>;
}
const xyz = (t: string): MinMax<Vec3> => tuple<Vec3>(t, "xyz", 3);
const xy = (t: string): MinMax<Vec2> => tuple<Vec2>(t, "xy", 2);
const rgba = (t: string): MinMax<Color4> => tuple<Color4>(t, "rgba", 4);

const bool = (t: string): boolean => {
  const u = t.trim().toUpperCase();
  if (u !== "TRUE" && u !== "FALSE") throw new Error(`expected a bool in "${t}"`);
  return u === "TRUE";
};

/** `RemoveQuotes` on a string value; an unquoted word is upper-cased by the tokenizer. */
function str(t: string): string {
  const s = t.trim();
  return s.includes('"') ? s.replaceAll('"', "") : s.toUpperCase();
}

function lookup(table: Readonly<Record<string, number>>, t: string, what: string): number {
  const u = t.trim().toUpperCase();
  if (!Object.hasOwn(table, u)) throw new Error(`bad ${what} "${t}"`);
  return table[u]!;
}

function lookupPairs(table: readonly (readonly [string, number])[], t: string, what: string): number {
  const u = t.trim().toUpperCase();
  const hit = table.find(([name]) => name === u);
  if (!hit) throw new Error(`bad ${what} "${t}"`);
  return hit[1];
}

// a number token is whatever starts with a digit or `-` up to white space or a delimiter (`0.s1` is a number: `_atof` stops at the `s`)
const NUM_RE = String.raw`(?:random\s*\([^()]*\)|[-\d.][^\s,()]*)`;
const TIME_RE = String.raw`(fade\s+so\s+)?(initial|final|at\s+(${NUM_RE})|from\s+(${NUM_RE})\s+to\s+(${NUM_RE}))`;
const PARTICLE_LHS = new RegExp(`^${TIME_RE}\\s+(\\w+)$`, "i");
const XMESH_LHS = new RegExp(`^(global|die|anim)\\s+${TIME_RE}\\s+(\\w+)$`, "i");

function timeOf(fade: string | undefined, spec: string, at: string | undefined, from: string | undefined, to: string | undefined,
  lifeMax: number | undefined): { fade: boolean; time: Range; final: boolean } {
  const s = spec.toLowerCase();
  if (s === "initial") {
    if (fade) throw new Error('"fade so initial"');
    return { fade: false, time: { min: 0, max: 0 }, final: false };
  }
  if (s === "final") {
    // particles: the time range [0, LIFETIME.max]; xmeshes: a flag (lifeMax undefined)
    return lifeMax === undefined ? { fade: !!fade, time: { min: 0, max: 0 }, final: true } : { fade: !!fade, time: { min: 0, max: lifeMax }, final: false };
  }
  if (s.startsWith("at")) return { fade: !!fade, time: range(at!), final: false };
  return { fade: !!fade, time: { min: range(from!).min, max: range(to!).max }, final: false };
}

const toRange = (r: Range): Range => ({ min: r.min, max: r.max });

// ---------------------------------------------------------------------------------------------------------------------------------
// Particle sequences

export function expectParticleSequence(block: ScannedBlock): ParticleSequence {
  const seq = newParticleSequence(block.name);
  for (const st of block.statements) {
    const ev = PARTICLE_LHS.exec(st.lhs);
    const rhs = st.rhs;
    if (ev) {
      const [, fade, spec, at, from, to, kindRaw] = ev;
      const head = timeOf(fade, spec!, at, from, to, seq.lifetime.max);
      const kind = kindRaw!.toLowerCase();
      const base = { fade: head.fade, time: head.time };
      let e: ParticleEvent;
      switch (kind) {
        case "color": e = { ...base, kind, value: rgba(rhs) }; break;
        case "size": case "velocity": case "position": case "rotate": case "crash": e = { ...base, kind, value: xyz(rhs) }; break;
        case "tex0uv": case "tex1uv": case "tex2uv": e = { ...base, kind, value: xy(rhs) }; break;
        case "scale": case "dirspeed": case "blackholetime": case "resetcrash": case "eventtimer": case "stretch": e = { ...base, kind, value: range(rhs) }; break;
        case "texture": e = { ...base, kind, value: str(rhs) }; break;
        default: throw new Error(`line ${st.line}: unknown particle event "${kindRaw}"`);
      }
      seq.events.push(e);
      continue;
    }
    if (/\s/.test(st.lhs)) throw new Error(`line ${st.line}: cannot read "${st.lhs}"`);
    const prop = st.lhs.toLowerCase();
    switch (prop) {
      case "sourceblendmode": seq.srcBlendMode = lookupPairs(D3DBLEND_NAMES, rhs, "blend"); break;
      case "destblendmode": seq.destBlendMode = lookupPairs(D3DBLEND_NAMES, rhs, "blend"); break;
      case "cullmode": seq.cullMode = lookupPairs(D3DCULL_NAMES, rhs, "cull"); break;
      case "particletype": seq.particleType = lookup(PARTICLE_TYPES, rhs, "particle type"); break;
      case "meshrendertype": seq.meshRenderType = lookup(PARTICLE_MESH_RENDER_TYPES, rhs, "mesh render type"); break;
      case "billboardtype": seq.billboardType = lookup(BILLBOARD_TYPES, rhs, "billboard"); break;
      case "useland": seq.useLand = bool(rhs); break;
      case "trace": seq.trace = bool(rhs); break;
      case "zenable": seq.zEnable = bool(rhs); break;
      case "zwriteenable": seq.zWriteEnable = bool(rhs); break;
      case "resolutionconvert": seq.resolutionConvert = bool(rhs); break;
      case "forcelayer": seq.forceLayer = bool(rhs); break;
      case "applyunitscale": seq.applyUnitScale = bool(rhs); break;
      case "alphatest": seq.alphaTest = bool(rhs); break;
      case "mesh": case "skinmesh": seq.meshName = str(rhs); break;
      case "changetexxet": seq.changeTexXETName = str(rhs); break;
      case "multitexxet": seq.multiTexXETName = str(rhs); break;
      case "anixet": seq.aniXETName = str(rhs); break;
      case "aniname": seq.aniName = str(rhs); break;
      case "traceparticlelist": seq.traceParticleList.push(str(rhs)); break;
      case "finalparticlelist": seq.finalParticleList.push(str(rhs)); break;
      case "lifetime": seq.lifetime = range(rhs); break;
      case "emitrate": seq.emitRate = range(rhs); break;
      case "numparticles": seq.maxParticleNum = cInt(range(rhs).max); break;
      case "triggercount": seq.triggerCount = range(rhs); break;
      case "triggertime": seq.triggerTime = range(rhs); break;
      case "drawcount": seq.drawCount = range(rhs); break;
      case "landpos": seq.landPosition = range(rhs); break;
      case "layer": seq.layer = cInt(range(rhs).max); break;
      case "screwvalue": seq.screwValue = cInt(range(rhs).max); break;
      case "screwrotatespeed": seq.screwRotateSpeed = cInt(range(rhs).max); break;
      case "spherical_emitradius": seq.sphericalEmitRadius = range(rhs); break;
      case "spherical_emitazimuth": { const r = range(rhs); seq.sphericalEmitAzimuth = { min: f32(r.min * DEG2RAD), max: f32(r.max * DEG2RAD) }; break; }
      case "spherical_emitpolar": { const r = range(rhs); seq.sphericalEmitPolar = { min: f32(r.min * DEG2RAD), max: f32(r.max * DEG2RAD) }; break; }
      case "emitradius": seq.emitRadius = xyz(rhs); break;
      case "emitradiusmin": seq.emitRadiusMin = xyz(rhs); break;
      case "gravity": seq.gravity = xyz(rhs); break;
      case "blackholepos": seq.blackHolePosition = xyz(rhs); break;
      case "lightpos": seq.lightPos = xyz(rhs); break;
      case "addrotaterel": seq.addRotateRel = xyz(rhs); break;
      case "spherical_emitrotation": seq.sphericalEmitRotation = xyz(rhs); break;
      default: throw new Error(`line ${st.line}: unknown sequence property "${st.lhs}"`);
    }
  }
  return seq;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// XMeshPlayer templets

export function expectXMeshTemplet(block: ScannedBlock): XMeshTemplet {
  const t = newXMeshTemplet(block.name);
  for (const st of block.statements) {
    const ev = XMESH_LHS.exec(st.lhs);
    const rhs = st.rhs;
    if (ev) {
      const [, track, fade, spec, at, from, to, kindRaw] = ev;
      const head = timeOf(fade, spec!, at, from, to, undefined);
      const kind = kindRaw!.toLowerCase();
      const base = { fade: head.fade, final: head.final, time: head.time };
      let e: XMeshEvent;
      switch (kind) {
        case "aniname": {
          const m = /^(.*),\s*(\w+)$/.exec(rhs);
          if (!m) throw new Error(`line ${st.line}: bad AniName`);
          e = { ...base, kind, value: { name: str(m[1]!), playType: lookup(XSKIN_ANIM_PLAYTYPES, m[2]!, "play type") } };
          break;
        }
        case "anispeed": case "dirspeed": case "blackholetime": case "resetcrash": case "lightflowimpact": e = { ...base, kind, value: range(rhs) }; break;
        case "color": case "outlinecolor": e = { ...base, kind, value: rgba(rhs) }; break;
        case "size": case "velocity": case "position": case "rotate": case "crash": case "lightflowpoint": e = { ...base, kind, value: xyz(rhs) }; break;
        case "tex0uv": case "tex1uv": case "tex2uv": e = { ...base, kind, value: xy(rhs) }; break;
        case "sound": e = { ...base, kind, value: str(rhs) }; break;
        case "render_type": e = { ...base, kind, value: lookupRenderType(rhs) }; break;
        case "slashtrace": e = { ...base, kind, value: bool(rhs) }; break;
        default: throw new Error(`line ${st.line}: unknown xmesh event "${kindRaw}"`);
      }
      (track!.toLowerCase() === "global" ? t.globalEvents : track!.toLowerCase() === "die" ? t.dieEvents : t.animEvents).push(e);
      continue;
    }
    if (/\s/.test(st.lhs)) throw new Error(`line ${st.line}: cannot read "${st.lhs}"`);
    const prop = st.lhs.toLowerCase();
    const r = (): Range => range(rhs);
    const ints = (): { min: number; max: number } => ({ min: cInt(r().min), max: cInt(r().max) });
    switch (prop) {
      case "sourceblendmode": t.srcBlend = lookupPairs(D3DBLEND_NAMES, rhs, "blend"); break;
      case "destblendmode": t.destBlend = lookupPairs(D3DBLEND_NAMES, rhs, "blend"); break;
      case "lifetype": t.lifeType = lookup(XMESH_LIFE_TYPES, rhs, "life type"); break;
      case "dietype": t.dieType = lookup(XMESH_LIFE_TYPES, rhs, "life type"); break;
      case "meshtype": t.meshType = lookup(XMESH_MESH_TYPES, rhs, "mesh type"); break;
      case "billboardtype": t.billboardType = lookup(BILLBOARD_TYPES, rhs, "billboard"); break;
      case "rendertype": t.renderType = lookupRenderType(rhs); break;
      case "cartoontextype": t.cartoonTexType = lookup(XMESH_CARTOON_TEX_TYPES, rhs, "cartoon tex type"); break;
      case "cullmode": t.cullMode = lookupPairs(D3DCULL_NAMES.filter(([n]) => n !== "D3DCULL_FORCE_DWORD"), rhs, "cull"); break;
      case "playcount": t.playCount = ints(); break;
      case "lifetime": t.lifeTime = toRange(r()); break;
      case "dieplaycount": t.diePlayCount = ints(); break;
      case "dielifetime": t.dieLifeTime = toRange(r()); break;
      case "outlinewide": t.outLineWide = toRange(r()); break;
      case "lightflowwide": t.lightFlowWide = toRange(r()); break;
      case "drawcount": t.drawCount = ints(); break;
      case "landpos": t.landPosition = toRange(r()); break;
      case "layer": t.layer = cInt(r().max); break;
      case "elasticcoeff": t.elasticCoeff = toRange(r()); break;
      case "elasticcoeff_x": t.elasticCoeffX = toRange(r()); break;
      case "slash_trace_type": t.slashTraceType = cInt(r().max); break;
      case "slash_trace_curve_type": t.slashTraceCurveType = cInt(r().max); break;
      case "not_check_land_time": t.notCheckLandTime = r().max; break;
      case "lightpos": t.lightPos = xyz(rhs); break;
      case "gravity": t.gravity = xyz(rhs); break;
      case "blackholepos": t.blackHolePosition = xyz(rhs); break;
      case "usedieevent": t.useDieEvent = bool(rhs); break;
      case "zenable": t.zEnable = bool(rhs); break;
      case "zwriteenable": t.zWriteEnable = bool(rhs); break;
      case "useland": t.useLand = bool(rhs); break;
      case "set_land_height_on_start": t.setLandHeightOnStart = bool(rhs); break;
      case "crashland": t.crashLand = bool(rhs); break;
      case "useslashtrace": t.useSlashTrace = bool(rhs); break;
      case "forcelayer": t.forceLayer = bool(rhs); break;
      case "applyunitscale": t.applyUnitScale = bool(rhs); break;
      case "alphatest": t.alphaTestEnable = bool(rhs); break;
      case "meshname": t.meshName = str(rhs); break;
      case "changetexxet": t.changeTexXETName = str(rhs); break;
      case "multitexxet": t.multiTexXETName = str(rhs); break;
      case "anipackage": t.aniXETName = str(rhs); break;
      case "slash_trace_texture": t.slashTraceTextureName = str(rhs); break;
      default: throw new Error(`line ${st.line}: unknown templet property "${st.lhs}"`);
    }
  }
  return t;
}

function lookupRenderType(text: string): number {
  const u = text.trim().toUpperCase();
  if (u.startsWith("RT_ADD_CARTOON")) throw new Error(`render type "${text}" is refused by the exe`);
  return lookup(RENDER_TYPES, u, "render type");
}

// ---------------------------------------------------------------------------------------------------------------------------------

/** The path of the first difference between two plain values (`Object.is` on numbers, so -0 and +0 differ), or undefined. */
export function firstDiff(a: unknown, b: unknown, path = ""): string | undefined {
  if (typeof a === "number" && typeof b === "number") return Object.is(a, b) ? undefined : `${path}: ${a} != ${b}`;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return a === b ? undefined : `${path}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`;
  if (Array.isArray(a) !== Array.isArray(b)) return `${path}: array vs object`;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return `${path}: length ${a.length} != ${b.length}`;
    for (let i = 0; i < a.length; i++) {
      const d = firstDiff(a[i], b[i], `${path}[${i}]`);
      if (d) return d;
    }
    return undefined;
  }
  const ka = Object.keys(a as object).sort();
  const kb = Object.keys(b as object).sort();
  if (ka.join() !== kb.join()) return `${path}: keys ${ka.join()} != ${kb.join()}`;
  for (const k of ka) {
    const d = firstDiff((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], path ? `${path}.${k}` : k);
    if (d) return d;
  }
  return undefined;
}
