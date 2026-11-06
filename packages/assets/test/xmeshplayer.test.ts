import { describe, expect, test } from "bun:test";
import {
  EffectScriptError, RENDER_TYPES, XMESH_EVENT_TYPES, XMeshLibrary, newXMeshTemplet, parseXMeshPlayerScript,
} from "../src/index.ts";
import type { XMeshTemplet } from "../src/index.ts";

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const f = Math.fround;

const sys = (body: string): string => `XMeshPlayer "T" 1.00 {\n${body}\n}\n`;
const templet = (body: string, name = "T1"): string => `Templet "${name}" {\n${body}\n}`;
const parse = (body: string) => parseXMeshPlayerScript(enc(sys(body)));
const one = (body: string): XMeshTemplet => parse(templet(body)).templets[0]!;
const errorOf = (text: string): EffectScriptError => {
  try {
    parseXMeshPlayerScript(enc(text));
  } catch (e) {
    if (e instanceof EffectScriptError) return e;
    throw e;
  }
  throw new Error("expected an EffectScriptError");
};
const msg = (body: string): string => errorOf(sys(templet(body))).message;

describe("xmeshplayer script: structure", () => {
  test("system header and templet blocks, keywords in any case", () => {
    const s = parseXMeshPlayerScript(enc('xmeshplayer "UIMajor" 1.5 {\ntemplet "a" {\n}\nTEMPLET "b" {\n}\n}\n'));
    expect(s.name).toBe("UIMajor");
    expect(s.version).toBe(1.5);
    expect(s.templets.map((t) => t.name)).toEqual(["a", "b"]);
    expect([s.stats.blocks, s.stats.properties, s.stats.events]).toEqual([2, 0, 0]);
    expect(s.stats.tokens - s.stats.tokensRead).toBe(1);
  });

  test("only the first system block is read", () => {
    const text = sys(templet("Layer = 1", "x")) + 'XMeshPlayer "B" 1 {\n' + templet("Layer = 2", "y") + "\n}\n";
    expect(parseXMeshPlayerScript(enc(text)).templets.map((t) => t.name)).toEqual(["x"]);
  });

  test("a templet may be empty (the shipped UIMinorXMeshPlayer.txt is one)", () => {
    const t = one("");
    expect(t).toEqual(newXMeshTemplet("T1"));
  });
});

describe("xmeshplayer script: templet defaults and properties", () => {
  test("the constructor's defaults", () => {
    const t = one("");
    expect([t.lifeType, t.dieType, t.meshType]).toEqual([0, 0, 1]); // LT_PLAY_COUNT, LT_PLAY_COUNT, X_SKIN_MESH
    expect([t.srcBlend, t.destBlend]).toEqual([5, 6]); // SRCALPHA, INVSRCALPHA
    expect([t.cullMode, t.billboardType, t.renderType, t.cartoonTexType]).toEqual([1, 0, 0, 0]);
    expect(t.drawCount).toEqual({ min: 1, max: 1 });
    expect(t.elasticCoeff).toEqual({ min: 0.5, max: 0.5 });
    expect([t.zEnable, t.zWriteEnable, t.applyUnitScale]).toEqual([false, false, true]);
    expect([t.useDieEvent, t.useLand, t.crashLand, t.setLandHeightOnStart, t.useSlashTrace, t.forceLayer, t.alphaTestEnable]).toEqual([false, false, false, false, false, false, false]);
    expect([t.layer, t.slashTraceType, t.slashTraceCurveType, t.notCheckLandTime]).toEqual([0, 0, 0, 0]);
    expect([t.globalEvents, t.animEvents, t.dieEvents]).toEqual([[], [], []]);
  });

  test("numeric properties: ranges as written, int fields take (int) of both ends or of the max", () => {
    const t = one(`
      PlayCount = Random(1.9, 3.1)
      LifeTime = 2.5
      DiePlayCount = 2.7
      DieLifeTime = Random(1, 2)
      OutlineWide = 3
      LightFlowWide = 4
      DrawCount = Random(2.5, 4.5)
      LandPos = Random(-1, 1)
      Layer = Random(1.5, 7.5)
      ElasticCoeff = 0.25
      ElasticCoeff_X = 0.75
      Slash_Trace_Type = 2.9
      Slash_Trace_Curve_Type = 1.2
      Not_Check_Land_Time = 1.5`);
    expect(t.playCount).toEqual({ min: 1, max: 3 });
    expect(t.lifeTime).toEqual({ min: 2.5, max: 2.5 });
    expect(t.diePlayCount).toEqual({ min: 2, max: 2 });
    expect(t.dieLifeTime).toEqual({ min: 1, max: 2 });
    expect(t.outLineWide).toEqual({ min: 3, max: 3 });
    expect(t.lightFlowWide).toEqual({ min: 4, max: 4 });
    expect(t.drawCount).toEqual({ min: 2, max: 4 });
    expect(t.landPosition).toEqual({ min: -1, max: 1 });
    expect(t.layer).toBe(7);
    expect(t.elasticCoeff).toEqual({ min: 0.25, max: 0.25 });
    expect(t.elasticCoeffX).toEqual({ min: 0.75, max: 0.75 });
    expect(t.slashTraceType).toBe(2);
    expect(t.slashTraceCurveType).toBe(1);
    expect(t.notCheckLandTime).toBe(1.5); // a float, not an int
    expect(one("LifeTime = 0.1").lifeTime.min).toBe(f(0.1));
  });

  test("vector, bool and string properties", () => {
    const t = one(`
      LightPos = XYZ(1, 2, 3)
      Gravity = XYZ(0, -980, Random(0, 1))
      BlackHolePos = XYZ(4, 5, 6)
      UseDieEvent = TRUE
      ZEnable = true
      ZWriteEnable = TRUE
      UseLand = TRUE
      Set_Land_Height_On_Start = TRUE
      CrashLand = TRUE
      UseSlashTrace = TRUE
      ForceLayer = TRUE
      ApplyUnitScale = FALSE
      AlphaTest = TRUE
      MeshName = "a.X"
      ChangeTexXET = "c.xet"
      MultiTexXET = "m.xet"
      AniPackage = "p.xap"
      Slash_Trace_Texture = "s.dds"`);
    expect(t.lightPos).toEqual({ min: [1, 2, 3], max: [1, 2, 3] });
    expect(t.gravity).toEqual({ min: [0, -980, 0], max: [0, -980, 1] });
    expect(t.blackHolePosition).toEqual({ min: [4, 5, 6], max: [4, 5, 6] });
    expect([t.useDieEvent, t.zEnable, t.zWriteEnable, t.useLand, t.setLandHeightOnStart, t.crashLand, t.useSlashTrace, t.forceLayer, t.applyUnitScale, t.alphaTestEnable])
      .toEqual([true, true, true, true, true, true, true, true, false, true]);
    expect([t.meshName, t.changeTexXETName, t.multiTexXETName, t.aniXETName, t.slashTraceTextureName]).toEqual(["a.X", "c.xet", "m.xet", "p.xap", "s.dds"]);
  });

  test("enumerations: LT_*, X_*MESH, BT_*, D3DCULL_*, CTT_*, D3DBLEND_*", () => {
    expect(["LT_PLAY_COUNT", "LT_TIME", "LT_MANUAL"].map((n) => one(`LifeType = ${n}`).lifeType)).toEqual([0, 1, 2]);
    expect(["LT_PLAY_COUNT", "LT_TIME", "LT_MANUAL"].map((n) => one(`DieType = ${n}`).dieType)).toEqual([0, 1, 2]);
    expect(["X_MESH", "X_SKIN_MESH"].map((n) => one(`MeshType = ${n}`).meshType)).toEqual([0, 1]);
    expect(["BT_NONE", "BT_ALL", "BT_X", "BT_Y", "BT_Z"].map((n) => one(`BillboardType = ${n}`).billboardType)).toEqual([0, 1, 2, 3, 4]);
    expect(["D3DCULL_NONE", "D3DCULL_CW", "D3DCULL_CCW"].map((n) => one(`CullMode = ${n}`).cullMode)).toEqual([1, 2, 3]);
    expect(["CTT_NORMAL", "CTT_RED"].map((n) => one(`CartoonTexType = ${n}`).cartoonTexType)).toEqual([0, 1]);
    expect(one("SourceBlendMode = D3DBLEND_ONE\nDestBlendMode = D3DBLEND_INVBLENDFACTOR")).toMatchObject({ srcBlend: 2, destBlend: 15 });
  });

  test("RenderType accepts 16 of the 19 RT_* names (RT_ADD_CARTOON* are refused), RENDER_TYPE events likewise", () => {
    const accepted = Object.entries(RENDER_TYPES).filter(([n]) => !n.startsWith("RT_ADD_CARTOON"));
    expect(accepted.length).toBe(16);
    for (const [n, v] of accepted) {
      expect(one(`RenderType = ${n}`).renderType).toBe(v);
      expect((one(`Global Initial Render_Type = ${n}`).globalEvents[0]!.value as number)).toBe(v);
    }
    for (const n of ["RT_ADD_CARTOON", "RT_ADD_CARTOON_BLACK_EDGE", "RT_ADD_CARTOON_COLOR_EDGE"]) {
      expect(msg(`RenderType = ${n}`)).toBe("Invalid RenderType!");
      expect(msg(`Global Initial Render_Type = ${n}`)).toBe("Invalid RenderType!");
    }
  });

  test("the last write wins, names are case-insensitive", () => {
    const t = one("MESHNAME = \"a\"\nmeshname = \"b\"\nlayer = 3\nLAYER = 4");
    expect([t.meshName, t.layer]).toEqual(["b", 4]);
  });

  test("properties are counted in the statistics", () => {
    const s = parse(templet("Layer = 1\nPlayCount = 1\nGlobal Initial AniSpeed = 1\nAnim at 1 SlashTrace = TRUE\nDie initial Size = XYZ(1, 1, 1)", "a") + "\n" + templet("Layer = 3", "b"));
    expect([s.stats.blocks, s.stats.properties, s.stats.events]).toEqual([2, 3, 3]);
  });
});

describe("xmeshplayer script: events", () => {
  test("every event kind with the shape of its value", () => {
    const t = one(`
      Global Initial AniName = "walk", XAP_LOOP
      Global Initial AniSpeed = 0.6
      Global Initial DirSpeed = 1
      Global Initial BlackHoleTime = 2
      Global Initial ResetCrash = 3
      Global Initial LightFlowImpact = Random(4, 5)
      Global Initial Color = RGBA(1, 0.5, 0.25, 1)
      Global Initial OutlineColor = RGBA(0, 0, 0, 1)
      Global Initial Size = XYZ(1, 2, 3)
      Global Initial Velocity = XYZ(4, 5, 6)
      Global Initial Rotate = XYZ(0, 0, Random(0, 360))
      Global Initial Crash = XYZ(7, 8, 9)
      Global Initial Position = XYZ(1, 1, 1)
      Global Initial LightFlowPoint = XYZ(2, 2, 2)
      Global Initial Tex0UV = XY(0.5, 0.25)
      Global Initial Tex1UV = XY(1, 1)
      Global Initial Tex2UV = XY(2, 2)
      Global Initial SlashTrace = TRUE
      Global Initial Render_Type = RT_CARTOON
      Global Initial Sound = "boom.ogg"`);
    const ev = t.globalEvents;
    expect(ev.map((e) => e.kind)).toEqual(["aniname", "anispeed", "dirspeed", "blackholetime", "resetcrash", "lightflowimpact", "color", "outlinecolor", "size", "velocity", "rotate", "crash", "position", "lightflowpoint", "tex0uv", "tex1uv", "tex2uv", "slashtrace", "render_type", "sound"]);
    expect(Object.keys(XMESH_EVENT_TYPES).sort()).toEqual(ev.map((e) => e.kind).sort());
    expect(ev[0]!.value).toEqual({ name: "walk", playType: 0 });
    expect(ev[1]!.value).toEqual({ min: f(0.6), max: f(0.6) });
    expect(ev[5]!.value).toEqual({ min: 4, max: 5 });
    expect(ev[6]!.value).toEqual({ min: [1, 0.5, 0.25, 1], max: [1, 0.5, 0.25, 1] });
    expect(ev[10]!.value).toEqual({ min: [0, 0, 0], max: [0, 0, 360] });
    expect(ev[14]!.value).toEqual({ min: [0.5, 0.25], max: [0.5, 0.25] });
    expect(ev[17]!.value).toBe(true);
    expect(ev[18]!.value).toBe(RENDER_TYPES.RT_CARTOON);
    expect(ev[19]!.value).toBe("boom.ogg");
    for (const e of ev) expect([e.fade, e.final, e.time]).toEqual([false, false, { min: 0, max: 0 }]);
  });

  test("the three timelines Global, Anim and Die are kept apart, each in file order", () => {
    const t = one(`
      Global Initial Size = XYZ(1, 1, 1)
      Anim Initial Size = XYZ(2, 2, 2)
      Die Initial Size = XYZ(3, 3, 3)
      Global at 1 Size = XYZ(4, 4, 4)
      anim at 1 Size = XYZ(5, 5, 5)
      DIE at 1 Size = XYZ(6, 6, 6)`);
    const first = (e: { value: unknown }): number => (e.value as { min: number[] }).min[0]!;
    expect(t.globalEvents.map(first)).toEqual([1, 4]);
    expect(t.animEvents.map(first)).toEqual([2, 5]);
    expect(t.dieEvents.map(first)).toEqual([3, 6]);
  });

  test("time specifiers: initial, at T, from A to B (Random allowed), final is a flag and keeps the time [0, 0]", () => {
    const t = one(`
      Global Initial DirSpeed = 1
      Global At 0.5 DirSpeed = 2
      Global At Random(0.1, 0.2) DirSpeed = 3
      Global From 0.2 To 0.4 DirSpeed = 4
      Global From Random(0.1, 0.2) To Random(0.3, 0.4) DirSpeed = 5
      Global Final DirSpeed = 6
      Global Fade so Final DirSpeed = 7
      Global Fade so At 0.5 DirSpeed = 8
      Global Fade so From 0 To 1 DirSpeed = 9`);
    expect(t.globalEvents.map((e) => e.time)).toEqual([
      { min: 0, max: 0 }, { min: 0.5, max: 0.5 }, { min: f(0.1), max: f(0.2) }, { min: f(0.2), max: f(0.4) }, { min: f(0.1), max: f(0.4) },
      { min: 0, max: 0 }, { min: 0, max: 0 }, { min: 0.5, max: 0.5 }, { min: 0, max: 1 },
    ]);
    expect(t.globalEvents.map((e) => e.final)).toEqual([false, false, false, false, false, true, true, false, false]);
    expect(t.globalEvents.map((e) => e.fade)).toEqual([false, false, false, false, false, false, true, true, true]);
  });

  test("AniName = \"name\", XAP_*: the play type", () => {
    const names = ["XAP_LOOP", "XAP_ONE", "XAP_ONE_WAIT"];
    expect(names.map((n) => one(`Global Initial AniName = "a b", ${n}`).globalEvents[0]!.value)).toEqual(names.map((_, i) => ({ name: "a b", playType: i })));
    expect(one("Global Initial AniName = abc, xap_one").globalEvents[0]!.value).toEqual({ name: "ABC", playType: 1 });
  });

  test("fading is refused for aniname, slashtrace, anispeed, blackholetime, resetcrash, sound and render_type", () => {
    const lines = ['AniName = "a", XAP_ONE', "SlashTrace = TRUE", "AniSpeed = 1", "BlackHoleTime = 1", "ResetCrash = 1", 'Sound = "a.ogg"', "Render_Type = RT_CARTOON"];
    for (const l of lines) expect(msg(`Global Fade so At 1 ${l}`)).toBe("Fading is not supported on this event.");
    for (const l of lines) expect(() => one(`Global At 1 ${l}`)).not.toThrow();
    for (const l of ["DirSpeed = 1", "LightFlowImpact = 1", "Color = RGBA(1, 1, 1, 1)", "OutlineColor = RGBA(1, 1, 1, 1)", "Size = XYZ(1, 1, 1)", "Tex0UV = XY(1, 1)"]) {
      expect(() => one(`Global Fade so At 1 ${l}`)).not.toThrow();
    }
  });

  test("a templet property after the first event is an error", () => {
    const m = "Cannot specify any sequence properties after specifying events.";
    for (const l of ["Layer = 1", 'MeshName = "a"', "LifeType = LT_TIME", "MeshType = X_MESH", "CullMode = D3DCULL_CW", "RenderType = RT_CARTOON", "BillboardType = BT_X", "CartoonTexType = CTT_RED", "Gravity = XYZ(0, 0, 0)", "ZEnable = TRUE", "SourceBlendMode = D3DBLEND_ONE"]) {
      expect(msg(`Global Initial DirSpeed = 1\n${l}`)).toBe(m);
    }
  });
});

describe("xmeshplayer script: errors carry the exe's text", () => {
  const top: [string, string, string][] = [
    ["empty file", "", "This script is too small to be valid."],
    ["first word", 'ParticleSystem "x" 1 {\n}\n', "First word must be XMeshPlayer"],
    ["unnamed system", "XMeshPlayer x 1 {\n}\n", "Must name XMeshPlayer"],
    ["no version", 'XMeshPlayer "x" y {\n}\n', "Must have version number"],
    ["no brace", 'XMeshPlayer "x" 1 y\n}\n', "Missing opening brace for XMeshPlayer block"],
    ["not a templet", 'XMeshPlayer "x" 1 {\nfoo\n}\n', 'Unexpected "FOO" in XMeshPlayer Block!'],
    ["unnamed templet", 'XMeshPlayer "x" 1 {\nTemplet t {\n}\n}\n', "Must name Templet block!"],
    ["templet without brace", 'XMeshPlayer "x" 1 {\nTemplet "t" foo\n}\n}\n', "Expected opening brace for Templet block!"],
    ["file ends inside a templet", 'XMeshPlayer "x" 1 {\nTemplet "t" {\nLayer', "Unexpected end-of-file."],
  ];
  for (const [title, text, message] of top) {
    test(title, () => {
      const e = errorOf(text);
      expect(e.message).toBe(message);
      expect(e.script).toBe("xmeshplayer");
    });
  }

  const inside: [string, string, string][] = [
    ["missing equals sign", "Layer 5", "Expected equals sign!"],
    ["number expected", "Layer = foo", "Expecting either Random(...) or a number value."],
    ["vector expected", "Gravity = 5", "Expecting XYZ(...)!"],
    ["bool", "ZEnable = maybe", "Invalid bool!"],
    ["life type", "LifeType = LT_BOGUS", "Invalid LifeType!"],
    ["die type", "DieType = lt_forever", "Invalid LifeType!"],
    ["mesh type", "MeshType = X_BOGUS", "Invalid MeshType!"],
    ["cartoon tex type: the enum has more names than the script accepts", "CartoonTexType = CTT_SCARLET", "Invalid cartoonTexType!"],
    ["cull mode", "CullMode = D3DCULL_BOGUS", "Invalid cullMode!"],
    ["cull mode FORCE_DWORD is not accepted here", "CullMode = D3DCULL_FORCE_DWORD", "Invalid cullMode!"],
    ["billboard", "BillboardType = BT_BOGUS", "Invalid billboard type!"],
    ["render type", "RenderType = RT_BOGUS", "Invalid RenderType!"],
    ["blend mode token", "SourceBlendMode = foo", "Expecting alpha blend mode (D3DBLEND_ZERO, D3DBLEND_ONE, etc.)."],
    ["blend mode name", "DestBlendMode = D3DBLEND_BOGUS", "Invalid alpha blending mode!"],
    ["unexpected word", "foo", 'Unexpected "FOO" in Sequence Block!'],
    ["an event without a track keyword", "Initial Size = XYZ(1, 1, 1)", 'Unexpected "INITIAL" in Sequence Block!'],
    ["an event property without a time", "Size = XYZ(1, 1, 1)", 'Unexpected "SIZE" in Sequence Block!'],
    ["no time specifier", "Global Size = XYZ(1, 1, 1)", 'Expected time specifier: "[fade so] at", "initial", or "[fade so] final"'],
    ["fade without so", "Global Fade At 1 DirSpeed = 1", 'Expecting "so" after "fade".'],
    ["fade so initial", "Global Fade so Initial DirSpeed = 1", 'Cannot use "fade so" modifier on "initial" times.'],
    ["from without to", "Global From 1 DirSpeed = 1", 'Expecting "To" after "From".'],
    ["at without number", "Global At DirSpeed = 1", "Expecting either Random(...) or a number value."],
    ["property expected after the time", "Global Initial foo = 1", "Expecting meshPlayer property after time specifier!"],
    ["a templet property after the time", "Global Initial Layer = 1", "Expecting meshPlayer property after time specifier!"],
    ["events use their own equals message", "Global Initial Size 5", "Expecting = after property."],
    ["aniname uses the templet one", "Global Initial AniName 5", "Expected equals sign!"],
    ["aniname needs a comma", 'Global Initial AniName = "a" XAP_ONE', "Expected comma sign!"],
    ["aniname play type", 'Global Initial AniName = "a", XAP_BOGUS', "Invalid AniName!"],
    ["color", "Global Initial Color = XYZ(1, 1, 1)", "Expecting RGBA(...)!"],
    ["vector2", "Global Initial Tex0UV = XYZ(1, 1, 1)", "Expecting XY(...)!"],
    ["slash trace bool", "Global Initial SlashTrace = 5", "Invalid bool!"],
    ["TextureChange is classified as an event property but the factory has no class for it", 'Global Initial TextureChange = "a.dds"', "Unknown event type, or there was an error creating this event."],
  ];
  for (const [title, body, message] of inside) {
    test(title, () => {
      expect(msg(body)).toBe(message);
    });
  }
});

describe("XMeshLibrary", () => {
  test("a later templet of the same name replaces the earlier one, in the same file or across files", () => {
    const a = parse(templet("Layer = 1", "A") + "\n" + templet("Layer = 2", "B"));
    const b = parse(templet("Layer = 3", "B") + "\n" + templet("Layer = 4", "C") + "\n" + templet("Layer = 5", "C"));
    const lib = new XMeshLibrary();
    lib.add(a);
    lib.add(b);
    expect([...lib.templets.keys()]).toEqual(["A", "B", "C"]);
    expect([lib.get("A")!.layer, lib.get("B")!.layer, lib.get("C")!.layer]).toEqual([1, 3, 5]);
    expect(lib.replaced).toEqual(["B", "C"]);
    expect(lib.get("b")).toBeUndefined();
  });
});

// excerpts of the shipped GameMajorXMeshPlayer.txt
const crlf = (s: string): string => s.replaceAll("\n", "\r\n");
const AISHA = `\tTEMPLET "AishaLightningBolt"
\t{
\t\tMeshName\t\t= "Arme_SpecialAttack_LightningBolts2a-0.X"
\t\tLifeType\t\t= LT_PLAY_COUNT
\t\tMeshType\t\t= X_SKIN_MESH
\t\tBillBoardType\t= BT_NONE
\t\tSourceBlendMode\t= D3DBLEND_SRCALPHA
\t\tDestBlendMode\t= D3DBLEND_DESTALPHA
\t\tLayer\t\t\t= 14
\t\tPlayCount\t\t= 1

\t\tGlobal Initial\t\t\t\t\t\tAniSpeed = 0.600
\t\tGlobal Initial\t\t\t\t\t\tAniName = "LightningBolts2a-0", XAP_ONE
\t}`;
const STEAL = `\tTEMPLET "STEAL_SOUL_FX"
\t{
\t\tMeshName\t\t= "Effect_ElSword_MegaSlashBackDust.X"
\t\tLifeType\t\t= LT_PLAY_COUNT
\t\tMeshType\t\t= X_SKIN_MESH
\t\tBillBoardType\t= BT_NONE
\t\tSourceBlendMode\t= D3DBLEND_SRCALPHA
\t\tDestBlendMode\t= D3DBLEND_INVSRCALPHA
\t\tLayer\t\t\t= 14
\t\tPlayCount\t\t= 1

\t\tGlobal Initial\t\t\t\t\t\tAniName = "MegaSlashBackDust", XAP_ONE
\t\tGlobal Initial\t\t\t\t\t\tVelocity = XYZ(-1000, 0, 0)
\t\tGlobal Initial\t\t\t\t\t\tSize = XYZ(1, 1, 1)
\t\tGlobal Fade so From 0.500 to 1.000\tSize = XYZ(0.200, 0.200, 0.200)
\t\tGlobal Fade so From 1.000 to 1.500\tSize = XYZ(0, 0, 0)
\t}`;

describe("excerpts of the shipped GameMajorXMeshPlayer.txt", () => {
  const file = (...blocks: string[]) => parseXMeshPlayerScript(enc(crlf(`XMeshPlayer "GameMajor" 1.00\n{\n${blocks.join("\n")}\n}\n`)));

  test("AishaLightningBolt: a skin mesh played once with an animation and a speed", () => {
    const t = file(AISHA).templets[0]!;
    expect(t.name).toBe("AishaLightningBolt");
    expect(t.meshName).toBe("Arme_SpecialAttack_LightningBolts2a-0.X");
    expect([t.lifeType, t.meshType, t.billboardType, t.srcBlend, t.destBlend, t.layer]).toEqual([0, 1, 0, 5, 7, 14]);
    expect(t.playCount).toEqual({ min: 1, max: 1 });
    expect(t.globalEvents).toEqual([
      { kind: "anispeed", fade: false, final: false, time: { min: 0, max: 0 }, value: { min: f(0.6), max: f(0.6) } },
      { kind: "aniname", fade: false, final: false, time: { min: 0, max: 0 }, value: { name: "LightningBolts2a-0", playType: 1 } },
    ]);
    expect(t.animEvents).toEqual([]);
    expect(t.dieEvents).toEqual([]);
  });

  test("STEAL_SOUL_FX: velocity, size and two fading size events", () => {
    const t = file(STEAL).templets[0]!;
    expect(t.destBlend).toBe(6);
    expect(t.globalEvents.map((e) => [e.kind, e.fade, e.time.min, e.time.max])).toEqual([
      ["aniname", false, 0, 0], ["velocity", false, 0, 0], ["size", false, 0, 0], ["size", true, 0.5, 1], ["size", true, 1, 1.5],
    ]);
    expect(t.globalEvents[1]!.value).toEqual({ min: [-1000, 0, 0], max: [-1000, 0, 0] });
    expect(t.globalEvents[3]!.value).toEqual({ min: [f(0.2), f(0.2), f(0.2)], max: [f(0.2), f(0.2), f(0.2)] });
    expect(t.globalEvents[4]!.value).toEqual({ min: [0, 0, 0], max: [0, 0, 0] });
  });

  test("both excerpts in one CR LF file", () => {
    const s = file(AISHA, STEAL);
    expect(s.templets.map((t) => t.name)).toEqual(["AishaLightningBolt", "STEAL_SOUL_FX"]);
    expect([s.stats.blocks, s.stats.properties, s.stats.events]).toEqual([2, 8 + 8, 2 + 5]);
    expect(s.stats.tokens - s.stats.tokensRead).toBe(1);
  });
});
