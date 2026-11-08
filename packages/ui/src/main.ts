/**
 * `CX2Main` (the Lua class and the global object `g_pMain`) as far as the UI reaches it.  Only `InstallFont` is ported; everything else a
 * script asks of `g_pMain` (client version, server addresses, `DeleteFile`, ...) is not implemented and goes through the host layer's
 * `notPorted` policy.
 *
 * `InstallFont(pValueName, pFontFileName)` (329F3F50), 38 sites in the scripts and one in C++ (`CX2Main::Init`, 329EB2A0, installs
 * `"GULIM"` = `"Gulim.ttc"` right after `LoadLuaEnum` and `MassFileMapping`, before the config script runs):
 *
 * 1. `g_pKTDXApp->m_pDGManager->m_pFontManager->InstallFont(name, file)` (328B71A0, fontmanager.ts) makes the font known to the glyph
 *    fonts: the file is read through the mass-file manager (a KOM member, upper-cased name).
 * 2. Then the file is also made known to the OS: `KGCMassFileManager::GetPullPath` (328D58A0) looks for it ON DISK under the paths of
 *    the manager (a loose file next to the exe); there is none for a font that only exists inside a KOM (GULIM) and the answer is false.
 *    A loose file is added with `AddFontResourceW` (its failure is error 0x2720; here the OS call succeeds) and its path is appended to
 *    `m_UseFontNameList`; the answer is true.
 *
 * The result (the Lua `true` / `false` of the call) depends on the files of the install; `hasLocalFile` says which ones are there.
 */
import type { CX2Main_Methods } from "@els/host";
import type { CKTDGFontManager } from "./fontmanager.ts";

export class CX2Main implements Partial<CX2Main_Methods> {
  /** `m_UseFontNameList`: the files `InstallFont` registered with the system */
  readonly m_UseFontNameList: string[] = [];

  constructor(
    private readonly fontManager: CKTDGFontManager,
    /** `GetPullPath(name) != NULL`: the file is on disk next to the exe */
    private readonly hasLocalFile: (name: string) => boolean = () => false,
  ) {}

  InstallFont(pValueName: string, pFontFileName: string): boolean {
    this.fontManager.InstallFont(pValueName, pFontFileName);
    if (!this.hasLocalFile(pFontFileName)) return false;
    this.m_UseFontNameList.push(pFontFileName);
    return true;
  }
}
