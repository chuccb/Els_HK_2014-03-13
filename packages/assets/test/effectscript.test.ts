import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { KomArchive, fileSource } from "@els/kom";
import {
  BILLBOARD_TYPES, D3DBLEND_NAMES, D3DCULL_NAMES, EFFECT_SYSTEMS, MsvcRand, RENDER_TYPES, catof, cInt, classifyParticleToken,
  classifyXMeshToken, parseParticleScript, parseXMeshPlayerScript, randomInt, randomNumber, removeQuotes, tokenizeEffectScript,
} from "../src/index.ts";

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const toks = (s: string, classify = classifyParticleToken): string[] => tokenizeEffectScript(enc(s), classify).map((t) => `${t.type}:${t.value}`);

describe("the tokenizer (CParticleEmitterTokenizer::Tokenize / CXMeshPlayerTokenizer::Tokenize)", () => {
  test("words are upper-cased and classified, `=`, numbers and strings keep their own types", () => {
    expect(toks("Layer = 14\n")).toEqual(["SeqNumericProp:LAYER", "Equals:=", "RealNumber:14", "RealNumber:14"]);
    expect(toks('texture = "a b.dds" ')).toEqual(["ParticleStringProp:TEXTURE", "Equals:=", 'Quote:"a b.dds"', 'Quote:"a b.dds"']);
    expect(toks("x = -5\n").slice(0, 3)).toEqual(["Unknown:X", "Equals:=", "RealNumber:-5"]);
    expect(toks("Random(1,2)")).toEqual(["KeywordRandom:RANDOM", "OpenParen:(", "RealNumber:1", "Comma:,", "RealNumber:2", "CloseParen:)"]);
    expect(toks("ParticleSystem EventSequence fade so at from to initial final", classifyParticleToken).slice(0, 9)).toEqual([
      "KeywordParticleSystem:PARTICLESYSTEM", "KeywordEventSequence:EVENTSEQUENCE", "KeywordFade:FADE", "KeywordSo:SO", "KeywordAt:AT",
      "KeywordFrom:FROM", "KeywordTo:TO", "KeywordInitial:INITIAL", "KeywordFinal:FINAL",
    ]);
    expect(toks("XMeshPlayer Templet global die anim", classifyXMeshToken)).toEqual([
      "KeywordXMeshPlayer:XMESHPLAYER", "KeywordTemplet:TEMPLET", "KeywordGlobal:GLOBAL", "KeywordDie:DIE", "KeywordAnim:ANIM",
    ]);
  });

  test("white space is the C locale's isspace; a NUL ends the text", () => {
    expect(toks("a\tb\vc\fd\re")).toEqual(["Unknown:A", "Unknown:B", "Unknown:C", "Unknown:D", "Unknown:E"]);
    expect(toks("a\0b\n")).toEqual(["Unknown:A"]);
  });

  test("the last token is repeated when the text ends in white space (the flush does not clear the buffer)", () => {
    expect(toks("a b")).toEqual(["Unknown:A", "Unknown:B"]);
    expect(toks("a b\n")).toEqual(["Unknown:A", "Unknown:B", "Unknown:B"]);
    expect(toks("a b\r\n")).toEqual(["Unknown:A", "Unknown:B", "Unknown:B"]);
    expect(toks("{\n}\r\n")).toEqual(["OpenBrace:{", "CloseBrace:}", "CloseBrace:}"]);
  });

  test("`//` and `--` comments run to the end of the line", () => {
    expect(toks("a // comment\nb\n")).toEqual(["Unknown:A", "Unknown:B", "Unknown:B"]);
    expect(toks("a -- comment\nb\n")).toEqual(["Unknown:A", "Unknown:B", "Unknown:B"]);
    expect(toks("// only a comment\nx\n")).toEqual(["Unknown:X", "Unknown:X"]);
    expect(toks("-- only a comment\r\nx\r\n")).toEqual(["Unknown:X", "Unknown:X"]);
    expect(toks("x\n\t----- decoration -----\ny")).toEqual(["Unknown:X", "Unknown:Y"]);
  });

  test("`--` is a comment only where a token starts: inside a word it is part of the word", () => {
    expect(toks("a--b c\n")).toEqual(["Unknown:A--B", "Unknown:C", "Unknown:C"]);
  });

  test("`//` in the middle of a word starts a comment and the word is dropped (unless nothing follows to overwrite the buffer)", () => {
    expect(toks("abc//def\nxyz\n")).toEqual(["KeywordXYZ:XYZ", "KeywordXYZ:XYZ"]);
    expect(toks("abc//def\n")).toEqual(["Unknown:ABC"]);
  });

  test("a text that ends inside a comment ends with a stray `/` or `-` token", () => {
    expect(toks("a\n// c")).toEqual(["Unknown:A", "Unknown:/"]);
    expect(toks("a\r\n// c\r\n")).toEqual(["Unknown:A", "Unknown:/"]);
    expect(toks("a\n-- c\n")).toEqual(["Unknown:A", "RealNumber:-"]);
  });

  test("delimiters: ( ) , \" { } and a single `/` split a word and are tokens of their own", () => {
    expect(toks("a{b}c\n")).toEqual(["Unknown:A", "OpenBrace:{", "Unknown:B", "CloseBrace:}", "Unknown:C", "Unknown:C"]);
    expect(toks("f(1,2)")).toEqual(["Unknown:F", "OpenParen:(", "RealNumber:1", "Comma:,", "RealNumber:2", "CloseParen:)"]);
    expect(toks("a/b c\n")).toEqual(["Unknown:A", "Unknown:/", "Unknown:B", "Unknown:C", "Unknown:C"]);
    expect(toks("a / b\n")).toEqual(["Unknown:A", "Unknown:/", "Unknown:B", "Unknown:B"]);
  });

  test("a delimiter that starts a token is not a delimiter: `{abc` is one token, `=5` too", () => {
    expect(toks("{abc d\n")).toEqual(["OpenBrace:{abc", "Unknown:D", "Unknown:D"]);
    expect(toks("x =5\n")).toEqual(["Unknown:X", "Equals:=5", "Equals:=5"]);
    expect(toks("x=5\n")).toEqual(["Unknown:X=5", "Unknown:X=5"]);
  });

  test("a quote right behind a word keeps the word and appends the string's text to it (the buffer is not cleared)", () => {
    expect(toks('name"x" y\n')).toEqual(["Unknown:NAME", 'Unknown:NAMEX"', "Unknown:Y", "Unknown:Y"]);
  });

  test("strings keep both quotes and may hold anything but a quote, including `//` and braces", () => {
    expect(toks('"a // b {c}" d ')).toEqual(['Quote:"a // b {c}"', "Unknown:D", "Unknown:D"]);
    expect(toks('"" x ')[0]).toBe('Quote:""');
  });

  test("tokens carry the line they were found on (diagnostics only)", () => {
    const t = tokenizeEffectScript(enc("a\nb\nc"), classifyXMeshToken);
    expect(t.map((x) => x.line)).toEqual([1, 2, 3]);
  });
});

describe("helpers", () => {
  test("catof is the CRT's atof: blanks, sign, digits, fraction, exponent, stops at the first byte that does not fit", () => {
    expect(catof("1.5")).toBe(1.5);
    expect(catof("  -2.5e2xyz")).toBe(-250);
    expect(catof("0.s1")).toBe(0); // a typo in the shipped GameMinorParticle.txt: `from 0.s1 to 0.5`
    expect(catof("1e5")).toBe(100000);
    expect(catof("1d2")).toBe(100);
    expect(catof("1.5f")).toBe(1.5);
    expect(catof(".5")).toBe(0.5);
    expect(catof("5.")).toBe(5);
    expect(catof("1e")).toBe(1);
    expect(catof("1e+")).toBe(1);
    expect(catof("abc")).toBe(0);
    expect(catof("-")).toBe(0);
    expect(catof("+7")).toBe(7);
    expect(Object.is(catof("-0.0"), -0)).toBe(true);
  });

  test("cInt truncates toward zero; NaN and out-of-range values give INT_MIN like cvttss2si", () => {
    expect(cInt(2.9)).toBe(2);
    expect(cInt(-2.9)).toBe(-2);
    expect(cInt(-0.5)).toBe(0);
    expect(cInt(2147483647)).toBe(2147483647);
    expect(cInt(-2147483648.5)).toBe(-2147483648);
    expect(cInt(2147483648)).toBe(-2147483648);
    expect(cInt(3e9)).toBe(-2147483648);
    expect(cInt(NaN)).toBe(-2147483648);
    expect(cInt(Infinity)).toBe(-2147483648);
  });

  test("removeQuotes deletes every quote, not only the outer pair", () => {
    expect(removeQuotes('"abc"')).toBe("abc");
    expect(removeQuotes('a"b"c')).toBe("abc");
    expect(removeQuotes("abc")).toBe("abc");
  });

  test("MsvcRand is the msvcrt rand(): the well-known sequence of seed 1", () => {
    const r = new MsvcRand();
    expect(Array.from({ length: 10 }, () => r.next())).toEqual([41, 18467, 6334, 26500, 19169, 15724, 11478, 29358, 26962, 24464]);
    r.srand(1);
    expect(r.next()).toBe(41);
    r.srand(0);
    expect(r.next()).toBe(38); // srand(0): seed 0 -> 2531011 >> 16 = 38
  });

  test("randomNumber: the minimum when the bounds are equal, else rand()/32767 * |max - min| + min in float arithmetic", () => {
    expect(randomNumber(3, 3, () => 123)).toBe(3);
    expect(randomNumber(2, 6, () => 0)).toBe(2);
    expect(randomNumber(2, 6, () => 32767)).toBe(6);
    const u = Math.fround(16384 / 32767);
    expect(randomNumber(0, 1, () => 16384)).toBe(Math.fround(u * 1));
    // reversed bounds use |max - min| but keep min as the base: the result lies outside [max, min]
    expect(randomNumber(6, 2, () => 32767)).toBe(10);
  });

  test("randomInt: min + rand() % (|max - min| + 1), the minimum when the bounds are equal", () => {
    expect(randomInt(5, 5, () => 99)).toBe(5);
    expect(randomInt(3, 7, () => 12)).toBe(5);
    expect(randomInt(3, 7, () => 4)).toBe(7);
    expect(randomInt(7, 3, () => 12)).toBe(9); // not clamped
  });
});

describe("enumeration tables", () => {
  test("D3DBLEND_* and D3DCULL_* carry the D3D9 values", () => {
    const blend = ["ZERO", "ONE", "SRCCOLOR", "INVSRCCOLOR", "SRCALPHA", "INVSRCALPHA", "DESTALPHA", "INVDESTALPHA", "DESTCOLOR", "INVDESTCOLOR",
      "SRCALPHASAT", "BOTHSRCALPHA", "BOTHINVSRCALPHA", "BLENDFACTOR", "INVBLENDFACTOR"];
    expect(D3DBLEND_NAMES.map(([n, v]) => [n, v])).toEqual(blend.map((n, i) => [`D3DBLEND_${n}`, i + 1]));
    expect(D3DCULL_NAMES.map(([n, v]) => [n, v])).toEqual([["D3DCULL_NONE", 1], ["D3DCULL_CW", 2], ["D3DCULL_CCW", 3], ["D3DCULL_FORCE_DWORD", 0x7fffffff]]);
  });

  test("billboard and render types", () => {
    expect(BILLBOARD_TYPES).toEqual({ BT_NONE: 0, BT_ALL: 1, BT_X: 2, BT_Y: 3, BT_Z: 4 });
    expect(Object.keys(RENDER_TYPES).length).toBe(19);
    expect(RENDER_TYPES.RT_REAL_COLOR).toBe(0);
    expect(RENDER_TYPES.RT_CARTOON_FADE_NONTEX).toBe(18);
    expect(Object.values(RENDER_TYPES) as number[]).toEqual(Array.from({ length: 19 }, (_, i) => i));
  });
});

describe("EFFECT_SYSTEMS (CX2StateStartUp::LoadData)", () => {
  test("eight systems, ids 0..3 per kind, every file once", () => {
    expect(EFFECT_SYSTEMS.length).toBe(8);
    for (const kind of ["particle", "xmeshplayer"] as const) expect(EFFECT_SYSTEMS.filter((s) => s.kind === kind).map((s) => s.id)).toEqual([0, 1, 2, 3]);
    const files = EFFECT_SYSTEMS.flatMap((s) => s.files);
    expect(new Set(files).size).toBe(files.length);
    expect(files.length).toBe(2 + 1 + 24 + 2 + 2 + 1 + 2 + 1);
  });

  test("the game major particle system loads GameMajorParticle.txt, 2..23, then the _INT script (a later script replaces earlier names)", () => {
    const major = EFFECT_SYSTEMS.find((s) => s.name === "GameMajorParticle")!;
    expect(major.id).toBe(2);
    expect(major.files[0]).toBe("GameMajorParticle.txt");
    expect(major.files[1]).toBe("GameMajorParticle2.txt");
    expect(major.files[22]).toBe("GameMajorParticle23.txt");
    expect(major.files[23]).toBe("GameMajorParticle_INT.txt");
    expect(major.files.length).toBe(24);
  });
});

describe("shipped scripts", () => {
  const read = async (kom: string, name: string): Promise<Uint8Array | undefined> => {
    const path = new URL(`../../../data/${kom}`, import.meta.url).pathname;
    if (!existsSync(path)) return undefined;
    const k = await KomArchive.open(fileSource(path));
    const e = k.find(name);
    return e ? k.read(e) : undefined;
  };

  test("GameMinorParticle_INT.txt: 3 sequences, 45 properties, 24 events; the only token left after the block is the repeated last one", async () => {
    const bytes = await read("datai015.kom", "GameMinorParticle_INT.txt");
    if (!bytes) return;
    const s = parseParticleScript(bytes);
    expect(s.sequences.length).toBe(3);
    expect([s.stats.properties, s.stats.events]).toEqual([45, 24]);
    expect(bytes[bytes.length - 1]).toBe(0x0a);
    expect(s.stats.tokens - s.stats.tokensRead).toBe(1);
  });

  test("UIMinorXMeshPlayer.txt is one empty templet", async () => {
    const bytes = await read("data036.kom", "UIMinorXMeshPlayer.txt");
    if (!bytes) return;
    const s = parseXMeshPlayerScript(bytes);
    expect(s.templets.length).toBe(1);
    expect(s.stats.properties + s.stats.events).toBe(0);
  });

  test("GameMinorParticle.txt has `from 0.s1 to 0.5` in Sand_villeage_balpanWIND_P02: _atof reads 0 for the number token `0.s1`", async () => {
    const bytes = await read("data036.kom", "GameMinorParticle.txt");
    if (!bytes) return;
    const s = parseParticleScript(bytes);
    const seq = s.sequences.find((q) => q.name === "Sand_villeage_balpanWIND_P02")!;
    const ev = seq.events.find((e) => e.kind === "velocity" && e.fade && e.time.max === 0.5);
    expect(ev).toBeDefined();
    expect(ev!.time.min).toBe(0);
  });
});
