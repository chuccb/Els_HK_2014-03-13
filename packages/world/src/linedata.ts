/**
 * The data of a line map (`CKTDGLineMap`): the lines a unit walks on, the start positions, the cameras and the triggers.  The names are
 * the exe's (`tools/structs.py CKTDGLineMap`); the sizes in the comments are the exe's too.
 */
import { Color, Vec3 } from "@els/host";

/** `CKTDGLineMap::LINE_TYPE` (the scripts' `LT_*`) */
export const LT = {
  INVALID: -1, NORMAL: 0, WALL: 1, POTAL: 2, HOLE: 3, JUMP_UP_REL: 4, JUMP_UP_ABS: 5, BUNGEE: 6, MONSTER_ROAD: 7, UNIT_ROAD: 8, OTHER_ROAD: 9, CLIFF: 10,
} as const;
/** `CKTDGLineMap::LINE_DUST_TYPE` */
export const LDT = { DEFALT_DUST: 0, WATER_SPLASH: 1 } as const;
/** `CKTDGLineMap::LINE_CAMERA_TYPE` */
export const LCT = { INVALID: 0, ABSOULTE_POSITION: 1, RELATIE_POSITION: 2 } as const;
/** `CKTDGLineMap::LINEMAP_DIRECTION_OPTION` */
export const LDO = { NONE: 0, LEFT: 1, RIGHT: 2 } as const;

/** `CKTDGLineMap::LineGroupID` */
export interface LineGroupID {
  m_iStartLineIndex: number;
  m_iEndLineIndex: number;
}

/**
 * `CKTDGLineMap::LineData` (0xFC bytes): one line.  The constructor is 329085C0; `AddLine_LUA` sets every field a script can name and
 * `MakeLine` fills the ones that follow from the two end points (`m_vPosMin`, `m_vPosMax`, `dirVector`, `dirDegree`, `dirRadian`, `fLength`).
 * The three `Vec3`s that are written in place keep the `float` rounding of the C++ members.
 */
export class LineData {
  lineIndex = -1;
  lineType: number = LT.NORMAL;
  bEnable = true;
  eDustType: number = LDT.DEFALT_DUST;
  potalGroup = -1;
  fStopFactor = 1;
  bCanDown = true;
  beforeLine = -1;
  nextLine = -1;
  readonly startPos = new Vec3();
  readonly endPos = new Vec3();
  readonly m_vPosMin = new Vec3();
  readonly m_vPosMax = new Vec3();
  readonly dirVector = new Vec3();
  readonly dirDegree = new Vec3();
  readonly dirRadian = new Vec3();
  fLength = 0;
  /**
   * not in the exe: `dirRadian` / `dirDegree` of this line are the exe's reads of an uninitialised stack slot (`D3DXMatrixInverse` failed: the line
   * is vertical or has length 0), which the port cannot know; see `CKTDGLineMap.makeLine`
   */
  unspecifiedAngles = false;
  lineSet = -1;
  m_fSpeed = 0;
  readonly m_vJumpSpeed = new Vec3();
  m_iTeleportLineIndex = -1;
  m_bEnableWallJump = false;
  m_bMonsterAllowed = true;
  m_bCanPass = true;
  m_iCameraIndex = -1;
  m_bOtherRoadUp = false;
  /** `m_pLineAnimData`: no script can make one (`AddLineAnim_LUA` does nothing), so a line never has it */
  m_pLineAnimData: undefined = undefined;
  m_fCliffHeight = 0;
  m_bTempLineMap = false;
  m_bUnderWater = false;
  m_fWaterHeight = 0;
  m_fBuoyancy = 0;
  m_fResistance = 0;
  m_fAnimSpeed = 1;
  m_fVarianceOxyen = 0;
  /** the constructor leaves it alone; `AddLine_LUA` always sets it */
  readonly m_cLineColor = new Color();
  m_bForceChangeColor = false;
  m_iTriggerId = -1;
  m_bFootOnLine = true;
  m_eDirection: number = LDO.NONE;
  m_fKeyStopTime = 0;
  m_eLineTypeAfterClearStage: number = LT.INVALID;
  m_iChangeAfterClearStage = -1;
  m_iChangeAfterClearSubStage = -1;
  readonly m_lineGroupID: LineGroupID = { m_iStartLineIndex: -1, m_iEndLineIndex: -1 };
  /** the constructor leaves it alone; `AddLine_LUA` always sets it */
  m_bIsPortalWhenActiveRaid = false;
}

/** `CKTDGLineMap::StartInfo` (20 bytes) */
export class StartInfo {
  readonly m_vStartPos: Vec3;
  m_bStartRight: boolean;
  m_iStartLineIndex: number;
  constructor(pos = new Vec3(), right = true, lineIndex = -1) {
    this.m_vStartPos = pos.clone();
    this.m_bStartRight = right;
    this.m_iStartLineIndex = lineIndex;
  }
}

/** `CKTDGLineMap::CameraData` (48 bytes) */
export class CameraData {
  m_eType: number = LCT.INVALID;
  readonly m_vEye = new Vec3();
  readonly m_vLookAt = new Vec3();
  m_bFocusUnit = true;
  readonly m_vRelativeEye = new Vec3();
  m_fCameraRepositionSpeed = 100;
}

/** `CKTDGLineMap::TRIGGER_MESH_ACTION_TYPE`, `TRIGGER_LINE_ACTION_TYPE` and `TRIGGER_ETC_ACTION_TYPE` (the scripts' `TAT_*`) */
export const TAT_MESH = { NONE: 0, CHANGE_ANIM: 1, CHANGE_SPEED: 2 } as const;
export const TAT_LINE = { NONE: 0, CHANGE_ENABLE: 1, CHANGE_SPEED: 2, CHANGE_JUMPSPEED: 3, CHANGE_CAMERA: 4, CHANGE_CANPASS: 5, CHANGE_TELEPORT: 6 } as const;
export const TAT_ETC = { NONE: 0, PLAY_SOUND: 1, DURATION_TIME: 2, CAMERA: 3, CAMERA_SHAKE: 4, ACTIVE_LAYER: 5 } as const;

/** `CKTDGLineMap::TRIGGER_DATA_MESH` (68 bytes) */
export interface TriggerDataMesh {
  m_iMeshTriggerAction: number;
  m_wstrMeshName: string;
  m_fTriggerTime: number;
  m_wstrName: string;
  m_iPlayType: number;
  m_fAnimSpeed: number;
  m_bDone: boolean;
}

/** `CKTDGLineMap::TRIGGER_DATA_LINE` (40 bytes) */
export interface TriggerDataLine {
  m_iLineTriggerAction: number;
  m_iTriggerLineIndex: number;
  m_fTriggerTime: number;
  m_bEnable: boolean;
  m_fSpeed: number;
  m_vJumpSpeed: Vec3;
  /** the camera index of `TAT_LINE_CHANGE_CAMERA`; the line a `TAT_LINE_CHANGE_TELEPORT` leads to */
  m_iCamera: number;
  m_bDone: boolean;
}

/** `CKTDGLineMap::TRIGGER_DATA_ETC` (44 bytes) */
export interface TriggerDataEtc {
  m_iEtcTriggerAction: number;
  m_wstrActionName: string;
  m_fTriggerTime: number;
  m_iDummyValue01: number;
  m_fDummyValue01: number;
  m_bDone: boolean;
}

/** `CKTDGLineMap::TRIGGER_DATA` */
export interface TriggerData {
  m_fElapsedTime: number;
  m_vecTriggerMesh: TriggerDataMesh[];
  m_vecTriggerLine: TriggerDataLine[];
  m_vecTriggerEtc: TriggerDataEtc[];
}

/** `CKTDGLineMap::TRIGGER_SEGMENT` (24 bytes) */
export interface TriggerSegment {
  m_iTriggerId: number;
  m_iTriggerDataIndex: number;
  m_bLoop: boolean;
  m_vecTriggerData: TriggerData[];
}

/** `CKTDGLineMap::LINEMAP_TRIGGER` */
export interface LineMapTrigger {
  m_vecNowTrigger: number[];
  m_vecTriggerSeg: TriggerSegment[];
}
