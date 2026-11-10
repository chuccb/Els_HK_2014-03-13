/**
 * `CKTDGLineMap` (the Lua class `CKTDGLineMap`, 0x15C bytes, a `CKTDGObject` in C++ that luabind registers without a base): the walkable
 * lines of a stage.  A `*_LINEMAP.LUA` script describes one through the global `g_pLineMap`: `SetLandHeight`, `SetTeamStartPos`,
 * `AddStartPos`, `AddCameraData_LUA`, `AddLine_LUA` and `AddTrigger_LUA`.
 *
 * `CX2World::SetLineMap_LUA` (32DE07A0) makes the object (`operator new(0x15C)`, the constructor 329081A0) and runs `LoadLineMap` 329127D0 on
 * it: the trigger vectors are emptied, the object becomes the global `g_pLineMap`, the script runs (a missing script is error 0x48, one that
 * fails 0x49, and each ends with 0x14 and the answer false), then `ReBuildLineGroup` 32913840 numbers the chains of lines and the trigger
 * segments are sorted by id (`std::sort` with `TriggerLess`).  The lines, start positions and cameras of an earlier load stay: the exe never
 * empties them.
 *
 * What the constructor does with a `ID3DXLine` (`D3DXCreateLine`, width 3, antialiased: the debug drawing of the lines) and with the vertex
 * buffer of that drawing is not here; nothing a script can reach depends on it.
 */
import { LuaError } from "@els/lua";
import { KLuaManager, Vec3 } from "@els/host";
import type { CKTDGLineMap_Methods, HostWorld } from "@els/host";
import { matInverse, matLookAtLH, vec3Normalize } from "@els/d3d9";
import { IntMap } from "./intmap.ts";
import { CameraData, LCT, LT, LDT, LineData, StartInfo } from "./linedata.ts";
import type { LineMapTrigger, TriggerData, TriggerDataEtc, TriggerDataLine, TriggerDataMesh, TriggerSegment } from "./linedata.ts";

const f = Math.fround;
/** 57.295776f (180 / pi as the exe's `float`: the constant at 334AC5B8) */
const RAD_TO_DEG = 57.2957763671875;

/** what `MakeLine` reads when `D3DXMatrixInverse` fails: the exe reads a slot of its stack that nothing wrote (see `makeLine`) */
const STALE_MATRIX = new Float32Array(16);

/** `minss a, b` (the exe's `fminf` / `fmaxf` of two floats): the second operand when the compare fails (NaN or equal) */
const minss = (a: number, b: number): number => (a < b ? a : b);
const maxss = (a: number, b: number): number => (a > b ? a : b);

/** what the line map needs of the client: the Lua world (one state: `g_pLineMap` is published into it) */
export interface LineMapContext {
  readonly world: HostWorld;
}

export class CKTDGLineMap implements Partial<CKTDGLineMap_Methods> {
  readonly m_LineList: LineData[] = [];
  readonly m_WallList: LineData[] = [];
  m_fLandHeight = 0;
  readonly m_vecRedTeamStartInfo: StartInfo[] = [];
  readonly m_vecBlueTeamStartInfo: StartInfo[] = [];
  readonly m_mapStartInfo = new IntMap<StartInfo>();
  readonly m_vecCameraData: CameraData[] = [];
  m_fXMin = 0;
  m_fXMax = 0;
  m_fYMin = 0;
  m_fYMax = 0;
  m_fStopTime = 0;
  m_iNumofLineMapCreatedByMonster = 0;
  readonly m_LineMapTrigger: LineMapTrigger = { m_vecNowTrigger: [], m_vecTriggerSeg: [] };

  constructor(private readonly ctx: LineMapContext) {}

  // ---- the script side ------------------------------------------------------------------------------------------------------

  /** `SetLandHeight(float)` (328CD810) */
  SetLandHeight(fLandHeight: number): void {
    this.m_fLandHeight = f(fLandHeight);
  }

  /** `SetTeamStartPos(bool bRed, D3DXVECTOR3 pos, bool bRight, int iLineIndex)` (328CE120): appended to the red or the blue team's list */
  SetTeamStartPos(bRed: boolean, pos: Vec3, bRight: boolean, iLineIndex: number): void {
    (bRed ? this.m_vecRedTeamStartInfo : this.m_vecBlueTeamStartInfo).push(new StartInfo(pos, bRight, iLineIndex));
  }

  /** `AddStartPos(int key, D3DXVECTOR3 pos, bool bRight, int iLineIndex)` (328C0DE0): `m_mapStartInfo[key] = ...`: a key that is there is replaced */
  AddStartPos(key: number, pos: Vec3, bRight: boolean, iLineIndex: number): void {
    this.m_mapStartInfo.getOrInsert(key, () => new StartInfo());
    const info = this.m_mapStartInfo.get(key)!;
    info.m_vStartPos.set(pos.x, pos.y, pos.z);
    info.m_bStartRight = bRight;
    info.m_iStartLineIndex = iLineIndex;
  }

  /**
   * `AddCameraData_LUA()` (329093C0): the table on the stack names a camera.  When all three of `RELATIVE_EYE_POS_X/Y/Z` are there it is a
   * camera relative to the unit (`CAMERA_REPOSITION_SPEED`, default 100); otherwise an absolute one (`FOCUS_UNIT`, default true, `EYE_POS`,
   * `LOOKAT_POS`, default zeros) that still holds the relative values that were found (a missing one is 0).  Always true.
   */
  AddCameraData_LUA(): boolean {
    const m = new KLuaManager(this.ctx.world.rt, 1);
    const camera = new CameraData();
    const x = m.getFloat("RELATIVE_EYE_POS_X");
    const y = m.getFloat("RELATIVE_EYE_POS_Y");
    const z = m.getFloat("RELATIVE_EYE_POS_Z");
    camera.m_vRelativeEye.set(x ?? 0, y ?? 0, z ?? 0);
    if (x !== undefined && y !== undefined && z !== undefined) {
      camera.m_eType = LCT.RELATIE_POSITION;
      camera.m_fCameraRepositionSpeed = m.getFloat("CAMERA_REPOSITION_SPEED") ?? 100;
    } else {
      camera.m_eType = LCT.ABSOULTE_POSITION;
      camera.m_bFocusUnit = m.getBool("FOCUS_UNIT") ?? true;
      const eye = m.getVec3("EYE_POS");
      if (eye) camera.m_vEye.set(eye.x, eye.y, eye.z);
      const lookAt = m.getVec3("LOOKAT_POS");
      if (lookAt) camera.m_vLookAt.set(lookAt.x, lookAt.y, lookAt.z);
    }
    this.m_vecCameraData.push(camera);
    return true;
  }

  /**
   * `AddLine_LUA()` (329095A0): one line from the table on the stack (every key is optional; the defaults are below).  `LINE_DEPTH`, when it is
   * there and not 0, ends the call with false after the line was made (the exe never frees it and never adds it).  A `LT_WALL` line is also
   * put in `m_WallList`; `m_fXMin / XMax / YMin / YMax` take in every line that is neither a wall nor a bungee.
   */
  AddLine_LUA(): boolean {
    const m = new KLuaManager(this.ctx.world.rt, 1);
    const line = new LineData();
    line.lineType = m.getInt("LINE_TYPE") ?? LT.NORMAL;
    line.bEnable = m.getBool("ENABLE") ?? true;
    line.potalGroup = m.getInt("POTAL_GROUP") ?? -1;
    line.fStopFactor = m.getFloat("STOP_FACTOR") ?? 1;
    line.eDustType = m.getInt("DUST_TYPE") ?? LDT.DEFALT_DUST;
    line.beforeLine = m.getInt("BEFORE_LINE") ?? -1;
    line.nextLine = m.getInt("NEXT_LINE") ?? -1;
    line.bCanDown = m.getBool("CAN_DOWN") ?? true;
    line.lineSet = m.getInt("LINE_SET") ?? -1;
    line.m_fSpeed = m.getFloat("SPEED") ?? 0;
    line.m_vJumpSpeed.x = m.getFloat("JUMP_SPEED_X") ?? 0;
    line.m_vJumpSpeed.y = m.getFloat("JUMP_SPEED_Y") ?? 0;
    line.m_iTeleportLineIndex = m.getInt("TELEPORT_LINE") ?? -1;
    line.m_bEnableWallJump = m.getBool("ENABLE_WALL_JUMP") ?? false;
    line.m_bMonsterAllowed = m.getBool("MONSTER_ALLOWED") ?? true;
    line.m_bCanPass = m.getBool("CAN_PASS") ?? true;
    line.m_fCliffHeight = m.getFloat("CLIFF_HEIGHT") ?? 0;
    line.m_iCameraIndex = m.getInt("CAMERA_INDEX") ?? -1;
    line.m_bOtherRoadUp = m.getBool("OTHER_ROAD_UP") ?? false;
    line.m_iTriggerId = m.getInt("TRIGGER_ID") ?? -1;
    line.m_bFootOnLine = m.getBool("TRIGGER_ON_LINE") ?? true;
    line.m_bUnderWater = m.getBool("IS_UNDERWATER") ?? false;
    line.m_fWaterHeight = m.getFloat("UNDERWATER_HEIGHT") ?? 0;
    line.m_fBuoyancy = m.getFloat("UNDERWATER_BUOYANCY") ?? f(0.6);
    line.m_fResistance = m.getFloat("UNDERWATER_RESISTANCE") ?? f(0.8);
    line.m_fAnimSpeed = m.getFloat("UNDERWATER_ANIMSPEED") ?? f(0.9);
    line.m_fVarianceOxyen = m.getFloat("UNDERWATER_VARIANCEOXYEN") ?? -1;
    // the colour the line gives a unit: the alpha is 0 (the exe never reads one)
    line.m_cLineColor.set(m.getFloat("UNIT_COLOR_R") ?? 0, m.getFloat("UNIT_COLOR_G") ?? 0, m.getFloat("UNIT_COLOR_B") ?? 0, 0);
    line.m_bForceChangeColor = m.getBool("FORCE_CHANGE_COLOR") ?? false;
    if (line.m_bUnderWater) line.eDustType = LDT.WATER_SPLASH;
    line.m_bTempLineMap = m.getBool("TEMP_LINE_MAP") ?? false;
    if (line.m_bTempLineMap) this.m_iNumofLineMapCreatedByMonster++; // the exe tests `== 1`: a bool is 0 or 1
    line.m_eDirection = m.getInt("LINEMAP_DIRECTION_OPTION") ?? 0;
    line.m_fKeyStopTime = m.getFloat("JUMP_REL_UP_KEYSTOP_TIME") ?? 0;
    line.m_eLineTypeAfterClearStage = m.getInt("CHANGE_LINE_TYPE_AFTER_CLEAR_STAGE") ?? -1;
    line.m_iChangeAfterClearStage = m.getInt("CHANGE_AFTER_CLEAR_STAGE") ?? -1;
    line.m_iChangeAfterClearSubStage = m.getInt("CHANGE_AFTER_CLEAR_SUB_STAGE") ?? -1;
    line.m_bIsPortalWhenActiveRaid = m.getBool("PORTAL_WHEN_ACTIVE_RAID") ?? false;
    if ((m.getInt("LINE_DEPTH") ?? 0) !== 0) return false;
    const start = m.getVec3("START_POS");
    line.startPos.set(start?.x ?? 0, start?.y ?? 0, start?.z ?? 0);
    const end = m.getVec3("END_POS");
    line.endPos.set(end?.x ?? 0, end?.y ?? 0, end?.z ?? 0);
    this.makeLine(line);
    if (line.lineType === LT.WALL) this.m_WallList.push(line);
    this.m_LineList.push(line);
    line.lineIndex = this.m_LineList.length - 1;
    if (line.lineType !== LT.BUNGEE && line.lineType !== LT.WALL) this.takeInBounds(line);
    return true;
  }

  /**
   * the end of `AddLine_LUA` (329095A0 at 32909BB3): the bounds of the lines.  Only the line that makes `m_LineList` one long starts them (from its
   * own end points); when that line is a wall or a bungee the bounds are not touched and start from the 0s of the constructor.  Each bound is
   * `minss` / `maxss` of the start point and the old bound, then the end point is compared with that (`comiss`, `ja`): the compare that fails for a
   * NaN keeps the bound.
   */
  private takeInBounds(line: LineData): void {
    const s = line.startPos, e = line.endPos;
    let y: number;
    if (this.m_LineList.length === 1) {
      this.m_fXMin = s.x;
      this.m_fXMax = e.x;
      this.m_fYMin = s.y;
      y = e.y;
      this.m_fYMax = y;
    } else {
      y = this.m_fYMax;
    }
    const xMin = minss(s.x, this.m_fXMin);
    this.m_fXMin = xMin > e.x ? e.x : xMin;
    const yMin = minss(s.y, this.m_fYMin);
    this.m_fYMin = yMin > e.y ? e.y : yMin;
    const xMax = maxss(s.x, this.m_fXMax);
    this.m_fXMax = e.x > xMax ? e.x : xMax;
    const yMax = maxss(s.y, y);
    this.m_fYMax = e.y > yMax ? e.y : yMax;
  }

  /** `AddLineAnim_LUA()`: the exe registers a function that returns false (an ICF twin of `CX2GameUnit::GetIsMiddleBosRaidNPC`, 328F8F90) */
  AddLineAnim_LUA(): boolean {
    return false;
  }

  /**
   * `AddTrigger_LUA()` (32909CF0): a trigger segment from the table on the stack: `TRIGGER_ID` (a negative or missing id makes the call false and
   * adds nothing), `TRIGGER_LOOP`, and the tables `TRIGGER_DATA0`, `TRIGGER_DATA1`, ... up to the first number that is missing, each with
   * `TRIGGER_DATA_MESH0..`, `TRIGGER_DATA_LINE0..` and `TRIGGER_DATA_ETC0..` the same way.  The segment is added even when it has no data.
   */
  AddTrigger_LUA(): boolean {
    const m = new KLuaManager(this.ctx.world.rt, 1);
    const seg: TriggerSegment = { m_iTriggerId: m.getInt("TRIGGER_ID") ?? -1, m_iTriggerDataIndex: 0, m_bLoop: m.getBool("TRIGGER_LOOP") ?? false, m_vecTriggerData: [] };
    if (seg.m_iTriggerId < 0) return false;
    for (let i = 0; m.beginTable(`TRIGGER_DATA${i}`); i++) {
      const data: TriggerData = { m_fElapsedTime: 0, m_vecTriggerMesh: [], m_vecTriggerLine: [], m_vecTriggerEtc: [] };
      for (let j = 0; m.beginTable(`TRIGGER_DATA_MESH${j}`); j++) {
        data.m_vecTriggerMesh.push(readTriggerMesh(m));
        m.endTable();
      }
      for (let j = 0; m.beginTable(`TRIGGER_DATA_LINE${j}`); j++) {
        data.m_vecTriggerLine.push(readTriggerLine(m));
        m.endTable();
      }
      for (let j = 0; m.beginTable(`TRIGGER_DATA_ETC${j}`); j++) {
        data.m_vecTriggerEtc.push(readTriggerEtc(m));
        m.endTable();
      }
      seg.m_vecTriggerData.push(data);
      m.endTable();
    }
    this.m_LineMapTrigger.m_vecTriggerSeg.push(seg);
    return true;
  }

  /** `EnableLineData_LUA(int, bool)` (328C1AA0) */
  EnableLineData_LUA(iIndex: number, bEnable: boolean): void {
    this.enableLineData(iIndex, bEnable);
  }

  /** `SetStartEndPosAtThisLineMap_LUA(int, D3DXVECTOR3, D3DXVECTOR3)` (329139D0): a line that is not there is passed over (`MakeLine(NULL)`) */
  SetStartEndPosAtThisLineMap_LUA(iIndex: number, vStartPos: Vec3, vEndPos: Vec3): void {
    this.updateLineData(iIndex, vStartPos, vEndPos);
  }

  /** `GetNumLineData_LUA()` (328C22C0): `m_LineList.size()` */
  GetNumLineData_LUA(): number {
    return this.m_LineList.length;
  }

  /** `GetStartPosition(int key)` (328C26A0): the start position of the key, (0, 0, 0) when there is none */
  GetStartPosition(key: number): Vec3 {
    return this.m_mapStartInfo.get(key)?.m_vStartPos.clone() ?? new Vec3();
  }

  /** `GetStartLineIndex(int key)` (328C2650): the line of the key's start position, -1 when there is none */
  GetStartLineIndex(key: number): number {
    return this.m_mapStartInfo.get(key)?.m_iStartLineIndex ?? -1;
  }

  // ---- the C++ side ---------------------------------------------------------------------------------------------------------

  /** `EnableLineData(int, bool)` (3290E200): a change makes the chains of lines again */
  enableLineData(iIndex: number, bEnable: boolean): void {
    if (iIndex < 0 || iIndex >= this.m_LineList.length) return;
    const line = this.m_LineList[iIndex]!;
    if (line.bEnable !== bEnable) {
      line.bEnable = bEnable;
      this.reBuildLineGroup();
    }
  }

  /** `UpdateLineData(int, const D3DXVECTOR3*, const D3DXVECTOR3*)` (32913A30): false when there is no such line */
  updateLineData(iIndex: number, vStart: Vec3, vEnd: Vec3): boolean {
    if (iIndex < 0 || iIndex >= this.m_LineList.length) return false;
    const line = this.m_LineList[iIndex]!;
    line.startPos.set(vStart.x, vStart.y, vStart.z);
    line.endPos.set(vEnd.x, vEnd.y, vEnd.z);
    this.makeLine(line);
    return true;
  }

  /**
   * `MakeLine(LineData*)` (32913120, static): what follows from the two end points.  `m_vPosMin` / `m_vPosMax` are the componentwise `minss` /
   * `maxss`; `dirVector` is `D3DXVec3Normalize(end - start)`; the angles come from the inverse of `D3DXMatrixLookAtLH(eye (0,0,0), at dirVector,
   * up (0,1,0))` (`I`, row major): when `I[1]` and `I[5]` (`_12`, `_22`) are both 0, `dirRadian.x = atan2(-I[6], I[2])` and `dirRadian.z = 0`;
   * otherwise `dirRadian.z = asin(I[9])` and `dirRadian.x = 0`; always `dirRadian.y = atan2(-I[10], I[8])`; the degrees are the radians times
   * 57.295776f (the unset ones are 0); `fLength` is the square root of the squared differences, summed as floats.
   *
   * A line that goes straight up or down (a wall) and a line of length 0 have no inverse: the look-at matrix has a row of zeros, `D3DXMatrixInverse`
   * returns NULL and writes nothing, and the exe goes on with whatever its stack slot held.  The port cannot know that: it uses a matrix of zeros
   * (so the angles are -0, -0 and 0) and marks the line (`unspecifiedAngles`).  For every other line `I[5]` is the length of the direction in the
   * x-z plane, never 0, so the first branch is only ever reached through such a stale matrix.
   */
  makeLine(line: LineData): void {
    const s = line.startPos, e = line.endPos;
    line.m_vPosMin.set(minss(s.x, e.x), minss(s.y, e.y), minss(s.z, e.z));
    line.m_vPosMax.set(maxss(s.x, e.x), maxss(s.y, e.y), maxss(s.z, e.z));
    const dx = f(e.x - s.x), dy = f(e.y - s.y), dz = f(e.z - s.z);
    const dir = vec3Normalize({ x: dx, y: dy, z: dz });
    line.dirVector.set(dir.x, dir.y, dir.z);
    const inverse = matInverse(matLookAtLH({ x: 0, y: 0, z: 0 }, line.dirVector, { x: 0, y: 1, z: 0 }));
    line.unspecifiedAngles = inverse === null;
    const I = inverse ? inverse.matrix : STALE_MATRIX;
    let radX = 0, degX = 0, degZ = 0;
    if (I[1] === 0 && I[5] === 0) {
      line.dirRadian.z = 0;
      radX = f(Math.atan2(-I[6]!, I[2]!));
      degX = f(radX * RAD_TO_DEG);
    } else {
      const radZ = f(Math.asin(I[9]!));
      line.dirRadian.z = radZ;
      degZ = f(radZ * RAD_TO_DEG);
    }
    const radY = f(Math.atan2(-I[10]!, I[8]!));
    line.dirRadian.y = radY;
    line.dirRadian.x = radX;
    line.dirDegree.z = degZ;
    line.dirDegree.y = f(radY * RAD_TO_DEG);
    line.dirDegree.x = degX;
    line.fLength = f(Math.sqrt(f(f(f(dy * dy) + f(dx * dx)) + f(dz * dz))));
  }

  /**
   * `ReBuildLineGroup()` (32913840): every enabled line gets the numbers of the first and the last line of its chain (`nextLine` / `beforeLine`
   * links that agree with each other, through enabled lines that no earlier chain took), -1 / -1 for a disabled line.  A chain starts at the
   * lowest index and runs forward first, then backward.
   */
  reBuildLineGroup(): void {
    const lines = this.m_LineList;
    const n = lines.length;
    if (n <= 0) return;
    const taken = new Uint8Array(n);
    for (const line of lines) {
      line.m_lineGroupID.m_iStartLineIndex = -1;
      line.m_lineGroupID.m_iEndLineIndex = -1;
    }
    for (let i = 0; i < n; i++) {
      const line = lines[i]!;
      if (!line.bEnable || taken[i] === 1) continue;
      const members = [i];
      let first = i, last = i;
      let before = i;
      for (let next = line.nextLine; next >= 0 && next < n && taken[next] === 0; ) {
        const l = lines[next]!;
        if (!l.bEnable || l.beforeLine !== before) break;
        last = next;
        taken[next] = 1;
        members.push(next);
        before = next;
        next = l.nextLine;
      }
      let after = i;
      for (let prev = line.beforeLine; prev >= 0 && prev < n && taken[prev] === 0; ) {
        const l = lines[prev]!;
        if (!l.bEnable || l.nextLine !== after) break;
        first = prev;
        taken[prev] = 1;
        members.push(prev);
        after = prev;
        prev = l.beforeLine;
      }
      for (const k of members) {
        lines[k]!.m_lineGroupID.m_iStartLineIndex = first;
        lines[k]!.m_lineGroupID.m_iEndLineIndex = last;
      }
    }
  }

  /**
   * `LoadLineMap(pFileName)` (329127D0): see the top of the file.  False when the script is missing or fails (the log gets 0x48 or 0x49, then
   * 0x14; the lines the script added before it failed stay).
   */
  loadLineMap(fileName: string): boolean {
    const trigger = this.m_LineMapTrigger;
    trigger.m_vecNowTrigger.length = 0;
    trigger.m_vecTriggerSeg.length = 0;
    const world = this.ctx.world;
    world.rt.setObject("g_pLineMap", this, "CKTDGLineMap");
    const log = world.massFiles.log;
    const fail = (id: number, text: string): false => {
      log.push(id, text);
      log.push(0x14, fileName);
      return false;
    };
    if (fileName.length === 0) return fail(0x48, ""); // 32913094: the text of this one is empty (the exe also fails here without a device manager: there always is one)
    try {
      if (!world.execScript(fileName)) return fail(0x48, fileName);
    } catch (e) {
      if (!(e instanceof LuaError)) throw e;
      return fail(0x49, `${fileName}: ${String(e.message)}`); // the exe logs the file name; the message is here for the one who reads the log
    }
    this.reBuildLineGroup();
    sortTriggerSegments(trigger.m_vecTriggerSeg);
    return true;
  }
}

/**
 * `std::sort(first, last, TriggerLess)` as `LoadLineMap` calls it: not at all for 2 segments or fewer; `TriggerLess` compares `m_iTriggerId`.
 * 32 segments or fewer are `_Insertion_sort_unchecked` (32906610), which keeps the order of equal ids.  More would be the introsort of
 * `_Sort_unchecked` (32907AE0), which does not; no script has that many, so it is not ported.  No shipped script has even 3: of the 523
 * line-map scripts 510 have no trigger segment, 11 have one and 2 have two (the census test), so the sort is never reached with data of the game.
 */
export function sortTriggerSegments(segments: TriggerSegment[]): void {
  if (segments.length <= 2) return;
  if (segments.length > 32) throw new Error(`std::sort of ${segments.length} trigger segments (the introsort of 32907AE0) is not ported`);
  for (let i = 1; i < segments.length; i++) {
    const value = segments[i]!;
    let at = i;
    if (value.m_iTriggerId >= segments[0]!.m_iTriggerId) {
      while (value.m_iTriggerId < segments[at - 1]!.m_iTriggerId) {
        segments[at] = segments[at - 1]!;
        at--;
      }
    } else {
      while (at > 0) {
        segments[at] = segments[at - 1]!;
        at--;
      }
    }
    segments[at] = value;
  }
}

/** one `TRIGGER_DATA_MESH%d` table of `AddTrigger_LUA` */
function readTriggerMesh(m: KLuaManager): TriggerDataMesh {
  return {
    m_iMeshTriggerAction: m.getInt("TRIGGER_ACTION") ?? 0,
    m_iPlayType: m.getInt("PLAY_TYPE") ?? 1,
    m_fTriggerTime: m.getFloat("DELAY_TIME") ?? 0,
    m_wstrMeshName: m.getString("MESH_NAME") ?? "",
    m_wstrName: m.getString("ANIM_NAME") ?? "",
    m_fAnimSpeed: m.getFloat("ANIM_SPEED") ?? 1,
    m_bDone: false,
  };
}

/** one `TRIGGER_DATA_LINE%d` table: which of the keys is read depends on the action */
function readTriggerLine(m: KLuaManager): TriggerDataLine {
  const line: TriggerDataLine = {
    m_iLineTriggerAction: m.getInt("TRIGGER_ACTION") ?? 0,
    m_iTriggerLineIndex: -1,
    m_fTriggerTime: 0,
    m_bEnable: true,
    m_fSpeed: 0,
    m_vJumpSpeed: new Vec3(),
    m_iCamera: -1,
    m_bDone: false,
  };
  line.m_fTriggerTime = m.getFloat("DELAY_TIME") ?? 0;
  line.m_iTriggerLineIndex = m.getInt("LINE_ID") ?? -1;
  switch (line.m_iLineTriggerAction) {
    case 1: line.m_bEnable = m.getBool("LINE_ENABLE") ?? true; break;
    case 2: line.m_fSpeed = m.getFloat("LINE_SPEED") ?? 0; break;
    case 3:
      line.m_vJumpSpeed.x = m.getFloat("LINE_JUMPSPEED_X") ?? 0;
      line.m_vJumpSpeed.y = m.getFloat("LINE_JUMPSPEED_Y") ?? 0;
      break;
    case 4: line.m_iCamera = m.getInt("LINE_CAMERA") ?? -1; break;
    case 5: line.m_bEnable = m.getBool("LINE_CANPASS") ?? true; break;
    case 6: line.m_iCamera = m.getInt("LINE_TELEPORT") ?? -1; break;
  }
  return line;
}

/** one `TRIGGER_DATA_ETC%d` table */
function readTriggerEtc(m: KLuaManager): TriggerDataEtc {
  const etc: TriggerDataEtc = {
    m_iEtcTriggerAction: m.getInt("TRIGGER_ACTION") ?? 0,
    m_wstrActionName: "",
    m_fTriggerTime: 0,
    m_iDummyValue01: -1,
    m_fDummyValue01: 0,
    m_bDone: false,
  };
  etc.m_fTriggerTime = m.getFloat("DELAY_TIME") ?? 0;
  switch (etc.m_iEtcTriggerAction) {
    case 1: etc.m_wstrActionName = m.getString("LINE_SOUND") ?? ""; break;
    case 3:
      etc.m_iDummyValue01 = m.getInt("CAMERA_INDEX") ?? -1;
      etc.m_fDummyValue01 = m.getFloat("CAMERA_DURATION") ?? 0;
      break;
    case 4:
      etc.m_iDummyValue01 = m.getInt("CAMERA_SHAKE_GAP") ?? 0;
      etc.m_fDummyValue01 = m.getFloat("CAMERA_SHAKE_DURATION") ?? 0;
      break;
    case 5:
      etc.m_iDummyValue01 = m.getInt("ACTIVE_LAYER_ID") ?? -1;
      etc.m_fDummyValue01 = m.getFloat("FADE_TIME") ?? 0;
      break;
  }
  return etc;
}
