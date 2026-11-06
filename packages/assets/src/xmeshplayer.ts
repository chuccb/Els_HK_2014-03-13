/**
 * XMeshPlayer scripts (`GameMajorXMeshPlayer*.txt`, `UIMajorXMeshPlayer*.txt`, ...): the text DSL that `CKTDGXMeshPlayer::Compile`
 * reads. A templet describes an animated `.X` mesh effect (mesh, render state, play/life rule, events on three timelines). Port of
 *   Compile              32917A60  x2.exe.c L357620      DetermineTokenType 329189F0  L358390
 *   ProcessXMeshPlayerBlock 32921C10 L365743             ProcessTempletBlock 3291ECD0 L363061
 *   EventFactory(name, bFinal) 32919330 L358702          CXMeshEvent_*::ProcessTokenStream 32921330..32921A50 L365217
 *   ProcessBool 3291E360, ProcessRenderType 3291E9D0, ProcessString 3291EBF0, ProcessPropEqualsValue 3291E710..3291E970
 *   XMeshTemplet::XMeshTemplet 329165A0 L356409 (the defaults)
 * Tokenizer, `ProcessNumber`/`ProcessColor`/`ProcessVector3` are the same code as the particle script's (`effectscript.ts`).
 *
 * Grammar (case-insensitive; `//` and `--` start comments; only the first `XMeshPlayer` block of a file is read):
 *
 *     XMESHPLAYER "NAME" 1.00 {
 *       TEMPLET "NAME" {
 *         <property> = <value>                                   // templet properties, all before the first event
 *         ...
 *         global|die|anim  initial|at T|from A to B|final  <event>   // `fade so` in front of at/from/final blends towards the value
 *       }
 *     }
 *
 * Templet properties by token class:
 *   numeric  PLAYCOUNT LIFETIME DIEPLAYCOUNT DIELIFETIME OUTLINEWIDE LIGHTFLOWWIDE DRAWCOUNT LANDPOS LAYER ELASTICCOEFF ELASTICCOEFF_X
 *            SLASH_TRACE_TYPE SLASH_TRACE_CURVE_TYPE NOT_CHECK_LAND_TIME    (ranges kept as written; PLAYCOUNT, DIEPLAYCOUNT and
 *            DRAWCOUNT hold `(int)` of both ends, LAYER, SLASH_TRACE_TYPE and SLASH_TRACE_CURVE_TYPE `(int)max`)
 *   vector   LIGHTPOS GRAVITY BLACKHOLEPOS   (`XYZ(...)`)
 *   bool     USEDIEEVENT ZENABLE ZWRITEENABLE USELAND SET_LAND_HEIGHT_ON_START CRASHLAND USESLASHTRACE FORCELAYER APPLYUNITSCALE ALPHATEST
 *   string   MESHNAME CHANGETEXXET MULTITEXXET ANIPACKAGE SLASH_TRACE_TEXTURE
 *   enum     LIFETYPE DIETYPE (LT_PLAY_COUNT | LT_TIME | LT_MANUAL), MESHTYPE (X_MESH | X_SKIN_MESH), BILLBOARDTYPE (BT_*), RENDERTYPE
 *            (RT_*, 16 of the 19 names), CARTOONTEXTYPE (CTT_NORMAL | CTT_RED only), CULLMODE (D3DCULL_NONE | CW | CCW),
 *            SOURCEBLENDMODE DESTBLENDMODE (D3DBLEND_*)
 * Events: ANINAME (`= "ani", XAP_LOOP | XAP_ONE | XAP_ONE_WAIT`), ANISPEED, DIRSPEED, BLACKHOLETIME, RESETCRASH, LIGHTFLOWIMPACT,
 * COLOR, OUTLINECOLOR (`RGBA(...)`), SIZE, VELOCITY, ROTATE, CRASH, POSITION, LIGHTFLOWPOINT (`XYZ(...)`), TEX0UV TEX1UV TEX2UV
 * (`XY(...)`), SLASHTRACE (`TRUE | FALSE`), RENDER_TYPE, SOUND. `TEXTURECHANGE` is classified as an event property but the factory
 * has no class for it, so using it is an error. Fading is refused for ANINAME, ANISPEED, SLASHTRACE, BLACKHOLETIME, RESETCRASH, SOUND
 * and RENDER_TYPE. `final` does not give a time range here (unlike particles): the event keeps time [0, 0] and `final: true`.
 */

import {
  D3DCULL_NAMES, MSG_EQUALS_PROP, MSG_EQUALS_SEQ, RENDER_TYPES, TokenStream, catof, cInt, classifyCommonKeyword,
  classifyFirstByte, expectEquals, processBillboardType, processBlendMode, processColor, processNumber, processVector2, processVector3,
  removeQuotes, toUpperAscii, tokenize,
} from "./effectscript.ts";
import type { Color4, MinMax, Range, ScriptStats, TokenType, Vec2, Vec3 } from "./effectscript.ts";

/** `CKTDGXMeshPlayer::LIFE_TYPE` */
export const XMESH_LIFE_TYPES = { LT_PLAY_COUNT: 0, LT_TIME: 1, LT_MANUAL: 2 } as const;
/** `CKTDGXMeshPlayer::MESH_TYPE` */
export const XMESH_MESH_TYPES = { X_MESH: 0, X_SKIN_MESH: 1 } as const;
/** The `CKTDGXRenderer::CARTOON_TEX_TYPE` names the script accepts (the enum goes up to `CTT_SCARLET` = 9). */
export const XMESH_CARTOON_TEX_TYPES = { CTT_NORMAL: 0, CTT_RED: 1 } as const;
/** `CKTDGXSkinAnim::XSKIN_ANIM_PLAYTYPE` */
export const XSKIN_ANIM_PLAYTYPES = { XAP_LOOP: 0, XAP_ONE: 1, XAP_ONE_WAIT: 2 } as const;
/** `CKTDGXMeshPlayer::EVENT_TYPE` (`ET_*`) by event kind (15 = TEXTURECHANGE and 19 = GLOBALTIMER have no parsed event). */
export const XMESH_EVENT_TYPES = {
  anispeed: 1, aniname: 2, color: 3, outlinecolor: 4, size: 5, velocity: 6, tex0uv: 7, tex1uv: 8, tex2uv: 9, rotate: 10, dirspeed: 11,
  blackholetime: 12, crash: 13, resetcrash: 14, lightflowimpact: 16, lightflowpoint: 17, sound: 18, slashtrace: 20, render_type: 21,
  position: 22,
} as const;

export type XMeshEventKind = keyof typeof XMESH_EVENT_TYPES;

interface XMeshEventHead {
  /** `fade so ...` */
  fade: boolean;
  /** `final` (the factory's `bFinal`) */
  final: boolean;
  /** `m_ActualTime`: `at T` is [T, T], `from A to B` is [A.min, B.max], `initial` and `final` [0, 0] */
  time: Range;
}

export type XMeshEvent = XMeshEventHead & (
  | { kind: "aniname"; value: { name: string; playType: number } }
  | { kind: "anispeed" | "dirspeed" | "blackholetime" | "resetcrash" | "lightflowimpact"; value: Range }
  | { kind: "color" | "outlinecolor"; value: MinMax<Color4> }
  | { kind: "size" | "velocity" | "position" | "rotate" | "crash" | "lightflowpoint"; value: MinMax<Vec3> }
  | { kind: "tex0uv" | "tex1uv" | "tex2uv"; value: MinMax<Vec2> }
  | { kind: "sound"; value: string }
  | { kind: "render_type"; value: number }
  | { kind: "slashtrace"; value: boolean }
);

/** `CKTDGXMeshPlayer::XMeshTemplet` as the script leaves it. */
export interface XMeshTemplet {
  name: string;
  layer: number;
  forceLayer: boolean;
  lifeType: number;
  dieType: number;
  useDieEvent: boolean;
  playCount: MinMax<number>;
  lifeTime: Range;
  diePlayCount: MinMax<number>;
  dieLifeTime: Range;
  meshType: number;
  meshName: string;
  changeTexXETName: string;
  multiTexXETName: string;
  aniXETName: string;
  renderType: number;
  cartoonTexType: number;
  lightPos: MinMax<Vec3>;
  outLineWide: Range;
  lightFlowWide: Range;
  zEnable: boolean;
  zWriteEnable: boolean;
  cullMode: number;
  srcBlend: number;
  destBlend: number;
  drawCount: MinMax<number>;
  billboardType: number;
  gravity: MinMax<Vec3>;
  blackHolePosition: MinMax<Vec3>;
  landPosition: Range;
  setLandHeightOnStart: boolean;
  useLand: boolean;
  crashLand: boolean;
  elasticCoeff: Range;
  elasticCoeffX: Range;
  /** the three timelines (`global`, `anim`, `die`), each in file order */
  globalEvents: XMeshEvent[];
  animEvents: XMeshEvent[];
  dieEvents: XMeshEvent[];
  useSlashTrace: boolean;
  slashTraceType: number;
  slashTraceTextureName: string;
  slashTraceCurveType: number;
  notCheckLandTime: number;
  applyUnitScale: boolean;
  alphaTestEnable: boolean;
}

export interface XMeshPlayerScript {
  name: string;
  version: number;
  /** in file order; a later templet with the same name replaces an earlier one in the exe's map (see `XMeshLibrary`) */
  templets: XMeshTemplet[];
  stats: ScriptStats;
}

const zero3 = (): MinMax<Vec3> => ({ min: [0, 0, 0], max: [0, 0, 0] });

/** `XMeshTemplet::XMeshTemplet` defaults. */
export function newXMeshTemplet(name: string): XMeshTemplet {
  return {
    name,
    layer: 0,
    forceLayer: false,
    lifeType: XMESH_LIFE_TYPES.LT_PLAY_COUNT,
    dieType: XMESH_LIFE_TYPES.LT_PLAY_COUNT,
    useDieEvent: false,
    playCount: { min: 0, max: 0 },
    lifeTime: { min: 0, max: 0 },
    diePlayCount: { min: 0, max: 0 },
    dieLifeTime: { min: 0, max: 0 },
    meshType: XMESH_MESH_TYPES.X_SKIN_MESH,
    meshName: "",
    changeTexXETName: "",
    multiTexXETName: "",
    aniXETName: "",
    renderType: RENDER_TYPES.RT_REAL_COLOR,
    cartoonTexType: XMESH_CARTOON_TEX_TYPES.CTT_NORMAL,
    lightPos: zero3(),
    outLineWide: { min: 0, max: 0 },
    lightFlowWide: { min: 0, max: 0 },
    zEnable: false,
    zWriteEnable: false,
    cullMode: 1, // D3DCULL_NONE
    srcBlend: 5, // D3DBLEND_SRCALPHA
    destBlend: 6, // D3DBLEND_INVSRCALPHA
    drawCount: { min: 1, max: 1 },
    billboardType: 0, // BT_NONE
    gravity: zero3(),
    blackHolePosition: zero3(),
    landPosition: { min: 0, max: 0 },
    setLandHeightOnStart: false,
    useLand: false,
    crashLand: false,
    elasticCoeff: { min: 0.5, max: 0.5 },
    elasticCoeffX: { min: 0, max: 0 },
    globalEvents: [],
    animEvents: [],
    dieEvents: [],
    useSlashTrace: false,
    slashTraceType: 0,
    slashTraceTextureName: "",
    slashTraceCurveType: 0, // CT_SMOOTH_CURVE
    notCheckLandTime: 0,
    applyUnitScale: true,
    alphaTestEnable: false,
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// DetermineTokenType (329189F0)

const SEQ_BOOL = new Set([
  "USEDIEEVENT", "ZENABLE", "ZWRITEENABLE", "USELAND", "SET_LAND_HEIGHT_ON_START", "CRASHLAND", "USESLASHTRACE", "FORCELAYER",
  "APPLYUNITSCALE", "ALPHATEST",
]);
const SEQ_NUMERIC = new Set([
  "PLAYCOUNT", "LIFETIME", "DIEPLAYCOUNT", "DIELIFETIME", "OUTLINEWIDE", "LIGHTFLOWWIDE", "DRAWCOUNT", "LANDPOS", "LAYER", "ELASTICCOEFF",
  "ELASTICCOEFF_X", "SLASH_TRACE_TYPE", "SLASH_TRACE_CURVE_TYPE", "NOT_CHECK_LAND_TIME",
]);
const SEQ_STRING = new Set(["MESHNAME", "CHANGETEXXET", "MULTITEXXET", "ANIPACKAGE", "SLASH_TRACE_TEXTURE"]);
const SEQ_VECTOR3 = new Set(["LIGHTPOS", "GRAVITY", "BLACKHOLEPOS"]);
const EV_NUMERIC = new Set(["ANISPEED", "DIRSPEED", "BLACKHOLETIME", "RESETCRASH", "LIGHTFLOWIMPACT"]);
const EV_VECTOR3 = new Set(["SIZE", "VELOCITY", "ROTATE", "CRASH", "POSITION", "LIGHTFLOWPOINT"]);
const EV_VECTOR2 = new Set(["TEX0UV", "TEX1UV", "TEX2UV"]);

/** Every property name the templet block accepts (lower case), by token class; for the verification tools. */
export const XMESH_PROPERTY_NAMES: readonly string[] = [
  ...[...SEQ_BOOL, ...SEQ_NUMERIC, ...SEQ_STRING, ...SEQ_VECTOR3].map((n) => n.toLowerCase()),
  "sourceblendmode", "destblendmode", "lifetype", "dietype", "meshtype", "rendertype", "cartoontextype", "cullmode", "billboardtype",
];

/** `CXMeshPlayerTokenizer::DetermineTokenType`. Words come back upper-cased. */
export function classifyXMeshToken(text: string): { type: TokenType; text: string } {
  const first = classifyFirstByte(text);
  if (first) return { type: first, text };
  const u = toUpperAscii(text);
  let type: TokenType = "Unknown";
  if (u === "XMESHPLAYER") type = "KeywordXMeshPlayer";
  else if (u === "TEMPLET") type = "KeywordTemplet";
  else {
    const k = classifyCommonKeyword(u);
    if (k) type = k;
    else if (u === "GLOBAL") type = "KeywordGlobal";
    else if (u === "DIE") type = "KeywordDie";
    else if (u === "ANIM") type = "KeywordAnim";
    else if (u.startsWith("D3DBLEND_")) type = "AlphaBlendMode";
    else if (u === "SOURCEBLENDMODE" || u === "DESTBLENDMODE") type = "SeqAlphaBlendModeProp";
    else if (u === "LIFETYPE" || u === "DIETYPE") type = "SeqLifeTypeProp";
    else if (SEQ_BOOL.has(u)) type = "SeqBoolProp";
    else if (SEQ_NUMERIC.has(u)) type = "SeqNumericProp";
    else if (u === "MESHTYPE") type = "SeqMeshTypeProp";
    else if (SEQ_STRING.has(u)) type = "SeqStringProp";
    else if (u === "RENDERTYPE") type = "SeqRenderTypeProp";
    else if (u === "CARTOONTEXTYPE") type = "SeqCartoonTexTypeProp";
    else if (SEQ_VECTOR3.has(u)) type = "SeqVector3Prop";
    else if (u === "CULLMODE") type = "SeqCullModeProp";
    else if (u === "BILLBOARDTYPE") type = "SeqBillboardTypeProp";
    else if (u === "COLOR" || u === "OUTLINECOLOR") type = "MeshColorProp";
    else if (u === "ANINAME" || u === "TEXTURECHANGE" || u === "SOUND") type = "MeshStringProp";
    else if (EV_NUMERIC.has(u)) type = "MeshNumericProp";
    else if (EV_VECTOR3.has(u)) type = "MeshVector3Prop";
    else if (EV_VECTOR2.has(u)) type = "MeshVector2Prop";
    else if (u === "SLASHTRACE") type = "MeshBoolProp";
    else if (u === "RENDER_TYPE") type = "MeshRenderTypeProp";
  }
  return { type, text: u };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The parser

const MSG_AFTER_EVENTS = "Cannot specify any sequence properties after specifying events.";

/** `EventFactory`: event property name to kind (`TEXTURECHANGE` has no class). */
const EVENT_KINDS: Readonly<Record<string, XMeshEventKind>> = {
  ANINAME: "aniname", ANISPEED: "anispeed", SLASHTRACE: "slashtrace", COLOR: "color", OUTLINECOLOR: "outlinecolor", SIZE: "size",
  POSITION: "position", VELOCITY: "velocity", TEX0UV: "tex0uv", TEX1UV: "tex1uv", TEX2UV: "tex2uv", ROTATE: "rotate",
  DIRSPEED: "dirspeed", BLACKHOLETIME: "blackholetime", CRASH: "crash", RESETCRASH: "resetcrash", LIGHTFLOWIMPACT: "lightflowimpact",
  LIGHTFLOWPOINT: "lightflowpoint", SOUND: "sound", RENDER_TYPE: "render_type",
};

/** `FadeAllowed` of the event classes (`return false` for these, `return 1` for the others). */
const NO_FADE: ReadonlySet<XMeshEventKind> = new Set(["aniname", "slashtrace", "anispeed", "blackholetime", "resetcrash", "sound", "render_type"]);

/** `ProcessRenderType`: the `RT_*` names a script accepts (no `RT_ADD_CARTOON*`); `it` is on the value, afterwards after it. */
function processRenderType(s: TokenStream): number {
  const text = s.cur().value;
  if (!Object.hasOwn(RENDER_TYPES, text) || text.startsWith("RT_ADD_CARTOON")) throw s.error("Invalid RenderType!");
  s.step();
  return RENDER_TYPES[text as keyof typeof RENDER_TYPES];
}

function processBool(s: TokenStream): boolean {
  let b: boolean;
  if (s.cur().value === "TRUE") b = true;
  else if (s.cur().value === "FALSE") b = false;
  else throw s.error("Invalid bool!");
  s.step();
  return b;
}

/** `ProcessString`: any token, every `"` removed. */
function processString(s: TokenStream): string {
  const str = removeQuotes(s.cur().value);
  s.step();
  return str;
}

/** `CXMeshEvent_*::ProcessTokenStream`: `it` is on the property name. */
function parseEventValue(s: TokenStream, kind: XMeshEventKind): XMeshEvent["value"] {
  switch (kind) {
    case "aniname": {
      expectEquals(s, MSG_EQUALS_SEQ);
      const name = processString(s);
      if (s.cur().type !== "Comma") throw s.error("Expected comma sign!");
      s.step();
      const t = s.cur().value;
      if (!Object.hasOwn(XSKIN_ANIM_PLAYTYPES, t)) throw s.error("Invalid AniName!");
      const playType = XSKIN_ANIM_PLAYTYPES[t as keyof typeof XSKIN_ANIM_PLAYTYPES];
      s.step();
      return { name, playType };
    }
    case "slashtrace":
      expectEquals(s, MSG_EQUALS_SEQ);
      return processBool(s);
    case "render_type":
      expectEquals(s, MSG_EQUALS_SEQ);
      return processRenderType(s);
    case "sound":
      expectEquals(s, MSG_EQUALS_SEQ);
      return processString(s);
    case "color": case "outlinecolor":
      expectEquals(s, MSG_EQUALS_PROP);
      return processColor(s);
    case "size": case "velocity": case "position": case "rotate": case "crash": case "lightflowpoint":
      expectEquals(s, MSG_EQUALS_PROP);
      return processVector3(s);
    case "tex0uv": case "tex1uv": case "tex2uv":
      expectEquals(s, MSG_EQUALS_PROP);
      return processVector2(s);
    default: // anispeed dirspeed blackholetime resetcrash lightflowimpact
      expectEquals(s, MSG_EQUALS_PROP);
      return processNumber(s);
  }
}

/** The shared `NAME = <enum name>` checks: look the value token up in a table without looking at its type. */
function enumValue<T extends Record<string, number>>(s: TokenStream, table: T, invalid: string): number {
  const text = s.cur().value;
  if (!Object.hasOwn(table, text)) throw s.error(invalid);
  return table[text as keyof T] as number;
}

/** `ProcessTempletBlock`: `it` is on `templet`, afterwards after the closing brace. */
function parseTemplet(s: TokenStream, stats: ScriptStats): XMeshTemplet {
  s.step();
  if (s.cur().type !== "Quote") throw s.error("Must name Templet block!");
  const t = newXMeshTemplet(removeQuotes(s.cur().value));
  s.step();
  if (s.cur().type !== "OpenBrace") throw s.error("Expected opening brace for Templet block!");
  s.step();
  stats.blocks++;
  let eventsStarted = false;
  for (;;) {
    const tok = s.cur();
    if (tok.type === "CloseBrace") break;
    const prop = tok.value; // `savedtoken`
    switch (tok.type) {
      case "SeqAlphaBlendModeProp": {
        if (eventsStarted) throw s.error(MSG_AFTER_EVENTS);
        expectEquals(s, MSG_EQUALS_SEQ);
        const v = processBlendMode(s);
        if (prop === "SOURCEBLENDMODE") t.srcBlend = v;
        else if (prop === "DESTBLENDMODE") t.destBlend = v;
        else throw s.error("Unknown sequence alpha blending mode property!");
        break;
      }
      case "SeqLifeTypeProp": {
        if (eventsStarted) throw s.error(MSG_AFTER_EVENTS);
        expectEquals(s, MSG_EQUALS_SEQ);
        const v = enumValue(s, XMESH_LIFE_TYPES, "Invalid LifeType!");
        s.step();
        if (prop === "LIFETYPE") t.lifeType = v;
        else if (prop === "DIETYPE") t.dieType = v;
        else throw s.error("Unknown sequence LifeType property!");
        break;
      }
      case "SeqMeshTypeProp": {
        if (eventsStarted) throw s.error(MSG_AFTER_EVENTS);
        expectEquals(s, MSG_EQUALS_SEQ);
        const v = enumValue(s, XMESH_MESH_TYPES, "Invalid MeshType!");
        s.step();
        if (prop !== "MESHTYPE") throw s.error("Unknown sequence meshType property!");
        t.meshType = v;
        break;
      }
      case "SeqBillboardTypeProp": {
        if (eventsStarted) throw s.error(MSG_AFTER_EVENTS);
        expectEquals(s, MSG_EQUALS_SEQ);
        const v = processBillboardType(s);
        if (prop !== "BILLBOARDTYPE") throw s.error("Unknown sequence billboardType property!");
        t.billboardType = v;
        break;
      }
      case "SeqRenderTypeProp": {
        if (eventsStarted) throw s.error(MSG_AFTER_EVENTS);
        expectEquals(s, MSG_EQUALS_SEQ);
        const v = processRenderType(s);
        if (prop !== "RENDERTYPE") throw s.error("Unknown sequence renderType property!");
        t.renderType = v;
        break;
      }
      case "SeqCartoonTexTypeProp": {
        if (eventsStarted) throw s.error(MSG_AFTER_EVENTS);
        expectEquals(s, MSG_EQUALS_SEQ);
        const v = enumValue(s, XMESH_CARTOON_TEX_TYPES, "Invalid cartoonTexType!");
        s.step();
        if (prop !== "CARTOONTEXTYPE") throw s.error("Unknown sequence cartoonTexType property!");
        t.cartoonTexType = v;
        break;
      }
      case "SeqCullModeProp": {
        if (eventsStarted) throw s.error(MSG_AFTER_EVENTS);
        expectEquals(s, MSG_EQUALS_SEQ);
        const text = s.cur().value;
        const hit = D3DCULL_NAMES.find(([name]) => name === text && name !== "D3DCULL_FORCE_DWORD");
        if (!hit) throw s.error("Invalid cullMode!");
        s.step();
        if (prop !== "CULLMODE") throw s.error("Unknown sequence cullMode property!");
        t.cullMode = hit[1];
        break;
      }
      case "KeywordGlobal": case "KeywordDie": case "KeywordAnim": {
        eventsStarted = true;
        let final = false;
        let time: Range = { min: 0, max: 0 };
        let fade = false;
        s.step();
        if (s.cur().type === "KeywordFade") {
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
            final = true;
            s.step();
            break;
          default:
            throw s.error('Expected time specifier: "[fade so] at", "initial", or "[fade so] final"');
        }
        const pt = s.cur().type;
        if (pt !== "MeshNumericProp" && pt !== "MeshVector3Prop" && pt !== "MeshVector2Prop" && pt !== "MeshColorProp" &&
          pt !== "MeshBoolProp" && pt !== "MeshStringProp" && pt !== "MeshRenderTypeProp") {
          throw s.error("Expecting meshPlayer property after time specifier!");
        }
        const kind = EVENT_KINDS[s.cur().value];
        if (kind === undefined) throw s.error("Unknown event type, or there was an error creating this event.");
        if (fade && NO_FADE.has(kind)) throw s.error("Fading is not supported on this event.");
        const value = parseEventValue(s, kind);
        const ev = { kind, fade, final, time, value } as XMeshEvent;
        (tok.type === "KeywordGlobal" ? t.globalEvents : tok.type === "KeywordDie" ? t.dieEvents : t.animEvents).push(ev);
        stats.events++;
        break;
      }
      case "SeqNumericProp": {
        if (eventsStarted) throw s.error(MSG_AFTER_EVENTS);
        expectEquals(s, MSG_EQUALS_SEQ);
        const n = processNumber(s);
        const ints = { min: cInt(n.min), max: cInt(n.max) };
        switch (prop) {
          case "PLAYCOUNT": t.playCount = ints; break;
          case "LIFETIME": t.lifeTime = n; break;
          case "DIEPLAYCOUNT": t.diePlayCount = ints; break;
          case "DIELIFETIME": t.dieLifeTime = n; break;
          case "OUTLINEWIDE": t.outLineWide = n; break;
          case "LIGHTFLOWWIDE": t.lightFlowWide = n; break;
          case "DRAWCOUNT": t.drawCount = ints; break;
          case "LANDPOS": t.landPosition = n; break;
          case "LAYER": t.layer = ints.max; break;
          case "ELASTICCOEFF": t.elasticCoeff = n; break;
          case "ELASTICCOEFF_X": t.elasticCoeffX = n; break;
          case "SLASH_TRACE_TYPE": t.slashTraceType = ints.max; break;
          case "SLASH_TRACE_CURVE_TYPE": t.slashTraceCurveType = ints.max; break;
          case "NOT_CHECK_LAND_TIME": t.notCheckLandTime = n.max; break;
          default: throw s.error("Unknown sequence numeric property!");
        }
        break;
      }
      case "SeqVector3Prop": {
        if (eventsStarted) throw s.error(MSG_AFTER_EVENTS);
        expectEquals(s, MSG_EQUALS_SEQ);
        const v = processVector3(s);
        switch (prop) {
          case "LIGHTPOS": t.lightPos = v; break;
          case "GRAVITY": t.gravity = v; break;
          case "BLACKHOLEPOS": t.blackHolePosition = v; break;
          default: throw s.error("Unknown sequence vector property!");
        }
        break;
      }
      case "SeqBoolProp": {
        if (eventsStarted) throw s.error(MSG_AFTER_EVENTS);
        expectEquals(s, MSG_EQUALS_SEQ);
        const b = processBool(s);
        switch (prop) {
          case "USEDIEEVENT": t.useDieEvent = b; break;
          case "ZENABLE": t.zEnable = b; break;
          case "ZWRITEENABLE": t.zWriteEnable = b; break;
          case "USELAND": t.useLand = b; break;
          case "SET_LAND_HEIGHT_ON_START": t.setLandHeightOnStart = b; break;
          case "FORCELAYER": t.forceLayer = b; break;
          case "USESLASHTRACE": t.useSlashTrace = b; break;
          case "CRASHLAND": t.crashLand = b; break;
          case "APPLYUNITSCALE": t.applyUnitScale = b; break;
          case "ALPHATEST": t.alphaTestEnable = b; break;
          default: throw s.error("Unknown sequence bool property!");
        }
        break;
      }
      case "SeqStringProp": {
        if (eventsStarted) throw s.error(MSG_AFTER_EVENTS);
        expectEquals(s, MSG_EQUALS_SEQ);
        const str = processString(s);
        switch (prop) {
          case "MESHNAME": t.meshName = str; break;
          case "CHANGETEXXET": t.changeTexXETName = str; break;
          case "MULTITEXXET": t.multiTexXETName = str; break;
          case "ANIPACKAGE": t.aniXETName = str; break;
          case "SLASH_TRACE_TEXTURE": t.slashTraceTextureName = str; break;
          default: throw s.error("Unknown sequence String property!");
        }
        break;
      }
      default:
        throw s.error(`Unexpected "${tok.value}" in Sequence Block!`);
    }
    if (tok.type !== "KeywordGlobal" && tok.type !== "KeywordDie" && tok.type !== "KeywordAnim") stats.properties++;
  }
  s.step(); // past the closing brace
  return t;
}

/** `ProcessXMeshPlayerBlock`: `it` is on the opening brace. */
function parseXMeshPlayerBlock(s: TokenStream, out: XMeshTemplet[], stats: ScriptStats): void {
  s.step();
  if (s.cur().type !== "CloseBrace") {
    do {
      if (s.cur().type !== "KeywordTemplet") throw s.error(`Unexpected "${s.cur().value}" in XMeshPlayer Block!`);
      out.push(parseTemplet(s, stats));
    } while (s.cur().type !== "CloseBrace");
  }
  s.step();
}

/**
 * `CKTDGXMeshPlayer::Compile`: parse the bytes of one XMeshPlayer script file. Throws `EffectScriptError` (message = the exe's
 * exception text) where the exe throws.
 */
export function parseXMeshPlayerScript(bytes: Uint8Array): XMeshPlayerScript {
  const tokens = tokenize(bytes, classifyXMeshToken);
  const s = new TokenStream(tokens, "xmeshplayer");
  if (tokens.length < 2) throw s.error("This script is too small to be valid.");
  if (tokens[0]!.type !== "KeywordXMeshPlayer") throw s.error("First word must be XMeshPlayer");
  s.i = 1;
  if (tokens[1]!.type !== "Quote") throw s.error("Must name XMeshPlayer");
  const name = removeQuotes(tokens[1]!.value);
  s.step();
  if (s.cur().type !== "RealNumber") throw s.error("Must have version number");
  const version = catof(s.cur().value);
  s.step();
  if (s.cur().type !== "OpenBrace") throw s.error("Missing opening brace for XMeshPlayer block");
  const templets: XMeshTemplet[] = [];
  const stats: ScriptStats = { tokens: tokens.length, tokensRead: 0, blocks: 0, properties: 0, events: 0 };
  parseXMeshPlayerBlock(s, templets, stats);
  stats.tokensRead = s.i;
  return { name, version, templets, stats };
}

/** The templet map of a `CKTDGXMeshPlayer`: scripts are added in load order, a later templet replaces an earlier one of the same name. */
export class XMeshLibrary {
  readonly templets = new Map<string, XMeshTemplet>();
  /** names that were defined more than once (within a file or across files), in the order the replacements happened */
  readonly replaced: string[] = [];

  add(script: XMeshPlayerScript): void {
    for (const t of script.templets) {
      if (this.templets.has(t.name)) this.replaced.push(t.name);
      this.templets.set(t.name, t);
    }
  }

  get(name: string): XMeshTemplet | undefined {
    return this.templets.get(name);
  }
}

