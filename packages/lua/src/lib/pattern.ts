/**
 * Lua 5.1 pattern matching (lstrlib.c) over byte strings — LuaJIT 2.0's string library uses the same engine.
 * Strings are JS strings holding one byte per char.
 */
import { callerError } from "../value.ts";

const L_ESC = 0x25; // '%'
export const CAP_UNFINISHED = -1;
export const CAP_POSITION = -2;
export const LUA_MAXCAPTURES = 32;
const MAXCCALLS = 200;

export class MatchState {
  level = 0;
  capInit = new Int32Array(LUA_MAXCAPTURES);
  capLen = new Int32Array(LUA_MAXCAPTURES);
  depth = 0;
  readonly slen: number;
  readonly plen: number;
  constructor(readonly src: string, readonly pat: string) {
    this.slen = src.length;
    this.plen = pat.length;
  }
}

const isalpha = (c: number) => (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
const isdigit = (c: number) => c >= 48 && c <= 57;
const islower = (c: number) => c >= 97 && c <= 122;
const isupper = (c: number) => c >= 65 && c <= 90;
const isspace = (c: number) => c === 32 || (c >= 9 && c <= 13);
const iscntrl = (c: number) => c < 32 || c === 127;
const ispunct = (c: number) => (c >= 33 && c <= 47) || (c >= 58 && c <= 64) || (c >= 91 && c <= 96) || (c >= 123 && c <= 126);
const isalnum = (c: number) => isalpha(c) || isdigit(c);
const isxdigit = (c: number) => isdigit(c) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102);

function checkCapture(ms: MatchState, l: number): number {
  l -= 0x31; // '1'
  if (l < 0 || l >= ms.level || ms.capLen[l] === CAP_UNFINISHED) throw callerError("invalid capture index");
  return l;
}

function captureToClose(ms: MatchState): number {
  let level = ms.level;
  for (level--; level >= 0; level--) if (ms.capLen[level] === CAP_UNFINISHED) return level;
  throw callerError("invalid pattern capture");
}

function classEnd(ms: MatchState, p: number): number {
  const pat = ms.pat, plen = ms.plen;
  const c = pat.charCodeAt(p++);
  if (c === L_ESC) {
    if (p >= plen) throw callerError("malformed pattern (ends with '%')");
    return p + 1;
  }
  if (c === 0x5b) { // '['
    if (pat.charCodeAt(p) === 0x5e) p++; // '^'
    do {
      if (p >= plen) throw callerError("malformed pattern (missing ']')");
      const cc = pat.charCodeAt(p++);
      if (cc === L_ESC && p < plen) p++; // skip escapes (e.g. `%]')
    } while (pat.charCodeAt(p) !== 0x5d);
    return p + 1;
  }
  return p;
}

function matchClass(c: number, cl: number): boolean {
  let res: boolean;
  switch (isupper(cl) ? cl + 32 : cl) {
    case 0x61: res = isalpha(c); break; // a
    case 0x63: res = iscntrl(c); break; // c
    case 0x64: res = isdigit(c); break; // d
    case 0x6c: res = islower(c); break; // l
    case 0x70: res = ispunct(c); break; // p
    case 0x73: res = isspace(c); break; // s
    case 0x75: res = isupper(c); break; // u
    case 0x77: res = isalnum(c); break; // w
    case 0x78: res = isxdigit(c); break; // x
    case 0x7a: res = c === 0; break; // z (deprecated)
    default: return cl === c;
  }
  return isupper(cl) ? !res : res;
}

function matchBracketClass(ms: MatchState, c: number, p: number, ec: number): boolean {
  const pat = ms.pat;
  let sig = true;
  if (pat.charCodeAt(p + 1) === 0x5e) {
    sig = false;
    p++; // skip the `^'
  }
  while (++p < ec) {
    const pc = pat.charCodeAt(p);
    if (pc === L_ESC) {
      p++;
      if (matchClass(c, pat.charCodeAt(p))) return sig;
    } else if (pat.charCodeAt(p + 1) === 0x2d && p + 2 < ec) { // range a-z
      p += 2;
      if (pc <= c && c <= pat.charCodeAt(p)) return sig;
    } else if (pc === c) return sig;
  }
  return !sig;
}

function singleMatch(ms: MatchState, s: number, p: number, ep: number): boolean {
  if (s >= ms.slen) return false;
  const c = ms.src.charCodeAt(s);
  const pc = ms.pat.charCodeAt(p);
  switch (pc) {
    case 0x2e: return true; // '.'
    case L_ESC: return matchClass(c, ms.pat.charCodeAt(p + 1));
    case 0x5b: return matchBracketClass(ms, c, p, ep - 1);
    default: return pc === c;
  }
}

function matchBalance(ms: MatchState, s: number, p: number): number {
  if (p + 1 >= ms.plen) throw callerError("unbalanced pattern");
  const src = ms.src;
  if (s >= ms.slen || src.charCodeAt(s) !== ms.pat.charCodeAt(p)) return -1;
  const b = ms.pat.charCodeAt(p), e = ms.pat.charCodeAt(p + 1);
  let cont = 1;
  while (++s < ms.slen) {
    const c = src.charCodeAt(s);
    if (c === e) {
      if (--cont === 0) return s + 1;
    } else if (c === b) cont++;
  }
  return -1;
}

function maxExpand(ms: MatchState, s: number, p: number, ep: number): number {
  let i = 0;
  while (singleMatch(ms, s + i, p, ep)) i++;
  // keeps trying to match with the maximum repetitions
  while (i >= 0) {
    const res = doMatch(ms, s + i, ep + 1);
    if (res !== -1) return res;
    i--;
  }
  return -1;
}

function minExpand(ms: MatchState, s: number, p: number, ep: number): number {
  for (;;) {
    const res = doMatch(ms, s, ep + 1);
    if (res !== -1) return res;
    if (singleMatch(ms, s, p, ep)) s++;
    else return -1;
  }
}

function startCapture(ms: MatchState, s: number, p: number, what: number): number {
  const level = ms.level;
  if (level >= LUA_MAXCAPTURES) throw callerError("too many captures");
  ms.capInit[level] = s;
  ms.capLen[level] = what;
  ms.level = level + 1;
  const res = doMatch(ms, s, p);
  if (res === -1) ms.level--; // undo capture
  return res;
}

function endCapture(ms: MatchState, s: number, p: number): number {
  const l = captureToClose(ms);
  ms.capLen[l] = s - ms.capInit[l]!;
  const res = doMatch(ms, s, p);
  if (res === -1) ms.capLen[l] = CAP_UNFINISHED; // undo capture
  return res;
}

function matchCapture(ms: MatchState, s: number, l: number): number {
  l = checkCapture(ms, l);
  const len = ms.capLen[l]!;
  if (ms.slen - s >= len && ms.src.substr(ms.capInit[l]!, len) === ms.src.substr(s, len)) return s + len;
  return -1;
}

export function doMatch(ms: MatchState, s: number, p: number): number {
  if (++ms.depth > MAXCCALLS) throw callerError("pattern too complex");
  try {
    const pat = ms.pat, plen = ms.plen;
    for (;;) {
      if (p >= plen) return s;
      const pc = pat.charCodeAt(p);
      let dflt = false;
      switch (pc) {
        case 0x28: // '('
          if (pat.charCodeAt(p + 1) === 0x29) return startCapture(ms, s, p + 2, CAP_POSITION);
          return startCapture(ms, s, p + 1, CAP_UNFINISHED);
        case 0x29: // ')'
          return endCapture(ms, s, p + 1);
        case 0x24: // '$'
          if (p + 1 === plen) return s === ms.slen ? s : -1;
          dflt = true;
          break;
        case L_ESC: {
          const nc = pat.charCodeAt(p + 1);
          if (nc === 0x62) { // %b
            s = matchBalance(ms, s, p + 2);
            if (s !== -1) { p += 4; continue; }
            return -1;
          }
          if (nc === 0x66) { // %f frontier
            p += 2;
            if (pat.charCodeAt(p) !== 0x5b) throw callerError("missing '[' after '%f' in pattern");
            const ep = classEnd(ms, p);
            const prev = s === 0 ? 0 : ms.src.charCodeAt(s - 1);
            const cur = s < ms.slen ? ms.src.charCodeAt(s) : 0;
            if (!matchBracketClass(ms, prev, p, ep - 1) && matchBracketClass(ms, cur, p, ep - 1)) { p = ep; continue; }
            return -1;
          }
          if (isdigit(nc)) { // %0-%9 back reference
            s = matchCapture(ms, s, nc);
            if (s !== -1) { p += 2; continue; }
            return -1;
          }
          dflt = true;
          break;
        }
        default:
          dflt = true;
      }
      if (dflt) {
        const ep = classEnd(ms, p);
        const epc = pat.charCodeAt(ep);
        if (!singleMatch(ms, s, p, ep)) {
          if (epc === 0x2a || epc === 0x3f || epc === 0x2d) { // '*' '?' '-' accept empty
            p = ep + 1;
            continue;
          }
          return -1;
        }
        switch (epc) {
          case 0x3f: { // '?'
            const res = doMatch(ms, s + 1, ep + 1);
            if (res !== -1) return res;
            p = ep + 1;
            continue;
          }
          case 0x2b: return maxExpand(ms, s + 1, p, ep); // '+'
          case 0x2a: return maxExpand(ms, s, p, ep); // '*'
          case 0x2d: return minExpand(ms, s, p, ep); // '-'
          default:
            s++;
            p = ep;
            continue;
        }
      }
    }
  } finally {
    ms.depth--;
  }
}

/** Value of capture i (string or position number); i may equal ms.level only for whole-match when level==0. */
export function getOneCapture(ms: MatchState, i: number, s: number, e: number): string | number {
  if (i >= ms.level) {
    if (i === 0) return ms.src.slice(s, e); // add whole match
    throw callerError("invalid capture index");
  }
  const l = ms.capLen[i]!;
  if (l === CAP_UNFINISHED) throw callerError("unfinished capture");
  if (l === CAP_POSITION) return ms.capInit[i]! + 1;
  return ms.src.substr(ms.capInit[i]!, l);
}

/** All captures (or the whole match when the pattern has none and `wholeIfNone`). */
export function getCaptures(ms: MatchState, s: number, e: number, wholeIfNone: boolean): (string | number)[] {
  const n = ms.level === 0 && wholeIfNone ? 1 : ms.level;
  const out: (string | number)[] = [];
  for (let i = 0; i < n; i++) out.push(getOneCapture(ms, i, s, e));
  return out;
}

export function noSpecials(p: string): boolean {
  return !/[\^$*+?.(\[%-]/.test(p);
}
