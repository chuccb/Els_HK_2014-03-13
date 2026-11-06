/**
 * Shared machinery of the client's two effect-script languages: the particle script (`*Particle*.txt`, `CKTDGParticleSystem`) and the
 * XMeshPlayer script (`*XMeshPlayer*.txt`, `CKTDGXMeshPlayer`). Both are small C++ recursive-descent parsers over a token vector; the
 * two copies of the tokenizer and of the `Process{Number,Vector,Color,...}` helpers in the exe are the same code with different token
 * enums, so one port serves both. The grammar-specific parts live in `particle.ts` and `xmeshplayer.ts`.
 *
 * Tokenizer (`CParticleEmitterTokenizer::Tokenize` 329041E0, x2.exe.c L341570; `CXMeshPlayerTokenizer::Tokenize` 32922360, L366148):
 * a four state machine over the bytes up to the first NUL (state 1 between tokens, 2 in a word, 3 in a quoted string, 4 in a comment).
 *   - state 1 skips `isspace` bytes; any other byte starts a token (the byte is stored first); `//` or `--` at the start of a token
 *     begins a comment that runs to the next LF; `"` starts a string; everything else starts a word.
 *   - a word ends at white space, or at one of `( ) , " { }` or a `/` that does not start `//`; those delimiters flush the word and (but
 *     the quote) become a one-character token of their own. `//` inside a word starts a comment and DROPS the word; `--` is only a
 *     comment at the start of a token (the dropped word stays in the buffer: it is emitted after all when the text ends before another
 *     token starts). A one-character token that starts a token (`(`, `{`, `=`, ...) is a word too: `{abc` is ONE token, because only
 *     the next byte decides; `x=5` is one token `X=5`, `x =5` the tokens `X` and `=5`.
 *   - a string keeps both quotes in its text (`"a b"`). A `"` that directly follows a word flushes the word but forgets to clear the
 *     buffer, so the text of the string is appended to the old word (and its opening quote is lost): `name"x"` gives the tokens
 *     `NAME` and `NAMEX"` (the second one is a word to the classifier, so it is upper-cased). Real scripts never do this; the port keeps
 *     it because it is what the exe does.
 *   - `AddToken` drops empty texts and classifies the rest (`DetermineTokenType`: first byte, then the upper-cased word against the
 *     keyword/property lists, see the two grammars).
 *   - after the last byte the pending buffer is flushed once more WITHOUT clearing it after the previous flush: a file that ends in
 *     white space after a word (almost always `}` + CR LF) therefore ends with that token twice (a string too: it is flushed when its
 *     closing quote arrives, and the buffer stays), a file that ends inside a comment ends with a stray `/` or `-` token. The parsers
 *     tolerate the duplicate (a missing last `}` is closed by it); a file that ends right after its last byte has no duplicate.
 * The XMeshPlayer copy also numbers the lines (`m_iLineNumber`, the line of the first byte processed after the previous token); the
 * number is only kept for diagnostics.
 *
 * Parser helpers: `ProcessNumber` (32902D90 / 3291E5A0), `ProcessVector` / `ProcessVector3` (32903AF0 / 32921AA0), `ProcessColor`
 * (32900600 / 3291E3E0), the `ProcessPropEqualsValue` overloads (32903290..32903430 / 3291E710..3291E970), `ProcessBool`, `ProcessString`,
 * `ProcessRenderType`, `RemoveQuotes` (32903C60). Errors are C++ exceptions of type `const char*` (two of them `wchar_t*`) that nothing in
 * the exe catches near the parser; here they are `EffectScriptError` with the exe's text as the message.
 *
 * Numbers are `float`s in the exe: `_atof` (double) stored to a `float`, so every value here went through `Math.fround`.
 */

export type ScriptKind = "particle" | "xmeshplayer";

export type TokenType =
  | "RealNumber" | "Equals" | "Comma" | "OpenParen" | "CloseParen" | "OpenBrace" | "CloseBrace" | "Quote"
  | "KeywordRandom" | "KeywordXYZ" | "KeywordXY" | "KeywordColor"
  | "KeywordFade" | "KeywordSo" | "KeywordAt" | "KeywordFrom" | "KeywordTo" | "KeywordInitial" | "KeywordFinal"
  | "KeywordParticleSystem" | "KeywordEventSequence"
  | "KeywordXMeshPlayer" | "KeywordTemplet" | "KeywordGlobal" | "KeywordDie" | "KeywordAnim"
  | "AlphaBlendMode" | "CullMode"
  | "SeqAlphaBlendModeProp" | "SeqParticleTypeProp" | "SeqMeshRenderTypeProp" | "SeqBillboardTypeProp" | "SeqCullModeProp"
  | "SeqNumericProp" | "SeqVectorProp" | "SeqBoolProp" | "SeqStringProp"
  | "SeqLifeTypeProp" | "SeqMeshTypeProp" | "SeqRenderTypeProp" | "SeqCartoonTexTypeProp" | "SeqVector3Prop"
  | "ParticleNumericProp" | "ParticleVectorProp" | "ParticleVector2Prop" | "ParticleColorProp" | "ParticleStringProp"
  | "MeshNumericProp" | "MeshVector3Prop" | "MeshVector2Prop" | "MeshColorProp" | "MeshStringProp" | "MeshBoolProp" | "MeshRenderTypeProp"
  | "Unknown";

export interface Token {
  type: TokenType;
  /** the token text: words are upper-cased by the classifier, quoted strings keep their quotes */
  value: string;
  /** XMeshPlayer tokenizer only (diagnostics): see the file comment; -1 when unknown */
  line: number;
}

/** `DetermineTokenType`: the type of a token text, plus the text itself (it upper-cases words in place). */
export type Classifier = (text: string) => { type: TokenType; text: string };

export class EffectScriptError extends Error {
  constructor(message: string, readonly script: ScriptKind, readonly tokenIndex: number, readonly line: number) {
    super(message);
    this.name = "EffectScriptError";
  }
}

export const EOF_MESSAGE = "Unexpected end-of-file.";

/** `isspace` of the C locale (the shipped scripts are ASCII; bytes >= 0x80 are never white space). */
function isSpace(c: number): boolean {
  return c === 0x20 || (c >= 0x09 && c <= 0x0d);
}

/** `_toupper` over a whole string: ASCII letters only. */
export function toUpperAscii(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    out += c >= 0x61 && c <= 0x7a ? String.fromCharCode(c - 32) : s[i];
  }
  return out;
}

/**
 * The first-byte part of `DetermineTokenType`, identical in both scripts: a digit or `-` is a number (whatever follows), then the
 * punctuation characters; `undefined` means "a word".
 */
export function classifyFirstByte(text: string): TokenType | undefined {
  const c = text.charCodeAt(0);
  if ((c >= 0x30 && c <= 0x39) || c === 0x2d) return "RealNumber";
  switch (c) {
    case 0x3d: return "Equals";
    case 0x2c: return "Comma";
    case 0x28: return "OpenParen";
    case 0x29: return "CloseParen";
    case 0x7b: return "OpenBrace";
    case 0x7d: return "CloseBrace";
    case 0x22: return "Quote";
    default: return undefined;
  }
}

/** The shared words of both languages (after upper-casing); `undefined` when the word is not one of them. */
export function classifyCommonKeyword(upper: string): TokenType | undefined {
  switch (upper) {
    case "RANDOM": return "KeywordRandom";
    case "XYZ": return "KeywordXYZ";
    case "XY": return "KeywordXY";
    case "RGBA": return "KeywordColor";
    case "FADE": return "KeywordFade";
    case "SO": return "KeywordSo";
    case "AT": return "KeywordAt";
    case "FROM": return "KeywordFrom";
    case "TO": return "KeywordTo";
    case "INITIAL": return "KeywordInitial";
    case "FINAL": return "KeywordFinal";
    default: return undefined;
  }
}

/** Run the tokenizer over the bytes of a script (stops at the first NUL, like the exe's C string loop). */
export function tokenize(bytes: Uint8Array, classify: Classifier): Token[] {
  const out: Token[] = [];
  const n = bytes.length;
  let state = 1;
  let tok = "";
  let tokLine = -1;
  let line = 1;
  const add = (text: string, ln: number): void => {
    if (text.length === 0) return; // AddToken ignores empty texts
    const c = classify(text);
    out.push({ type: c.type, value: c.text, line: ln });
  };
  for (let pos = 0; pos < n; pos++) {
    const c = bytes[pos]!;
    if (c === 0) break;
    if (tokLine < 0) tokLine = line;
    const ch = String.fromCharCode(c);
    const nextIsSlash = pos + 1 < n && bytes[pos + 1] === 0x2f;
    switch (state) {
      case 1:
        if (!isSpace(c)) {
          tok = ch;
          if (c === 0x2f) state = nextIsSlash ? 4 : 2;
          else if (c === 0x2d && pos + 1 < n && bytes[pos + 1] === 0x2d) state = 4;
          else state = c === 0x22 ? 3 : 2;
        }
        break;
      case 2:
        if (isSpace(c)) {
          add(tok, tokLine);
          tokLine = -1;
          state = 1;
        } else if (c === 0x28 || c === 0x29 || c === 0x2c || c === 0x22 || c === 0x7b || c === 0x7d || (c === 0x2f && !nextIsSlash)) {
          tok = classify(tok).text; // DetermineTokenType(&token) upper-cases the buffer itself
          add(tok, tokLine);
          tokLine = -1;
          if (c === 0x22) {
            state = 3; // the buffer is NOT cleared: the old word stays in front of the string text
          } else {
            add(ch, tokLine);
            tok = "";
            tokLine = -1;
          }
        } else if (c === 0x2f) {
          state = 4; // "//" inside a word: the word is dropped
        } else {
          tok += ch;
        }
        break;
      case 3:
        tok += ch;
        if (c === 0x22) {
          add(tok, tokLine);
          tokLine = -1;
          state = 1;
        }
        break;
      default: // 4: comment
        if (c === 0x0a) {
          tokLine = -1;
          state = 1;
        }
        break;
    }
    if (c === 0x0a) line++;
  }
  add(tok, tokLine); // the final flush (the buffer may still hold the last token)
  return out;
}

/** One of the eight script systems of `CX2Data`: a `CKTDGParticleSystem` or `CKTDGXMeshPlayer` and the files it is fed, in order. */
export interface EffectSystem {
  kind: ScriptKind;
  /** the constructor's `ucSystemID`: 0 UI major, 1 UI minor, 2 game major, 3 game minor */
  id: number;
  /** the `CX2Data` member without its `m_p` */
  name: string;
  files: readonly string[];
}

/**
 * Which script goes to which system, in which order (`CX2StateStartUp::LoadData` 32ED9CB0, x2.exe.c L1544939; `CX2SquareGame` builds a
 * second set of the four game systems from the same game files, L863261). Every system is its own name space: a later script (or a
 * later sequence of the same file) replaces an earlier sequence of the same name, but only inside its system, so the many names that
 * several files define (`GameMajorParticle.txt` and `GameMinorParticle.txt` share some) do not clash. `GameMinorXMeshPlayer.txt`,
 * `UIMinorXMeshPlayer.txt` and `UIMinorParticle.txt` have no `_INT` companion. `rena_A_trapingArrow_Particle.txt` and
 * `rena_A_trapingArrow_Xmesh.txt` are in the KOMs but named nowhere in the exe or in the Lua scripts.
 */
export const EFFECT_SYSTEMS: readonly EffectSystem[] = [
  { kind: "particle", id: 0, name: "UIMajorParticle", files: ["UIMajorParticle.txt", "UIMajorParticle_INT.txt"] },
  { kind: "particle", id: 1, name: "UIMinorParticle", files: ["UIMinorParticle.txt"] },
  {
    kind: "particle", id: 2, name: "GameMajorParticle",
    files: ["GameMajorParticle.txt", ...Array.from({ length: 22 }, (_, i) => `GameMajorParticle${i + 2}.txt`), "GameMajorParticle_INT.txt"],
  },
  { kind: "particle", id: 3, name: "GameMinorParticle", files: ["GameMinorParticle.txt", "GameMinorParticle_INT.txt"] },
  { kind: "xmeshplayer", id: 0, name: "UIMajorXMeshPlayer", files: ["UIMajorXMeshPlayer.txt", "UIMajorXMeshPlayer_INT.txt"] },
  { kind: "xmeshplayer", id: 1, name: "UIMinorXMeshPlayer", files: ["UIMinorXMeshPlayer.txt"] },
  { kind: "xmeshplayer", id: 2, name: "GameMajorXMeshPlayer", files: ["GameMajorXMeshPlayer.txt", "GameMajorXMeshPlayer_INT.txt"] },
  { kind: "xmeshplayer", id: 3, name: "GameMinorXMeshPlayer", files: ["GameMinorXMeshPlayer.txt"] },
];

/** Bookkeeping of one parse, for the verification tools (the exe keeps nothing of it). */
export interface ScriptStats {
  /** tokens produced by the tokenizer (including the duplicated last one, see the file comment) */
  tokens: number;
  /** index of the iterator after the main block's closing brace: tokens from there on are never read by the exe */
  tokensRead: number;
  /** `eventsequence` / `templet` blocks, duplicates by name included */
  blocks: number;
  /** `name = value` sequence/templet properties that were accepted (a property written twice counts twice) */
  properties: number;
  /** events accepted */
  events: number;
}

/** The token iterator of the parsers (`std::vector<Token>::iterator` + `end()`). */
export class TokenStream {
  i = 0;
  constructor(readonly tokens: readonly Token[], readonly script: ScriptKind) {}

  error(message: string): EffectScriptError {
    const t = this.tokens[Math.min(this.i, this.tokens.length - 1)];
    return new EffectScriptError(message, this.script, this.i, t ? t.line : -1);
  }

  /**
   * `it->`. Reading the element at `end()` is undefined behaviour in the exe (it sees whatever the vector's spare capacity holds);
   * here it is the end-of-file error, which is what every checked path reports. (A method rather than a getter on purpose: TypeScript
   * would keep a narrowing like `s.cur.type !== "X"` alive across `step()`.)
   */
  cur(): Token {
    const t = this.tokens[this.i];
    if (t === undefined) throw this.error(EOF_MESSAGE);
    return t;
  }

  /** `NextToken` / `if (it == end) throw; ++it`. */
  step(): void {
    if (this.i >= this.tokens.length) throw this.error(EOF_MESSAGE);
    this.i++;
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Values

export interface MinMax<T> { min: T; max: T }
export type Vec2 = readonly [number, number];
export type Vec3 = readonly [number, number, number];
export type Color4 = readonly [number, number, number, number];
export type Range = MinMax<number>;

/** `(float)` of a double, i.e. what storing `_atof`'s result into a `float` field does. */
export const f32 = Math.fround;

/** Degrees to radians as the exe's float constant `0.017453292f`. */
export const DEG2RAD = Math.fround(0.017453292);

/** C `(int)` of a float: truncation toward zero; NaN and out of range give INT_MIN (`cvttss2si`). */
export function cInt(x: number): number {
  if (!Number.isFinite(x) || x >= 2147483648 || x <= -2147483649) return -2147483648;
  return Math.trunc(x) | 0;
}

/**
 * msvcr100 `atof`: optional blanks and sign, digits with an optional fraction, an optional exponent (`e`, `E`, `d` or `D`); stops at the
 * first byte that does not fit. No digits at all gives +0. (The CRT converts through an 80-bit intermediate, so in very rare halfway
 * cases the last bit of the double can differ from `Number()`; after the conversion to `float` that is invisible.)
 */
export function catof(text: string): number {
  const m = /^[\t\n\v\f\r ]*([+-]?)(\d*)(?:\.(\d*))?/.exec(text)!;
  const int = m[2] ?? "";
  const frac = m[3] ?? "";
  if (int.length === 0 && frac.length === 0) return 0;
  let rest = text.slice(m[0].length);
  let exp = "";
  const em = /^[dDeE]([+-]?\d+)/.exec(rest);
  if (em) { exp = "e" + em[1]; rest = rest.slice(em[0].length); }
  return Number(`${m[1]}${int || "0"}.${frac || "0"}${exp}`);
}

/** `RemoveQuotes`: deletes EVERY `"` of the text (it is not limited to the ends). */
export function removeQuotes(text: string): string {
  return text.replaceAll('"', "");
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Parser helpers (all of them leave the iterator after the construct they parsed)

/** `ProcessNumber`: `<number>` or `Random(<number>, <number>)`. */
export function processNumber(s: TokenStream): Range {
  const t = s.cur();
  if (t.type === "RealNumber") {
    const v = f32(catof(t.value));
    s.step();
    return { min: v, max: v };
  }
  if (t.type !== "KeywordRandom") throw s.error("Expecting either Random(...) or a number value.");
  s.step();
  if (s.cur().type !== "OpenParen") throw s.error("Expecting opening paren after Random keyword.");
  s.step();
  if (s.cur().type !== "RealNumber") throw s.error("Expecting first number within Random(...).");
  const min = f32(catof(s.cur().value));
  s.step();
  if (s.cur().type !== "Comma") throw s.error("Expecting comma within Random(...).");
  s.step();
  if (s.cur().type !== "RealNumber") throw s.error("Expecting second number within Random(...).");
  const max = f32(catof(s.cur().value));
  s.step();
  if (s.cur().type !== "CloseParen") throw s.error("Missing close paren on Random(...).");
  s.step();
  return { min, max };
}

/** `<KEYWORD>(<number>, ..., <number>)` with `n` components: shared body of XYZ(...), XY(...) and RGBA(...). */
function processTuple(s: TokenStream, keyword: TokenType, expecting: string, afterKeyword: string, n: number, sepMessage: string): Range[] {
  if (s.cur().type !== keyword) throw s.error(expecting);
  s.step();
  if (s.cur().type !== "OpenParen") throw s.error(afterKeyword);
  s.step();
  const parts: Range[] = [];
  for (let k = 0; k < n; k++) {
    if (k > 0) {
      if (s.cur().type !== "Comma") throw s.error(sepMessage);
      s.step();
    }
    parts.push(processNumber(s));
  }
  if (s.cur().type !== "CloseParen") throw s.error("Expecting ) to close vector.");
  s.step();
  return parts;
}

/** `ProcessVector` / `ProcessVector3`: `XYZ(x, y, z)`, each component a number or `Random(a, b)`. */
export function processVector3(s: TokenStream): MinMax<Vec3> {
  const p = processTuple(s, "KeywordXYZ", "Expecting XYZ(...)!", "Expecting ( after XYZ!", 3, "Vector components must be seperated by a comma.");
  return { min: [p[0]!.min, p[1]!.min, p[2]!.min], max: [p[0]!.max, p[1]!.max, p[2]!.max] };
}

/** The `XY(x, y)` form of the texture-UV events. */
export function processVector2(s: TokenStream): MinMax<readonly [number, number]> {
  const p = processTuple(s, "KeywordXY", "Expecting XY(...)!", "Expecting ( after XY!", 2, "Vector components must be seperated by a comma.");
  return { min: [p[0]!.min, p[1]!.min], max: [p[0]!.max, p[1]!.max] };
}

/** `ProcessColor`: `RGBA(r, g, b, a)`. */
export function processColor(s: TokenStream): MinMax<Color4> {
  const p = processTuple(s, "KeywordColor", "Expecting RGBA(...)!", "Expecting ( after RGBA!", 4, "Color components must be seperated by a comma.");
  return { min: [p[0]!.min, p[1]!.min, p[2]!.min, p[3]!.min], max: [p[0]!.max, p[1]!.max, p[2]!.max, p[3]!.max] };
}

/**
 * The shared prelude of every `name = value` construct: `it` is on the property name, afterwards on the first token of the value.
 * The exe uses "Expected equals sign!" in the sequence blocks and in some events, "Expecting = after property." in the others.
 */
export function expectEquals(s: TokenStream, message: string): void {
  s.step();
  if (s.cur().type !== "Equals") throw s.error(message);
  s.step();
}

export const MSG_EQUALS_SEQ = "Expected equals sign!";
export const MSG_EQUALS_PROP = "Expecting = after property.";

// ---------------------------------------------------------------------------------------------------------------------------------
// Enumerations shared by both scripts (tables from x2.exe.c: `m_BlendingModes` L37493 / L37781, `m_CullModes` L37540)

export const D3DBLEND_NAMES: readonly (readonly [string, number])[] = [
  ["D3DBLEND_ZERO", 1], ["D3DBLEND_ONE", 2], ["D3DBLEND_SRCCOLOR", 3], ["D3DBLEND_INVSRCCOLOR", 4], ["D3DBLEND_SRCALPHA", 5],
  ["D3DBLEND_INVSRCALPHA", 6], ["D3DBLEND_DESTALPHA", 7], ["D3DBLEND_INVDESTALPHA", 8], ["D3DBLEND_DESTCOLOR", 9],
  ["D3DBLEND_INVDESTCOLOR", 10], ["D3DBLEND_SRCALPHASAT", 11], ["D3DBLEND_BOTHSRCALPHA", 12], ["D3DBLEND_BOTHINVSRCALPHA", 13],
  ["D3DBLEND_BLENDFACTOR", 14], ["D3DBLEND_INVBLENDFACTOR", 15],
];

export const D3DCULL_NAMES: readonly (readonly [string, number])[] = [
  ["D3DCULL_NONE", 1], ["D3DCULL_CW", 2], ["D3DCULL_CCW", 3], ["D3DCULL_FORCE_DWORD", 0x7fffffff],
];

/** `CKTDGMatrix::BILLBOARD_TYPE` (`BT_NONE` is the literal 0 in the parsers). */
export const BILLBOARD_TYPES = { BT_NONE: 0, BT_ALL: 1, BT_X: 2, BT_Y: 3, BT_Z: 4 } as const;

/** `CKTDGXRenderer::RENDER_TYPE` (x2.exe.h L48201). */
export const RENDER_TYPES = {
  RT_REAL_COLOR: 0, RT_CARTOON_BLACK_EDGE: 1, RT_CARTOON_COLOR_EDGE: 2, RT_CARTOON: 3, RT_ADD_CARTOON_BLACK_EDGE: 4,
  RT_ADD_CARTOON_COLOR_EDGE: 5, RT_ADD_CARTOON: 6, RT_BLACK_EDGE: 7, RT_COLOR_EDGE: 8, RT_LIGHT_FLOW_WORLD_X: 9,
  RT_LIGHT_FLOW_WORLD_Y: 10, RT_LIGHT_FLOW_WORLD_Z: 11, RT_LIGHT_FLOW_WORLD_POINT: 12, RT_LIGHT_FLOW_LOCAL_X: 13,
  RT_LIGHT_FLOW_LOCAL_Y: 14, RT_LIGHT_FLOW_LOCAL_Z: 15, RT_LIGHT_FLOW_LOCAL_POINT: 16, RT_CARTOON_FADE: 17, RT_CARTOON_FADE_NONTEX: 18,
} as const;

/** The table lookup of `SOURCEBLENDMODE` / `DESTBLENDMODE`: `it` is on the value token, afterwards after it. */
export function processBlendMode(s: TokenStream): number {
  if (s.cur().type !== "AlphaBlendMode") throw s.error("Expecting alpha blend mode (D3DBLEND_ZERO, D3DBLEND_ONE, etc.).");
  const text = s.cur().value;
  const hit = D3DBLEND_NAMES.find(([name]) => name === text);
  if (!hit) throw s.error("Invalid alpha blending mode!");
  s.step();
  return hit[1];
}

/** `X = BT_ALL | BT_NONE | BT_X | BT_Y | BT_Z` (same checks in both scripts); `it` is on the value token, afterwards after it. */
export function processBillboardType(s: TokenStream): number {
  const text = s.cur().value;
  if (!Object.hasOwn(BILLBOARD_TYPES, text)) throw s.error("Invalid billboard type!");
  s.step();
  return BILLBOARD_TYPES[text as keyof typeof BILLBOARD_TYPES];
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The CRT's rand() and the exe's RandomNumber helpers

/** msvcr100 `rand()`: a 32-bit linear congruential generator, 15 output bits. */
export class MsvcRand {
  #seed: number;
  constructor(seed = 1) { this.#seed = seed >>> 0; }
  srand(seed: number): void { this.#seed = seed >>> 0; }
  next(): number {
    this.#seed = (Math.imul(this.#seed, 214013) + 2531011) >>> 0;
    return (this.#seed >>> 16) & 0x7fff;
  }
}

/**
 * `RandomNumber(float, float)` (32972450, x2.exe.c L432545): `min` when the bounds are equal, otherwise
 * `(float)((float)((float)(rand() / 32767.0) * |max - min|) + min)`. The script parsers keep the `Random(a, b)` ranges as they are;
 * the exe draws a number from them at load time for a few particle properties (see the notes in `particle.ts`).
 */
export function randomNumber(min: number, max: number, rand: () => number): number {
  if (min === max) return min;
  const u = f32(rand() / 32767);
  const span = Math.abs(f32(max - min));
  return f32(f32(u * span) + min);
}

/** `RandomNumber(int, int)` (32972410, L432536): `min + rand() % (|max - min| + 1)` unless the bounds are equal. */
export function randomInt(min: number, max: number, rand: () => number): number {
  if (min === max) return min;
  return (min + (rand() % (Math.abs((max - min) | 0) + 1))) | 0;
}
