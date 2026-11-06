import { describe, expect, test } from "bun:test";
import { EffectScriptError, ParticleLibrary, PARTICLE_EVENT_TYPES, newParticleSequence, parseParticleScript } from "../src/index.ts";
import type { ParticleSequence } from "../src/index.ts";

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const f = Math.fround;
const DEG = f(0.017453292);

const sys = (body: string): string => `ParticleSystem "T" 1.00 {\n${body}\n}\n`;
const seq = (body: string, name = "S"): string => `EventSequence "${name}" {\n${body}\n}`;
const parse = (body: string) => parseParticleScript(enc(sys(body)));
const one = (body: string): ParticleSequence => parse(seq(body)).sequences[0]!;
const errorOf = (text: string): EffectScriptError => {
  try {
    parseParticleScript(enc(text));
  } catch (e) {
    if (e instanceof EffectScriptError) return e;
    throw e;
  }
  throw new Error("expected an EffectScriptError");
};
const msg = (body: string): string => errorOf(sys(seq(body))).message;

describe("particle script: structure", () => {
  test("system header: name without quotes, version number, case-insensitive keywords", () => {
    const s = parseParticleScript(enc('particlesystem "GameMajor" 1.25 {\neventsequence "a" {\n}\nEVENTSEQUENCE "b" {\n}\n}\n'));
    expect(s.name).toBe("GameMajor");
    expect(s.version).toBe(1.25);
    expect(s.sequences.map((q) => q.name)).toEqual(["a", "b"]);
    expect(s.stats).toEqual({ tokens: s.stats.tokens, tokensRead: s.stats.tokens - 1, blocks: 2, properties: 0, events: 0 });
  });

  test("an empty system block is fine; names lose every quote", () => {
    expect(parse("").sequences).toEqual([]);
    expect(one("").name).toBe("S");
    expect(parse(seq("", "A B")).sequences[0]!.name).toBe("A B");
  });

  test("only the first system block is read; whatever follows its closing brace is ignored", () => {
    const text = sys(seq("Layer = 1", "x")) + '\nParticleSystem "B" 1 {\n' + seq("Layer = 2", "y") + "\n}\n} } garbage = = =\n";
    const s = parseParticleScript(enc(text));
    expect(s.sequences.map((q) => q.name)).toEqual(["x"]);
    expect(s.stats.tokens - s.stats.tokensRead).toBeGreaterThan(10);
  });

  test("a missing last brace is closed by the tokenizer's repeated last token, but not when the file ends without white space", () => {
    const text = 'ParticleSystem "T" 1 {\nEventSequence "s" {\nLayer = 3\n}\n';
    expect(parseParticleScript(enc(text)).sequences[0]!.layer).toBe(3);
    expect(errorOf(text.slice(0, -1)).message).toBe("Unexpected end-of-file.");
  });

  test("comments and layout do not matter; `--` and `//` work in the middle of the block", () => {
    const q = one("  -- a comment\n\tLayer = 5 // trailing\n\n// another\nLifetime = 1 -- last");
    expect(q.layer).toBe(5);
    expect(q.lifetime).toEqual({ min: 1, max: 1 });
  });
});

describe("particle script: sequence defaults and properties", () => {
  test("an empty sequence has the constructor's defaults", () => {
    const q = one("");
    expect(q).toEqual(newParticleSequence("S"));
    expect(q.particleType).toBe(0); // PT_3D_PLANE
    expect(q.meshRenderType).toBe(0);
    expect(q.billboardType).toBe(1); // BT_ALL
    expect([q.srcBlendMode, q.destBlendMode]).toEqual([5, 7]); // SRCALPHA, DESTALPHA (not INVSRCALPHA)
    expect(q.cullMode).toBe(1);
    expect(q.drawCount).toEqual({ min: 1, max: 1 });
    expect(q.triggerCount).toEqual({ min: -1, max: -1 });
    expect(q.triggerTime).toEqual({ min: -1, max: -1 });
    expect([q.screwValue, q.screwRotateSpeed]).toEqual([-1, 10]);
    expect([q.zEnable, q.zWriteEnable, q.applyUnitScale]).toEqual([true, true, true]);
    expect([q.useLand, q.trace, q.forceLayer, q.resolutionConvert, q.alphaTest]).toEqual([false, false, false, false, false]);
    expect([q.maxParticleNum, q.layer]).toEqual([0, 0]);
    expect(q.events).toEqual([]);
  });

  test("numeric properties: Random(a, b) keeps the range, int fields take (int)max, the spherical angles are converted to radians", () => {
    const q = one(`
      Lifetime = 1.5
      EmitRate = Random(10, 20)
      NumParticles = 7.9
      TriggerCount = Random(2, 4)
      TriggerTime = 0.75
      DrawCount = 3
      LandPos = Random(-5, 5)
      Layer = Random(3.5, 9.9)
      ScrewValue = 12.7
      ScrewRotateSpeed = 3.2
      Spherical_EmitRadius = 5
      Spherical_EmitAzimuth = Random(0, 90)
      Spherical_EmitPolar = 180`);
    expect(q.lifetime).toEqual({ min: 1.5, max: 1.5 });
    expect(q.emitRate).toEqual({ min: 10, max: 20 });
    expect(q.maxParticleNum).toBe(7);
    expect(q.triggerCount).toEqual({ min: 2, max: 4 });
    expect(q.triggerTime).toEqual({ min: 0.75, max: 0.75 });
    expect(q.drawCount).toEqual({ min: 3, max: 3 });
    expect(q.landPosition).toEqual({ min: -5, max: 5 });
    expect(q.layer).toBe(9);
    expect(q.screwValue).toBe(12);
    expect(q.screwRotateSpeed).toBe(3);
    expect(q.sphericalEmitRadius).toEqual({ min: 5, max: 5 });
    expect(q.sphericalEmitAzimuth).toEqual({ min: 0, max: f(90 * DEG) });
    expect(q.sphericalEmitPolar).toEqual({ min: f(180 * DEG), max: f(180 * DEG) });
  });

  test("numbers are floats: 0.1 is stored as the nearest float", () => {
    expect(one("Lifetime = 0.1").lifetime.min).toBe(f(0.1));
    expect(one("Lifetime = 0.1").lifetime.min).not.toBe(0.1);
    expect(one("NumParticles = -2.5").maxParticleNum).toBe(-2);
    expect(one("Layer = 1e2").layer).toBe(100);
  });

  test("vector properties: XYZ(x, y, z), every component a number or Random(a, b)", () => {
    const q = one(`
      EmitRadius = XYZ(1, Random(2, 3), -4)
      EmitRadiusMin = XYZ(0, 0, 0.5)
      Gravity = XYZ(0, -980, 0)
      BlackHolePos = XYZ(1, 2, 3)
      LightPos = XYZ(Random(-1, 1), 0, 0)
      AddRotateRel = XYZ(0, 0, Random(0, 360))
      Spherical_EmitRotation = XYZ(10, 20, 30)`);
    expect(q.emitRadius).toEqual({ min: [1, 2, -4], max: [1, 3, -4] });
    expect(q.emitRadiusMin).toEqual({ min: [0, 0, 0.5], max: [0, 0, 0.5] });
    expect(q.gravity).toEqual({ min: [0, -980, 0], max: [0, -980, 0] });
    expect(q.blackHolePosition).toEqual({ min: [1, 2, 3], max: [1, 2, 3] });
    expect(q.lightPos).toEqual({ min: [-1, 0, 0], max: [1, 0, 0] });
    expect(q.addRotateRel).toEqual({ min: [0, 0, 0], max: [0, 0, 360] });
    expect(q.sphericalEmitRotation).toEqual({ min: [10, 20, 30], max: [10, 20, 30] }); // degrees, converted when the sequence is instantiated
  });

  test("bool, enum and string properties", () => {
    const q = one(`
      UseLand = TRUE
      Trace = true
      ZEnable = FALSE
      ZWriteEnable = False
      ResolutionConvert = TRUE
      ForceLayer = TRUE
      ApplyUnitScale = FALSE
      AlphaTest = TRUE
      ParticleType = PT_MESH
      MeshRenderType = RT_CARTOON
      BillboardType = BT_Y
      SourceBlendMode = D3DBLEND_ONE
      DestBlendMode = D3DBLEND_INVSRCCOLOR
      CullMode = D3DCULL_CCW
      Mesh = "a.X"
      ChangeTexXET = "c.xet"
      MultiTexXET = "m.xet"
      AniXET = "a.xet"
      AniName = "walk"
      TraceParticleList = "P1"
      TraceParticleList = "P2"
      FinalParticleList = "F1"`);
    expect([q.useLand, q.trace, q.zEnable, q.zWriteEnable, q.resolutionConvert, q.forceLayer, q.applyUnitScale, q.alphaTest])
      .toEqual([true, true, false, false, true, true, false, true]);
    expect([q.particleType, q.meshRenderType, q.billboardType, q.srcBlendMode, q.destBlendMode, q.cullMode]).toEqual([2, 3, 3, 2, 4, 3]);
    expect([q.meshName, q.changeTexXETName, q.multiTexXETName, q.aniXETName, q.aniName]).toEqual(["a.X", "c.xet", "m.xet", "a.xet", "walk"]);
    expect(q.traceParticleList).toEqual(["P1", "P2"]);
    expect(q.finalParticleList).toEqual(["F1"]);
  });

  test("every PT_*, BT_*, RT_* (the four of a particle sequence), D3DCULL_* name", () => {
    expect(["PT_3D_PLANE", "PT_2D_PLANE", "PT_MESH", "PT_SKINMESH"].map((n) => one(`ParticleType = ${n}`).particleType)).toEqual([0, 1, 2, 3]);
    expect(["BT_NONE", "BT_ALL", "BT_X", "BT_Y", "BT_Z"].map((n) => one(`BillboardType = ${n}`).billboardType)).toEqual([0, 1, 2, 3, 4]);
    expect(["RT_REAL_COLOR", "RT_CARTOON_BLACK_EDGE", "RT_CARTOON_COLOR_EDGE", "RT_CARTOON"].map((n) => one(`MeshRenderType = ${n}`).meshRenderType)).toEqual([0, 1, 2, 3]);
    expect(["D3DCULL_NONE", "D3DCULL_CW", "D3DCULL_CCW", "D3DCULL_FORCE_DWORD"].map((n) => one(`CullMode = ${n}`).cullMode)).toEqual([1, 2, 3, 0x7fffffff]);
    const blends = ["ZERO", "ONE", "SRCCOLOR", "INVSRCCOLOR", "SRCALPHA", "INVSRCALPHA", "DESTALPHA", "INVDESTALPHA", "DESTCOLOR", "INVDESTCOLOR", "SRCALPHASAT", "BOTHSRCALPHA", "BOTHINVSRCALPHA", "BLENDFACTOR", "INVBLENDFACTOR"];
    expect(blends.map((n) => one(`SourceBlendMode = D3DBLEND_${n}`).srcBlendMode)).toEqual(blends.map((_, i) => i + 1));
    expect(blends.map((n) => one(`DestBlendMode = d3dblend_${n.toLowerCase()}`).destBlendMode)).toEqual(blends.map((_, i) => i + 1));
  });

  test("names are case-insensitive, the last write wins, SkinMesh and Mesh set the same field, lists append", () => {
    const q = one('LIFETIME = 1\nlifetime = 2\nMesh = "a"\nSkinMesh = "b"\nTraceParticleList = "x"\ntraceparticlelist = "y"');
    expect(q.lifetime.max).toBe(2);
    expect(q.meshName).toBe("b");
    expect(q.traceParticleList).toEqual(["x", "y"]);
  });

  test("string values: any token is accepted, an unquoted word is upper-cased by the tokenizer, quotes vanish wherever they are", () => {
    expect(one('Mesh = "Some Mesh.X"').meshName).toBe("Some Mesh.X");
    expect(one("Mesh = abc").meshName).toBe("ABC");
    expect(one("Mesh = 12").meshName).toBe("12");
    expect(one('Mesh = ""').meshName).toBe("");
  });

  test("properties are counted in the statistics", () => {
    const s = parse(seq("Layer = 1\nLifetime = 2\nInitial Size = XYZ(1, 1, 1)\nFade so at 1 Size = XYZ(2, 2, 2)", "a") + "\n" + seq("Layer = 3", "b"));
    expect([s.stats.blocks, s.stats.properties, s.stats.events]).toEqual([2, 3, 2]);
  });
});

describe("particle script: events", () => {
  test("every event kind with the shape of its value", () => {
    const q = one(`
      Initial Color = RGBA(1, 0.5, 0.25, 1)
      Initial Size = XYZ(10, 20, 30)
      Initial Scale = 2
      Initial Velocity = XYZ(1, 2, 3)
      Initial Position = XYZ(4, 5, 6)
      Initial Rotate = XYZ(0, 0, Random(0, 360))
      Initial Crash = XYZ(7, 8, 9)
      Initial ResetCrash = 1
      Initial DirSpeed = Random(1, 2)
      Initial BlackHoleTime = 0.5
      Initial EventTimer = 3
      Initial Stretch = 1.5
      Initial Tex0UV = XY(0.5, 0.25)
      Initial Tex1UV = XY(1, 1)
      Initial Tex2UV = XY(2, 2)
      Initial Texture = "T.dds"`);
    expect(q.events.map((e) => e.kind)).toEqual(["color", "size", "scale", "velocity", "position", "rotate", "crash", "resetcrash", "dirspeed", "blackholetime", "eventtimer", "stretch", "tex0uv", "tex1uv", "tex2uv", "texture"]);
    expect(Object.keys(PARTICLE_EVENT_TYPES).sort()).toEqual(q.events.map((e) => e.kind).sort());
    expect(q.events[0]!.value).toEqual({ min: [1, 0.5, 0.25, 1], max: [1, 0.5, 0.25, 1] });
    expect(q.events[1]!.value).toEqual({ min: [10, 20, 30], max: [10, 20, 30] });
    expect(q.events[2]!.value).toEqual({ min: 2, max: 2 });
    expect(q.events[5]!.value).toEqual({ min: [0, 0, 0], max: [0, 0, 360] });
    expect(q.events[8]!.value).toEqual({ min: 1, max: 2 });
    expect(q.events[12]!.value).toEqual({ min: [0.5, 0.25], max: [0.5, 0.25] });
    expect(q.events[15]!.value).toBe("T.dds");
    for (const e of q.events) expect([e.fade, e.time]).toEqual([false, { min: 0, max: 0 }]);
  });

  test("time specifiers: initial, at T, from A to B, with Random(...) in either place", () => {
    const q = one(`
      Initial Scale = 1
      At 0.5 Scale = 2
      At Random(0.1, 0.2) Scale = 3
      From 0.2 To 0.4 Scale = 4
      From Random(0.1, 0.2) To Random(0.3, 0.4) Scale = 5
      From 1 To 0.5 Scale = 6`);
    expect(q.events.map((e) => e.time)).toEqual([
      { min: 0, max: 0 }, { min: 0.5, max: 0.5 }, { min: f(0.1), max: f(0.2) }, { min: f(0.2), max: f(0.4) },
      { min: f(0.1), max: f(0.4) }, // from.min .. to.max
      { min: 1, max: 0.5 }, // kept as written
    ]);
    expect(q.events.map((e) => e.fade)).toEqual([false, false, false, false, false, false]);
  });

  test("`fade so` marks the event; `fade so initial` is refused", () => {
    const q = one(`
      Fade so At 0.5 Scale = 2
      Fade so From 0 To 1 Color = RGBA(1, 1, 1, 0)
      Fade so Final Size = XYZ(1, 1, 1)`);
    expect(q.events.map((e) => e.fade)).toEqual([true, true, true]);
    expect(msg("Fade so Initial Scale = 1")).toBe('Cannot use "fade so" modifier on "initial" times.');
  });

  test("final is [0, LIFETIME.max] with the LIFETIME written before the event (0 without one)", () => {
    expect(one("Lifetime = 2.5\nFinal Scale = 1").events[0]!.time).toEqual({ min: 0, max: 2.5 });
    expect(one("Lifetime = Random(1, 3)\nFade so Final Scale = 1").events[0]!.time).toEqual({ min: 0, max: 3 });
    expect(one("Final Scale = 1").events[0]!.time).toEqual({ min: 0, max: 0 });
    expect(one("Lifetime = 2\nFinal Scale = 1").events[0]!.fade).toBe(false);
  });

  test("a sequence property after the first event is an error, for every kind of property", () => {
    const after = (line: string): string => msg(`Initial Scale = 1\n${line}`);
    const m = "Cannot specify any sequence properties after specifying events.";
    for (const line of ["Layer = 1", "Gravity = XYZ(0, 0, 0)", "Trace = TRUE", "Mesh = \"a\"", "ParticleType = PT_MESH", "SourceBlendMode = D3DBLEND_ONE", "CullMode = D3DCULL_NONE", "MeshRenderType = RT_CARTOON", "BillboardType = BT_X"]) {
      expect(after(line)).toBe(m);
    }
  });

  test("fading is refused for texture, eventtimer and blackholetime", () => {
    for (const line of ['Fade so At 1 Texture = "a.dds"', "Fade so At 1 EventTimer = 1", "Fade so From 0 To 1 BlackHoleTime = 1"]) {
      expect(msg(line)).toBe("Fading is not supported on this event.");
    }
    for (const line of ['At 1 Texture = "a.dds"', "At 1 EventTimer = 1", "At 1 BlackHoleTime = 1", "Fade so At 1 Stretch = 1", "Fade so At 1 ResetCrash = 1"]) {
      expect(() => one(line)).not.toThrow();
    }
  });

  test("events keep file order, time specifiers can repeat the same kind", () => {
    const q = one("Initial Size = XYZ(1, 1, 1)\nFade so From 0 To 1 Size = XYZ(2, 2, 2)\nFade so From 1 To 2 Size = XYZ(3, 3, 3)");
    expect(q.events.map((e) => (e.value as unknown as { max: number[] }).max[0])).toEqual([1, 2, 3]);
  });
});

describe("particle script: errors carry the exe's text", () => {
  const cases: [string, string, string][] = [
    ["empty file", "", "This script is too small to be valid."],
    ["one token", "ParticleSystem", "This script is too small to be valid."],
    ["first word", 'Foo "x" 1 {\n}\n', "First word must be ParticleSystem"],
    ["unnamed system", "ParticleSystem x 1 {\n}\n", "Must name particle system"],
    ["no version", 'ParticleSystem "x" y {\n}\n', "Must have version number"],
    ["no brace", 'ParticleSystem "x" 1 y\n}\n', "Missing opening brace for ParticleSystem block"],
    ["not a sequence", 'ParticleSystem "x" 1 {\nfoo\n}\n', 'Unexpected "FOO" in Particle System Block!'],
    ["file ends in the system block", 'ParticleSystem "x" 1 {', "Unexpected end-of-file."],
    ["file ends inside a sequence", 'ParticleSystem "x" 1 {\nEventSequence "s" {\nLayer', "Unexpected end-of-file."],
    // a string that ends the file is repeated like any last token, so the parser finds a second string where it wants the brace
    ["file ends after the sequence name", 'ParticleSystem "x" 1 {\nEventSequence "s"', "Expected opening brace for particle sequence block!"],
    ["file ends inside an event", 'ParticleSystem "x" 1 {\nEventSequence "s" {\nAt 1 Scale =', "Unexpected end-of-file."],
    ["unnamed sequence", 'ParticleSystem "x" 1 {\nEventSequence s {\n}\n}\n', "Must name particle sequence block!"],
    ["sequence without brace", 'ParticleSystem "x" 1 {\nEventSequence "s" foo\n}\n}\n', "Expected opening brace for particle sequence block!"],
  ];
  for (const [title, text, message] of cases) {
    test(title, () => {
      const e = errorOf(text);
      expect(e.message).toBe(message);
      expect(e.script).toBe("particle");
      expect(e.name).toBe("EffectScriptError");
    });
  }

  const inSeq: [string, string, string][] = [
    ["missing equals sign", "Layer 5", "Expected equals sign!"],
    ["number expected", "Layer = foo", "Expecting either Random(...) or a number value."],
    ["Random without paren", "Layer = Random 1", "Expecting opening paren after Random keyword."],
    ["Random first number", "Layer = Random(x, 1)", "Expecting first number within Random(...)."],
    ["Random comma", "Layer = Random(1 2)", "Expecting comma within Random(...)."],
    ["Random second number", "Layer = Random(1, x)", "Expecting second number within Random(...)."],
    ["Random close paren", "Layer = Random(1, 2 }", "Missing close paren on Random(...)."],
    ["XYZ expected", "Gravity = 5", "Expecting XYZ(...)!"],
    ["XYZ paren", "Gravity = XYZ 1", "Expecting ( after XYZ!"],
    ["XYZ comma", "Gravity = XYZ(1 2, 3)", "Vector components must be seperated by a comma."],
    ["XYZ second comma", "Gravity = XYZ(1, 2 3)", "Vector components must be seperated by a comma."],
    ["XYZ close", "Gravity = XYZ(1, 2, 3 4)", "Expecting ) to close vector."],
    ["XYZ short", "Gravity = XYZ(1, 2)", "Vector components must be seperated by a comma."],
    ["RGBA expected", "Initial Color = 5", "Expecting RGBA(...)!"],
    ["RGBA paren", "Initial Color = RGBA 1", "Expecting ( after RGBA!"],
    ["RGBA comma", "Initial Color = RGBA(1 2, 3, 4)", "Color components must be seperated by a comma."],
    ["XY expected", "Initial Tex0UV = 5", "Expecting XY(...)!"],
    ["XY paren", "Initial Tex1UV = XY 1", "Expecting ( after XY!"],
    ["events use their own equals message", "Initial Size 5", "Expecting = after property."],
    ["texture uses the sequence one", "Initial Texture 5", "Expected equals sign!"],
    ["texture needs a string", "Initial Texture = 5", "Expected filename after texture sequence property."],
    ["bool", "Trace = maybe", "Invalid bool!"],
    ["blend mode token", "SourceBlendMode = foo", "Expecting alpha blend mode (D3DBLEND_ZERO, D3DBLEND_ONE, etc.)."],
    ["blend mode name", "DestBlendMode = D3DBLEND_BOGUS", "Invalid alpha blending mode!"],
    ["cull mode token", "CullMode = foo", "Expecting cull mode (D3DCULL_NONE, D3DCULL_CCW, etc.)."],
    ["cull mode name", "CullMode = D3DCULL_BOGUS", "Invalid cull mode!"],
    ["particle type", "ParticleType = PT_BOGUS", "Invalid particle type!"],
    ["mesh render type", "MeshRenderType = RT_ADD_CARTOON", "Invalid mesh render type!"],
    ["mesh render type 2", "MeshRenderType = RT_LIGHT_FLOW_WORLD_X", "Invalid mesh render type!"],
    ["billboard", "BillboardType = BT_BOGUS", "Invalid billboard type!"],
    ["unexpected word", "foo", 'S, Unexpected "FOO" in Sequence Block!'],
    ["unexpected number", "5", 'S, Unexpected "5" in Sequence Block!'],
    ["no spaces around =", "Layer=14", 'S, Unexpected "LAYER=14" in Sequence Block!'],
    ["an event property without a time", "Size = XYZ(1, 1, 1)", 'S, Unexpected "SIZE" in Sequence Block!'],
    ["fade without so", "Fade At 1 Scale = 1", 'Expecting "so" after "fade".'],
    ["from without a number", "From Scale = 1", "Expecting either Random(...) or a number value."],
    ["from without to", "From 1 Scale = 1", 'Expecting "To" after "From".'],
    ["from number without to", "From 1 2 Scale = 1", 'Expecting "To" after "From".'],
    ["at without number", "At Scale = 1", "Expecting either Random(...) or a number value."],
    ["time specifier expected", "To 1 Scale = 1", 'Expected time specifier: "[fade so] at", "initial", or "[fade so] final"'],
    ["fade so then nothing", "Fade so Scale = 1", 'Expected time specifier: "[fade so] at", "initial", or "[fade so] final"'],
    ["property expected after the time", "Initial foo = 1", "S, Expecting particle property after time specifier!"],
    ["sequence property after time", "Initial Layer = 1", "S, Expecting particle property after time specifier!"],
  ];
  for (const [title, body, message] of inSeq) {
    test(title, () => {
      // a sequence named S inside a system; the closing braces come after the body, so some cases end in the middle of the construct
      expect(msg(body)).toBe(message);
    });
  }

  test("the sequence name in the two messages that print it is the name written in the file", () => {
    expect(errorOf(sys(seq("foo", "My Seq"))).message).toBe('My Seq, Unexpected "FOO" in Sequence Block!');
  });

  test("the error knows its position (token index)", () => {
    const e = errorOf(sys(seq("Layer = 1\nfoo")));
    expect(e.tokenIndex).toBeGreaterThan(8);
    expect(e.script).toBe("particle");
  });
});

describe("ParticleLibrary", () => {
  test("a later sequence of the same name replaces the earlier one, in the same file or across files", () => {
    const a = parse(seq("Layer = 1", "A") + "\n" + seq("Layer = 2", "B"));
    const b = parse(seq("Layer = 3", "B") + "\n" + seq("Layer = 4", "C") + "\n" + seq("Layer = 5", "C"));
    const lib = new ParticleLibrary();
    lib.add(a);
    expect(lib.replaced).toEqual([]);
    lib.add(b);
    expect([...lib.sequences.keys()]).toEqual(["A", "B", "C"]);
    expect(lib.get("A")!.layer).toBe(1);
    expect(lib.get("B")!.layer).toBe(3);
    expect(lib.get("C")!.layer).toBe(5);
    expect(lib.replaced).toEqual(["B", "C"]);
  });

  test("names are case-sensitive", () => {
    const lib = new ParticleLibrary();
    lib.add(parse(seq("Layer = 1", "Fire") + "\n" + seq("Layer = 2", "fire")));
    expect(lib.get("Fire")!.layer).toBe(1);
    expect(lib.get("fire")!.layer).toBe(2);
    expect(lib.get("FIRE")).toBeUndefined();
    expect(lib.replaced).toEqual([]);
  });
});

// excerpts of the shipped GameMajorParticle.txt (tabs and all)
const GAME_FIGHT = `\teventsequence "GameFight"
\t{
\t\tparticleType\t\t= PT_2D_PLANE
\t\tLifetime\t\t\t= 1.500
\t\tNumParticles\t\t= 1
\t\tLayer\t\t\t\t= 21
\t\tEmitradius\t\t\t= XYZ(-300, 400, 0)
\t\tBillBoardType\t\t= BT_ALL
\t\tSourceBlendMode\t= D3DBLEND_SRCALPHA
\t\tDestBlendMode\t= D3DBLEND_INVSRCALPHA
\t\tResolutionConvert\t= TRUE

\t\tInitial\t\t\t\t\t\tTexture = "HQ_Fight.dds"
\t\tInitial\t\t\t\t\t\tSize = XYZ(512, 512, 1)
\t\tInitial\t\t\t\t\t\tPosition = XYZ(-300, 400, 0)
\t\tFade so From 0.000 to 0.300\tPosition = XYZ(512, 400, 0)
\t\tFade so From 0.800 to 1.000\tPosition = XYZ(1600, 400, 0)
\t}`;
const FLARE = `\teventsequence "Flare_Nasod_Diriler_Cannon_HyperCannon02"
\t{
\t\tparticleType\t\t= PT_3D_PLANE
\t\tEmitrate\t\t\t= 20
\t\tLifetime\t\t\t= 0.700
\t\tNumParticles\t\t= 80
\t\tTriggerTime\t\t\t= 0.750
\t\tLayer\t\t\t\t= 14
\t\tEmitradius\t\t\t= XYZ(random(-5, 5), random(-5, 5), random(-5, 5))
\t\tBillBoardType\t\t= BT_ALL
\t\tSourceBlendMode\t= D3DBLEND_SRCALPHA
\t\tDestBlendMode\t= D3DBLEND_DESTALPHA

\t\tInitial\t\t\t\t\t\tTexture = "ColorBallFire.dds"
\t\tInitial\t\t\t\t\t\tColor = RGBA(1, 0.600, 0.400, 1)
\t\tFade so From 0.300 to 0.700\tColor = RGBA(1, 0, 0, 0)
\t\tInitial\t\t\t\t\t\tSize = XYZ(random(150, 200), random(150, 200), 1)
\t\tFade so From 0.300 to 0.700\tSize = XYZ(random(0, 30), random(0, 30), 1)
\t}`;
const AIR_BLAST = `\teventsequence "ArmeAirBlastCenter"
\t{
\t\tparticleType\t\t= PT_3D_PLANE
\t\tEmitrate\t\t\t= random(10, 20)
\t\tLifetime\t\t\t= random(0.100, 0.300)
\t\tNumParticles\t\t= 10
\t\tTriggerTime\t\t\t= 0.400
\t\tDrawCount\t\t\t= 2
\t\tLayer\t\t\t\t= 14
\t\tBillBoardType\t\t= BT_ALL
\t\tSourceBlendMode\t= D3DBLEND_SRCALPHA
\t\tDestBlendMode\t= D3DBLEND_DESTALPHA

\t\tInitial\t\t\t\t\t\tTexture = "Arme_Critical2.dds"
\t\tInitial\t\t\t\t\t\tColor = RGBA(1, 1, 1, 1)
\t\tFade so From 0.000 to 0.300\tColor = RGBA(1, 1, 1, 0.300)
\t\tInitial\t\t\t\t\t\tSize = XYZ(500, 500, 1)
\t\tFade so From 0.000 to 0.300\tSize = XYZ(0, 0, 1)
\t\tInitial\t\t\t\t\t\tRotate = XYZ(0, 0, random(0, 360))
\t}`;

describe("excerpts of the shipped GameMajorParticle.txt", () => {
  const file = (...blocks: string[]): ParticleSequence[] => parseParticleScript(enc(`ParticleSystem "GameMajor" 1.00\r\n{\r\n${blocks.join("\r\n")}\r\n}\r\n`.replaceAll("\n", "\r\n").replaceAll("\r\r\n", "\r\n"))).sequences;

  test("GameFight: a 2D plane with a texture and two fading position events", () => {
    const [q] = file(GAME_FIGHT);
    expect(q!.name).toBe("GameFight");
    expect([q!.particleType, q!.layer, q!.maxParticleNum, q!.billboardType, q!.srcBlendMode, q!.destBlendMode, q!.resolutionConvert]).toEqual([1, 21, 1, 1, 5, 6, true]);
    expect(q!.lifetime).toEqual({ min: 1.5, max: 1.5 });
    expect(q!.emitRadius).toEqual({ min: [-300, 400, 0], max: [-300, 400, 0] });
    expect(q!.events).toEqual([
      { kind: "texture", fade: false, time: { min: 0, max: 0 }, value: "HQ_Fight.dds" },
      { kind: "size", fade: false, time: { min: 0, max: 0 }, value: { min: [512, 512, 1], max: [512, 512, 1] } },
      { kind: "position", fade: false, time: { min: 0, max: 0 }, value: { min: [-300, 400, 0], max: [-300, 400, 0] } },
      { kind: "position", fade: true, time: { min: 0, max: f(0.3) }, value: { min: [512, 400, 0], max: [512, 400, 0] } },
      { kind: "position", fade: true, time: { min: f(0.8), max: 1 }, value: { min: [1600, 400, 0], max: [1600, 400, 0] } },
    ]);
  });

  test("Flare_Nasod_Diriler_Cannon_HyperCannon02: Random components, RGBA, fade so", () => {
    const [q] = file(FLARE);
    expect(q!.emitRate).toEqual({ min: 20, max: 20 });
    expect(q!.triggerTime).toEqual({ min: 0.75, max: 0.75 });
    expect(q!.maxParticleNum).toBe(80);
    expect(q!.emitRadius).toEqual({ min: [-5, -5, -5], max: [5, 5, 5] });
    expect(q!.destBlendMode).toBe(7);
    expect(q!.events.length).toBe(5);
    expect(q!.events[1]).toEqual({ kind: "color", fade: false, time: { min: 0, max: 0 }, value: { min: [1, f(0.6), f(0.4), 1], max: [1, f(0.6), f(0.4), 1] } });
    expect(q!.events[2]).toEqual({ kind: "color", fade: true, time: { min: f(0.3), max: f(0.7) }, value: { min: [1, 0, 0, 0], max: [1, 0, 0, 0] } });
    expect(q!.events[3]!.value).toEqual({ min: [150, 150, 1], max: [200, 200, 1] });
    expect(q!.events[4]!.value).toEqual({ min: [0, 0, 1], max: [30, 30, 1] });
  });

  test("ArmeAirBlastCenter: ranges for EmitRate and Lifetime, DrawCount, a random rotation", () => {
    const [q] = file(AIR_BLAST);
    expect(q!.emitRate).toEqual({ min: 10, max: 20 });
    expect(q!.lifetime).toEqual({ min: f(0.1), max: f(0.3) });
    expect(q!.drawCount).toEqual({ min: 2, max: 2 });
    expect(q!.events[5]).toEqual({ kind: "rotate", fade: false, time: { min: 0, max: 0 }, value: { min: [0, 0, 0], max: [0, 0, 360] } });
  });

  test("the three excerpts together, CR LF line ends: 3 sequences, the repeated last token is left over", () => {
    const text = `ParticleSystem "GameMajor" 1.00\r\n{\r\n${[GAME_FIGHT, FLARE, AIR_BLAST].join("\r\n")}\r\n}\r\n`.replaceAll("\n", "\r\n").replaceAll("\r\r\n", "\r\n");
    const s = parseParticleScript(enc(text));
    expect(s.sequences.map((q) => q.name)).toEqual(["GameFight", "Flare_Nasod_Diriler_Cannon_HyperCannon02", "ArmeAirBlastCenter"]);
    expect([s.stats.blocks, s.stats.properties, s.stats.events]).toEqual([3, 9 + 10 + 10, 5 + 5 + 6]);
    expect(s.stats.tokens - s.stats.tokensRead).toBe(1);
  });
});
