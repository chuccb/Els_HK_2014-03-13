import { describe, expect, test } from "bun:test";
import { call, index, LuaError, LuaNative, LuaTable, LuaUserdata, tostr, utf8ToLua } from "@els/lua";
import type { LuaValue } from "@els/lua";
import { HostWorld, Vec3 } from "@els/host";
import { matInverse, matLookAtLH, vec3Normalize } from "@els/d3d9";
import { CameraData, CKTDGLineMap, LCT, LDO, LDT, LineData, LT, sortTriggerSegments, StartInfo } from "../src/index.ts";
import type { TriggerSegment } from "../src/index.ts";

const f = Math.fround;
/** -0 is 0 (the sign of a zero that the D3DX inverse gives is not specified: see `CKTDGLineMap.makeLine`) */
const z = (v: number): number => v + 0;

/**
 * The line map is driven the way a script drives it: through the binder (`g_pLineMap:AddLine_LUA{ ... }`), so a table argument is read by
 * `KLuaManager(L, 1, false)` from the stack of the native call, a `D3DXVECTOR3` is a userdata and a missing key is a missing key.
 */
function setup() {
  const world = new HostWorld({ readScript: () => undefined, notPorted: "throw" });
  const { rt, G } = world;
  rt.registerImpl("CKTDGLineMap", CKTDGLineMap);
  const map = new CKTDGLineMap({ world });
  const obj = rt.pushObject(map, "CKTDGLineMap");
  const L = G.main;
  const m = (name: string, ...args: LuaValue[]): LuaValue[] => call(L, index(L, obj, name), [obj, ...args]);
  const vec = (x: number, y: number, z: number): LuaValue => call(L, G.globals.getStr("D3DXVECTOR3"), [x, y, z])[0];
  const addLine = (fields: Record<string, LuaValue>, start = [0, 0, 0], end = [100, 0, 0]): boolean =>
    m("AddLine_LUA", table({ START_POS: vec(start[0]!, start[1]!, start[2]!), END_POS: vec(end[0]!, end[1]!, end[2]!), ...fields }))[0] as boolean;
  return { world, rt, G, L, map, obj, m, vec, addLine };
}
function table(entries: Record<string, LuaValue>): LuaTable {
  const t = new LuaTable();
  for (const [k, v] of Object.entries(entries)) t.setStr(k, v);
  return t;
}
/** a table that answers every key with nil and writes the keys down (what the exe asks for, in its order) */
function recordingTable(answer: (key: string) => LuaValue = () => undefined): { table: LuaTable; reads: string[] } {
  const reads: string[] = [];
  const t = new LuaTable();
  const mt = new LuaTable();
  mt.setStr("__index", new LuaNative("record", (_L, a) => {
    const key = tostr(a[1])!;
    reads.push(key);
    return [answer(key)];
  }));
  t.metatable = mt;
  return { table: t, reads };
}
const vecOf = (v: LuaValue): number[] => ((v as LuaUserdata).data as Vec3).toArray();

/** every member of a line, as plain data (a -0 is 0) */
function snapshot(l: LineData): Record<string, unknown> {
  const v3 = (v: Vec3) => v.toArray().map(z);
  return {
    lineIndex: l.lineIndex, lineType: l.lineType, bEnable: l.bEnable, eDustType: l.eDustType, potalGroup: l.potalGroup, fStopFactor: l.fStopFactor,
    bCanDown: l.bCanDown, beforeLine: l.beforeLine, nextLine: l.nextLine, startPos: v3(l.startPos), endPos: v3(l.endPos), m_vPosMin: v3(l.m_vPosMin),
    m_vPosMax: v3(l.m_vPosMax), dirVector: v3(l.dirVector), dirDegree: v3(l.dirDegree), dirRadian: v3(l.dirRadian), fLength: l.fLength,
    unspecifiedAngles: l.unspecifiedAngles, lineSet: l.lineSet, m_fSpeed: l.m_fSpeed, m_vJumpSpeed: v3(l.m_vJumpSpeed),
    m_iTeleportLineIndex: l.m_iTeleportLineIndex, m_bEnableWallJump: l.m_bEnableWallJump, m_bMonsterAllowed: l.m_bMonsterAllowed,
    m_bCanPass: l.m_bCanPass, m_iCameraIndex: l.m_iCameraIndex, m_bOtherRoadUp: l.m_bOtherRoadUp, m_fCliffHeight: l.m_fCliffHeight,
    m_bTempLineMap: l.m_bTempLineMap, m_bUnderWater: l.m_bUnderWater, m_fWaterHeight: l.m_fWaterHeight, m_fBuoyancy: l.m_fBuoyancy,
    m_fResistance: l.m_fResistance, m_fAnimSpeed: l.m_fAnimSpeed, m_fVarianceOxyen: l.m_fVarianceOxyen, m_cLineColor: l.m_cLineColor.toArray(),
    m_bForceChangeColor: l.m_bForceChangeColor, m_iTriggerId: l.m_iTriggerId, m_bFootOnLine: l.m_bFootOnLine, m_eDirection: l.m_eDirection,
    m_fKeyStopTime: l.m_fKeyStopTime, m_eLineTypeAfterClearStage: l.m_eLineTypeAfterClearStage, m_iChangeAfterClearStage: l.m_iChangeAfterClearStage,
    m_iChangeAfterClearSubStage: l.m_iChangeAfterClearSubStage, m_lineGroupID: { ...l.m_lineGroupID }, m_bIsPortalWhenActiveRaid: l.m_bIsPortalWhenActiveRaid,
  };
}

// ---- what the constructor of LineData and AddLine_LUA make of an empty table (329085C0, 329095A0), the line (0,0,0) -> (100,0,0) ------------

/** the exe's defaults: `GetValue(...) == 0` branches of AddLine_LUA, one by one */
const DEFAULT_LINE: Record<string, unknown> = {
  lineIndex: 0, lineType: LT.NORMAL, bEnable: true, eDustType: LDT.DEFALT_DUST, potalGroup: -1, fStopFactor: 1, bCanDown: true, beforeLine: -1, nextLine: -1,
  startPos: [0, 0, 0], endPos: [100, 0, 0], m_vPosMin: [0, 0, 0], m_vPosMax: [100, 0, 0], dirVector: [1, 0, 0], dirDegree: [0, 0, 0], dirRadian: [0, 0, 0],
  fLength: 100, unspecifiedAngles: false, lineSet: -1, m_fSpeed: 0, m_vJumpSpeed: [0, 0, 0], m_iTeleportLineIndex: -1, m_bEnableWallJump: false,
  m_bMonsterAllowed: true, m_bCanPass: true, m_iCameraIndex: -1, m_bOtherRoadUp: false, m_fCliffHeight: 0, m_bTempLineMap: false, m_bUnderWater: false,
  m_fWaterHeight: 0, m_fBuoyancy: f(0.6), m_fResistance: f(0.8), m_fAnimSpeed: f(0.9), m_fVarianceOxyen: -1, m_cLineColor: [0, 0, 0, 0],
  m_bForceChangeColor: false, m_iTriggerId: -1, m_bFootOnLine: true, m_eDirection: LDO.NONE, m_fKeyStopTime: 0, m_eLineTypeAfterClearStage: LT.INVALID,
  m_iChangeAfterClearStage: -1, m_iChangeAfterClearSubStage: -1, m_lineGroupID: { m_iStartLineIndex: -1, m_iEndLineIndex: -1 }, m_bIsPortalWhenActiveRaid: false,
};

/** the keys of AddLine_LUA in the order of the decompile, each with a value that is not the default and the members it must change */
const KEYS: [string, LuaValue, Record<string, unknown>][] = [
  ["LINE_TYPE", LT.JUMP_UP_REL, { lineType: 4 }],
  ["ENABLE", 0, { bEnable: false }],
  ["POTAL_GROUP", 12, { potalGroup: 12 }],
  ["STOP_FACTOR", 0.75, { fStopFactor: 0.75 }],
  ["DUST_TYPE", 1, { eDustType: LDT.WATER_SPLASH }],
  ["BEFORE_LINE", 3, { beforeLine: 3 }],
  ["NEXT_LINE", 5, { nextLine: 5 }],
  ["CAN_DOWN", 0, { bCanDown: false }],
  ["LINE_SET", 9, { lineSet: 9 }],
  ["SPEED", -2.5, { m_fSpeed: -2.5 }],
  ["JUMP_SPEED_X", 1.5, { m_vJumpSpeed: [1.5, 0, 0] }],
  ["JUMP_SPEED_Y", -3.5, { m_vJumpSpeed: [0, -3.5, 0] }],
  ["TELEPORT_LINE", 4, { m_iTeleportLineIndex: 4 }],
  ["ENABLE_WALL_JUMP", 1, { m_bEnableWallJump: true }],
  ["MONSTER_ALLOWED", 0, { m_bMonsterAllowed: false }],
  ["CAN_PASS", 0, { m_bCanPass: false }],
  ["CLIFF_HEIGHT", 33.5, { m_fCliffHeight: 33.5 }],
  ["CAMERA_INDEX", 2, { m_iCameraIndex: 2 }],
  ["OTHER_ROAD_UP", 1, { m_bOtherRoadUp: true }],
  ["TRIGGER_ID", 6, { m_iTriggerId: 6 }],
  ["TRIGGER_ON_LINE", 0, { m_bFootOnLine: false }],
  ["IS_UNDERWATER", 1, { m_bUnderWater: true, eDustType: LDT.WATER_SPLASH }], // an underwater line always has the splash dust
  ["UNDERWATER_HEIGHT", 40.25, { m_fWaterHeight: 40.25 }],
  ["UNDERWATER_BUOYANCY", 0.25, { m_fBuoyancy: 0.25 }],
  ["UNDERWATER_RESISTANCE", 0.5, { m_fResistance: 0.5 }],
  ["UNDERWATER_ANIMSPEED", 1.5, { m_fAnimSpeed: 1.5 }],
  ["UNDERWATER_VARIANCEOXYEN", -2.5, { m_fVarianceOxyen: -2.5 }],
  ["UNIT_COLOR_R", 0.25, { m_cLineColor: [0.25, 0, 0, 0] }],
  ["UNIT_COLOR_G", 0.5, { m_cLineColor: [0, 0.5, 0, 0] }],
  ["UNIT_COLOR_B", 0.75, { m_cLineColor: [0, 0, 0.75, 0] }],
  ["FORCE_CHANGE_COLOR", 1, { m_bForceChangeColor: true }],
  ["TEMP_LINE_MAP", 1, { m_bTempLineMap: true }],
  ["LINEMAP_DIRECTION_OPTION", LDO.RIGHT, { m_eDirection: 2 }],
  ["JUMP_REL_UP_KEYSTOP_TIME", 0.125, { m_fKeyStopTime: 0.125 }],
  ["CHANGE_LINE_TYPE_AFTER_CLEAR_STAGE", 3, { m_eLineTypeAfterClearStage: 3 }],
  ["CHANGE_AFTER_CLEAR_STAGE", 8, { m_iChangeAfterClearStage: 8 }],
  ["CHANGE_AFTER_CLEAR_SUB_STAGE", 2, { m_iChangeAfterClearSubStage: 2 }],
  ["PORTAL_WHEN_ACTIVE_RAID", 1, { m_bIsPortalWhenActiveRaid: true }],
];
/** what AddLine_LUA asks a table for, in the exe's order: the string literals of the decompile of 329095A0, as they come */
const ADD_LINE_KEYS = [
  "LINE_TYPE", "ENABLE", "POTAL_GROUP", "STOP_FACTOR", "DUST_TYPE", "BEFORE_LINE", "NEXT_LINE", "CAN_DOWN", "LINE_SET", "SPEED", "JUMP_SPEED_X", "JUMP_SPEED_Y",
  "TELEPORT_LINE", "ENABLE_WALL_JUMP", "MONSTER_ALLOWED", "CAN_PASS", "CLIFF_HEIGHT", "CAMERA_INDEX", "OTHER_ROAD_UP", "TRIGGER_ID", "TRIGGER_ON_LINE",
  "IS_UNDERWATER", "UNDERWATER_HEIGHT", "UNDERWATER_BUOYANCY", "UNDERWATER_RESISTANCE", "UNDERWATER_ANIMSPEED", "UNDERWATER_VARIANCEOXYEN", "UNIT_COLOR_R",
  "UNIT_COLOR_G", "UNIT_COLOR_B", "FORCE_CHANGE_COLOR", "TEMP_LINE_MAP", "LINEMAP_DIRECTION_OPTION", "JUMP_REL_UP_KEYSTOP_TIME",
  "CHANGE_LINE_TYPE_AFTER_CLEAR_STAGE", "CHANGE_AFTER_CLEAR_STAGE", "CHANGE_AFTER_CLEAR_SUB_STAGE", "PORTAL_WHEN_ACTIVE_RAID", "LINE_DEPTH", "START_POS", "END_POS",
];

describe("the constructors of the data", () => {
  test("LineData(): 329085C0 from the top to the bottom (the two members it leaves alone are the port's zeros: AddLine_LUA always sets them)", () => {
    const line = new LineData();
    expect(snapshot(line)).toEqual({
      lineIndex: -1, lineType: LT.NORMAL, bEnable: true, potalGroup: -1, fStopFactor: 1, bCanDown: true, eDustType: LDT.DEFALT_DUST,
      startPos: [0, 0, 0], endPos: [0, 0, 0], m_vPosMin: [0, 0, 0], m_vPosMax: [0, 0, 0], dirVector: [0, 0, 0], dirDegree: [0, 0, 0], dirRadian: [0, 0, 0],
      fLength: 0, beforeLine: -1, nextLine: -1, lineSet: -1, m_fSpeed: 0, m_vJumpSpeed: [0, 0, 0], m_iTeleportLineIndex: -1, m_bEnableWallJump: false,
      m_bMonsterAllowed: true, m_bCanPass: true, m_iCameraIndex: -1, m_bOtherRoadUp: false, m_fCliffHeight: 0, m_bTempLineMap: false, m_bUnderWater: false,
      m_fWaterHeight: 0, m_fBuoyancy: 0, m_fResistance: 0, m_fAnimSpeed: 1, m_fVarianceOxyen: 0, m_bForceChangeColor: false, m_iTriggerId: -1,
      m_bFootOnLine: true, m_eDirection: LDO.NONE, m_fKeyStopTime: 0, m_eLineTypeAfterClearStage: LT.INVALID, m_iChangeAfterClearStage: -1,
      m_iChangeAfterClearSubStage: -1, m_lineGroupID: { m_iStartLineIndex: -1, m_iEndLineIndex: -1 },
      unspecifiedAngles: false, m_cLineColor: [0, 0, 0, 0], m_bIsPortalWhenActiveRaid: false, // not the exe's: it does not write these
    });
    expect(line.m_pLineAnimData).toBeUndefined();
    // two lines share nothing
    const other = new LineData();
    line.startPos.x = 5;
    line.m_lineGroupID.m_iStartLineIndex = 3;
    expect([other.startPos.x, other.m_lineGroupID.m_iStartLineIndex]).toEqual([0, -1]);
  });

  test("StartInfo(): the node that a new key of the start map gets in AddStartPos (328C0DE0): (0,0,0), right, line index -1; the position is copied", () => {
    const fresh = new StartInfo();
    expect([fresh.m_vStartPos.toArray(), fresh.m_bStartRight, fresh.m_iStartLineIndex]).toEqual([[0, 0, 0], true, -1]);
    const p = new Vec3(1, 2, 3);
    const made = new StartInfo(p, false, 4);
    p.x = 9;
    expect([made.m_vStartPos.toArray(), made.m_bStartRight, made.m_iStartLineIndex]).toEqual([[1, 2, 3], false, 4]);
    expect(new StartInfo().m_vStartPos).not.toBe(new StartInfo().m_vStartPos);
  });

  test("CameraData(): no type, both points at (0,0,0), it follows the unit, the relative eye (0,0,0), speed 100 (AddCameraData_LUA, 329093C0)", () => {
    const c = new CameraData();
    expect([c.m_eType, c.m_vEye.toArray(), c.m_vLookAt.toArray(), c.m_bFocusUnit, c.m_vRelativeEye.toArray(), c.m_fCameraRepositionSpeed]).toEqual([
      LCT.INVALID, [0, 0, 0], [0, 0, 0], true, [0, 0, 0], 100,
    ]);
  });
});

describe("AddLine_LUA (329095A0)", () => {
  test("it reads the 41 keys of the exe, in the exe's order, and nothing else", () => {
    const { m } = setup();
    const { table: t, reads } = recordingTable();
    expect(m("AddLine_LUA", t)).toEqual([true]);
    expect(reads).toEqual(ADD_LINE_KEYS);
    expect(reads.length).toBe(41);
  });

  test("an empty table: every default of the exe; the end points are (0,0,0) (a line of length 0)", () => {
    const { m, map } = setup();
    expect(m("AddLine_LUA", table({}))).toEqual([true]);
    expect(map.m_LineList.length).toBe(1);
    const line = map.m_LineList[0]!;
    expect(snapshot(line)).toEqual({
      ...DEFAULT_LINE, startPos: [0, 0, 0], endPos: [0, 0, 0], m_vPosMax: [0, 0, 0], dirVector: [0, 0, 0], fLength: 0, unspecifiedAngles: true,
    });
  });

  test("a line from (0,0,0) to (100,0,0) with no key but the end points is the default line", () => {
    const { addLine, map } = setup();
    expect(addLine({})).toBe(true);
    expect(snapshot(map.m_LineList[0]!)).toEqual(DEFAULT_LINE);
  });

  test.each(KEYS)("%s changes the member the exe stores it in and nothing else", (key, value, changed) => {
    const { addLine, map } = setup();
    expect(addLine({ [key]: value })).toBe(true);
    expect(snapshot(map.m_LineList[0]!)).toEqual({ ...DEFAULT_LINE, ...changed });
    expect(map.m_iNumofLineMapCreatedByMonster).toBe(key === "TEMP_LINE_MAP" ? 1 : 0);
  });

  // the keys whose test value is a whole number are the ints and the bools; the exe reads them with (int)lua_tonumber, which cuts 4.75 to 4 (and 0.75 to 0)
  test.each(KEYS.filter(([, v]) => Number.isInteger(v)))("%s: a number with a fraction is cut to its integer part (the same line as for the whole number)", (key, value, changed) => {
    const { addLine, map } = setup();
    expect(addLine({ [key]: (value as number) + 0.75 })).toBe(true);
    expect(snapshot(map.m_LineList[0]!)).toEqual({ ...DEFAULT_LINE, ...changed });
  });

  test("all keys at once", () => {
    const { addLine, map } = setup();
    const all: Record<string, LuaValue> = {};
    for (const [k, v] of KEYS) all[k] = v;
    all.TEMP_LINE_MAP = 0;
    expect(addLine(all)).toBe(true);
    const expected: Record<string, unknown> = { ...DEFAULT_LINE };
    for (const [, , changed] of KEYS) Object.assign(expected, changed);
    Object.assign(expected, {
      m_vJumpSpeed: [1.5, -3.5, 0], m_cLineColor: [0.25, 0.5, 0.75, 0], m_bTempLineMap: false,
    });
    expect(snapshot(map.m_LineList[0]!)).toEqual(expected);
  });

  test("an underwater line keeps the dust type 1 whatever DUST_TYPE says; a line that is not underwater has the dust type of its key", () => {
    const { addLine, map } = setup();
    addLine({ IS_UNDERWATER: 1, DUST_TYPE: 0 });
    addLine({ IS_UNDERWATER: 0, DUST_TYPE: 1 });
    addLine({ IS_UNDERWATER: 0, DUST_TYPE: 0 });
    expect(map.m_LineList.map((l) => [l.m_bUnderWater, l.eDustType])).toEqual([[true, 1], [false, 1], [false, 0]]);
  });

  test("a value is read as lua_isnumber: numeric strings count (truncated like (int)lua_tonumber), the Lua booleans do not", () => {
    const { addLine, map } = setup();
    addLine({ LINE_TYPE: "4", POTAL_GROUP: -3.9, STOP_FACTOR: "0.5", ENABLE: false, CAN_DOWN: true, CAN_PASS: "0", MONSTER_ALLOWED: 2.5, LINE_SET: "abc" });
    const l = map.m_LineList[0]!;
    expect([l.lineType, l.potalGroup, l.fStopFactor]).toEqual([4, -3, 0.5]);
    // `false` / `true` are not numbers: the exe keeps its defaults (ENABLE, CAN_DOWN)
    expect([l.bEnable, l.bCanDown]).toEqual([true, true]);
    expect([l.m_bCanPass, l.m_bMonsterAllowed, l.lineSet]).toEqual([false, true, -1]);
  });

  test("a float is stored as a float32; the end points are copied as float32 too", () => {
    const { addLine, map } = setup();
    addLine({ STOP_FACTOR: 0.1, SPEED: 1e-3, UNIT_COLOR_B: 0.3 }, [0.1, 0, 0], [0.3, 0, 0]);
    const l = map.m_LineList[0]!;
    expect([l.fStopFactor, l.m_fSpeed, l.m_cLineColor.b]).toEqual([f(0.1), f(1e-3), f(0.3)]);
    expect([l.startPos.x, l.endPos.x]).toEqual([f(0.1), f(0.3)]);
  });

  test("LINE_DEPTH: any number but 0 ends the call with false and no line (but TEMP_LINE_MAP was counted); 0 and a non-number do not", () => {
    const { addLine, map } = setup();
    expect(addLine({ LINE_DEPTH: 1, TEMP_LINE_MAP: 1 })).toBe(false);
    expect(addLine({ LINE_DEPTH: "2" })).toBe(false);
    expect(addLine({ LINE_DEPTH: -1 })).toBe(false);
    expect(map.m_LineList.length).toBe(0);
    expect(map.m_iNumofLineMapCreatedByMonster).toBe(1);
    expect(addLine({ LINE_DEPTH: 1.75 })).toBe(false);
    expect(map.m_LineList.length).toBe(0);
    expect(addLine({ LINE_DEPTH: 0 })).toBe(true);
    expect(addLine({ LINE_DEPTH: true })).toBe(true); // `true` is not a number: not found
    expect(addLine({ LINE_DEPTH: 0.75 })).toBe(true); // (int)0.75 is 0
    expect(addLine({ LINE_DEPTH: -0.75 })).toBe(true);
    expect(addLine({})).toBe(true);
    expect(map.m_LineList.length).toBe(5);
    expect(map.m_LineList.map((l) => l.lineIndex)).toEqual([0, 1, 2, 3, 4]);
  });

  test("TEMP_LINE_MAP counts the lines (any non-zero number is true)", () => {
    const { addLine, map } = setup();
    addLine({ TEMP_LINE_MAP: 1 });
    addLine({ TEMP_LINE_MAP: 2 });
    addLine({ TEMP_LINE_MAP: 0 });
    addLine({});
    addLine({ TEMP_LINE_MAP: -1 });
    expect(map.m_iNumofLineMapCreatedByMonster).toBe(3);
    expect(map.m_LineList.map((l) => l.m_bTempLineMap)).toEqual([true, true, false, false, true]);
  });

  test("a wall is in the wall list and in the line list; the index is the place in the line list", () => {
    const { addLine, map } = setup();
    addLine({});
    addLine({ LINE_TYPE: LT.WALL }, [5, 0, 0], [5, 100, 0]);
    addLine({});
    addLine({ LINE_TYPE: LT.WALL }, [9, 0, 0], [9, 50, 0]);
    expect(map.m_LineList.map((l) => [l.lineIndex, l.lineType])).toEqual([[0, 0], [1, 1], [2, 0], [3, 1]]);
    expect(map.m_WallList.length).toBe(2);
    expect(map.m_WallList[0]).toBe(map.m_LineList[1]!);
    expect(map.m_WallList[1]).toBe(map.m_LineList[3]!);
  });

  test("the bounds take in the start and the end of every line that is neither a wall nor a bungee", () => {
    const { addLine, map } = setup();
    const bounds = () => [map.m_fXMin, map.m_fXMax, map.m_fYMin, map.m_fYMax];
    addLine({}, [0, 10, -5], [100, 20, 5]);
    expect(bounds()).toEqual([0, 100, 10, 20]);
    addLine({}, [-50, 5, 0], [30, 40, 0]);
    expect(bounds()).toEqual([-50, 100, 5, 40]);
    addLine({}, [10, 12, 0], [-70, -9, 0]); // the end is the smallest x and y
    expect(bounds()).toEqual([-70, 100, -9, 40]);
    addLine({}, [10, 12, 0], [200, 77, 0]); // the end is the largest x and y
    expect(bounds()).toEqual([-70, 200, -9, 77]);
    addLine({ LINE_TYPE: LT.WALL }, [500, -500, 0], [500, 900, 0]);
    addLine({ LINE_TYPE: LT.BUNGEE }, [-900, 0, 0], [900, 0, 0]);
    expect(bounds()).toEqual([-70, 200, -9, 77]);
    addLine({}, [300, 100, 0], [-1, 0, 0]); // the start is the largest x and y
    expect(bounds()).toEqual([-70, 300, -9, 100]);
    addLine({ LINE_TYPE: LT.POTAL }, [-80, -60, 0], [0, 0, 0]); // the start is the smallest x and y
    expect(bounds()).toEqual([-80, 300, -60, 100]);
  });

  test("the first line starts the bounds from its own end points, also when they are all negative", () => {
    const { addLine, map } = setup();
    addLine({}, [-100, -50, 0], [-20, -10, 0]);
    expect([map.m_fXMin, map.m_fXMax, map.m_fYMin, map.m_fYMax]).toEqual([-100, -20, -50, -10]);
    const other = setup();
    other.addLine({}, [100, 0, 0], [0, 50, 0]); // a line that goes right to left
    expect([other.map.m_fXMin, other.map.m_fXMax, other.map.m_fYMin, other.map.m_fYMax]).toEqual([0, 100, 0, 50]);
  });

  test("a wall as the first line does not start the bounds: they keep the 0s of the constructor, and the next line takes in 0 too", () => {
    const { addLine, map } = setup();
    addLine({ LINE_TYPE: LT.WALL }, [5, 5, 0], [9, 50, 0]);
    expect([map.m_fXMin, map.m_fXMax, map.m_fYMin, map.m_fYMax]).toEqual([0, 0, 0, 0]);
    addLine({}, [20, 30, 0], [40, 60, 0]);
    expect([map.m_fXMin, map.m_fXMax, map.m_fYMin, map.m_fYMax]).toEqual([0, 40, 0, 60]);
  });

  test("a line whose depth made it fail did not count as the first line", () => {
    const { addLine, map } = setup();
    addLine({ LINE_DEPTH: 5 }, [-1000, -1000, 0], [1000, 1000, 0]);
    addLine({}, [10, 20, 0], [30, 40, 0]);
    expect([map.m_fXMin, map.m_fXMax, map.m_fYMin, map.m_fYMax]).toEqual([10, 30, 20, 40]);
  });

  // the sign of a zero tells which operand an `minss` / `maxss` / `comiss; ja` chose when the two are equal: minss(a, b) is a < b ? a : b and maxss(a, b) is
  // a > b ? a : b (a tie answers b), and `ja` is not taken for a tie, so the bound that is there stays
  test("a tie: minss / maxss answer their second operand and the end point replaces a bound only when it is strictly beyond it (+0 and -0 tie)", () => {
    const sign = (v: number) => (Object.is(v, -0) ? "-0" : Object.is(v, 0) ? "+0" : v);
    const bounds = (map: CKTDGLineMap) => [map.m_fXMin, map.m_fXMax, map.m_fYMin, map.m_fYMax].map(sign);
    // the first line from +0 to -0: the bounds start as (start.x, end.x, start.y, end.y) = (+0, -0, +0, -0)
    //   min = minss(+0, +0) = +0 and `+0 > -0` is false: +0;  max = maxss(+0, -0) = -0 (the second operand) and `-0 > -0` is false: -0
    const first = setup();
    first.addLine({}, [0, 0, 0], [-0, -0, 0]);
    expect(bounds(first.map)).toEqual(["+0", "-0", "+0", "-0"]);
    // a line from +0 to -0 after the bounds (-2, -1): min = minss(+0, -2) = -2;  max = maxss(+0, -1) = +0 and `-0 > +0` is false: +0
    const beyond = setup();
    beyond.addLine({}, [-2, -2, 0], [-1, -1, 0]);
    beyond.addLine({}, [0, 0, 0], [-0, -0, 0]);
    expect(bounds(beyond.map)).toEqual([-2, "+0", -2, "+0"]);
    // minss(+0, -0) = -0 (the second operand): the second line's start does not replace the -0 that is there
    const tie = setup();
    tie.addLine({}, [-0, -0, 0], [5, 5, 0]);
    expect(bounds(tie.map)).toEqual(["-0", 5, "-0", 5]);
    tie.addLine({}, [0, 0, 0], [5, 5, 0]);
    expect(bounds(tie.map)).toEqual(["-0", 5, "-0", 5]);
  });
});

describe("MakeLine (32913120): what follows from the two end points", () => {
  const made = (start: number[], end: number[]) => {
    const { addLine, map } = setup();
    addLine({}, start, end);
    return map.m_LineList[0]!;
  };

  test("min and max are taken per component, whichever end is which", () => {
    const l = made([10, -20, 30], [-5, 40, 7]);
    expect(l.m_vPosMin.toArray()).toEqual([-5, -20, 7]);
    expect(l.m_vPosMax.toArray()).toEqual([10, 40, 30]);
    const r = made([-5, 40, 7], [10, -20, 30]);
    expect(r.m_vPosMin.toArray()).toEqual([-5, -20, 7]);
    expect(r.m_vPosMax.toArray()).toEqual([10, 40, 30]);
    // dir = (-15, 60, -23) / sqrt(4354): the direction is normalized, the length is the float sum of the squares
    expect(l.dirVector.toArray()).toEqual([-0.22732491791248322, 0.9092996716499329, -0.34856486320495605]);
    expect(l.fLength).toBe(65.98484802246094);
    // the angles: asin(dir.y) and atan2(-dir.z, dir.x), times 57.295776f, as floats
    expect(l.dirRadian.x).toBe(0);
    expect(l.dirRadian.y).toBeCloseTo(2.148698329925537, 5);
    expect(l.dirRadian.z).toBeCloseTo(1.141598105430603, 5);
    expect(l.dirDegree.x).toBe(0);
    expect(l.dirDegree.y).toBeCloseTo(123.11133575439453, 3);
    expect(l.dirDegree.z).toBeCloseTo(65.40875244140625, 3);
    expect(l.unspecifiedAngles).toBe(false);
  });

  test("(0,0,0) -> (3,4,12): length 13, direction (3,4,12)/13 as floats; slope asin(4/13), yaw atan2(-12, 3)", () => {
    const l = made([0, 0, 0], [3, 4, 12]);
    expect(l.fLength).toBe(13);
    expect(l.dirVector.toArray()).toEqual([0.23076923191547394, 0.3076923191547394, 0.9230769276618958]);
    expect(l.dirRadian.x).toBe(0);
    expect(l.dirRadian.y).toBeCloseTo(-1.3258177042007446, 5);
    expect(l.dirRadian.z).toBeCloseTo(0.3127667307853699, 5);
    expect(l.dirDegree.x).toBe(0);
    expect(l.dirDegree.y).toBeCloseTo(-75.96375274658203, 3);
    expect(l.dirDegree.z).toBeCloseTo(17.920211791992188, 3);
  });

  test("a slope in the x-y plane: (0,0,0) -> (200,100,0) rises 26.565 degrees and does not turn", () => {
    const l = made([0, 0, 0], [200, 100, 0]);
    expect(l.dirVector.toArray()).toEqual([0.8944271802902222, 0.4472135901451111, 0]);
    expect(l.fLength).toBe(223.60679626464844);
    expect(l.dirRadian.z).toBeCloseTo(0.46364760398864746, 6);
    expect(l.dirDegree.z).toBeCloseTo(26.56505012512207, 4);
    expect(Math.abs(l.dirRadian.y)).toBe(0);
    expect(Math.abs(l.dirDegree.y)).toBe(0);
    expect(l.dirRadian.x).toBe(0);
  });

  test("along +x: length 7500 and no angle; along -x the yaw is a half turn (the sign of it is the sign of a zero in D3DX: not specified)", () => {
    const right = made([-4000, 10, -601], [3500, 10, -601]);
    expect(right.fLength).toBe(7500);
    expect(right.dirVector.toArray()).toEqual([1, 0, 0]);
    expect(right.dirRadian.toArray().map(z)).toEqual([0, 0, 0]);
    expect(right.dirDegree.toArray().map(z)).toEqual([0, 0, 0]);
    const left = made([100, 5, 7], [-50, 5, 7]);
    expect(left.fLength).toBe(150);
    expect(left.dirVector.toArray()).toEqual([-1, 0, 0]);
    expect(Math.abs(left.dirRadian.y)).toBe(f(Math.PI));
    expect(Math.abs(left.dirDegree.y)).toBe(180); // 3.1415927f * 57.295776f rounds to exactly 180 as a float
    expect(left.dirRadian.x).toBe(0);
    expect(z(left.dirRadian.z)).toBe(0);
  });

  test("along z: -z turns a quarter one way, +z the other", () => {
    const back = made([0, 0, 5], [0, 0, -45]);
    expect(back.fLength).toBe(50);
    expect(back.dirVector.toArray().map(z)).toEqual([0, 0, -1]);
    expect(back.dirRadian.y).toBe(f(Math.PI / 2));
    expect(back.dirDegree.y).toBe(90);
    const front = made([0, 0, 0], [0, 0, 50]);
    expect(front.dirRadian.y).toBe(-f(Math.PI / 2));
    expect(front.dirDegree.y).toBe(-90);
    expect(z(front.dirRadian.z)).toBe(0);
  });

  test("the length is a sum of float squares: (0,0,0) -> (1,2,2) is 3; (0.1,0.2,0.3) is 0.37416577339172363", () => {
    expect(made([0, 0, 0], [1, 2, 2]).fLength).toBe(3);
    const l = made([0, 0, 0], [0.1, 0.2, 0.3]);
    expect(l.fLength).toBe(0.37416577339172363);
    expect(l.dirVector.toArray()).toEqual([0.26726123690605164, 0.5345224738121033, 0.8017837405204773]);
  });

  test("a wall (straight up) and a line of length 0 have no D3DX inverse: the angles are the exe's reads of an unwritten stack slot, marked", () => {
    const wall = made([5, 0, 7], [5, 300, 7]);
    expect(wall.dirVector.toArray()).toEqual([0, 1, 0]);
    expect(wall.fLength).toBe(300);
    expect(wall.unspecifiedAngles).toBe(true);
    // a matrix of zeros: the first branch (`_12` and `_22` are 0), atan2(-0, 0) = -0
    expect(wall.dirRadian.toArray().map((v) => Object.is(v, -0))).toEqual([true, true, false]);
    expect(wall.dirDegree.toArray().map((v) => Object.is(v, -0))).toEqual([true, true, false]);
    expect(wall.dirRadian.z).toBe(0);
    const down = made([5, 300, 7], [5, 0, 7]);
    expect(down.dirVector.toArray()).toEqual([0, -1, 0]);
    expect(down.unspecifiedAngles).toBe(true);
    const point = made([5, 5, 5], [5, 5, 5]);
    expect(point.dirVector.toArray()).toEqual([0, 0, 0]);
    expect(point.fLength).toBe(0);
    expect(point.unspecifiedAngles).toBe(true);
    // a line that is not vertical is not marked, however steep
    const steep = made([0, 0, 0], [0.5, 100, 0]);
    expect(steep.unspecifiedAngles).toBe(false);
    expect(steep.dirRadian.z).toBeCloseTo(1.5657929182052612, 4); // asin(0.99998748f): a float of error in the direction is 1e-5 here
  });
});

describe("MakeLine (32913120): the branch for a matrix of zeros", () => {
  // `_12 == 0 && _22 == 0` of the inverse of LookAtLH(0, dir, up) with up = (0,1,0): _12 is the y of the x axis, (up x dir) has no y, so it is 0; _22 is the y of the
  // y axis, which is the length of the horizontal part of dir (the x axis is that part turned a quarter): it is 0 only when dir is straight up or down.  Then the x
  // axis is the zero vector, the matrix has no inverse, and the exe reads a slot of its stack nobody wrote.  The port's model is a matrix of zeros: the one that
  // takes that branch (tools/mutate-linemap.py lists the mutants of the branch that this makes the same)
  test("a line has an inverse unless it is straight up or down or has no length, and then _22 is not 0: only a line without an inverse takes the branch", () => {
    const up = { x: 0, y: 1, z: 0 };
    const zero = { x: 0, y: 0, z: 0 };
    let seed = 7;
    const random = () => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      return seed / 4294967296;
    };
    const scales = [1, 1e-3, 1e-9, 1e-20, 1e-30];
    let withInverse = 0, without = 0;
    const check = (dx: number, dy: number, dz: number) => {
      const dir = vec3Normalize({ x: f(dx), y: f(dy), z: f(dz) });
      const inverse = matInverse(matLookAtLH(zero, dir, up));
      if (inverse === null) {
        without++;
        expect([dir.x, dir.z]).toEqual([0, 0]);
      } else {
        withInverse++;
        const I = inverse.matrix;
        expect(I[1] === 0 && I[5] === 0).toBe(false);
        expect(I[5]).toBeGreaterThan(0);
      }
    };
    for (let i = 0; i < 20000; i++) {
      check((random() - 0.5) * scales[i % 5]!, (random() - 0.5) * 1000, (random() - 0.5) * scales[(i >> 3) % 5]!);
    }
    // the lines of a map: along the axes, straight up and down, a point
    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0], [0, 0, 0], [1e-30, 1, 0], [0, 1, 1e-30], [-1e-30, -300, 1e-30]] as const) check(dx, dy, dz);
    expect([withInverse, without]).toEqual([20007, 3]); // the random lines and 7 of the 10 listed ones have an inverse; straight up, straight down and a point do not
  });
});

describe("UpdateLineData / SetStartEndPosAtThisLineMap_LUA (32913A30, 329139D0)", () => {
  test("the new end points make the line again, from scratch", () => {
    const { addLine, map, m, vec } = setup();
    addLine({ NEXT_LINE: 3 }, [0, 0, 0], [100, 0, 0]);
    expect(map.updateLineData(0, new Vec3(0, 0, 0), new Vec3(3, 4, 12))).toBe(true);
    const l = map.m_LineList[0]!;
    expect(l.fLength).toBe(13);
    expect(l.endPos.toArray()).toEqual([3, 4, 12]);
    expect(l.m_vPosMax.toArray()).toEqual([3, 4, 12]);
    expect(l.nextLine).toBe(3); // nothing else changes
    expect(l.dirRadian.z).toBeCloseTo(0.3127667307853699, 5);
    // the script's way: (index, start, end); a vector argument is copied
    expect(m("SetStartEndPosAtThisLineMap_LUA", 0, vec(1, 2, 3), vec(1, 2, 53))).toEqual([]);
    expect(l.startPos.toArray()).toEqual([1, 2, 3]);
    expect(l.endPos.toArray()).toEqual([1, 2, 53]);
    expect(l.fLength).toBe(50);
    expect(l.dirVector.toArray()).toEqual([0, 0, 1]);
    // UpdateLineData: the start is copied component by component as well
    expect(map.updateLineData(0, new Vec3(-7, 8.5, 9), new Vec3(-7, 8.5, 109))).toBe(true);
    expect(l.startPos.toArray()).toEqual([-7, 8.5, 9]);
    expect(l.m_vPosMin.toArray()).toEqual([-7, 8.5, 9]);
    expect(l.m_vPosMax.toArray()).toEqual([-7, 8.5, 109]);
  });

  test("a line that is made vertical by an update has no slope any more: the first branch of MakeLine writes dirRadian.z itself", () => {
    const { addLine, map } = setup();
    addLine({}, [0, 0, 0], [3, 4, 12]);
    const l = map.m_LineList[0]!;
    expect(l.dirRadian.z).toBeCloseTo(0.3127667307853699, 5);
    expect(l.unspecifiedAngles).toBe(false);
    expect(map.updateLineData(0, new Vec3(1, 2, 3), new Vec3(1, 52, 3))).toBe(true);
    expect(l.unspecifiedAngles).toBe(true);
    expect(l.dirVector.toArray()).toEqual([0, 1, 0]);
    expect(l.dirRadian.z).toBe(0); // the exe stores a 0.0 there; the slope of the line it was is not left
    expect(l.dirDegree.z).toBe(0);
    // and a vertical line that is made slanting has its angles again
    expect(map.updateLineData(0, new Vec3(0, 0, 0), new Vec3(3, 4, 12))).toBe(true);
    expect(l.unspecifiedAngles).toBe(false);
    expect(l.dirRadian.z).toBeCloseTo(0.3127667307853699, 5);
  });

  test("a line that is not there: UpdateLineData is false, the script's method does nothing (MakeLine(NULL))", () => {
    const { addLine, map, m, vec } = setup();
    addLine({});
    expect(map.updateLineData(-1, new Vec3(), new Vec3(1, 1, 1))).toBe(false);
    expect(map.updateLineData(1, new Vec3(), new Vec3(1, 1, 1))).toBe(false);
    expect(m("SetStartEndPosAtThisLineMap_LUA", 7, vec(1, 1, 1), vec(2, 2, 2))).toEqual([]);
    expect(m("SetStartEndPosAtThisLineMap_LUA", -1, vec(1, 1, 1), vec(2, 2, 2))).toEqual([]);
    expect(snapshot(map.m_LineList[0]!)).toEqual(DEFAULT_LINE);
  });
});

describe("start positions, land height, line count", () => {
  test("SetLandHeight stores a float", () => {
    const { m, map } = setup();
    expect(m("SetLandHeight", -12.75)).toEqual([]);
    expect(map.m_fLandHeight).toBe(-12.75);
    m("SetLandHeight", 0.1);
    expect(map.m_fLandHeight).toBe(f(0.1));
  });

  test("SetTeamStartPos appends to the red or the blue list, in order; the position is copied", () => {
    const { m, map, vec } = setup();
    expect(m("SetTeamStartPos", true, vec(1, 2, 3), true, 5)).toEqual([]);
    m("SetTeamStartPos", false, vec(4, 5, 6), false, -1);
    m("SetTeamStartPos", true, vec(7.5, -8, 9), false, 2);
    const rows = (v: typeof map.m_vecRedTeamStartInfo) => v.map((s) => [s.m_vStartPos.toArray(), s.m_bStartRight, s.m_iStartLineIndex]);
    expect(rows(map.m_vecRedTeamStartInfo)).toEqual([[[1, 2, 3], true, 5], [[7.5, -8, 9], false, 2]]);
    expect(rows(map.m_vecBlueTeamStartInfo)).toEqual([[[4, 5, 6], false, -1]]);
    // the bool is read as the binder reads one: a number is true unless it is 0
    m("SetTeamStartPos", 0, vec(0, 0, 0), 2, 1);
    expect(rows(map.m_vecBlueTeamStartInfo)[1]).toEqual([[0, 0, 0], true, 1]);
  });

  test("AddStartPos is map[key] = ...: keys are kept in order, a key that is there is replaced (position, side and line, the side in both directions)", () => {
    const { m, map, vec } = setup();
    expect(m("AddStartPos", 9, vec(1, 2, 3), true, 4)).toEqual([]);
    m("AddStartPos", 3, vec(4, 5, 6), false, 7);
    m("AddStartPos", -2, vec(7, 8, 9), true, 1);
    expect([...map.m_mapStartInfo].map(([k]) => k)).toEqual([-2, 3, 9]);
    const row = (k: number) => {
      const s = map.m_mapStartInfo.get(k)!;
      return [s.m_vStartPos.toArray(), s.m_bStartRight, s.m_iStartLineIndex];
    };
    expect([-2, 3, 9].map(row)).toEqual([[[7, 8, 9], true, 1], [[4, 5, 6], false, 7], [[1, 2, 3], true, 4]]);
    m("AddStartPos", 3, vec(10.5, -11, 12), true, -3); // false -> true
    m("AddStartPos", 9, vec(13, 14, 15), false, 0); // true -> false
    expect(map.m_mapStartInfo.size).toBe(3);
    expect([3, 9].map(row)).toEqual([[[10.5, -11, 12], true, -3], [[13, 14, 15], false, 0]]);
    // the bool is read as the binder reads one: a number is true unless it is 0
    m("AddStartPos", 5, vec(0, 0, 0), 0, 2);
    m("AddStartPos", 6, vec(0, 0, 0), 3, 2);
    expect([5, 6].map((k) => map.m_mapStartInfo.get(k)!.m_bStartRight)).toEqual([false, true]);
  });

  test("GetStartPosition / GetStartLineIndex: the key's, (0,0,0) and -1 for a key that is not there; the position is a copy", () => {
    const { m, map, vec } = setup();
    m("AddStartPos", 9, vec(1, 2, 3), true, 4);
    m("AddStartPos", 3, vec(4, 5, 6), false, 7);
    expect(vecOf(m("GetStartPosition", 9)[0]!)).toEqual([1, 2, 3]);
    expect(vecOf(m("GetStartPosition", 3)[0]!)).toEqual([4, 5, 6]);
    expect(vecOf(m("GetStartPosition", 4)[0]!)).toEqual([0, 0, 0]);
    expect(m("GetStartLineIndex", 9)).toEqual([4]);
    expect(m("GetStartLineIndex", 3)).toEqual([7]);
    expect(m("GetStartLineIndex", 4)).toEqual([-1]);
    const got = map.GetStartPosition(9);
    got.x = 99;
    expect(map.GetStartPosition(9).x).toBe(1);
    // the same key in the red / blue team lists is not a start position
    m("SetTeamStartPos", true, vec(1, 1, 1), true, 0);
    expect(m("GetStartLineIndex", 0)).toEqual([-1]);
  });

  test("GetNumLineData_LUA is the number of lines (a wall counts, a failed AddLine_LUA does not)", () => {
    const { m, addLine } = setup();
    expect(m("GetNumLineData_LUA")).toEqual([0]);
    addLine({});
    addLine({ LINE_TYPE: LT.WALL });
    addLine({ LINE_DEPTH: 3 });
    expect(m("GetNumLineData_LUA")).toEqual([2]);
  });

  test("AddLineAnim_LUA is the function that answers false (the exe registers 328F8F90, an ICF twin of GetIsMiddleBosRaidNPC)", () => {
    const { m, map } = setup();
    expect(m("AddLineAnim_LUA", table({ ANIM_TYPE: 1 }))).toEqual([false]);
    expect(map.m_LineList.length).toBe(0);
  });
});

describe("AddCameraData_LUA (329093C0)", () => {
  test("the keys, in the exe's order: the three relative positions, then (relative) the speed, or (absolute) FOCUS_UNIT, EYE_POS, LOOKAT_POS", () => {
    const { m } = setup();
    const absolute = recordingTable();
    expect(m("AddCameraData_LUA", absolute.table)).toEqual([true]);
    expect(absolute.reads).toEqual(["RELATIVE_EYE_POS_X", "RELATIVE_EYE_POS_Y", "RELATIVE_EYE_POS_Z", "FOCUS_UNIT", "EYE_POS", "LOOKAT_POS"]);
    const relative = recordingTable((k) => (k.startsWith("RELATIVE_EYE_POS_") ? 1 : undefined));
    expect(m("AddCameraData_LUA", relative.table)).toEqual([true]);
    expect(relative.reads).toEqual(["RELATIVE_EYE_POS_X", "RELATIVE_EYE_POS_Y", "RELATIVE_EYE_POS_Z", "CAMERA_REPOSITION_SPEED"]);
  });

  test("all three relative positions: a camera relative to the unit, with its speed (default 100)", () => {
    const { m, map } = setup();
    m("AddCameraData_LUA", table({ RELATIVE_EYE_POS_X: 10.5, RELATIVE_EYE_POS_Y: -20, RELATIVE_EYE_POS_Z: 30.25, CAMERA_REPOSITION_SPEED: 55.5 }));
    m("AddCameraData_LUA", table({ RELATIVE_EYE_POS_X: 0, RELATIVE_EYE_POS_Y: 0, RELATIVE_EYE_POS_Z: 0 }));
    const [a, b] = map.m_vecCameraData;
    expect([a!.m_eType, a!.m_vRelativeEye.toArray(), a!.m_fCameraRepositionSpeed, a!.m_bFocusUnit]).toEqual([LCT.RELATIE_POSITION, [10.5, -20, 30.25], 55.5, true]);
    expect([a!.m_vEye.toArray(), a!.m_vLookAt.toArray()]).toEqual([[0, 0, 0], [0, 0, 0]]);
    expect([b!.m_eType, b!.m_vRelativeEye.toArray(), b!.m_fCameraRepositionSpeed]).toEqual([LCT.RELATIE_POSITION, [0, 0, 0], 100]);
  });

  test("an absolute camera: FOCUS_UNIT (a number; default true), EYE_POS and LOOKAT_POS (vectors; default zeros)", () => {
    const { m, map, vec } = setup();
    m("AddCameraData_LUA", table({ FOCUS_UNIT: 0, EYE_POS: vec(100, -200, 300.5), LOOKAT_POS: vec(1.5, 2.5, -3.5) }));
    m("AddCameraData_LUA", table({}));
    m("AddCameraData_LUA", table({ FOCUS_UNIT: false, EYE_POS: 5, LOOKAT_POS: "x" })); // not numbers / not vectors: the defaults
    m("AddCameraData_LUA", table({ FOCUS_UNIT: 3 }));
    const rows = map.m_vecCameraData.map((c) => [c.m_eType, c.m_bFocusUnit, c.m_vEye.toArray(), c.m_vLookAt.toArray(), c.m_fCameraRepositionSpeed]);
    expect(rows).toEqual([
      [LCT.ABSOULTE_POSITION, false, [100, -200, 300.5], [1.5, 2.5, -3.5], 100],
      [LCT.ABSOULTE_POSITION, true, [0, 0, 0], [0, 0, 0], 100],
      [LCT.ABSOULTE_POSITION, true, [0, 0, 0], [0, 0, 0], 100],
      [LCT.ABSOULTE_POSITION, true, [0, 0, 0], [0, 0, 0], 100],
    ]);
  });

  test("a camera with only some of the relative positions is absolute, and keeps the ones it found (a missing one is 0)", () => {
    const { m, map } = setup();
    m("AddCameraData_LUA", table({ RELATIVE_EYE_POS_X: 7, RELATIVE_EYE_POS_Y: 8, CAMERA_REPOSITION_SPEED: 3 }));
    m("AddCameraData_LUA", table({ RELATIVE_EYE_POS_Z: 9, FOCUS_UNIT: 0 }));
    m("AddCameraData_LUA", table({ RELATIVE_EYE_POS_Y: 8.5, RELATIVE_EYE_POS_Z: 9.5 }));
    const rows = map.m_vecCameraData.map((c) => [c.m_eType, c.m_vRelativeEye.toArray(), c.m_fCameraRepositionSpeed, c.m_bFocusUnit]);
    expect(rows).toEqual([
      [LCT.ABSOULTE_POSITION, [7, 8, 0], 100, true], // the speed is only read by a relative camera
      [LCT.ABSOULTE_POSITION, [0, 0, 9], 100, false],
      [LCT.ABSOULTE_POSITION, [0, 8.5, 9.5], 100, true],
    ]);
  });
});

// ---- the triggers -----------------------------------------------------------------------------------------------------------------

const meshA = () => table({ TRIGGER_ACTION: 1, PLAY_TYPE: 2, DELAY_TIME: 0.5, MESH_NAME: utf8ToLua("門.x"), ANIM_NAME: "Open", ANIM_SPEED: 1.5 });
const lineRows = (seg: TriggerSegment, d = 0) => seg.m_vecTriggerData[d]!.m_vecTriggerLine.map((l) => [l.m_iLineTriggerAction, l.m_iTriggerLineIndex, l.m_fTriggerTime, l.m_bEnable, l.m_fSpeed, l.m_vJumpSpeed.toArray(), l.m_iCamera, l.m_bDone]);
const etcRows = (seg: TriggerSegment, d = 0) => seg.m_vecTriggerData[d]!.m_vecTriggerEtc.map((e) => [e.m_iEtcTriggerAction, e.m_wstrActionName, e.m_fTriggerTime, e.m_iDummyValue01, e.m_fDummyValue01, e.m_bDone]);
const meshRows = (seg: TriggerSegment, d = 0) => seg.m_vecTriggerData[d]!.m_vecTriggerMesh.map((x) => [x.m_iMeshTriggerAction, x.m_wstrMeshName, x.m_fTriggerTime, x.m_wstrName, x.m_iPlayType, x.m_fAnimSpeed, x.m_bDone]);

describe("AddTrigger_LUA (32909CF0)", () => {
  test("a segment without an id (or with a negative one) is false and adds nothing; id 0 is fine; TRIGGER_LOOP is a number", () => {
    const { m, map } = setup();
    expect(m("AddTrigger_LUA", table({}))).toEqual([false]);
    expect(m("AddTrigger_LUA", table({ TRIGGER_ID: -1 }))).toEqual([false]);
    expect(m("AddTrigger_LUA", table({ TRIGGER_ID: "x" }))).toEqual([false]);
    expect(map.m_LineMapTrigger.m_vecTriggerSeg.length).toBe(0);
    expect(m("AddTrigger_LUA", table({ TRIGGER_ID: 0 }))).toEqual([true]);
    expect(m("AddTrigger_LUA", table({ TRIGGER_ID: 4, TRIGGER_LOOP: 1 }))).toEqual([true]);
    expect(m("AddTrigger_LUA", table({ TRIGGER_ID: 5, TRIGGER_LOOP: true }))).toEqual([true]); // `true` is not a number: not found: false
    expect(m("AddTrigger_LUA", table({ TRIGGER_ID: 6, TRIGGER_LOOP: 0 }))).toEqual([true]);
    const rows = map.m_LineMapTrigger.m_vecTriggerSeg.map((s) => [s.m_iTriggerId, s.m_iTriggerDataIndex, s.m_bLoop, s.m_vecTriggerData.length]);
    expect(rows).toEqual([[0, 0, false, 0], [4, 0, true, 0], [5, 0, false, 0], [6, 0, false, 0]]);
  });

  test("a segment with all three kinds of actions", () => {
    const { m, map } = setup();
    const data0 = table({
      TRIGGER_DATA_MESH0: meshA(),
      TRIGGER_DATA_MESH1: table({}),
      TRIGGER_DATA_LINE0: table({ TRIGGER_ACTION: 1, DELAY_TIME: 2.5, LINE_ID: 3, LINE_ENABLE: 0 }),
      TRIGGER_DATA_LINE1: table({ TRIGGER_ACTION: 2, LINE_ID: 4, LINE_SPEED: 7.5 }),
      TRIGGER_DATA_LINE2: table({ TRIGGER_ACTION: 3, LINE_ID: 5, LINE_JUMPSPEED_X: 1.5, LINE_JUMPSPEED_Y: -2.5 }),
      TRIGGER_DATA_LINE3: table({ TRIGGER_ACTION: 4, LINE_ID: 6, LINE_CAMERA: 2 }),
      TRIGGER_DATA_LINE4: table({ TRIGGER_ACTION: 5, LINE_ID: 7, LINE_CANPASS: 0 }),
      TRIGGER_DATA_LINE5: table({ TRIGGER_ACTION: 6, LINE_ID: 8, LINE_TELEPORT: 9 }),
      TRIGGER_DATA_LINE6: table({ TRIGGER_ACTION: 1 }),
      TRIGGER_DATA_ETC0: table({ TRIGGER_ACTION: 1, DELAY_TIME: 0.25, LINE_SOUND: "boom.ogg" }),
      TRIGGER_DATA_ETC1: table({ TRIGGER_ACTION: 3, CAMERA_INDEX: 2, CAMERA_DURATION: 1.5 }),
      TRIGGER_DATA_ETC2: table({ TRIGGER_ACTION: 4, CAMERA_SHAKE_GAP: 3, CAMERA_SHAKE_DURATION: 0.25 }),
      TRIGGER_DATA_ETC3: table({ TRIGGER_ACTION: 5, ACTIVE_LAYER_ID: 4, FADE_TIME: 0.75 }),
      TRIGGER_DATA_ETC4: table({ TRIGGER_ACTION: 2, CAMERA_INDEX: 77, LINE_SOUND: "ignored" }),
      TRIGGER_DATA_ETC5: table({}),
    });
    const data1 = table({ TRIGGER_DATA_LINE0: table({ TRIGGER_ACTION: 1, LINE_ID: 12, LINE_ENABLE: 1 }) });
    expect(m("AddTrigger_LUA", table({ TRIGGER_ID: 5, TRIGGER_LOOP: 1, TRIGGER_DATA0: data0, TRIGGER_DATA1: data1, TRIGGER_DATA3: data0 }))).toEqual([true]);
    const segs = map.m_LineMapTrigger.m_vecTriggerSeg;
    expect(segs.length).toBe(1);
    const seg = segs[0]!;
    expect([seg.m_iTriggerId, seg.m_iTriggerDataIndex, seg.m_bLoop, seg.m_vecTriggerData.length]).toEqual([5, 0, true, 2]); // TRIGGER_DATA2 is missing: DATA3 is not read
    expect(seg.m_vecTriggerData.map((d) => d.m_fElapsedTime)).toEqual([0, 0]);
    expect(meshRows(seg)).toEqual([
      [1, "門.x", 0.5, "Open", 2, 1.5, false],
      [0, "", 0, "", 1, 1, false],
    ]);
    expect(lineRows(seg)).toEqual([
      [1, 3, 2.5, false, 0, [0, 0, 0], -1, false],
      [2, 4, 0, true, 7.5, [0, 0, 0], -1, false],
      [3, 5, 0, true, 0, [1.5, -2.5, 0], -1, false],
      [4, 6, 0, true, 0, [0, 0, 0], 2, false],
      [5, 7, 0, false, 0, [0, 0, 0], -1, false],
      [6, 8, 0, true, 0, [0, 0, 0], 9, false],
      [1, -1, 0, true, 0, [0, 0, 0], -1, false],
    ]);
    expect(etcRows(seg)).toEqual([
      [1, "boom.ogg", 0.25, -1, 0, false],
      [3, "", 0, 2, 1.5, false],
      [4, "", 0, 3, 0.25, false],
      [5, "", 0, 4, 0.75, false],
      [2, "", 0, -1, 0, false],
      [0, "", 0, -1, 0, false],
    ]);
    expect(meshRows(seg, 1)).toEqual([]);
    expect(lineRows(seg, 1)).toEqual([[1, 12, 0, true, 0, [0, 0, 0], -1, false]]);
    expect(etcRows(seg, 1)).toEqual([]);
  });

  test("the defaults of the fields each action reads (a missing key) differ from the ones of the constructor", () => {
    const { m, map } = setup();
    const data = table({
      TRIGGER_DATA_LINE0: table({ TRIGGER_ACTION: 1 }), // LINE_ENABLE missing: true
      TRIGGER_DATA_LINE1: table({ TRIGGER_ACTION: 2 }), // LINE_SPEED missing: 0
      TRIGGER_DATA_LINE2: table({ TRIGGER_ACTION: 3 }), // both jump speeds missing: 0
      TRIGGER_DATA_LINE3: table({ TRIGGER_ACTION: 4 }), // LINE_CAMERA missing: -1
      TRIGGER_DATA_LINE4: table({ TRIGGER_ACTION: 5 }), // LINE_CANPASS missing: true
      TRIGGER_DATA_LINE5: table({ TRIGGER_ACTION: 6 }), // LINE_TELEPORT missing: -1
      TRIGGER_DATA_ETC0: table({ TRIGGER_ACTION: 3 }), // CAMERA_INDEX -1, CAMERA_DURATION 0
      TRIGGER_DATA_ETC1: table({ TRIGGER_ACTION: 4 }), // CAMERA_SHAKE_GAP 0, CAMERA_SHAKE_DURATION 0
      TRIGGER_DATA_ETC2: table({ TRIGGER_ACTION: 5 }), // ACTIVE_LAYER_ID -1, FADE_TIME 0
      TRIGGER_DATA_ETC3: table({ TRIGGER_ACTION: 1 }), // LINE_SOUND missing: ""
    });
    m("AddTrigger_LUA", table({ TRIGGER_ID: 1, TRIGGER_DATA0: data }));
    const seg = map.m_LineMapTrigger.m_vecTriggerSeg[0]!;
    expect(lineRows(seg).map((r) => [r[0], r[3], r[4], r[5], r[6]])).toEqual([
      [1, true, 0, [0, 0, 0], -1],
      [2, true, 0, [0, 0, 0], -1],
      [3, true, 0, [0, 0, 0], -1],
      [4, true, 0, [0, 0, 0], -1],
      [5, true, 0, [0, 0, 0], -1],
      [6, true, 0, [0, 0, 0], -1],
    ]);
    expect(etcRows(seg)).toEqual([
      [3, "", 0, -1, 0, false],
      [4, "", 0, 0, 0, false],
      [5, "", 0, -1, 0, false],
      [1, "", 0, -1, 0, false],
    ]);
  });

  test("a table with no key: action 0 of its kind and the constructor's members (a mesh: play type 1 and speed 1; a line: index -1, enabled, camera -1)", () => {
    const { m, map } = setup();
    m("AddTrigger_LUA", table({ TRIGGER_ID: 1, TRIGGER_DATA0: table({ TRIGGER_DATA_MESH0: table({}), TRIGGER_DATA_LINE0: table({}), TRIGGER_DATA_ETC0: table({}) }) }));
    const seg = map.m_LineMapTrigger.m_vecTriggerSeg[0]!;
    expect(meshRows(seg)).toEqual([[0, "", 0, "", 1, 1, false]]);
    expect(lineRows(seg)).toEqual([[0, -1, 0, true, 0, [0, 0, 0], -1, false]]);
    expect(etcRows(seg)).toEqual([[0, "", 0, -1, 0, false]]);
  });

  test("an int is cut like (int)lua_tonumber: TRIGGER_ID (-0.75 is not a negative id), the actions, PLAY_TYPE, LINE_ID, LINE_CAMERA, LINE_TELEPORT, CAMERA_INDEX, CAMERA_SHAKE_GAP, ACTIVE_LAYER_ID", () => {
    const { m, map } = setup();
    const data = table({
      TRIGGER_DATA_MESH0: table({ TRIGGER_ACTION: 2.75, PLAY_TYPE: 3.75 }),
      TRIGGER_DATA_LINE0: table({ TRIGGER_ACTION: 4.75, LINE_ID: 6.75, LINE_CAMERA: 7.75 }),
      TRIGGER_DATA_LINE1: table({ TRIGGER_ACTION: 6.75, LINE_TELEPORT: 9.75 }),
      TRIGGER_DATA_ETC0: table({ TRIGGER_ACTION: 3.75, CAMERA_INDEX: 2.75 }),
      TRIGGER_DATA_ETC1: table({ TRIGGER_ACTION: 4.75, CAMERA_SHAKE_GAP: 3.75 }),
      TRIGGER_DATA_ETC2: table({ TRIGGER_ACTION: 5.75, ACTIVE_LAYER_ID: 4.75 }),
    });
    expect(m("AddTrigger_LUA", table({ TRIGGER_ID: 5.75, TRIGGER_DATA0: data }))).toEqual([true]);
    expect(m("AddTrigger_LUA", table({ TRIGGER_ID: -0.75 }))).toEqual([true]);
    const [seg, zero] = map.m_LineMapTrigger.m_vecTriggerSeg as [TriggerSegment, TriggerSegment];
    expect([seg.m_iTriggerId, zero.m_iTriggerId]).toEqual([5, 0]);
    expect(meshRows(seg)).toEqual([[2, "", 0, "", 3, 1, false]]);
    expect(lineRows(seg)).toEqual([
      [4, 6, 0, true, 0, [0, 0, 0], 7, false],
      [6, -1, 0, true, 0, [0, 0, 0], 9, false],
    ]);
    expect(etcRows(seg)).toEqual([
      [3, "", 0, 2, 0, false],
      [4, "", 0, 3, 0, false],
      [5, "", 0, 4, 0, false],
    ]);
  });

  test("every action of a line reads its own keys and no other, whatever else the table has (0 and 7 read none)", () => {
    const { m, map } = setup();
    const keys = { DELAY_TIME: 1.5, LINE_ID: 4, LINE_ENABLE: 0, LINE_SPEED: 3.5, LINE_JUMPSPEED_X: 8.5, LINE_JUMPSPEED_Y: 9.5, LINE_CAMERA: 5, LINE_CANPASS: 0, LINE_TELEPORT: 6 };
    const entries: Record<string, LuaValue> = {};
    for (let action = 0; action <= 7; action++) entries[`TRIGGER_DATA_LINE${action}`] = table({ TRIGGER_ACTION: action, ...keys });
    m("AddTrigger_LUA", table({ TRIGGER_ID: 1, TRIGGER_DATA0: table(entries) }));
    // [action, line, time, enable, speed, jump speed, camera or teleport line, done]
    expect(lineRows(map.m_LineMapTrigger.m_vecTriggerSeg[0]!)).toEqual([
      [0, 4, 1.5, true, 0, [0, 0, 0], -1, false],
      [1, 4, 1.5, false, 0, [0, 0, 0], -1, false], // LINE_ENABLE
      [2, 4, 1.5, true, 3.5, [0, 0, 0], -1, false], // LINE_SPEED
      [3, 4, 1.5, true, 0, [8.5, 9.5, 0], -1, false], // LINE_JUMPSPEED_X / _Y
      [4, 4, 1.5, true, 0, [0, 0, 0], 5, false], // LINE_CAMERA
      [5, 4, 1.5, false, 0, [0, 0, 0], -1, false], // LINE_CANPASS
      [6, 4, 1.5, true, 0, [0, 0, 0], 6, false], // LINE_TELEPORT
      [7, 4, 1.5, true, 0, [0, 0, 0], -1, false],
    ]);
  });

  test("every action of an etc entry reads its own keys and no other, whatever else the table has (0, 2 and 6 read none)", () => {
    const { m, map } = setup();
    const keys = {
      DELAY_TIME: 0.5, LINE_SOUND: "snd", CAMERA_INDEX: 2, CAMERA_DURATION: 1.25, CAMERA_SHAKE_GAP: 3, CAMERA_SHAKE_DURATION: 0.75, ACTIVE_LAYER_ID: 4, FADE_TIME: 0.375,
    };
    const entries: Record<string, LuaValue> = {};
    for (let action = 0; action <= 6; action++) entries[`TRIGGER_DATA_ETC${action}`] = table({ TRIGGER_ACTION: action, ...keys });
    m("AddTrigger_LUA", table({ TRIGGER_ID: 1, TRIGGER_DATA0: table(entries) }));
    // [action, name, time, int value, float value, done]
    expect(etcRows(map.m_LineMapTrigger.m_vecTriggerSeg[0]!)).toEqual([
      [0, "", 0.5, -1, 0, false],
      [1, "snd", 0.5, -1, 0, false], // LINE_SOUND
      [2, "", 0.5, -1, 0, false],
      [3, "", 0.5, 2, 1.25, false], // CAMERA_INDEX, CAMERA_DURATION
      [4, "", 0.5, 3, 0.75, false], // CAMERA_SHAKE_GAP, CAMERA_SHAKE_DURATION
      [5, "", 0.5, 4, 0.375, false], // ACTIVE_LAYER_ID, FADE_TIME
      [6, "", 0.5, -1, 0, false],
    ]);
  });

  test("a field that belongs to another action is not read", () => {
    const { m, map } = setup();
    const data = table({
      TRIGGER_DATA_LINE0: table({ TRIGGER_ACTION: 2, LINE_ENABLE: 0, LINE_CANPASS: 0, LINE_SPEED: 3, LINE_CAMERA: 5, LINE_TELEPORT: 6, LINE_JUMPSPEED_X: 8 }),
      TRIGGER_DATA_LINE1: table({ TRIGGER_ACTION: 1, LINE_SPEED: 3, LINE_CANPASS: 0, LINE_CAMERA: 5 }),
      TRIGGER_DATA_LINE2: table({ TRIGGER_ACTION: 0, LINE_ENABLE: 0, LINE_SPEED: 3, LINE_CAMERA: 5, LINE_JUMPSPEED_Y: 4 }),
      TRIGGER_DATA_LINE3: table({ TRIGGER_ACTION: 9, LINE_ENABLE: 0, LINE_SPEED: 3, LINE_TELEPORT: 5 }),
      TRIGGER_DATA_ETC0: table({ TRIGGER_ACTION: 2, LINE_SOUND: "x", CAMERA_INDEX: 5, CAMERA_DURATION: 6, FADE_TIME: 7 }),
      TRIGGER_DATA_ETC1: table({ TRIGGER_ACTION: 3, LINE_SOUND: "x", CAMERA_SHAKE_GAP: 5, FADE_TIME: 7, ACTIVE_LAYER_ID: 8 }),
      TRIGGER_DATA_ETC2: table({ TRIGGER_ACTION: 9, CAMERA_INDEX: 5, ACTIVE_LAYER_ID: 8 }),
    });
    m("AddTrigger_LUA", table({ TRIGGER_ID: 1, TRIGGER_DATA0: data }));
    const seg = map.m_LineMapTrigger.m_vecTriggerSeg[0]!;
    expect(lineRows(seg).map((r) => [r[0], r[3], r[4], r[5], r[6]])).toEqual([
      [2, true, 3, [0, 0, 0], -1],
      [1, true, 0, [0, 0, 0], -1],
      [0, true, 0, [0, 0, 0], -1],
      [9, true, 0, [0, 0, 0], -1],
    ]);
    expect(etcRows(seg)).toEqual([
      [2, "", 0, -1, 0, false],
      [3, "", 0, -1, 0, false],
      [9, "", 0, -1, 0, false],
    ]);
  });

  test("a list of mesh / line / etc tables ends at the first number that is missing; a value that is not a table ends it too", () => {
    const { m, map } = setup();
    const data = table({
      TRIGGER_DATA_MESH0: meshA(), TRIGGER_DATA_MESH2: meshA(),
      TRIGGER_DATA_LINE0: table({ TRIGGER_ACTION: 1, LINE_ID: 1 }), TRIGGER_DATA_LINE1: 5, TRIGGER_DATA_LINE2: table({ TRIGGER_ACTION: 1, LINE_ID: 2 }),
      TRIGGER_DATA_ETC1: table({ TRIGGER_ACTION: 1, LINE_SOUND: "a" }),
    });
    m("AddTrigger_LUA", table({ TRIGGER_ID: 2, TRIGGER_DATA0: data }));
    const seg = map.m_LineMapTrigger.m_vecTriggerSeg[0]!;
    expect([meshRows(seg).length, lineRows(seg).length, etcRows(seg).length]).toEqual([1, 1, 0]);
    // TRIGGER_DATA0 that is not a table: nothing is read, the segment is still added
    m("AddTrigger_LUA", table({ TRIGGER_ID: 3, TRIGGER_DATA0: 7, TRIGGER_DATA1: data }));
    expect(map.m_LineMapTrigger.m_vecTriggerSeg[1]!.m_vecTriggerData.length).toBe(0);
  });

  test("the data are in the order of their numbers, past 9 as well (TRIGGER_DATA10 follows TRIGGER_DATA9)", () => {
    const { m, map } = setup();
    const entries: Record<string, LuaValue> = { TRIGGER_ID: 8 };
    for (let i = 0; i < 12; i++) entries[`TRIGGER_DATA${i}`] = table({ TRIGGER_DATA_LINE0: table({ TRIGGER_ACTION: 1, LINE_ID: 100 + i }) });
    m("AddTrigger_LUA", table(entries));
    const seg = map.m_LineMapTrigger.m_vecTriggerSeg[0]!;
    expect(seg.m_vecTriggerData.map((d) => d.m_vecTriggerLine[0]!.m_iTriggerLineIndex)).toEqual([100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111]);
  });
});

// ---- ReBuildLineGroup, EnableLineData ------------------------------------------------------------------------------------------------

describe("ReBuildLineGroup (32913840) and EnableLineData (3290E200)", () => {
  /** lines with (before, next, enabled) */
  const chain = (links: [number, number, boolean?][]) => {
    const s = setup();
    for (const [before, next, enable = true] of links) s.addLine({ BEFORE_LINE: before, NEXT_LINE: next, ENABLE: enable ? 1 : 0 });
    return s;
  };
  const groups = (map: CKTDGLineMap) => map.m_LineList.map((l) => [l.m_lineGroupID.m_iStartLineIndex, l.m_lineGroupID.m_iEndLineIndex]);

  test("a chain of lines that agree on their links is one group; a line with no links is a group of its own", () => {
    const { map } = chain([[-1, 1], [0, 2], [1, -1], [-1, 4], [3, -1], [-1, -1]]);
    map.reBuildLineGroup();
    expect(groups(map)).toEqual([[0, 2], [0, 2], [0, 2], [3, 4], [3, 4], [5, 5]]);
  });

  test("a line that does not point back ends the chain: its neighbours are not in the group", () => {
    const { map } = chain([[-1, 1], [7, 2], [1, -1], [-1, -1]]);
    map.reBuildLineGroup();
    expect(groups(map)).toEqual([[0, 0], [1, 2], [1, 2], [3, 3]]);
  });

  test("a disabled line has no group and cuts the chain", () => {
    const { map } = chain([[-1, 1], [0, 2, false], [1, -1]]);
    map.reBuildLineGroup();
    expect(groups(map)).toEqual([[0, 0], [-1, -1], [2, 2]]);
  });

  test("the chain runs forward from the line of the lowest index, then backward: a chain in reverse order starts at its last line", () => {
    const { map } = chain([[1, -1], [2, 0], [-1, 1]]);
    map.reBuildLineGroup();
    expect(groups(map)).toEqual([[2, 0], [2, 0], [2, 0]]);
  });

  test("a link to a line that is not there (negative or past the end) ends the chain", () => {
    const { map } = chain([[-1, 3], [0, 99], [-5, -1]]);
    map.reBuildLineGroup();
    expect(groups(map)).toEqual([[0, 0], [1, 1], [2, 2]]);
  });

  test("a loop is cut where the exe cuts it: the start line is not marked as taken, so it is met again", () => {
    const { map } = chain([[1, 1], [0, 0]]);
    map.reBuildLineGroup();
    expect(groups(map)).toEqual([[0, 0], [0, 0]]);
    // the groups are made again from nothing: an old number does not stay
    map.m_LineList[0]!.m_lineGroupID.m_iStartLineIndex = 42;
    map.reBuildLineGroup();
    expect(groups(map)).toEqual([[0, 0], [0, 0]]);
  });

  test("a list with no line is left alone", () => {
    const { map } = setup();
    map.reBuildLineGroup();
    expect(map.m_LineList.length).toBe(0);
  });

  test("EnableLineData_LUA changes the flag and, only when it changed, makes the groups again; an index that is not there does nothing", () => {
    const { map, m } = chain([[-1, 1], [0, 2], [1, -1]]);
    map.reBuildLineGroup();
    expect(groups(map)).toEqual([[0, 2], [0, 2], [0, 2]]);
    expect(m("EnableLineData_LUA", 1, false)).toEqual([]);
    expect(map.m_LineList[1]!.bEnable).toBe(false);
    expect(groups(map)).toEqual([[0, 0], [-1, -1], [2, 2]]);
    m("EnableLineData_LUA", 1, true);
    expect(groups(map)).toEqual([[0, 2], [0, 2], [0, 2]]);
    // the same value: no new groups (a number we put in stays)
    map.m_LineList[0]!.m_lineGroupID.m_iStartLineIndex = 99;
    m("EnableLineData_LUA", 1, true);
    expect(map.m_LineList[0]!.m_lineGroupID.m_iStartLineIndex).toBe(99);
    m("EnableLineData_LUA", 3, false);
    m("EnableLineData_LUA", -1, false);
    expect(map.m_LineList.map((l) => l.bEnable)).toEqual([true, true, true]);
    expect(map.m_LineList[0]!.m_lineGroupID.m_iStartLineIndex).toBe(99);
    // a number is a bool as the binder reads it
    m("EnableLineData_LUA", 0, 0);
    expect(map.m_LineList[0]!.bEnable).toBe(false);
  });
});

// ---- LoadLineMap ------------------------------------------------------------------------------------------------------------------------

describe("LoadLineMap (329127D0)", () => {
  const log = (w: HostWorld) => w.massFiles.log.entries.map((e) => [e.id, e.text]);

  test("the map is the global g_pLineMap before the script runs; the groups are made after it; the lines of an earlier load stay", () => {
    const { world, map, m, vec, addLine } = setup();
    addLine({}); // an earlier load's line: never removed
    const seen: unknown[] = [];
    world.execScript = (name) => {
      const g = world.G.globals.getStr("g_pLineMap") as LuaUserdata;
      seen.push(name, g instanceof LuaUserdata && g.data === map, map.m_LineList.map((l) => l.m_lineGroupID.m_iStartLineIndex));
      m("SetLandHeight", 5.5);
      m("AddLine_LUA", table({ START_POS: vec(0, 0, 0), END_POS: vec(10, 0, 0), NEXT_LINE: 2 }));
      m("AddLine_LUA", table({ START_POS: vec(10, 0, 0), END_POS: vec(20, 0, 0), BEFORE_LINE: 1 }));
      return true;
    };
    expect(map.loadLineMap("LINEMAP_X.lua")).toBe(true);
    expect(seen).toEqual(["LINEMAP_X.lua", true, [-1]]);
    expect(map.m_fLandHeight).toBe(5.5);
    expect(map.m_LineList.map((l) => [l.m_lineGroupID.m_iStartLineIndex, l.m_lineGroupID.m_iEndLineIndex])).toEqual([[0, 0], [1, 2], [1, 2]]);
    expect(log(world)).toEqual([]);
  });

  test("the trigger lists are emptied first; the other lists are not", () => {
    const { world, map, m, vec } = setup();
    m("AddTrigger_LUA", table({ TRIGGER_ID: 3 }));
    map.m_LineMapTrigger.m_vecNowTrigger.push(1, 2);
    m("AddStartPos", 4, vec(1, 2, 3), true, 0);
    m("SetTeamStartPos", true, vec(1, 2, 3), true, 0);
    m("AddCameraData_LUA", table({}));
    world.execScript = () => {
      m("AddTrigger_LUA", table({ TRIGGER_ID: 9 }));
      return true;
    };
    map.loadLineMap("A.lua");
    expect(map.m_LineMapTrigger.m_vecNowTrigger).toEqual([]);
    expect(map.m_LineMapTrigger.m_vecTriggerSeg.map((s) => s.m_iTriggerId)).toEqual([9]);
    expect([map.m_mapStartInfo.size, map.m_vecRedTeamStartInfo.length, map.m_vecCameraData.length]).toEqual([1, 1, 1]);
  });

  test("an empty name: error 0x48 with no text, then 0x14 with the name; false; the map is the global anyway", () => {
    const { world, map } = setup();
    let ran = 0;
    world.execScript = () => (ran++, true);
    expect(map.loadLineMap("")).toBe(false);
    expect(ran).toBe(0);
    expect(log(world)).toEqual([[0x48, ""], [0x14, ""]]);
    expect(((world.G.globals.getStr("g_pLineMap") as LuaUserdata).data as unknown) === map).toBe(true);
  });

  test("a script that is not there: 0x48 with the name, then 0x14; false", () => {
    const { world, map } = setup();
    expect(map.loadLineMap("NOT_THERE.lua")).toBe(false);
    expect(log(world)).toEqual([[0x48, "NOT_THERE.lua"], [0x14, "NOT_THERE.lua"]]);
  });

  test("a script that fails: 0x49 (and the Lua message), then 0x14; false; the lines it added stay and no group is made; a bug of ours is not swallowed", () => {
    const { world, map, m, vec } = setup();
    world.execScript = () => {
      m("AddLine_LUA", table({ START_POS: vec(0, 0, 0), END_POS: vec(10, 0, 0) }));
      throw new LuaError("LINEMAP_Y.lua:7: boom");
    };
    expect(map.loadLineMap("LINEMAP_Y.lua")).toBe(false);
    expect(log(world)).toEqual([[0x49, "LINEMAP_Y.lua: LINEMAP_Y.lua:7: boom"], [0x14, "LINEMAP_Y.lua"]]);
    expect(map.m_LineList.length).toBe(1);
    expect(map.m_LineList[0]!.m_lineGroupID.m_iStartLineIndex).toBe(-1);
    world.execScript = () => {
      throw new TypeError("ours");
    };
    expect(() => map.loadLineMap("Z.lua")).toThrow(TypeError);
  });

  const seg = (id: number, tag = ""): TriggerSegment => ({ m_iTriggerId: id, m_iTriggerDataIndex: 0, m_bLoop: false, m_vecTriggerData: [{ m_fElapsedTime: 0, m_vecTriggerMesh: [], m_vecTriggerLine: [], m_vecTriggerEtc: [{ m_iEtcTriggerAction: 1, m_wstrActionName: tag, m_fTriggerTime: 0, m_iDummyValue01: 0, m_fDummyValue01: 0, m_bDone: false }] }] });
  const ids = (segs: TriggerSegment[]) => segs.map((s) => s.m_iTriggerId + (s.m_vecTriggerData[0]?.m_vecTriggerEtc[0]?.m_wstrActionName ?? ""));

  test("the trigger segments are sorted by id when there are more than two (std::sort is not even called for two): 5 1 3 -> 1 3 5, 9 1 stays", () => {
    const { world, map, m } = setup();
    const load = (idsToAdd: number[]) => {
      world.execScript = () => {
        for (const id of idsToAdd) m("AddTrigger_LUA", table({ TRIGGER_ID: id }));
        return true;
      };
      map.loadLineMap("T.lua");
      return map.m_LineMapTrigger.m_vecTriggerSeg.map((s) => s.m_iTriggerId);
    };
    expect(load([5, 1, 3])).toEqual([1, 3, 5]);
    expect(load([9, 1])).toEqual([9, 1]);
    expect(load([2])).toEqual([2]);
    expect(load([])).toEqual([]);
    expect(load([4, 4, 2, 2, 0])).toEqual([0, 2, 2, 4, 4]);
  });

  test("sortTriggerSegments is an insertion sort that keeps the order of equal ids (up to 32 segments); 3 or more are sorted, 2 or fewer are not", () => {
    const a = [seg(4, "a"), seg(2, "b"), seg(4, "c"), seg(2, "d"), seg(3, "e")];
    sortTriggerSegments(a);
    expect(ids(a)).toEqual(["2b", "2d", "3e", "4a", "4c"]);
    const two = [seg(9, "x"), seg(1, "y")];
    sortTriggerSegments(two);
    expect(ids(two)).toEqual(["9x", "1y"]);
    const sorted = [seg(1, "p"), seg(1, "q"), seg(2, "r")];
    sortTriggerSegments(sorted);
    expect(ids(sorted)).toEqual(["1p", "1q", "2r"]);
    const lowestLast = [seg(5, "a"), seg(6, "b"), seg(7, "c"), seg(1, "d")];
    sortTriggerSegments(lowestLast);
    expect(ids(lowestLast)).toEqual(["1d", "5a", "6b", "7c"]);
    const reversed = Array.from({ length: 32 }, (_, i) => seg(31 - i));
    sortTriggerSegments(reversed);
    expect(reversed.map((s) => s.m_iTriggerId)).toEqual(Array.from({ length: 32 }, (_, i) => i));
    // 33 and more is the introsort of 32907AE0: not ported, and not guessed
    expect(() => sortTriggerSegments(Array.from({ length: 33 }, (_, i) => seg(i)))).toThrow(/not ported/);
  });
});

describe("the registered API", () => {
  test("every method that a line-map script calls is implemented; the queries are not (yet)", () => {
    const { rt } = setup();
    const status = rt.status().find((s) => s.cls === "CKTDGLineMap")!;
    expect(status.total).toBe(18);
    expect([...status.missing].sort()).toEqual(
      ["GetLandPosition_LUA", "GetNearest_LUA", "GetRandomPosition", "GetRandomPositionDir", "GetRandomPosition_LUA", "GetRandomStartPosIndex_LUA"].sort(),
    );
  });
});
