import { beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { LuaTable, LuaUserdata, tostr } from "@els/lua";
import { HostWorld, runCensus } from "@els/host";
import type { ScriptRun, Vec3 } from "@els/host";
import { CKTDGLineMap, LCT, LT } from "../src/index.ts";
import type { LineData } from "../src/index.ts";
import { indexAllKoms } from "../../../tools/komindex.ts";

const dataDir = join(import.meta.dir, "..", "..", "..", "data");
/** all 523 line-map scripts are members of data040.kom */
const haveData = existsSync(join(dataDir, "data040.kom"));

const f = Math.fround;

// ---- what the scripts say, read from the Lua tables with no help of the port ------------------------------------------------------

type Kind = "int" | "float" | "bool";
/** every key of `AddLine_LUA` that is not a vector: the member the exe stores it in, how it is read, and what a missing key leaves */
const FIELDS: [key: string, member: (l: LineData) => number | boolean, kind: Kind, missing: number | boolean][] = [
  ["LINE_TYPE", (l) => l.lineType, "int", 0],
  ["ENABLE", (l) => l.bEnable, "bool", true],
  ["POTAL_GROUP", (l) => l.potalGroup, "int", -1],
  ["STOP_FACTOR", (l) => l.fStopFactor, "float", 1],
  ["BEFORE_LINE", (l) => l.beforeLine, "int", -1],
  ["NEXT_LINE", (l) => l.nextLine, "int", -1],
  ["CAN_DOWN", (l) => l.bCanDown, "bool", true],
  ["LINE_SET", (l) => l.lineSet, "int", -1],
  ["SPEED", (l) => l.m_fSpeed, "float", 0],
  ["JUMP_SPEED_X", (l) => l.m_vJumpSpeed.x, "float", 0],
  ["JUMP_SPEED_Y", (l) => l.m_vJumpSpeed.y, "float", 0],
  ["TELEPORT_LINE", (l) => l.m_iTeleportLineIndex, "int", -1],
  ["ENABLE_WALL_JUMP", (l) => l.m_bEnableWallJump, "bool", false],
  ["MONSTER_ALLOWED", (l) => l.m_bMonsterAllowed, "bool", true],
  ["CAN_PASS", (l) => l.m_bCanPass, "bool", true],
  ["CLIFF_HEIGHT", (l) => l.m_fCliffHeight, "float", 0],
  ["CAMERA_INDEX", (l) => l.m_iCameraIndex, "int", -1],
  ["OTHER_ROAD_UP", (l) => l.m_bOtherRoadUp, "bool", false],
  ["TRIGGER_ID", (l) => l.m_iTriggerId, "int", -1],
  ["TRIGGER_ON_LINE", (l) => l.m_bFootOnLine, "bool", true],
  ["IS_UNDERWATER", (l) => l.m_bUnderWater, "bool", false],
  ["UNDERWATER_HEIGHT", (l) => l.m_fWaterHeight, "float", 0],
  ["UNDERWATER_BUOYANCY", (l) => l.m_fBuoyancy, "float", 0.6],
  ["UNDERWATER_RESISTANCE", (l) => l.m_fResistance, "float", 0.8],
  ["UNDERWATER_ANIMSPEED", (l) => l.m_fAnimSpeed, "float", 0.9],
  ["UNDERWATER_VARIANCEOXYEN", (l) => l.m_fVarianceOxyen, "float", -1],
  ["UNIT_COLOR_R", (l) => l.m_cLineColor.r, "float", 0],
  ["UNIT_COLOR_G", (l) => l.m_cLineColor.g, "float", 0],
  ["UNIT_COLOR_B", (l) => l.m_cLineColor.b, "float", 0],
  ["FORCE_CHANGE_COLOR", (l) => l.m_bForceChangeColor, "bool", false],
  ["TEMP_LINE_MAP", (l) => l.m_bTempLineMap, "bool", false],
  ["LINEMAP_DIRECTION_OPTION", (l) => l.m_eDirection, "int", 0],
  ["JUMP_REL_UP_KEYSTOP_TIME", (l) => l.m_fKeyStopTime, "float", 0],
  ["CHANGE_LINE_TYPE_AFTER_CLEAR_STAGE", (l) => l.m_eLineTypeAfterClearStage, "int", -1],
  ["CHANGE_AFTER_CLEAR_STAGE", (l) => l.m_iChangeAfterClearStage, "int", -1],
  ["CHANGE_AFTER_CLEAR_SUB_STAGE", (l) => l.m_iChangeAfterClearSubStage, "int", -1],
  ["PORTAL_WHEN_ACTIVE_RAID", (l) => l.m_bIsPortalWhenActiveRaid, "bool", false],
];

/** a script's value: only numbers occur (no boolean, no numeric string, no table) in the keys the exe reads: asserted below */
const raw = (t: LuaTable, key: string): number | undefined => {
  const v = t.getStr(key);
  if (v === undefined) return undefined;
  if (typeof v !== "number") throw new Error(`${key} is not a number: ${typeof v}`);
  return v;
};
const vecOf = (t: LuaTable, key: string): number[] | undefined => {
  const v = t.getStr(key);
  return v instanceof LuaUserdata ? (v.data as Vec3).toArray().slice(0, 3) : undefined;
};
const sub = (t: LuaTable, key: string): LuaTable | undefined => {
  const v = t.getStr(key);
  return v instanceof LuaTable ? v : undefined;
};
const count = (t: LuaTable, prefix: string): number => {
  let n = 0;
  while (sub(t, prefix + n)) n++;
  return n;
};

/** a line map that checks every call of the script against what it made of it (the first mismatch of each kind is kept) */
class Probe extends CKTDGLineMap {
  skipped = 0;
  checked = { lines: 0, cameras: 0, segments: 0, entries: 0 };
  readonly problems: string[] = [];
  constructor(private readonly host: HostWorld, readonly script: string) {
    super({ world: host });
  }
  private bad(what: string): void {
    if (this.problems.length < 20) this.problems.push(`${this.script}: ${what}`);
  }
  override AddLine_LUA(): boolean {
    const t = this.host.rt.topOfStack() as LuaTable;
    const ok = super.AddLine_LUA();
    if (!ok) {
      this.skipped++;
      if ((raw(t, "LINE_DEPTH") ?? 0) === 0) this.bad("AddLine_LUA said false for a line with no LINE_DEPTH");
      return ok;
    }
    this.checked.lines++;
    const line = this.m_LineList[this.m_LineList.length - 1]!;
    for (const [key, member, kind, missing] of FIELDS) {
      const v = raw(t, key);
      const want = v === undefined ? (kind === "float" ? f(missing as number) : missing) : kind === "int" ? Math.trunc(v) : kind === "float" ? f(v) : v !== 0;
      const got = member(line);
      if (got !== want) this.bad(`line ${line.lineIndex} ${key}: ${String(got)}, the script says ${String(v)} (${String(want)})`);
    }
    const dust = (raw(t, "IS_UNDERWATER") ?? 0) !== 0 ? 1 : Math.trunc(raw(t, "DUST_TYPE") ?? 0);
    if (line.eDustType !== dust) this.bad(`line ${line.lineIndex} DUST_TYPE ${line.eDustType}, wanted ${dust}`);
    if (vecOf(t, "START_POS")?.join() !== line.startPos.toArray().slice(0, 3).join()) this.bad(`line ${line.lineIndex} START_POS`);
    if (vecOf(t, "END_POS")?.join() !== line.endPos.toArray().slice(0, 3).join()) this.bad(`line ${line.lineIndex} END_POS`);
    if (line.lineIndex !== this.m_LineList.length - 1) this.bad(`line ${line.lineIndex} is not the place in the list`);
    return ok;
  }
  override AddCameraData_LUA(): boolean {
    const t = this.host.rt.topOfStack() as LuaTable;
    const ok = super.AddCameraData_LUA();
    this.checked.cameras++;
    const cam = this.m_vecCameraData[this.m_vecCameraData.length - 1]!;
    const rel = ["RELATIVE_EYE_POS_X", "RELATIVE_EYE_POS_Y", "RELATIVE_EYE_POS_Z"].map((k) => raw(t, k));
    if (rel.every((v) => v !== undefined)) {
      if (cam.m_eType !== LCT.RELATIE_POSITION) this.bad("camera: three relative positions but not a relative camera");
      if (cam.m_vRelativeEye.toArray().slice(0, 3).join() !== rel.map((v) => f(v!)).join()) this.bad("camera: the relative position");
      if (cam.m_fCameraRepositionSpeed !== f(raw(t, "CAMERA_REPOSITION_SPEED") ?? 100)) this.bad("camera: the reposition speed");
    } else {
      if (cam.m_eType !== LCT.ABSOULTE_POSITION) this.bad("camera: not three relative positions but not an absolute camera");
      if (cam.m_bFocusUnit !== ((raw(t, "FOCUS_UNIT") ?? 1) !== 0)) this.bad("camera: FOCUS_UNIT");
      if (cam.m_vEye.toArray().slice(0, 3).join() !== (vecOf(t, "EYE_POS") ?? [0, 0, 0]).join()) this.bad("camera: EYE_POS");
      if (cam.m_vLookAt.toArray().slice(0, 3).join() !== (vecOf(t, "LOOKAT_POS") ?? [0, 0, 0]).join()) this.bad("camera: LOOKAT_POS");
    }
    return ok;
  }
  override AddTrigger_LUA(): boolean {
    const t = this.host.rt.topOfStack() as LuaTable;
    const before = this.m_LineMapTrigger.m_vecTriggerSeg.length;
    const ok = super.AddTrigger_LUA();
    const id = raw(t, "TRIGGER_ID");
    if (!ok) {
      this.bad(`AddTrigger_LUA said false (TRIGGER_ID ${String(id)})`);
      return ok;
    }
    this.checked.segments++;
    const seg = this.m_LineMapTrigger.m_vecTriggerSeg[before]!;
    if (seg.m_iTriggerId !== id) this.bad(`segment ${before}: id ${seg.m_iTriggerId}, the script says ${String(id)}`);
    if (seg.m_bLoop !== ((raw(t, "TRIGGER_LOOP") ?? 0) !== 0)) this.bad(`segment ${before}: loop`);
    const n = count(t, "TRIGGER_DATA");
    if (seg.m_vecTriggerData.length !== n) this.bad(`segment ${before}: ${seg.m_vecTriggerData.length} data, the script has ${n}`);
    for (let i = 0; i < Math.min(n, seg.m_vecTriggerData.length); i++) {
      const d = sub(t, `TRIGGER_DATA${i}`)!;
      const got = seg.m_vecTriggerData[i]!;
      const kinds = [
        ["TRIGGER_DATA_MESH", got.m_vecTriggerMesh.map((e) => [e.m_iMeshTriggerAction, e.m_fTriggerTime])],
        ["TRIGGER_DATA_LINE", got.m_vecTriggerLine.map((e) => [e.m_iLineTriggerAction, e.m_fTriggerTime])],
        ["TRIGGER_DATA_ETC", got.m_vecTriggerEtc.map((e) => [e.m_iEtcTriggerAction, e.m_fTriggerTime])],
      ] as const;
      for (const [prefix, entries] of kinds) {
        const k = count(d, prefix);
        if (entries.length !== k) this.bad(`segment ${before} data ${i}: ${entries.length} of ${prefix}, the script has ${k}`);
        for (let j = 0; j < Math.min(k, entries.length); j++) {
          const e = sub(d, prefix + j)!;
          this.checked.entries++;
          const want = [Math.trunc(raw(e, "TRIGGER_ACTION") ?? 0), f(raw(e, "DELAY_TIME") ?? 0)];
          if (entries[j]!.join() !== want.join()) this.bad(`segment ${before} data ${i} ${prefix}${j}: ${entries[j]!.join()} / ${want.join()}`);
        }
      }
      const meshes = count(d, "TRIGGER_DATA_MESH");
      for (let j = 0; j < Math.min(meshes, got.m_vecTriggerMesh.length); j++) {
        const e = sub(d, `TRIGGER_DATA_MESH${j}`)!;
        if (got.m_vecTriggerMesh[j]!.m_wstrMeshName !== tostr(e.getStr("MESH_NAME") ?? "")) this.bad(`segment ${before} mesh ${j}: MESH_NAME`);
        if (got.m_vecTriggerMesh[j]!.m_wstrName !== tostr(e.getStr("ANIM_NAME") ?? "")) this.bad(`segment ${before} mesh ${j}: ANIM_NAME`);
      }
    }
    return ok;
  }
}

interface Loaded {
  names: string[];
  recorded: Map<string, ScriptRun>;
  maps: Map<string, Probe>;
  log: [number, string][];
}
let loaded: Promise<Loaded> | undefined;
/** the 523 scripts: once recorded on stubs (what they call, counted by the host layer), once run strictly on the port (one Lua state, as the exe has) */
function load(): Promise<Loaded> {
  loaded ??= (async () => {
    const index = await indexAllKoms();
    const scripts = new Map<string, Uint8Array>();
    for (const [name, hit] of index) if (name.endsWith(".LUA")) scripts.set(name, await hit.kom.read(hit.entry));
    const needle = Buffer.from("g_pLineMap");
    const names = [...scripts].filter(([, b]) => Buffer.from(b.buffer, b.byteOffset, b.byteLength).includes(needle)).map(([n]) => n).sort();

    const recorded = runCensus(scripts, names);

    const world = new HostWorld({ readScript: (n) => scripts.get(n), notPorted: "throw" });
    world.loadEnums();
    world.rt.registerImpl("CKTDGLineMap", CKTDGLineMap);
    const maps = new Map<string, Probe>();
    for (const name of names) {
      const map = new Probe(world, name);
      if (!map.loadLineMap(name)) throw new Error(`${name}: LoadLineMap said false`);
      maps.set(name, map);
    }
    return { names, recorded, maps, log: world.massFiles.log.entries.map((e) => [e.id, e.text] as [number, string]) };
  })();
  return loaded;
}

describe.skipIf(!haveData)("the line-map scripts of the client (523 of the 4,498 scripts name g_pLineMap)", () => {
  let d: Loaded;
  beforeAll(async () => {
    d = await load();
  }, 240_000);
  const all = <T>(pick: (m: Probe) => T[]): T[] => [...d.maps.values()].flatMap(pick);
  const sum = (pick: (m: Probe) => number): number => [...d.maps.values()].reduce((s, m) => s + pick(m), 0);
  const calls = (name: string, method: string): number => d.recorded.get(name)!.calls.get(`CKTDGLineMap.${method}`) ?? 0;

  test("they are every script with LINEMAP in its name, they all run on stubs, and they run strictly on the port without an error", () => {
    expect(d.names.length).toBe(523);
    expect(d.names.filter((n) => /_LINEMAP\.LUA$/.test(n)).length).toBe(517);
    expect(d.names.filter((n) => !/_LINEMAP\.LUA$/.test(n)).every((n) => /^LINEMAP_/.test(n))).toBe(true);
    expect([...d.recorded].filter(([, r]) => !r.ok).map(([n, r]) => `${n}: ${r.error}`)).toEqual([]);
    expect(d.log.filter(([id]) => id === 0x48 || id === 0x49 || id === 0x14)).toEqual([]);
    expect(d.maps.size).toBe(523);
  });

  test("the scripts call exactly the six setup methods; none of the 18 registered queries is ever called from a line-map script", () => {
    const methods = new Set<string>();
    for (const r of d.recorded.values()) for (const k of r.calls.keys()) methods.add(k);
    expect([...methods].sort()).toEqual(
      ["AddCameraData_LUA", "AddLine_LUA", "AddStartPos", "AddTrigger_LUA", "SetLandHeight", "SetTeamStartPos"].map((m) => `CKTDGLineMap.${m}`).sort(),
    );
    // each script sets the land height, and the total of every call that the host layer counted
    expect(d.names.every((n) => calls(n, "SetLandHeight") >= 1)).toBe(true);
    const total = (m: string) => d.names.reduce((s, n) => s + calls(n, m), 0);
    expect([total("SetLandHeight"), total("SetTeamStartPos"), total("AddStartPos"), total("AddLine_LUA"), total("AddCameraData_LUA"), total("AddTrigger_LUA")]).toEqual([
      523, 2368, 37183, 18093, 477, 15,
    ]);
  });

  test("what the port stored is what the host layer counted: every call is a line (or a LINE_DEPTH skip), a camera, a segment, a start key (or a replaced one)", () => {
    const off: string[] = [];
    for (const name of d.names) {
      const m = d.maps.get(name)!;
      if (calls(name, "AddLine_LUA") !== m.m_LineList.length + m.skipped) off.push(`${name}: lines`);
      if (calls(name, "AddCameraData_LUA") !== m.m_vecCameraData.length) off.push(`${name}: cameras`);
      if (calls(name, "AddTrigger_LUA") !== m.m_LineMapTrigger.m_vecTriggerSeg.length) off.push(`${name}: segments`);
      if (calls(name, "SetTeamStartPos") !== m.m_vecRedTeamStartInfo.length + m.m_vecBlueTeamStartInfo.length) off.push(`${name}: team starts`);
      if (calls(name, "AddStartPos") !== m.m_mapStartInfo.size) off.push(`${name}: start keys ${calls(name, "AddStartPos")} / ${m.m_mapStartInfo.size}`);
    }
    // the one script that gives a key twice: the second AddStartPos replaced the first (std::map operator[])
    expect(off).toEqual(["EL_FOREST_EXTRA_STAGE3_LINEMAP.LUA: start keys 14 / 13"]);
    // the only script with LINE_DEPTH: six lines of VELDER_THIRD_DWELLING_STAGE2 (all LINE_DEPTH = 1) that AddLine_LUA does not add
    expect(d.names.filter((n) => d.maps.get(n)!.skipped > 0).map((n) => [n, d.maps.get(n)!.skipped])).toEqual([["VELDER_THIRD_DWELLING_STAGE2_LINEMAP.LUA", 6]]);
    // the totals
    expect([sum((m) => m.m_LineList.length), sum((m) => m.m_vecCameraData.length), sum((m) => m.m_LineMapTrigger.m_vecTriggerSeg.length)]).toEqual([18087, 477, 15]);
    expect([sum((m) => m.m_mapStartInfo.size), sum((m) => m.m_vecRedTeamStartInfo.length), sum((m) => m.m_vecBlueTeamStartInfo.length)]).toEqual([37182, 2285, 83]);
    expect(sum((m) => m.m_WallList.length)).toBe(36);
  });

  test("every field of every line, camera and trigger segment is what the script's own table says (read from the Lua table, not through the port)", () => {
    const problems = all((m) => m.problems);
    expect(problems).toEqual([]);
    expect([sum((m) => m.checked.lines), sum((m) => m.checked.cameras), sum((m) => m.checked.segments)]).toEqual([18087, 477, 15]);
    expect(sum((m) => m.checked.entries)).toBe(78); // 31 mesh + 19 line + 28 etc
  });

  test("the shape of the data: the types of the lines, the cameras, the trigger segments", () => {
    const byType = new Map<number, number>();
    for (const l of all((m) => m.m_LineList)) byType.set(l.lineType, (byType.get(l.lineType) ?? 0) + 1);
    expect(Object.fromEntries([...byType].sort((a, b) => a[0] - b[0]))).toEqual({
      [LT.NORMAL]: 17528, [LT.WALL]: 36, [LT.POTAL]: 118, [LT.JUMP_UP_REL]: 58, [LT.JUMP_UP_ABS]: 1, [LT.BUNGEE]: 86, [LT.MONSTER_ROAD]: 221, [LT.UNIT_ROAD]: 27,
      [LT.OTHER_ROAD]: 11, [LT.CLIFF]: 1,
    });
    expect(byType.get(LT.HOLE)).toBeUndefined();
    const cams = new Map<number, number>();
    for (const c of all((m) => m.m_vecCameraData)) cams.set(c.m_eType, (cams.get(c.m_eType) ?? 0) + 1);
    expect(Object.fromEntries(cams)).toEqual({ [LCT.ABSOULTE_POSITION]: 412, [LCT.RELATIE_POSITION]: 65 });
    // 15 segments in 13 scripts: 11 scripts have one, 2 have two (so the exe's std::sort, called for 3 or more, never runs on a script of the game)
    const perScript = new Map<number, number>();
    for (const m of d.maps.values()) perScript.set(m.m_LineMapTrigger.m_vecTriggerSeg.length, (perScript.get(m.m_LineMapTrigger.m_vecTriggerSeg.length) ?? 0) + 1);
    expect(Object.fromEntries(perScript)).toEqual({ 0: 510, 1: 11, 2: 2 });
    // every segment has one data table, and the 78 entries of it are 31 + 19 + 28
    const data = all((m) => m.m_LineMapTrigger.m_vecTriggerSeg.flatMap((s) => s.m_vecTriggerData));
    expect([data.length, data.reduce((s, x) => s + x.m_vecTriggerMesh.length, 0), data.reduce((s, x) => s + x.m_vecTriggerLine.length, 0), data.reduce((s, x) => s + x.m_vecTriggerEtc.length, 0)]).toEqual([15, 31, 19, 28]);
    expect(all((m) => m.m_LineMapTrigger.m_vecNowTrigger)).toEqual([]);
  });

  test("geometry: length, direction, bounds and angles of every line follow from its two end points (closed form, in doubles)", () => {
    let nonVertical = 0;
    const off: string[] = [];
    const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;
    for (const [name, m] of d.maps) {
      const ordinary = (l: LineData) => l.lineType !== LT.BUNGEE && l.lineType !== LT.WALL;
      // the bounds start from the first line only when it counts: otherwise from the 0s of the constructor
      let lo = [0, 0], hi = [0, 0];
      if (m.m_LineList.length > 0 && ordinary(m.m_LineList[0]!)) {
        const l = m.m_LineList[0]!;
        lo = [Math.min(l.startPos.x, l.endPos.x), Math.min(l.startPos.y, l.endPos.y)];
        hi = [Math.max(l.startPos.x, l.endPos.x), Math.max(l.startPos.y, l.endPos.y)];
      }
      for (const l of m.m_LineList) {
        const s = l.startPos, e = l.endPos;
        const dx = e.x - s.x, dy = e.y - s.y, dz = e.z - s.z;
        const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const tag = `${name}#${l.lineIndex}`;
        if (ordinary(l)) {
          lo = [Math.min(lo[0]!, s.x, e.x), Math.min(lo[1]!, s.y, e.y)];
          hi = [Math.max(hi[0]!, s.x, e.x), Math.max(hi[1]!, s.y, e.y)];
        }
        if (!near(l.fLength, len, len * 1e-6)) off.push(`${tag}: length ${l.fLength} / ${len}`);
        const min = [Math.min(s.x, e.x), Math.min(s.y, e.y), Math.min(s.z, e.z)], max = [Math.max(s.x, e.x), Math.max(s.y, e.y), Math.max(s.z, e.z)];
        if (l.m_vPosMin.toArray().slice(0, 3).join() !== min.join() || l.m_vPosMax.toArray().slice(0, 3).join() !== max.join()) off.push(`${tag}: min / max`);
        // a vertical line (a wall) and a line of length 0 have a LookAt matrix without an inverse: the exe's angles are unspecified there
        const singular = dx === 0 && dz === 0;
        if (l.unspecifiedAngles !== singular) off.push(`${tag}: unspecifiedAngles ${l.unspecifiedAngles}, the line is ${singular ? "" : "not "}vertical or empty`);
        if (singular) {
          if (len === 0 ? l.dirVector.toArray().slice(0, 3).some((v) => v !== 0) : false) off.push(`${tag}: direction of a line of length 0`);
          continue;
        }
        nonVertical++;
        const dir = [dx / len, dy / len, dz / len];
        if (l.dirVector.toArray().slice(0, 3).some((v, i) => !near(v, dir[i]!, 2e-7))) off.push(`${tag}: direction`);
        // the yaw is a turn about y: (cos, sin) of it are (dx, -dz) / |(dx, dz)|; the sign of a half turn (a line along -x) is not specified, so the angle is not compared
        const flat = Math.hypot(dx, dz);
        const yaw = l.dirRadian.y;
        if (!near(Math.cos(yaw), dx / flat, 1e-5) || !near(Math.sin(yaw), -dz / flat, 1e-5)) off.push(`${tag}: yaw ${yaw}`);
        // the pitch is asin(dir.y); near vertical a float of error in dir.y is a lot of angle, so the steepest lines are held to a looser bound
        const tol = Math.abs(dir[1]!) > 0.999 ? 2e-3 : 2e-6 + 4e-7 / Math.sqrt(1 - dir[1]! * dir[1]!);
        if (!near(l.dirRadian.z, Math.asin(dir[1]!), tol)) off.push(`${tag}: pitch ${l.dirRadian.z} / ${Math.asin(dir[1]!)}`);
        if (l.dirRadian.x !== 0) off.push(`${tag}: roll ${l.dirRadian.x}`);
        // degrees are radians x 57.29578 as floats
        const deg = [l.dirDegree.x, l.dirDegree.y, l.dirDegree.z], rad = [l.dirRadian.x, l.dirRadian.y, l.dirRadian.z];
        if (deg.some((v, i) => v !== f(f(rad[i]!) * 57.2957763671875))) off.push(`${tag}: degrees`);
      }
      if ([m.m_fXMin, m.m_fYMin, m.m_fXMax, m.m_fYMax].join() !== [lo[0], lo[1], hi[0], hi[1]].join()) off.push(`${name}: bounds ${[m.m_fXMin, m.m_fYMin, m.m_fXMax, m.m_fYMax]} / ${[lo, hi]}`);
    }
    expect(off.slice(0, 20)).toEqual([]);
    expect(nonVertical).toBe(18087 - 36);
    // the 36 lines with no D3DX inverse: 34 vertical lines, all of them walls (in 10 scripts), and the two lines of length 0 of ELDER_SECRET_BOSS (NORMAL)
    const flagged = [...d.maps].flatMap(([name, m]) => m.m_LineList.filter((l) => l.unspecifiedAngles).map((l) => ({ name, index: l.lineIndex, type: l.lineType, length: l.fLength })));
    expect(flagged.length).toBe(36);
    const vertical = flagged.filter((x) => x.length !== 0);
    expect([vertical.length, vertical.every((x) => x.type === LT.WALL), new Set(vertical.map((x) => x.name)).size]).toEqual([34, true, 10]);
    expect(flagged.filter((x) => x.length === 0)).toEqual([
      { name: "ELDER_SECRET_BOSS_LINEMAP.LUA", index: 1, type: LT.NORMAL, length: 0 },
      { name: "ELDER_SECRET_BOSS_LINEMAP.LUA", index: 5, type: LT.NORMAL, length: 0 },
    ]);
  });

  test("the groups: every chain of enabled lines that agree on their links is one group, as union-find over the mutual links says; no loop in the data", () => {
    let groups = 0, off = 0;
    const notes: string[] = [];
    for (const [name, m] of d.maps) {
      const lines = m.m_LineList, n = lines.length;
      const parent = Array.from({ length: n }, (_, i) => i);
      const find = (a: number): number => {
        while (parent[a] !== a) a = parent[a] = parent[parent[a]!]!;
        return a;
      };
      const mutual = (a: number, b: number) => b >= 0 && b < n && lines[a]!.bEnable && lines[b]!.bEnable && lines[a]!.nextLine === b && lines[b]!.beforeLine === a;
      for (let i = 0; i < n; i++) if (mutual(i, lines[i]!.nextLine)) parent[find(lines[i]!.nextLine)] = find(i);
      const chains = new Map<number, number[]>();
      for (let i = 0; i < n; i++) if (lines[i]!.bEnable) (chains.get(find(i)) ?? chains.set(find(i), []).get(find(i))!).push(i);
      for (const members of chains.values()) {
        groups++;
        // a chain is a path: one line with no mutual line before it (the first), one with none after it (the last)
        const first = members.filter((i) => !members.some((j) => mutual(j, i)));
        const last = members.filter((i) => !members.some((j) => mutual(i, j)));
        if (first.length !== 1 || last.length !== 1) {
          off++;
          notes.push(`${name}: a loop at ${members.slice(0, 5)}`);
          continue;
        }
        for (const i of members) {
          const g = lines[i]!.m_lineGroupID;
          if (g.m_iStartLineIndex !== first[0] || g.m_iEndLineIndex !== last[0]) {
            off++;
            notes.push(`${name}#${i}: group ${g.m_iStartLineIndex}..${g.m_iEndLineIndex}, the chain is ${first[0]}..${last[0]}`);
          }
        }
      }
      for (const l of lines) if (!l.bEnable && (l.m_lineGroupID.m_iStartLineIndex !== -1 || l.m_lineGroupID.m_iEndLineIndex !== -1)) notes.push(`${name}#${l.lineIndex}: a disabled line with a group`);
    }
    expect(notes.slice(0, 10)).toEqual([]);
    expect(off).toBe(0);
    expect(groups).toBe(7210);
  });
});
