/**
 * Particle scripts (`GameMajorParticle*.txt`, `UIMajorParticle.txt`, ...): the text DSL that `CKTDGParticleSystem::Compile` reads.
 * Not Lua; the files sit in the KOMs next to the Lua scripts. Port of
 *   Compile                   328F5DB0  x2.exe.c L330825     DetermineTokenType 328F7F70  L332476
 *   ProcessParticleSystemBlock 32902F00 L340444              ProcessEventSequenceBlock 329007C0 L338671
 *   EventFactory              328F87E0  L332767              CParticleEvent_*::ProcessTokenStream 32903490..32903AA0 L340768
 *   CParticleEventSequence ctor 328F3FB0 L329154 (the defaults)   `OpenScriptFile` 328FFC70 L338065 (decrypt + inflate, done by @els/kom)
 * The tokenizer and the number/vector/colour helpers are shared with the XMeshPlayer script (see `effectscript.ts`).
 *
 * Grammar (keywords and property names are case-insensitive; `//` and `--` start comments):
 *
 *     particlesystem "NAME" 1.00 {                       // the version must be a number; nothing reads its value
 *       eventsequence "SEQ" {
 *         <property> = <value>                           // sequence properties, all before the first event
 *         ...
 *         initial|at T|from A to B|final  <event>        // events, `fade so` in front of at/from/final blends towards the value
 *       }
 *       ...
 *     }
 *
 * Numbers are `1.5` or `Random(a, b)` (a range; vectors are `XYZ(x, y, z)`, colours `RGBA(r, g, b, a)`, texture offsets `XY(u, v)`,
 * each component a number or `Random`). Only the FIRST `particlesystem` block of a file is read; whatever follows its closing brace is
 * ignored by the exe (the tokenizer's duplicated last token is the usual leftover).
 *
 * Sequence properties by token class (`DetermineTokenType`):
 *   numeric  LIFETIME EMITRATE NUMPARTICLES TRIGGERCOUNT TRIGGERTIME DRAWCOUNT LANDPOS LAYER SCREWVALUE SCREWROTATESPEED
 *            SPHERICAL_EMITRADIUS SPHERICAL_EMITAZIMUTH SPHERICAL_EMITPOLAR
 *   vector   EMITRADIUS EMITRADIUSMIN GRAVITY BLACKHOLEPOS LIGHTPOS ADDROTATEREL SPHERICAL_EMITROTATION
 *   bool     USELAND TRACE ZENABLE ZWRITEENABLE RESOLUTIONCONVERT FORCELAYER APPLYUNITSCALE ALPHATEST   (TRUE / FALSE)
 *   string   MESH SKINMESH (both set the mesh name) CHANGETEXXET MULTITEXXET ANIXET ANINAME TRACEPARTICLELIST FINALPARTICLELIST
 *            (the last two append to a list)
 *   enum     SOURCEBLENDMODE DESTBLENDMODE (D3DBLEND_*), CULLMODE (D3DCULL_*), PARTICLETYPE (PT_*), MESHRENDERTYPE (RT_*),
 *            BILLBOARDTYPE (BT_*)
 * Events: COLOR SIZE SCALE VELOCITY POSITION ROTATE CRASH RESETCRASH DIRSPEED BLACKHOLETIME EVENTTIMER STRETCH TEX0UV TEX1UV TEX2UV
 * TEXTURE. Fading is refused for BLACKHOLETIME, TEXTURE and EVENTTIMER (their `FadeAllowed` returns false).
 *
 * What the exe does with the values that this port keeps as the script wrote them:
 *   - numbers it narrows when it stores them: NUMPARTICLES, LAYER, SCREWVALUE and SCREWROTATESPEED keep `(int)max` (done here);
 *     SPHERICAL_EMITAZIMUTH / _POLAR are stored in radians (done here, float multiplication by 0.017453292f).
 *   - values it draws once at load time with `RandomNumber(min, max)` (`randomNumber` in effectscript.ts): TRIGGERCOUNT (`(int)`),
 *     TRIGGERTIME, DRAWCOUNT (`(int)`), LANDPOS, and per component BLACKHOLEPOS, LIGHTPOS, ADDROTATEREL and SPHERICAL_EMITROTATION
 *     (the last one also times 0.017453292f, i.e. degrees to radians). The model keeps the ranges, so loading stays deterministic;
 *     a runtime that wants the exe's behaviour draws from them when it instantiates a sequence.
 *   - FINAL events get the time range `[0, LIFETIME.max]` using the LIFETIME written BEFORE the event (0 when there is none).
 */

import {
  DEG2RAD, D3DCULL_NAMES, MSG_EQUALS_PROP, MSG_EQUALS_SEQ, TokenStream, catof, cInt, classifyCommonKeyword,
  classifyFirstByte, expectEquals, f32, processBillboardType, processBlendMode, processColor, processNumber, processVector2,
  processVector3, removeQuotes, toUpperAscii, tokenize,
} from "./effectscript.ts";
import type { Color4, MinMax, Range, ScriptStats, TokenType, Vec2, Vec3 } from "./effectscript.ts";

/** `CKTDGParticleSystem::PARTICLE_TYPE` */
export const PARTICLE_TYPES = { PT_3D_PLANE: 0, PT_2D_PLANE: 1, PT_MESH: 2, PT_SKINMESH: 3 } as const;
/** The `RT_*` names a particle sequence accepts for `MESHRENDERTYPE` (the enum has more, XMeshPlayer scripts accept all of them). */
export const PARTICLE_MESH_RENDER_TYPES = { RT_REAL_COLOR: 0, RT_CARTOON_BLACK_EDGE: 1, RT_CARTOON_COLOR_EDGE: 2, RT_CARTOON: 3 } as const;
/** `CKTDGParticleSystem::EVENT_TYPE` (`ET_*`), by event kind. */
export const PARTICLE_EVENT_TYPES = {
  color: 1, size: 2, scale: 3, velocity: 4, position: 5, tex0uv: 6, tex1uv: 7, tex2uv: 8, rotate: 9, dirspeed: 10, blackholetime: 11,
  crash: 12, resetcrash: 13, texture: 14, eventtimer: 15, stretch: 16,
} as const;

export type ParticleEventKind = keyof typeof PARTICLE_EVENT_TYPES;

interface ParticleEventHead {
  /** `fade so ...`: the value is blended towards over the time range instead of being set at once */
  fade: boolean;
  /** `m_ActualTime`: `at T` is [T, T], `from A to B` is [A.min, B.max], `initial` [0, 0], `final` [0, LIFETIME.max] */
  time: Range;
}

export type ParticleEvent = ParticleEventHead & (
  | { kind: "color"; value: MinMax<Color4> }
  | { kind: "size" | "velocity" | "position" | "rotate" | "crash"; value: MinMax<Vec3> }
  | { kind: "tex0uv" | "tex1uv" | "tex2uv"; value: MinMax<Vec2> }
  | { kind: "scale" | "dirspeed" | "blackholetime" | "resetcrash" | "eventtimer" | "stretch"; value: Range }
  | { kind: "texture"; value: string }
);

/** The parse-time state of a `CParticleEventSequence` (the fields the script can set; everything else belongs to the runtime). */
export interface ParticleSequence {
  name: string;
  particleType: number;
  meshRenderType: number;
  billboardType: number;
  srcBlendMode: number;
  destBlendMode: number;
  cullMode: number;
  layer: number;
  forceLayer: boolean;
  useLand: boolean;
  trace: boolean;
  zEnable: boolean;
  zWriteEnable: boolean;
  resolutionConvert: boolean;
  applyUnitScale: boolean;
  alphaTest: boolean;
  lifetime: Range;
  emitRate: Range;
  emitRadius: MinMax<Vec3>;
  emitRadiusMin: MinMax<Vec3>;
  gravity: MinMax<Vec3>;
  /** radians */
  sphericalEmitRadius: Range;
  sphericalEmitAzimuth: Range;
  sphericalEmitPolar: Range;
  /** degrees (the exe draws a vector from the range and converts it to radians at load) */
  sphericalEmitRotation: MinMax<Vec3>;
  maxParticleNum: number;
  /** drawn with `RandomNumber` at load (see the file comment); default -1 */
  triggerCount: Range;
  /** drawn at load; default -1 */
  triggerTime: Range;
  /** drawn at load; default 1 */
  drawCount: Range;
  /** drawn at load; default 0 */
  landPosition: Range;
  screwValue: number;
  screwRotateSpeed: number;
  /** each component drawn at load */
  blackHolePosition: MinMax<Vec3>;
  lightPos: MinMax<Vec3>;
  addRotateRel: MinMax<Vec3>;
  meshName: string;
  changeTexXETName: string;
  multiTexXETName: string;
  aniXETName: string;
  aniName: string;
  traceParticleList: string[];
  finalParticleList: string[];
  events: ParticleEvent[];
}

export interface ParticleScript {
  name: string;
  version: number;
  /** in file order; a later sequence with the same name replaces an earlier one in the exe's map (see `ParticleLibrary`) */
  sequences: ParticleSequence[];
  stats: ScriptStats;
}

const zero: Range = { min: 0, max: 0 };
const zero3: MinMax<Vec3> = { min: [0, 0, 0], max: [0, 0, 0] };

/** `CKTDGParticleSystem::CParticleEventSequence::CParticleEventSequence` and `CKTDGObject::CKTDGObject` defaults. */
export function newParticleSequence(name: string): ParticleSequence {
  return {
    name,
    particleType: PARTICLE_TYPES.PT_3D_PLANE,
    meshRenderType: PARTICLE_MESH_RENDER_TYPES.RT_REAL_COLOR,
    billboardType: 1, // BT_ALL
    srcBlendMode: 5, // D3DBLEND_SRCALPHA
    destBlendMode: 7, // D3DBLEND_DESTALPHA (the constructor really stores 7, not INVSRCALPHA)
    cullMode: 1, // D3DCULL_NONE
    layer: 0,
    forceLayer: false,
    useLand: false,
    trace: false,
    zEnable: true,
    zWriteEnable: true,
    resolutionConvert: false,
    applyUnitScale: true,
    alphaTest: false,
    lifetime: { ...zero },
    emitRate: { ...zero },
    emitRadius: structuredClone(zero3),
    emitRadiusMin: structuredClone(zero3),
    gravity: structuredClone(zero3),
    sphericalEmitRadius: { ...zero },
    sphericalEmitAzimuth: { ...zero },
    sphericalEmitPolar: { ...zero },
    sphericalEmitRotation: structuredClone(zero3),
    maxParticleNum: 0,
    triggerCount: { min: -1, max: -1 },
    triggerTime: { min: -1, max: -1 },
    drawCount: { min: 1, max: 1 },
    landPosition: { ...zero },
    screwValue: -1,
    screwRotateSpeed: 10,
    blackHolePosition: structuredClone(zero3),
    lightPos: structuredClone(zero3),
    addRotateRel: structuredClone(zero3),
    meshName: "",
    changeTexXETName: "",
    multiTexXETName: "",
    aniXETName: "",
    aniName: "",
    traceParticleList: [],
    finalParticleList: [],
    events: [],
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// DetermineTokenType (328F7F70)

const SEQ_BOOL = new Set(["USELAND", "TRACE", "ZWRITEENABLE", "ZENABLE", "RESOLUTIONCONVERT", "APPLYUNITSCALE", "ALPHATEST", "FORCELAYER"]);
const SEQ_STRING = new Set(["MESH", "SKINMESH", "CHANGETEXXET", "MULTITEXXET", "ANIXET", "TRACEPARTICLELIST", "FINALPARTICLELIST", "ANINAME"]);
const SEQ_NUMERIC = new Set([
  "LIFETIME", "EMITRATE", "SPHERICAL_EMITRADIUS", "SPHERICAL_EMITAZIMUTH", "SPHERICAL_EMITPOLAR", "NUMPARTICLES", "TRIGGERCOUNT",
  "TRIGGERTIME", "DRAWCOUNT", "LANDPOS", "LAYER", "SCREWVALUE", "SCREWROTATESPEED",
]);
const SEQ_VECTOR = new Set(["GRAVITY", "EMITRADIUS", "EMITRADIUSMIN", "SPHERICAL_EMITROTATION", "BLACKHOLEPOS", "LIGHTPOS", "ADDROTATEREL"]);
const EV_NUMERIC = new Set(["DIRSPEED", "BLACKHOLETIME", "EVENTTIMER", "RESETCRASH", "STRETCH", "SCALE"]);
const EV_VECTOR2 = new Set(["TEX0UV", "TEX1UV", "TEX2UV"]);
const EV_VECTOR = new Set(["VELOCITY", "POSITION", "ROTATE", "SIZE", "CRASH"]);

/** Every property name the sequence block accepts (lower case), by token class; for the verification tools. */
export const PARTICLE_PROPERTY_NAMES: readonly string[] = [
  ...[...SEQ_BOOL, ...SEQ_STRING, ...SEQ_NUMERIC, ...SEQ_VECTOR].map((n) => n.toLowerCase()),
  "sourceblendmode", "destblendmode", "cullmode", "particletype", "meshrendertype", "billboardtype",
];

/** `CParticleEmitterTokenizer::DetermineTokenType`. Words come back upper-cased. */
export function classifyParticleToken(text: string): { type: TokenType; text: string } {
  const first = classifyFirstByte(text);
  if (first) return { type: first, text };
  const u = toUpperAscii(text);
  let type: TokenType = "Unknown";
  if (u === "PARTICLESYSTEM") type = "KeywordParticleSystem";
  else if (u === "EVENTSEQUENCE") type = "KeywordEventSequence";
  else {
    const k = classifyCommonKeyword(u);
    if (k) type = k;
    else if (u.startsWith("D3DBLEND_")) type = "AlphaBlendMode";
    else if (u === "SOURCEBLENDMODE" || u === "DESTBLENDMODE") type = "SeqAlphaBlendModeProp";
    else if (u.startsWith("D3DCULL_")) type = "CullMode";
    else if (u === "CULLMODE") type = "SeqCullModeProp";
    else if (u === "PARTICLETYPE") type = "SeqParticleTypeProp";
    else if (u === "MESHRENDERTYPE") type = "SeqMeshRenderTypeProp";
    else if (u === "BILLBOARDTYPE") type = "SeqBillboardTypeProp";
    else if (SEQ_BOOL.has(u)) type = "SeqBoolProp";
    else if (SEQ_STRING.has(u)) type = "SeqStringProp";
    else if (SEQ_NUMERIC.has(u)) type = "SeqNumericProp";
    else if (SEQ_VECTOR.has(u)) type = "SeqVectorProp";
    else if (EV_NUMERIC.has(u)) type = "ParticleNumericProp";
    else if (EV_VECTOR2.has(u)) type = "ParticleVector2Prop";
    else if (EV_VECTOR.has(u)) type = "ParticleVectorProp";
    else if (u === "COLOR") type = "ParticleColorProp";
    else if (u === "TEXTURE") type = "ParticleStringProp";
  }
  return { type, text: u };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The parser

const MSG_AFTER_EVENTS = "Cannot specify any sequence properties after specifying events.";
const NO_FADE: ReadonlySet<string> = new Set(["blackholetime", "texture", "eventtimer"]);

/** `EventFactory` (328F87E0): the event kind of a property name, by its token class. */
const EVENT_KINDS: Readonly<Record<string, ParticleEventKind>> = {
  SIZE: "size", COLOR: "color", SCALE: "scale", VELOCITY: "velocity", POSITION: "position", ROTATE: "rotate", DIRSPEED: "dirspeed",
  BLACKHOLETIME: "blackholetime", RESETCRASH: "resetcrash", CRASH: "crash", TEXTURE: "texture", TEX0UV: "tex0uv", TEX1UV: "tex1uv",
  TEX2UV: "tex2uv", EVENTTIMER: "eventtimer", STRETCH: "stretch",
};

/** `CParticleEvent_*::ProcessTokenStream`: `it` is on the property name; the value follows `=`. */
function parseEventValue(s: TokenStream, kind: ParticleEventKind): ParticleEvent["value"] {
  switch (kind) {
    case "color":
      expectEquals(s, MSG_EQUALS_PROP);
      return processColor(s);
    case "size": case "velocity": case "position": case "rotate": case "crash":
      expectEquals(s, MSG_EQUALS_PROP);
      return processVector3(s);
    case "tex0uv": case "tex1uv": case "tex2uv":
      expectEquals(s, MSG_EQUALS_PROP);
      return processVector2(s);
    case "texture": {
      expectEquals(s, MSG_EQUALS_SEQ);
      if (s.cur().type !== "Quote") throw s.error("Expected filename after texture sequence property.");
      const name = removeQuotes(s.cur().value);
      s.step();
      return name;
    }
    default: // scale dirspeed blackholetime resetcrash eventtimer stretch
      expectEquals(s, MSG_EQUALS_PROP);
      return processNumber(s);
  }
}

/** `ProcessEventSequenceBlock`: `it` is on `eventsequence`, afterwards after the closing brace. */
function parseEventSequence(s: TokenStream, stats: ScriptStats): ParticleSequence {
  s.step();
  if (s.cur().type !== "Quote") throw s.error("Must name particle sequence block!");
  const seq = newParticleSequence(removeQuotes(s.cur().value));
  s.step();
  if (s.cur().type !== "OpenBrace") throw s.error("Expected opening brace for particle sequence block!");
  s.step();
  stats.blocks++;
  let eventsStarted = false;
  for (;;) {
    const t = s.cur();
    if (t.type === "CloseBrace") break;
    const prop = t.value; // `savedtoken`
    switch (t.type) {
      case "SeqAlphaBlendModeProp": {
        if (eventsStarted) throw s.error(MSG_AFTER_EVENTS);
        expectEquals(s, MSG_EQUALS_SEQ);
        const v = processBlendMode(s);
        if (prop === "SOURCEBLENDMODE") seq.srcBlendMode = v;
        else if (prop === "DESTBLENDMODE") seq.destBlendMode = v;
        else throw s.error("Unknown sequence alpha blending mode property!");
        break;
      }
      case "SeqParticleTypeProp": {
        if (eventsStarted) throw s.error(MSG_AFTER_EVENTS);
        expectEquals(s, MSG_EQUALS_SEQ);
        const text = s.cur().value;
        if (!Object.hasOwn(PARTICLE_TYPES, text)) throw s.error("Invalid particle type!");
        const v = PARTICLE_TYPES[text as keyof typeof PARTICLE_TYPES];
        s.step();
        if (prop !== "PARTICLETYPE") throw s.error("Unknown sequence particle type property!");
        seq.particleType = v;
        break;
      }
      case "SeqMeshRenderTypeProp": {
        if (eventsStarted) throw s.error(MSG_AFTER_EVENTS);
        expectEquals(s, MSG_EQUALS_SEQ);
        const text = s.cur().value;
        if (!Object.hasOwn(PARTICLE_MESH_RENDER_TYPES, text)) throw s.error("Invalid mesh render type!");
        const v = PARTICLE_MESH_RENDER_TYPES[text as keyof typeof PARTICLE_MESH_RENDER_TYPES];
        s.step();
        if (prop !== "MESHRENDERTYPE") throw s.error("Unknown sequence particle type property!");
        seq.meshRenderType = v;
        break;
      }
      case "SeqBillboardTypeProp": {
        if (eventsStarted) throw s.error(MSG_AFTER_EVENTS);
        expectEquals(s, MSG_EQUALS_SEQ);
        const v = processBillboardType(s);
        if (prop !== "BILLBOARDTYPE") throw s.error("Unknown sequence particle type property!");
        seq.billboardType = v;
        break;
      }
      case "SeqCullModeProp": {
        if (eventsStarted) throw s.error(MSG_AFTER_EVENTS);
        expectEquals(s, MSG_EQUALS_SEQ);
        if (s.cur().type !== "CullMode") throw s.error("Expecting cull mode (D3DCULL_NONE, D3DCULL_CCW, etc.).");
        const text = s.cur().value;
        const hit = D3DCULL_NAMES.find(([name]) => name === text);
        if (!hit) throw s.error("Invalid cull mode!");
        s.step();
        if (prop !== "CULLMODE") throw s.error("Unknown sequence cull mode property!");
        seq.cullMode = hit[1];
        break;
      }
      case "KeywordFade": case "KeywordAt": case "KeywordFrom": case "KeywordTo": case "KeywordInitial": case "KeywordFinal": {
        const lifeMax = seq.lifetime.max;
        eventsStarted = true;
        let time: Range = { min: 0, max: 0 };
        let fade = false;
        if (t.type === "KeywordFade") {
          s.step();
          if (s.cur().type !== "KeywordSo") throw s.error('Expecting "so" after "fade".');
          fade = true;
          s.step();
        }
        switch (s.cur().type) {
          case "KeywordAt":
            s.step();
            time = processNumber(s);
            break;
          case "KeywordFrom": {
            s.step();
            const from = processNumber(s);
            if (s.cur().type !== "KeywordTo") throw s.error('Expecting "To" after "From".');
            s.step();
            const to = processNumber(s);
            time = { min: from.min, max: to.max };
            break;
          }
          case "KeywordInitial":
            if (fade) throw s.error('Cannot use "fade so" modifier on "initial" times.');
            s.step();
            break;
          case "KeywordFinal":
            time = { min: 0, max: lifeMax };
            s.step();
            break;
          default:
            throw s.error('Expected time specifier: "[fade so] at", "initial", or "[fade so] final"');
        }
        const pt = s.cur().type;
        if (pt !== "ParticleNumericProp" && pt !== "ParticleVectorProp" && pt !== "ParticleVector2Prop" && pt !== "ParticleColorProp" &&
          pt !== "ParticleStringProp") {
          throw s.error(`${seq.name}, Expecting particle property after time specifier!`);
        }
        const kind = EVENT_KINDS[s.cur().value];
        if (kind === undefined) throw s.error("Unknown event type, or there was an error creating this event.");
        if (fade && NO_FADE.has(kind)) throw s.error("Fading is not supported on this event.");
        const value = parseEventValue(s, kind);
        seq.events.push({ kind, fade, time, value } as ParticleEvent);
        stats.events++;
        break;
      }
      case "SeqNumericProp": {
        if (eventsStarted) throw s.error(MSG_AFTER_EVENTS);
        expectEquals(s, MSG_EQUALS_SEQ);
        const n = processNumber(s);
        switch (prop) {
          case "EMITRATE": seq.emitRate = n; break;
          case "LIFETIME": seq.lifetime = n; break;
          case "NUMPARTICLES": seq.maxParticleNum = cInt(n.max); break;
          case "TRIGGERCOUNT": seq.triggerCount = n; break;
          case "TRIGGERTIME": seq.triggerTime = n; break;
          case "DRAWCOUNT": seq.drawCount = n; break;
          case "LANDPOS": seq.landPosition = n; break;
          case "LAYER": seq.layer = cInt(n.max); break;
          case "SCREWVALUE": seq.screwValue = cInt(n.max); break;
          case "SCREWROTATESPEED": seq.screwRotateSpeed = cInt(n.max); break;
          case "SPHERICAL_EMITRADIUS": seq.sphericalEmitRadius = n; break;
          case "SPHERICAL_EMITAZIMUTH": seq.sphericalEmitAzimuth = { min: f32(n.min * DEG2RAD), max: f32(n.max * DEG2RAD) }; break;
          case "SPHERICAL_EMITPOLAR": seq.sphericalEmitPolar = { min: f32(n.min * DEG2RAD), max: f32(n.max * DEG2RAD) }; break;
          default: throw s.error("Unknown sequence numeric property!");
        }
        break;
      }
      case "SeqVectorProp": {
        if (eventsStarted) throw s.error(MSG_AFTER_EVENTS);
        expectEquals(s, MSG_EQUALS_SEQ);
        const v = processVector3(s);
        switch (prop) {
          case "EMITRADIUS": seq.emitRadius = v; break;
          case "EMITRADIUSMIN": seq.emitRadiusMin = v; break;
          case "GRAVITY": seq.gravity = v; break;
          case "BLACKHOLEPOS": seq.blackHolePosition = v; break;
          case "LIGHTPOS": seq.lightPos = v; break;
          case "ADDROTATEREL": seq.addRotateRel = v; break;
          case "SPHERICAL_EMITROTATION": seq.sphericalEmitRotation = v; break;
          default: throw s.error("Unknown sequence vector property!");
        }
        break;
      }
      case "SeqBoolProp": {
        if (eventsStarted) throw s.error(MSG_AFTER_EVENTS);
        expectEquals(s, MSG_EQUALS_SEQ);
        let b: boolean;
        if (s.cur().value === "TRUE") b = true;
        else if (s.cur().value === "FALSE") b = false;
        else throw s.error("Invalid bool!");
        s.step();
        switch (prop) {
          case "USELAND": seq.useLand = b; break;
          case "TRACE": seq.trace = b; break;
          case "ZENABLE": seq.zEnable = b; break;
          case "ZWRITEENABLE": seq.zWriteEnable = b; break;
          case "RESOLUTIONCONVERT": seq.resolutionConvert = b; break;
          case "FORCELAYER": seq.forceLayer = b; break;
          case "APPLYUNITSCALE": seq.applyUnitScale = b; break;
          case "ALPHATEST": seq.alphaTest = b; break;
          default: throw s.error("Unknown sequence particle type property!");
        }
        break;
      }
      case "SeqStringProp": {
        if (eventsStarted) throw s.error(MSG_AFTER_EVENTS);
        expectEquals(s, MSG_EQUALS_SEQ);
        const str = removeQuotes(s.cur().value); // any token is accepted, quotes are stripped wherever they are
        s.step();
        switch (prop) {
          case "MESH": case "SKINMESH": seq.meshName = str; break;
          case "CHANGETEXXET": seq.changeTexXETName = str; break;
          case "MULTITEXXET": seq.multiTexXETName = str; break;
          case "ANIXET": seq.aniXETName = str; break;
          case "ANINAME": seq.aniName = str; break;
          case "TRACEPARTICLELIST": seq.traceParticleList.push(str); break;
          case "FINALPARTICLELIST": seq.finalParticleList.push(str); break;
          default: throw s.error("Unknown sequence particle type property!");
        }
        break;
      }
      default:
        throw s.error(`${seq.name}, Unexpected "${t.value}" in Sequence Block!`);
    }
    if (t.type !== "KeywordFade" && t.type !== "KeywordAt" && t.type !== "KeywordFrom" && t.type !== "KeywordTo" &&
      t.type !== "KeywordInitial" && t.type !== "KeywordFinal") stats.properties++;
  }
  s.step(); // past the closing brace
  return seq;
}

/** `ProcessParticleSystemBlock`: `it` is on the opening brace. */
function parseParticleSystemBlock(s: TokenStream, out: ParticleSequence[], stats: ScriptStats): void {
  s.step();
  if (s.cur().type !== "CloseBrace") {
    do {
      if (s.cur().type !== "KeywordEventSequence") throw s.error(`Unexpected "${s.cur().value}" in Particle System Block!`);
      out.push(parseEventSequence(s, stats));
    } while (s.cur().type !== "CloseBrace");
  }
  s.step();
}

/**
 * `CKTDGParticleSystem::Compile`: parse the bytes of one particle script file. Throws `EffectScriptError` (message = the exe's
 * exception text) where the exe throws.
 */
export function parseParticleScript(bytes: Uint8Array): ParticleScript {
  const tokens = tokenize(bytes, classifyParticleToken);
  const s = new TokenStream(tokens, "particle");
  if (tokens.length < 2) throw s.error("This script is too small to be valid.");
  if (tokens[0]!.type !== "KeywordParticleSystem") throw s.error("First word must be ParticleSystem");
  s.i = 1;
  if (tokens[1]!.type !== "Quote") throw s.error("Must name particle system");
  const name = removeQuotes(tokens[1]!.value);
  s.step();
  if (s.cur().type !== "RealNumber") throw s.error("Must have version number");
  const version = catof(s.cur().value);
  s.step();
  if (s.cur().type !== "OpenBrace") throw s.error("Missing opening brace for ParticleSystem block");
  const sequences: ParticleSequence[] = [];
  const stats: ScriptStats = { tokens: tokens.length, tokensRead: 0, blocks: 0, properties: 0, events: 0 };
  parseParticleSystemBlock(s, sequences, stats);
  stats.tokensRead = s.i;
  return { name, version, sequences, stats };
}

/** The templet map of a `CKTDGParticleSystem`: scripts are added in load order, a later sequence replaces an earlier one of the same name. */
export class ParticleLibrary {
  readonly sequences = new Map<string, ParticleSequence>();
  /** names that were defined more than once (within a file or across files), in the order the replacements happened */
  readonly replaced: string[] = [];

  add(script: ParticleScript): void {
    for (const seq of script.sequences) {
      if (this.sequences.has(seq.name)) this.replaced.push(seq.name);
      this.sequences.set(seq.name, seq);
    }
  }

  get(name: string): ParticleSequence | undefined {
    return this.sequences.get(name);
  }
}

