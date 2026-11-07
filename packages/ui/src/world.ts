/**
 * The client as far as the UI needs it: the one Lua state with the host layer (`@els/host`), the device manager (mass-file manager and
 * textures), the string table, and the UI classes registered as the implementations of the Lua classes the exe registers.
 */
import { HostWorld, KGCMassFileManager } from "@els/host";
import type { HostOptions, MassFileSource } from "@els/host";
import type { StringTable } from "@els/assets";
import type { Direct3DDevice9 } from "@els/d3d9";
import { CKTDGUIControl, CPictureData } from "./control.ts";
import type { UIContext } from "./control.ts";
import { CKTDGUIButton } from "./button.ts";
import { CKTDGUICheckBox } from "./checkbox.ts";
import { CKTDGUIRadioButton } from "./radiobutton.ts";
import { CKTDGUIDialog } from "./dialog.ts";
import { DeviceManager } from "./device.ts";
import { CKTDGUIDialogManager } from "./dialogmanager.ts";
import { UIRender } from "./render.ts";
import { CKTDGUIItem, CKTDGUIStatic } from "./static.ts";
import { CKTDGUISlot, CX2CouponBox, CX2PostBox, CX2Slot, CX2SlotManager } from "./slot.ts";
import { CKTDGUIIMEEditBox, ImeSystem } from "./imeeditbox.ts";
import { CKTDGFontManager } from "./fontmanager.ts";
import { CKTDGUIComboBox } from "./combobox.ts";
import { CKTDGUIListBox } from "./listbox.ts";
import { CMovieData } from "./movie.ts";
import { CKTDGUIContolList } from "./controllist.ts";
import { CKTDGUISlider } from "./slider.ts";
import { CKTDGUIEditBox } from "./editbox.ts";
import { CX2MapSelectWindow } from "./mapselect.ts";
import { CKTDGUINavigation } from "./navigation.ts";
import { CKTDGUIScrollBar } from "./scrollbar.ts";
import { UIFonts } from "./font.ts";

export interface UIWorldOptions extends HostOptions {
  /** the KOM archives (`AddMassFile`) */
  source: MassFileSource;
  /** `general.ess` (`CKTDXStringTable::LoadStringTable`; a loose file next to the exe) */
  strings: StringTable;
  /** `GetTickCount()` in milliseconds (default: the time since start-up) */
  tickCount?: () => number;
  /**
   * The Direct3D device to draw on (`g_pKTDXApp->m_pd3dDevice`; a `Direct3DDevice9` of `@els/d3d9`).  Given, the textures that open get
   * Direct3D textures and `render` draws; without it the world only builds the dialogs.
   */
  device?: Direct3DDevice9;
  /** the size of the back buffer the layout (1024 x 768) is scaled to (`m_ResolutionScale`; default: no scaling) */
  backBuffer?: { width: number; height: number };
}

/** the Lua classes (C++ names) the UI classes implement */
const IMPLEMENTATIONS: [string, object][] = [
  ["KGCMassFileManager", KGCMassFileManager],
  ["CKTDGUIDialog", CKTDGUIDialog],
  ["CKTDGUIControl", CKTDGUIControl],
  ["CKTDGUIStatic", CKTDGUIStatic],
  ["CKTDGUIButton", CKTDGUIButton],
  ["CKTDGUIRadioButton", CKTDGUIRadioButton],
  ["CKTDGUICheckBox", CKTDGUICheckBox],
  ["CKTDGUISlot", CKTDGUISlot],
  ["CKTDGUIIMEEditBox", CKTDGUIIMEEditBox],
  ["CKTDGFontManager", CKTDGFontManager],
  ["CKTDGUIComboBox", CKTDGUIComboBox],
  ["CKTDGUIListBox", CKTDGUIListBox],
  ["CX2StatePVPRoom::CX2MapSelectWindow", CX2MapSelectWindow],
  ["CKTDGUIEditBox", CKTDGUIEditBox],
  ["CKTDGUIContolList", CKTDGUIContolList],
  ["CKTDGUISlider", CKTDGUISlider],
  ["CKTDGUIControl::CMovieData", CMovieData],
  ["CKTDGUINavigation", CKTDGUINavigation],
  ["CKTDGUIItem", CKTDGUIItem],
  ["CKTDGUIScrollBar", CKTDGUIScrollBar],
  ["CX2SlotManager", CX2SlotManager],
  ["CX2PostBox", CX2PostBox],
  ["CX2CouponBox", CX2CouponBox],
  ["CX2SlotManager::CX2Slot", CX2Slot],
  ["CKTDGUIControl::CPictureData", CPictureData],
];

export class UIWorld implements UIContext {
  readonly devices: DeviceManager;
  readonly strings: StringTable;
  readonly world: HostWorld;
  controlFocus: CKTDGUIControl | null = null;
  readonly fonts = new UIFonts();
  /** `g_pKTDXApp->m_pDGManager->m_pFontManager`, the global `g_pFontManager` */
  readonly fontManager = new CKTDGFontManager(this.fonts);
  readonly ime: ImeSystem;
  /** the message boxes the UI code opened, in order (the exe shows them modally) */
  readonly messageBoxes: { text: string; caption: string }[] = [];
  readonly render: UIRender | null;
  readonly dialogManager = new CKTDGUIDialogManager();

  constructor(opts: UIWorldOptions) {
    const massFiles = new KGCMassFileManager();
    massFiles.source = opts.source;
    if (opts.tickCount) massFiles.tickCount = opts.tickCount;
    this.devices = new DeviceManager(massFiles);
    if (opts.device) {
      this.devices.d3dDevice = opts.device;
      this.render = new UIRender(opts.device);
      if (opts.backBuffer) this.render.setBackBufferSize(opts.backBuffer.width, opts.backBuffer.height);
    } else {
      this.render = null;
    }
    this.ime = new ImeSystem(massFiles.log);
    this.strings = opts.strings;
    this.world = new HostWorld({ readScript: (name) => massFiles.loadDataFile(name), massFiles, notPorted: opts.notPorted });
    const rt = this.world.rt;
    for (const [cpp, impl] of IMPLEMENTATIONS) rt.registerImpl(cpp, impl);
    rt.setObject("g_pFontManager", this.fontManager, "CKTDGFontManager");
  }

  messageBox(text: string, caption: string): void {
    this.messageBoxes.push({ text, caption });
  }

  /** `_clock()`: milliseconds, from the same source as `GetTickCount` */
  clock(): number {
    return this.devices.massFiles.tickCount();
  }

  /** `LoadLuaEnum`: Enum.lua, DungeonEnum.lua, MassFileMappingList_HK.lua, StringID_def.lua */
  loadEnums(): void {
    this.world.loadEnums();
  }

  /**
   * The start-up script of the HK client (`Config_HK_SERVICE.lua`): among other things it tells the font manager which fonts there are
   * (`g_pFontManager:CreateNewUIUKFont(...)`, `MapUIFontToUKFont`), and the controls measure their text with those.  Its other calls go to
   * `g_pMain` (client version, server addresses, `InstallFont`, `DeleteFile`), the not yet ported `CX2Main`: they are recorded, not run.
   */
  loadConfig(script = "CONFIG_HK_SERVICE.LUA"): void {
    const { rt } = this.world;
    const saved = rt.notPorted;
    rt.notPorted = "record";
    try {
      if (!this.world.execScript(script)) throw new Error(`script ${script} not found`);
    } finally {
      rt.notPorted = saved;
    }
  }

  /** The world as it is when the first dialog is built: the global objects, the enumerations, the start-up config. */
  boot(): void {
    this.world.publishStubObjects();
    this.loadEnums();
    this.loadConfig();
  }

  /**
   * The UI classes whose own global the dialog scripts reach (`g_pPostBoxInventory`, `g_pCouponBox`, `g_pMapSelectWindow`).  The exe makes each when its UI is
   * opened (their constructors or `RegisterLuaBind` publish them) and the dialogs are built by them; a run of one script at a time
   * has them all alive from the start.
   */
  createOwners(): { postBox: CX2PostBox; couponBox: CX2CouponBox; mapSelectWindow: CX2MapSelectWindow } {
    const postBox = new CX2PostBox(this);
    const couponBox = new CX2CouponBox(this);
    const mapSelectWindow = new CX2MapSelectWindow(this);
    postBox.registerLuaBind();
    couponBox.registerLuaBind();
    mapSelectWindow.registerLuaBind();
    return { postBox, couponBox, mapSelectWindow };
  }

  /**
   * `new CKTDGUIDialog(pStage, script, 0, layer)`: builds the dialog the script describes.  The UI class that owns the dialog binds itself
   * to Lua before it builds it (`owner.registerLuaBind()`: a slot manager becomes the global `g_pCX2SlotManager`).
   */
  openDialog(scriptFileName: string, layer = 0, owner?: { registerLuaBind(): void }): CKTDGUIDialog {
    owner?.registerLuaBind();
    return new CKTDGUIDialog(this, { scriptFileName, layer });
  }
}
