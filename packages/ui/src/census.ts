/**
 * Runs the `DLG_*.lua` dialog scripts on the UI classes in ONE Lua state (as the exe has), with typed stubs for the registered methods
 * nobody ported yet (`notPorted: "record"`): which dialogs are built completely by ported code, what stops the others, and whether the
 * textures the scripts name resolve (file in the archives, key in its TET file).  The CLI and the report are tools/ui-census.ts.
 */
import { HostWorld } from "@els/host";
import type { HostOptions, HostRuntime } from "@els/host";
import { CKTDGUIDialog } from "./dialog.ts";
import { CX2SlotManager } from "./slot.ts";
import type { UITextureData } from "./control.ts";
import { UIWorld } from "./world.ts";
import type { UIWorldOptions } from "./world.ts";

export interface TextureCheck {
  /** `file:key` pairs whose file is not a valid member of the archives (or failed to load) */
  missingFile: string[];
  /** `file:key` pairs whose file loaded but whose TET has no such key (or has no TET) */
  missingKey: string[];
  /** how many texture references the dialog made (`SetTex`, `SetNormalTex`, ...) */
  resolved: number;
}

export interface DialogRun {
  ok: boolean;
  error?: string;
  /** `Class.method` -> calls of THIS run to registered methods nobody ported (typed stubs answered) */
  calls: Map<string, number>;
  textures: TextureCheck;
  dialog?: CKTDGUIDialog;
}

/** every UITextureData a control holds (what `SetTex` and its relatives made) */
export function textureDataOf(dialog: CKTDGUIDialog): UITextureData[] {
  const out: UITextureData[] = [];
  for (const c of dialog.m_ControlsList) c.textureData(out);
  return out;
}

export function checkTextures(list: UITextureData[]): TextureCheck {
  const res: TextureCheck = { missingFile: [], missingKey: [], resolved: 0 };
  for (const t of list) {
    const ref = `${t.texName}:${t.keyName}`;
    if (!t.pTexture) res.missingFile.push(ref);
    else if (t.keyName !== "" && !t.keyFound) res.missingKey.push(ref);
    else res.resolved++;
  }
  return res;
}

export function makeUICensusWorld(opts: Omit<UIWorldOptions, "notPorted">) {
  const ui = new UIWorld({ ...opts, notPorted: "record" });
  ui.world.publishStubObjects();
  ui.loadEnums();
  const { rt } = ui.world;
  const run = (name: string): DialogRun => {
    const before = new Map(rt.notPortedCalls);
    let error: string | undefined;
    let dialog: CKTDGUIDialog | undefined;
    try {
      dialog = ui.openDialog(name, 0, new CX2SlotManager(ui)); // the UI that owns the dialog: a slot manager (g_pCX2SlotManager)
      if (!dialog.m_bSuccessInitOpenScript) error = ui.devices.massFiles.log.entries.at(-1)?.text ?? "script failed";
    } catch (e) {
      error = HostWorld.describeError(e);
    }
    const calls = new Map<string, number>();
    for (const [k, v] of rt.notPortedCalls) if (v - (before.get(k) ?? 0) > 0) calls.set(k, v - (before.get(k) ?? 0));
    return { ok: error === undefined, error, calls, textures: checkTextures(dialog ? textureDataOf(dialog) : []), dialog };
  };
  return { ui, run };
}

/** `Class.method` (C++ class name, Lua method name) of every registered method that a TS class implements: what `rt.status()` counts */
export function implementedMethods(rt: HostRuntime): Set<string> {
  const out = new Set<string>();
  for (const bc of rt.byCpp.values()) {
    const impl = bc.impl as Record<string, unknown> | undefined;
    if (!impl) continue;
    for (const name of bc.methods.keys()) if (typeof impl[name] === "function") out.add(`${bc.spec.cpp}.${name}`);
  }
  return out;
}

/**
 * Which method to port next: the scripts that still need methods (`needs`: script -> the methods it calls that are not ported) vote for
 * them, a script with `n` missing methods gives each of them `1/n`; the winner is taken out and the vote repeated.  Returns the order and,
 * for every step, how many scripts were fully ported after it.
 */
export function greedyOrder(needs: Map<string, Set<string>>): { order: string[]; ported: number[] } {
  const remaining = [...needs.values()].map((n) => new Set(n));
  const order: string[] = [];
  const ported: number[] = [];
  for (;;) {
    const score = new Map<string, number>();
    for (const r of remaining) for (const k of r) score.set(k, (score.get(k) ?? 0) + 1 / r.size);
    if (score.size === 0) break;
    const best = [...score].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]![0];
    order.push(best);
    for (const r of remaining) r.delete(best);
    ported.push(remaining.filter((r) => r.size === 0).length);
  }
  return { order, ported };
}

export interface StrictRun {
  name: string;
  ok: boolean;
  error?: string;
  /**
   * the script failed on a global it does not define itself (`IconAni`, `g_pButtonCencle`): in the exe a sibling script defines it
   * (the client has ONE Lua state) and that sibling is not in the run
   */
  needsSibling?: boolean;
  textures: TextureCheck;
  /** controls of the finished dialog */
  controls: number;
}

/**
 * The scripts of `names` in ONE strict world (a registered method nobody ported is an error), each building a new dialog; a script
 * that fails does not stop the others.  A script that fails on a missing global gets a second try after all the others have run (a
 * sibling may define it), as in the host census.
 */
export function runStrict(opts: Omit<UIWorldOptions, "notPorted">, names: string[]): StrictRun[] {
  const ui = new UIWorld({ ...opts, notPorted: "throw" });
  ui.loadEnums();
  const one = (name: string): StrictRun => {
    let dialog: CKTDGUIDialog | undefined;
    let error: string | undefined;
    try {
      dialog = ui.openDialog(name, 0, new CX2SlotManager(ui)); // the UI that owns the dialog: a slot manager (g_pCX2SlotManager)
      if (!dialog.m_bSuccessInitOpenScript) error = ui.devices.massFiles.log.entries.at(-1)?.text ?? "script failed";
    } catch (e) {
      error = HostWorld.describeError(e);
    }
    return { name, ok: error === undefined, error, textures: checkTextures(dialog ? textureDataOf(dialog) : []), controls: dialog?.m_ControlsList.length ?? 0 };
  };
  const out = new Map<string, StrictRun>();
  for (const name of names) out.set(name, one(name));
  for (const name of names) {
    const first = out.get(name)!;
    if (first.ok || !/attempt to (?:index|call) global '/.test(first.error ?? "")) continue;
    const second = one(name);
    if (!second.ok && /attempt to (?:index|call) global '/.test(second.error ?? "")) second.needsSibling = true;
    out.set(name, second);
  }
  return names.map((n) => out.get(n)!);
}

export type { HostOptions };
