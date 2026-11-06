/**
 * Runs the scripts of the client on the host layer with typed stubs (`notPorted: "record"`): which registered methods do they call, and
 * which of them cannot run on the registered API at all.  The CLI and the report are tools/host-census.ts; docs/HOST_CENSUS.md is its output.
 *
 * Every script runs as the exe would load it: in the world's single Lua state (after `LoadLuaEnum`'s scripts), with `g_pUIDialog` set to a
 * new dialog (what `CKTDGUIDialog::OpenScriptFile` does for the DLG_*.lua scripts; the other scripts ignore it).
 */
import { HostStub } from "./tinker.ts";
import { HostWorld } from "./world.ts";

export interface ScriptRun {
  ok: boolean;
  error?: string;
  /** `Class.method` -> calls made by THIS run to methods nobody implemented */
  calls: Map<string, number>;
  /** scripts executed by the run (IncludeLua included) */
  included: string[];
}

/** one world for the census: stub objects, the enumerations, a `run(name)` for one script */
export function makeCensusWorld(readScript: (upperCaseBaseName: string) => Uint8Array | undefined) {
  const world = new HostWorld({ readScript, notPorted: "record" });
  world.publishStubObjects();
  world.loadEnums();
  const { rt } = world;
  const run = (name: string): ScriptRun => {
    world.executed.length = 0;
    rt.setObject("g_pUIDialog", new HostStub("CKTDGUIDialog"), "CKTDGUIDialog");
    const before = new Map(rt.notPortedCalls);
    let error: string | undefined;
    try {
      if (!world.execScript(name)) error = "script not found";
    } catch (e) {
      error = HostWorld.describeError(e);
    }
    const calls = new Map<string, number>();
    for (const [k, v] of rt.notPortedCalls) if (v - (before.get(k) ?? 0) > 0) calls.set(k, v - (before.get(k) ?? 0));
    return { ok: error === undefined, error, calls, included: [...world.executed] };
  };
  return { world, rt, run };
}

/**
 * All of `names` in ONE state in the given order (what the exe has: a script may use what a sibling defined), then the ones that failed
 * once more (their siblings have run by then); `isolated`: a fresh state per script and no second try.
 */
export function runCensus(scripts: Map<string, Uint8Array>, names: string[], isolated = false): Map<string, ScriptRun> {
  const read = (n: string) => scripts.get(n);
  const shared = isolated ? undefined : makeCensusWorld(read);
  const final = new Map<string, ScriptRun>();
  for (const n of names) final.set(n, (shared ?? makeCensusWorld(read)).run(n));
  if (shared) for (const n of names) if (!final.get(n)!.ok) final.set(n, shared.run(n));
  return final;
}
