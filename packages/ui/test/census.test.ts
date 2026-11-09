import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { StringTable } from "@els/assets";
import { runCensus } from "@els/host";
import { CKTDGUIButton, UIWorld, destroyDialogs, implementedMethods, runStrictWorld } from "../src/index.ts";
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
    const world = await source.settle(() => runStrictWorld({ source, strings }, ported, { sounds: true })); // the sound system is up, as in the client
    const strict = world.runs;

    expect(dlg.length).toBe(1024);
    // the ratchet: these only go up
    expect(runs.length).toBeGreaterThanOrEqual(992);
    expect(ported.length).toBeGreaterThanOrEqual(992);
    expect(ported.length).toBe(runs.length); // every script that runs is carried
    expect(strict.length).toBe(ported.length);
    expect(strict.filter((r) => !r.ok).map((r) => `${r.name}: ${r.error}`)).toEqual([]);
    expect(strict.filter((r) => r.needsSibling).length).toBe(0);

    // the drawing: how many of those dialogs hold only control classes whose OnFrameRender is ported (the combo box is, FINDINGS 17.14, the list box, 17.15,
    // the slot, 17.16, the edit box, 17.17, and the IME edit box, 17.18): all of them
    expect(strict.filter((r) => r.undrawn.length === 0).length).toBe(992);
    expect(strict.flatMap((r) => r.undrawn)).toEqual([]);
    // and a dialog's classes are counted as they are: DLG_COMMAND_SKILL holds a slider, five radio buttons, two buttons
    const skill = strict.find((r) => r.name === "DLG_COMMAND_SKILL.LUA")!;
    expect(skill.classes).toEqual({ CKTDGUIStatic: 3, CKTDGUIButton: 2, CKTDGUIRadioButton: 5, CKTDGUISlider: 1 });
    expect(skill.undrawn).toEqual([]);
    expect(strict.find((r) => r.name === "DLG_UI_OPTION_ETC.LUA")!.undrawn).toEqual([]);

    // and the destruction (E4b): every dialog that was built (the 992, and the 9 first tries of the scripts that wait for a global of a sibling,
    // which a failed script leaves half built) is destroyed after all of them were built.  Every control closes exactly what it opened: no
    // destructor closes a device nobody holds, no texture or render target is left in the device manager, and the only references that stay
    // in it are the ones the exe leaks: the sounds a button or radio button had when `SetCustomMouseOverSound` / `SetCustomMouseUpSound`
    // overwrote the pointer (3292F680, 3292F730, 3294BD80, 3294BE30), and the mouse down sound `~CKTDGUIButton` never closes.
    const controls = world.dialogs.flatMap((d) => d.m_ControlsList.slice());
    // 94 buttons and 66 radio buttons were given the custom over and up sounds of their dialog (`SetCustomButtonMouseOverSndFile`): each left the two sounds it
    // had opened open.  96 buttons (the card flip dialogs) have a mouse down sound, which no destructor closes.
    const replaced = controls.filter((c) => c.leakedSounds.length > 0);
    expect(["CKTDGUIButton", "CKTDGUIRadioButton"].map((n) => replaced.filter((c) => c.constructor.name === n).length)).toEqual([94, 66]);
    expect(replaced.length).toBe(94 + 66);
    expect(controls.filter((c) => c instanceof CKTDGUIButton && c.m_pSndMouseDown !== undefined).length).toBe(96);
    const report = destroyDialogs(world);
    expect([report.dialogs, report.controls]).toEqual([1001, 9707]);
    expect(report.errors).toEqual([]);
    expect(report.strays).toEqual({});
    expect(report.leaked).toEqual({ "CARD_FLIP.OGG": 96, "X2_BUTTON_MOUSE_OVER.OGG": 160, "X2_BUTTON_MOUSE_UP.OGG": 160 });
    expect(report.left).toEqual(report.leaked);
    const devices = world.ui.devices;
    expect([devices.devices.size, devices.renderTargets.size, [...devices.sounds.keys()].sort()]).toEqual([0, 0, ["CARD_FLIP.OGG", "X2_BUTTON_MOUSE_OVER.OGG", "X2_BUTTON_MOUSE_UP.OGG"]]);

    // the rest are the scripts of the game states: each reads a table or an object that the state (the village map, the shop, the video
    // recorder) puts into Lua when it starts, and no state is ported yet.  A bound that only goes down.
    const rest = dlg.filter((n) => !host.get(n)!.ok);
    expect(rest.length).toBeLessThanOrEqual(32);
    for (const n of rest) expect(host.get(n)!.error).toMatch(/attempt to index global '(STATE_[A-Z_]*UI_CUSTOM_MSG|SHOP_UI_CUSTOM_MSG|UI_RECORD_VIDEO_CUSTOM_MSG|WORLD_MISSION_UI_MSG|g_pShopCharStatus|g_pShopInventory)'/);
  }, 240_000);
});
