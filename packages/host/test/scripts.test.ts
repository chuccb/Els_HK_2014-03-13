import { beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { call } from "@els/lua";
import type { LuaTable } from "@els/lua";
import { HostNotPortedError, HostStub, HostWorld, makeCensusWorld, parseMappingTime, runCensus } from "../src/index.ts";
import { indexAllKoms } from "../../../tools/komindex.ts";

/**
 * The real scripts of the KOMs on the host layer (needs the client's data/ directory like the other data tests).
 * What they CALL is checked here; what the calls should DO is checked where the classes are implemented.
 */
const dataDir = join(import.meta.dir, "..", "..", "..", "data");
const haveData = existsSync(join(dataDir, "x2.exe")) && existsSync(join(dataDir, "data036.kom"));
const scripts = new Map<string, Uint8Array>();

beforeAll(async () => {
  if (!haveData) return;
  const index = await indexAllKoms();
  for (const [name, hit] of index) if (name.endsWith(".LUA")) scripts.set(name, await hit.kom.read(hit.entry));
}, 60_000);

const t = test.skipIf(!haveData);

describe("start-up scripts (CX2Main::LoadLuaEnum)", () => {
  t("Enum.lua, DungeonEnum.lua, MassFileMappingList_HK.lua and StringID_def.lua run in strict mode", () => {
    const w = new HostWorld({ readScript: (n) => scripts.get(n), notPorted: "throw" });
    w.loadEnums();
    expect(w.executed).toEqual(["ENUM.LUA", "DUNGEONENUM.LUA", "MASSFILEMAPPINGLIST_HK.LUA", "STRINGID_DEF.LUA"]);
    const g = (k: string) => w.G.globals.getStr(k);
    expect(g("TRUE")).toBe(1); // the scripts use the NUMBERS TRUE / FALSE (KLuaManager does not read Lua booleans)
    expect(g("FALSE")).toBe(0);
    expect(typeof g("STR_ID_1")).toBe("number");
    expect(g("NF_HK")).toBe(769); // registered by the exe, not by a script
  });

  t("the localisation mapping: group 1 for good, group 2 for the event of 2014-03-12..20", () => {
    const w = new HostWorld({ readScript: (n) => scripts.get(n), notPorted: "throw" });
    w.loadEnums();
    const m = w.massFiles;
    expect([...m.mappingList.keys()]).toEqual([1, 2]);
    expect(m.mappingList.get(1)!.size).toBe(9); // 15 calls: 9 + 6
    expect(m.mappingList.get(2)!.size).toBe(6);
    expect(m.mappingList.get(1)!.get("VILLAGE_ADBOARD_A01.DDS")).toBe("VILLAGE_ADBOARD_A01_HK.DDS");
    expect(m.mappingList.get(1)!.get("HQ_LOADINGOUTLINE.TGA")).toBe("HQ_LOADINGOUTLINE_HK.TGA");
    expect(m.mappingList.get(2)!.get("VILLAGE_ADBOARD_A01.dds")).toBe("VILLAGE_ADBOARD_A01_HK_1.dds"); // the event: other spelling, other file
    expect([...m.mappingTime.keys()]).toEqual([1, 2]);
    expect(m.mappingTime.get(1)).toEqual({ start: parseMappingTime("2013-07-20 00:00:00"), end: parseMappingTime("2049-12-31 23:59:00") });
    expect(m.mappingTime.get(2)).toEqual({ start: parseMappingTime("2014-03-12 00:00:00"), end: parseMappingTime("2014-03-20 09:59:00") });
    expect(m.mappingTime.get(2)!.end - m.mappingTime.get(2)!.start).toBe(8 * 86400 + 9 * 3600 + 59 * 60); // both in the same zone
  });

  t("AddMappingList / AddMappingTime keep the FIRST entry (std::map::emplace)", () => {
    const w = new HostWorld({ readScript: () => undefined });
    w.massFiles.AddMappingList(1, "A.DDS", "A_HK.DDS");
    w.massFiles.AddMappingList(1, "A.DDS", "A_XX.DDS");
    w.massFiles.AddMappingTime(1, "2014-01-01 00:00:00", "2014-02-01 00:00:00");
    w.massFiles.AddMappingTime(1, "2015-01-01 00:00:00", "2015-02-01 00:00:00");
    expect(w.massFiles.mappingList.get(1)!.get("A.DDS")).toBe("A_HK.DDS");
    expect(w.massFiles.mappingTime.get(1)!.start).toBe(parseMappingTime("2014-01-01 00:00:00"));
  });

  t("mapping dates: fields split at ' ' '-' ':', short strings are time 0, impossible times throw like the ATL exception", () => {
    expect(parseMappingTime("2014-03-13 12:34:56")).toBe(Math.floor(new Date(2014, 2, 13, 12, 34, 56).getTime() / 1000));
    expect(parseMappingTime("2014-3-13 1:2:3")).toBe(0); // 15 characters: shorter than 19
    expect(parseMappingTime("2014-03-13 12:34:56 and more text")).toBe(parseMappingTime("2014-03-13 12:34:56"));
    expect(parseMappingTime("1899-12-31 00:00:00")).toBe(0); // year < 1900: CTime's argument check fails, the exe skips
    expect(parseMappingTime("2014-13-01 00:00:00")).toBe(0); // month 13
    expect(() => parseMappingTime("1950-01-01 00:00:00")).toThrow("ATL::AtlThrow");
    expect(() => parseMappingTime("2014-03-13 24:00:00")).toThrow("ATL::AtlThrow");
  });

  t("IncludeLua runs a script by its base name and says whether it found it", () => {
    const w = new HostWorld({ readScript: (n) => scripts.get(n), notPorted: "record" });
    w.publishStubObjects();
    w.loadEnums();
    w.rt.setObject("g_pUIDialog", new HostStub("CKTDGUIDialog"), "CKTDGUIDialog");
    const include = w.G.globals.getStr("IncludeLua");
    expect(call(w.G.main, include, ["DLG_First_Loading_Front_HK.lua"])).toEqual([true]);
    expect(call(w.G.main, include, ["Some\\Dir/dlg_first_loading_front_hk.LUA"])).toEqual([true]); // directory dropped, case ignored
    expect(call(w.G.main, include, ["NoSuchScript.lua"])).toEqual([false]);
    expect(w.executed.slice(-2)).toEqual(["DLG_FIRST_LOADING_FRONT_HK.LUA", "DLG_FIRST_LOADING_FRONT_HK.LUA"]);
  });
});

describe("a dialog script on the typed stubs", () => {
  t("DLG_First_Loading_Front_HK.lua makes exactly the calls its bytecode contains", () => {
    const { run } = makeCensusWorld((n) => scripts.get(n));
    const r = run("DLG_First_Loading_Front_HK.lua");
    expect(r.error).toBeUndefined();
    expect(Object.fromEntries(r.calls)).toEqual({
      "CKTDGUIDialog.SetName": 1,
      "CKTDGUIDialog.SetPos": 1,
      "CKTDGUIDialog.SetModal": 1,
      "CKTDGUIDialog.SetFront": 1,
      "CKTDGUIDialog.CreateStatic": 3,
      "CKTDGUIDialog.AddControl": 3,
      "CKTDGUIControl.SetName": 3,
      "CKTDGUIControl.SetOffsetPos": 1,
      "CKTDGUIDialog.CreatePicture": 6,
      "CKTDGUIStatic.AddPicture": 6,
      "CKTDGUIControl::CPictureData.SetTex": 6,
      "CKTDGUIControl::CPictureData.SetPoint": 6,
      "CKTDGUIStatic.AddString": 2,
    });
  });

  t("in strict mode the first unimplemented call stops the script and names the exe's function", () => {
    const w = new HostWorld({ readScript: (n) => scripts.get(n), notPorted: "throw" });
    w.loadEnums();
    w.rt.setObject("g_pUIDialog", new HostStub("CKTDGUIDialog"), "CKTDGUIDialog");
    expect(() => w.execScript("DLG_First_Loading_Front_HK.lua")).toThrow(HostNotPortedError);
    try {
      w.execScript("DLG_First_Loading_Front_HK.lua");
    } catch (e) {
      expect((e as Error).message).toMatch(/^not ported: CKTDGUIDialog\.\w+ @[0-9A-F]{8}$/);
    }
  });
});

describe("all 4,498 scripts", () => {
  t("run on the registered API in one state: 4,422 to the end, the other 76 need names the exe does not have", () => {
    const names = [...scripts.keys()].sort();
    expect(names.length).toBe(4498);
    const final = runCensus(scripts, names);
    const failed = names.filter((n) => !final.get(n)!.ok);
    expect(names.length - failed.length).toBe(4422);
    expect(failed.length).toBe(76);
    // every failure is a Lua error about a name that is not a string of x2.exe (so the C++ cannot define it either)
    const exe = readFileSync(join(dataDir, "x2.exe"));
    const culprits = new Set<string>();
    for (const n of failed) {
      const msg = final.get(n)!.error!;
      const name = /global '([^']+)'/.exec(msg)?.[1] ?? /can't find '([^']+)' class variable/.exec(msg)?.[1];
      expect(name).toBeDefined();
      expect(exe.includes(name!)).toBe(false);
      culprits.add(name!);
    }
    expect(culprits.size).toBe(23);
    expect(final.get("ALTERA_FIELD_00.LUA")!.error).toContain("can't find 'AddSpawnMonsterGroup' class variable. (forgot registering class variable ?)");
  }, 120_000);

  t("the scripts call 440 registered methods nobody implements yet; 259 of them belong to the UI classes", () => {
    const names = [...scripts.keys()].sort();
    const final = runCensus(scripts, names);
    const methods = new Set<string>();
    for (const r of final.values()) for (const k of r.calls.keys()) methods.add(k);
    expect(methods.size).toBe(440); // 442 before KGCMassFileManager.AddMappingList / AddMappingTime were implemented
    expect([...methods].filter((k) => /^(CKTDGUI|CX2SlotManager|KGCMassFileManager)/.test(k)).length).toBe(259);
  }, 120_000);
});
