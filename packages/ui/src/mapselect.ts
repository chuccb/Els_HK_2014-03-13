/**
 * `CX2StatePVPRoom::CX2MapSelectWindow` (the Lua class `CX2MapSelectWindow`, 0x30 bytes): the window of the PVP room that lists the maps
 * (`DLG_PVP_MAP_LIST.LUA` describes the list).  The game state owns it; here it is what the dialog scripts reach as the global
 * `g_pMapSelectWindow`.
 *
 * `OpenScript(pFileName)` 32EFAC20: the list of maps is emptied, the object becomes the global `g_pMapSelectWindow`, and the script runs (a
 * missing or failing script is error 0x48 / 0x49, then, in both cases, 0x2793 with the file name, and the answer is false).  The script
 * calls `AddMapInfo_LUA` 32EFA710, the one method the class registers: the table on the Lua stack is a map (`m_WorldID`, `m_bHot`, `m_bNew`,
 * `m_MapName` as an id of the string table, and the texture and key of the map's picture and of its name's picture); a map that is new goes in
 * front of the first one that is not, the others to the end.  The rest of the class (the window itself) is not ported.
 */
import { KLuaManager } from "@els/host";
import type { CX2StatePVPRoom__CX2MapSelectWindow_Methods } from "@els/host";
import { LuaError } from "@els/lua";
import type { UIContext } from "./control.ts";

/** `CX2StatePVPRoom::MAP_INFO` (0x80 bytes) */
export interface MapInfo {
  m_WorldID: number;
  m_bHot: boolean;
  m_bNew: boolean;
  m_MapName: string;
  m_MapTexName: string;
  m_MapTexKeyName: string;
  m_MapNameTexName: string;
  m_MapNameTexKeyName: string;
}

export class CX2MapSelectWindow implements Partial<CX2StatePVPRoom__CX2MapSelectWindow_Methods> {
  /** `m_vecpMapInfo` */
  readonly m_vecpMapInfo: MapInfo[] = [];

  constructor(private readonly ctx: UIContext) {}

  /** the part of `OpenScript` that makes the object the global `g_pMapSelectWindow` */
  registerLuaBind(): void {
    this.ctx.world.rt.setObject("g_pMapSelectWindow", this, "CX2StatePVPRoom::CX2MapSelectWindow");
  }

  /** `OpenScript(pFileName)` (32EFAC20) */
  openScript(fileName: string): boolean {
    this.m_vecpMapInfo.length = 0;
    this.registerLuaBind();
    const log = this.ctx.devices.massFiles.log;
    if (fileName.length === 0) {
      log.push(0x48, "");
    } else {
      try {
        if (this.ctx.world.execScript(fileName)) return true;
        log.push(0x48, fileName);
      } catch (e) {
        if (!(e instanceof LuaError)) throw e;
        log.push(0x49, fileName);
      }
    }
    log.push(0x2793, fileName);
    return false;
  }

  /** `AddMapInfo_LUA()` (32EFA710) */
  AddMapInfo_LUA(): void {
    const m = new KLuaManager(this.ctx.world.rt, 1);
    const info: MapInfo = {
      m_WorldID: m.getInt("m_WorldID") ?? 0,
      m_bHot: m.getBool("m_bHot") ?? false,
      m_bNew: m.getBool("m_bNew") ?? false,
      m_MapName: "",
      m_MapTexName: "",
      m_MapTexKeyName: "",
      m_MapNameTexName: "",
      m_MapNameTexKeyName: "",
    };
    info.m_MapName = this.ctx.strings.get(m.getInt("m_MapName") ?? -1); // GetGeneralString (the debug-info variant is not ported)
    info.m_MapTexName = m.getString("m_MapTexName") ?? "";
    info.m_MapTexKeyName = m.getString("m_MapTexKeyName") ?? "";
    info.m_MapNameTexName = m.getString("m_MapNameTexName") ?? "";
    info.m_MapNameTexKeyName = m.getString("m_MapNameTexKeyName") ?? "";
    const list = this.m_vecpMapInfo;
    if (info.m_bNew) {
      const firstOld = list.findIndex((e) => !e.m_bNew);
      if (firstOld >= 0) {
        list.splice(firstOld, 0, info);
        return;
      }
    }
    list.push(info);
  }
}
