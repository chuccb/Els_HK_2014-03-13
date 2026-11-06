/**
 * The client as far as the UI needs it: the one Lua state with the host layer (`@els/host`), the device manager (mass-file manager and
 * textures), the string table, and the UI classes registered as the implementations of the Lua classes the exe registers.
 */
import { HostWorld, KGCMassFileManager } from "@els/host";
import type { HostOptions, MassFileSource } from "@els/host";
import type { StringTable } from "@els/assets";
import { CKTDGUIControl, CPictureData } from "./control.ts";
import type { UIContext } from "./control.ts";
import { CKTDGUIDialog } from "./dialog.ts";
import { DeviceManager } from "./device.ts";
import { CKTDGUIStatic } from "./static.ts";

export interface UIWorldOptions extends HostOptions {
  /** the KOM archives (`AddMassFile`) */
  source: MassFileSource;
  /** `general.ess` (`CKTDXStringTable::LoadStringTable`; a loose file next to the exe) */
  strings: StringTable;
  /** `GetTickCount()` in milliseconds (default: the time since start-up) */
  tickCount?: () => number;
}

export class UIWorld implements UIContext {
  readonly devices: DeviceManager;
  readonly strings: StringTable;
  readonly world: HostWorld;

  constructor(opts: UIWorldOptions) {
    const massFiles = new KGCMassFileManager();
    massFiles.source = opts.source;
    if (opts.tickCount) massFiles.tickCount = opts.tickCount;
    this.devices = new DeviceManager(massFiles);
    this.strings = opts.strings;
    this.world = new HostWorld({ readScript: (name) => massFiles.loadDataFile(name), massFiles, notPorted: opts.notPorted });
    const rt = this.world.rt;
    rt.registerImpl("KGCMassFileManager", KGCMassFileManager);
    rt.registerImpl("CKTDGUIDialog", CKTDGUIDialog);
    rt.registerImpl("CKTDGUIControl", CKTDGUIControl);
    rt.registerImpl("CKTDGUIStatic", CKTDGUIStatic);
    rt.registerImpl("CKTDGUIControl::CPictureData", CPictureData);
  }

  /** `LoadLuaEnum`: Enum.lua, DungeonEnum.lua, MassFileMappingList_HK.lua, StringID_def.lua */
  loadEnums(): void {
    this.world.loadEnums();
  }

  /** `new CKTDGUIDialog(pStage, script, 0, layer)`: builds the dialog the script describes */
  openDialog(scriptFileName: string, layer = 0): CKTDGUIDialog {
    return new CKTDGUIDialog(this, { scriptFileName, layer });
  }
}
