import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { StringTable } from "@els/assets";
import { runCensus } from "@els/host";
import { UIWorld, implementedMethods, runStrict } from "../src/index.ts";
import { indexAllKoms, KomMassFileSource } from "../../../tools/komindex.ts";

const dataDir = join(import.meta.dir, "..", "..", "..", "data");
const haveData = existsSync(join(dataDir, "x2.exe")) && existsSync(join(dataDir, "data036.kom")) && existsSync(join(dataDir, "general.ess"));

/**
 * The ratchet for `docs/UI_COVERAGE.md` (the same steps as `tools/ui-census.ts`): every DLG script of the client that can run on the host
 * layer at all is carried by the UI classes, and runs for real in strict mode (a registered method nobody ported is an error).  The numbers
 * may only go up: a manager that is ported later (the shop, the maps, the recorder) makes more of the 32 scripts below run, and the
 * bound at the end is then lowered.
 */
describe.skipIf(!haveData)("the DLG scripts of the client", () => {
  test("all that can run are fully ported and run strictly without an error", async () => {
    const index = await indexAllKoms();
    const scripts = new Map<string, Uint8Array>();
    for (const [name, hit] of index) if (name.endsWith(".LUA")) scripts.set(name, await hit.kom.read(hit.entry));
    const all = [...scripts.keys()].sort();
    const host = runCensus(scripts, all);
    const dlg = all.filter((n) => n.startsWith("DLG_"));
    const runs = dlg.filter((n) => host.get(n)!.ok);

    const strings = StringTable.fromEss(new Uint8Array(readFileSync(join(dataDir, "general.ess"))));
    const probe = new UIWorld({ source: { has: () => false, read: () => undefined }, strings, notPorted: "throw" });
    const implemented = implementedMethods(probe.world.rt);
    const ported = runs.filter((n) => [...host.get(n)!.calls.keys()].every((k) => implemented.has(k)));

    const source = new KomMassFileSource(index, 64 * 1024);
    await source.load(scripts.keys());
    const strict = await source.settle(() => runStrict({ source, strings }, ported));

    expect(dlg.length).toBe(1024);
    // the ratchet: these only go up
    expect(runs.length).toBeGreaterThanOrEqual(992);
    expect(ported.length).toBeGreaterThanOrEqual(992);
    expect(ported.length).toBe(runs.length); // every script that runs is carried
    expect(strict.length).toBe(ported.length);
    expect(strict.filter((r) => !r.ok).map((r) => `${r.name}: ${r.error}`)).toEqual([]);
    expect(strict.filter((r) => r.needsSibling).length).toBe(0);

    // the drawing: how many of those dialogs hold only control classes whose OnFrameRender is ported (the text of their strings is not
    // drawn yet).  Goes up as ListBox, ComboBox, the edit boxes and the slots are ported; the list of classes below only shrinks.
    expect(strict.filter((r) => r.undrawn.length === 0).length).toBeGreaterThanOrEqual(868);
    const notDrawn = ["CKTDGUIComboBox", "CKTDGUIEditBox", "CKTDGUIIMEEditBox", "CKTDGUIListBox", "CKTDGUISlot"];
    for (const r of strict) for (const c of r.undrawn) expect(notDrawn).toContain(c);
    // and a dialog's classes are counted as they are: DLG_COMMAND_SKILL holds a slider, five radio buttons, two buttons
    const skill = strict.find((r) => r.name === "DLG_COMMAND_SKILL.LUA")!;
    expect(skill.classes).toEqual({ CKTDGUIStatic: 3, CKTDGUIButton: 2, CKTDGUIRadioButton: 5, CKTDGUISlider: 1 });
    expect(skill.undrawn).toEqual([]);
    expect(strict.find((r) => r.name === "DLG_UI_OPTION_ETC.LUA")!.undrawn).toEqual([]);

    // the rest are the scripts of the game states: each reads a table or an object that the state (the village map, the shop, the video
    // recorder) puts into Lua when it starts, and no state is ported yet.  A bound that only goes down.
    const rest = dlg.filter((n) => !host.get(n)!.ok);
    expect(rest.length).toBeLessThanOrEqual(32);
    for (const n of rest) expect(host.get(n)!.error).toMatch(/attempt to index global '(STATE_[A-Z_]*UI_CUSTOM_MSG|SHOP_UI_CUSTOM_MSG|UI_RECORD_VIDEO_CUSTOM_MSG|WORLD_MISSION_UI_MSG|g_pShopCharStatus|g_pShopInventory)'/);
  }, 240_000);
});
