/**
 * The Lua world of the client: ONE Lua state with the host layer, `IncludeLua`, and the scripts `CX2Main::LoadLuaEnum` (32A0D910) runs at
 * start-up.  The exe has a single state for every script, so what one script defines (`IconAni` of DLG_MAP_LOCAL_BACK, `g_pStaticJoinList`
 * of DLG_GUILD_JOIN_LIST ...) is visible to the scripts that run later.
 *
 * `readScript(NAME)` hands over the (decrypted) bytecode of a script by its upper-cased base name: the VM is synchronous, so the caller
 * prefetches what it needs (the exe reads through its mass-file manager; names are matched without the directory part).
 */
import { call, createLuaState, loadChunk, LuaError } from "@els/lua";
import type { LuaState } from "@els/lua";
import { HOST_OBJECTS } from "./api.generated.ts";
import { KGCMassFileManager } from "./classes/massfile.ts";
import { HostRuntime, HostStub } from "./tinker.ts";
import type { HostOptions } from "./tinker.ts";

export interface WorldOptions extends HostOptions {
  readScript(upperCaseBaseName: string): Uint8Array | undefined;
  /** Lua `print` / `io.write` sink (default: dropped) */
  write?: (text: string) => void;
}

/** the scripts `CX2Main::LoadLuaEnum` runs, in its order (it also publishes `g_pMain` and `KGCMassFileManager` first) */
export const ENUM_SCRIPTS = ["Enum.lua", "DungeonEnum.lua", "MassFileMappingList_HK.lua", "StringID_def.lua"] as const;

export const baseName = (path: string): string => path.replace(/^.*[\\/]/, "").toUpperCase();

export class HostWorld {
  readonly G: LuaState;
  readonly rt: HostRuntime;
  /** the scripts run so far, in order (IncludeLua included) */
  readonly executed: string[] = [];
  /** the global `KGCMassFileManager` (the device manager's mass-file manager) that MassFileMappingList_HK.lua fills */
  readonly massFiles = new KGCMassFileManager();

  constructor(private readonly opts: WorldOptions) {
    this.G = createLuaState({ write: opts.write ?? (() => {}) });
    this.rt = new HostRuntime(this.G, opts);
    // IncludeLua_ (328C2930): the file name is UTF-8, the directory is dropped, a missing file is an error log and `false`
    this.rt.registerFunction("IncludeLua", (name: string) => this.execScript(name));
  }

  /** Runs a script in the world's state (a Lua error propagates as `LuaError`); `false` when there is no such script. */
  execScript(name: string): boolean {
    const key = baseName(name);
    const bytes = this.opts.readScript(key);
    if (!bytes) return false;
    this.executed.push(key);
    call(this.G.main, loadChunk(this.G.main, bytes, "=" + key), []);
    return true;
  }

  /** `LoadLuaEnum`: the enumerations, the mass-file mapping list and the string ids that every other script relies on. */
  loadEnums(): void {
    this.rt.setObject("KGCMassFileManager", this.massFiles, "KGCMassFileManager");
    for (const s of ENUM_SCRIPTS) if (!this.execScript(s)) throw new Error(`script ${s} not found`);
  }

  /**
   * Publishes every global object the exe registers (`g_pMain`, `g_pData`, `g_pItemManager`, ...) as a stub of its class. An object
   * whose class the binding census could not read is taken to be the class of the function that publishes it
   * (`CX2StatePVPRoom::CX2MapSelectWindow::OpenScript` sets `g_pMapSelectWindow`).  With `notPorted: "record"` every call on a stub is
   * counted and returns a typed default (tools/host-census.ts); with `"throw"` it raises HostNotPortedError.
   */
  publishStubObjects(): void {
    const done = new Set<string>();
    for (const o of HOST_OBJECTS) {
      const cls = o.cls || o.registeredIn.replace(/@.*$/, "").replace(/::[^:]+$/, "");
      if (!this.rt.byCpp.has(cls)) continue;
      if (done.has(o.name) && o.inferred) continue; // the first non-inferred registration wins
      done.add(o.name);
      this.rt.setObject(o.name, new HostStub(cls), cls);
    }
  }

  /** `error.message` of a Lua error, `Name: message` of anything else */
  static describeError(e: unknown): string {
    return e instanceof LuaError ? String(e.message) : `${(e as Error).name}: ${(e as Error).message}`;
  }
}
