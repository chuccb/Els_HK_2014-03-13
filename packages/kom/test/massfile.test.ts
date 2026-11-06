import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { CLIENT_KOM_NAMES, KomArchive, MassFileError, MassFileManager, fileSource, mountClientArchives } from "../src/index.ts";

const DATA = "data";
const have = existsSync(`${DATA}/data001.kom`);

describe("KGCMassFileManager", () => {
  test("the list of archives CX2Main builds: datai001..023 then data001..150", () => {
    expect(CLIENT_KOM_NAMES.length).toBe(173);
    expect(CLIENT_KOM_NAMES.slice(0, 2)).toEqual(["datai001.kom", "datai002.kom"]);
    expect(CLIENT_KOM_NAMES[22]).toBe("datai023.kom");
    expect(CLIENT_KOM_NAMES.slice(23, 26)).toEqual(["data001.kom", "data002.kom", "data003.kom"]);
    expect(CLIENT_KOM_NAMES[23 + 9]).toBe("data010.kom");
    expect(CLIENT_KOM_NAMES[23 + 99]).toBe("data100.kom");
    expect(CLIENT_KOM_NAMES[172]).toBe("data150.kom");
    expect(new Set(CLIENT_KOM_NAMES).size).toBe(173);
  });

  test.skipIf(!have)("a duplicated member name is an error, the archive is not mounted; the lock stops AddMassFile", async () => {
    const log: string[] = [];
    const m = new MassFileManager((s) => log.push(s));
    const kom = await m.addMassFile("data001.kom", fileSource(`${DATA}/data001.kom`));
    expect(kom).not.toBeNull();
    const n = m.size;
    expect(n).toBe(kom!.entries.length);
    await expect(m.addMassFile("again.kom", fileSource(`${DATA}/data001.kom`))).rejects.toThrow(MassFileError);
    expect(m.size).toBe(n); // nothing of the failed archive stays
    expect(m.archives.map((a) => a.name)).toEqual(["data001.kom"]);
    m.lock();
    expect(m.isLocked).toBe(true);
    expect(await m.addMassFile("data002.kom", fileSource(`${DATA}/data002.kom`))).toBeNull();
    expect(log.length).toBe(1);
    expect(log[0]).toContain("LockMassFileMap");
  });

  test.skipIf(!have)("LoadDataFile upper-cases the name; an unknown name logs and gives null", async () => {
    const log: string[] = [];
    const m = new MassFileManager((s) => log.push(s));
    await m.addMassFile("data017.kom", fileSource(`${DATA}/data017.kom`));
    const a = await m.loadDataFile("MESH_ELSWORD_BASIC_WEAPON.X");
    const b = await m.loadDataFile("mesh_elsword_basic_weapon.x");
    expect(a).not.toBeNull();
    expect(Buffer.compare(a!, b!)).toBe(0);
    expect(m.find("Mesh_Elsword_Basic_Weapon.x")!.komName).toBe("data017.kom");
    expect(await m.loadDataFile("no such file.tga")).toBeNull();
    expect(log).toEqual(["LoadDataFile: no such file.tga is not in any archive"]);
    expect(m.has("MESH_ELSWORD_BASIC_WEAPON.X")).toBe(true);
    expect(m.has("nothing")).toBe(false);
  });

  test.skipIf(!have)("all 173 shipped archives mount: 97,891 members, every name unique, the map is locked", async () => {
    const m = new MassFileManager();
    const seen: number[] = [];
    const r = await mountClientArchives(m, async (name) => (existsSync(`${DATA}/${name}`) ? fileSource(`${DATA}/${name}`) : null), { onProgress: (d) => seen.push(d) });
    expect(r).toEqual({ mounted: 173, missing: [] });
    expect(m.size).toBe(97891);
    expect(m.archives.map((a) => a.name)).toEqual([...CLIENT_KOM_NAMES]); // list order, whatever the order the archives finished opening in
    expect(m.isLocked).toBe(true);
    expect(seen.length).toBe(173);
    let n = 0;
    for (const _ of m.names()) n++;
    expect(n).toBe(97891);
    // some loose files of data/ are members too (the HK loading screen is in datai022), the event / spare screens are loose only
    expect(m.find("dlg_first_loading0_hk.tga")!.komName).toBe("datai022.kom");
    expect(m.has("dlg_first_loading0_hk_event.tga")).toBe(false);
  });

  test("a missing archive is an error unless the caller says what to do", async () => {
    const m = new MassFileManager();
    await expect(mountClientArchives(m, async () => null, { names: ["nope.kom"] })).rejects.toThrow("cannot open nope.kom");
    const m2 = new MassFileManager();
    const missing: string[] = [];
    const r = await mountClientArchives(m2, async () => null, { names: ["a.kom", "b.kom"], onMissing: (n) => missing.push(n) });
    expect(r).toEqual({ mounted: 0, missing: ["a.kom", "b.kom"] });
    expect(missing).toEqual(["a.kom", "b.kom"]);
    expect(m2.isLocked).toBe(true);
  });

  test.skipIf(!have)("KomArchive.open on an already open archive can be added with addArchive", async () => {
    const kom = await KomArchive.open(fileSource(`${DATA}/data002.kom`));
    const m = new MassFileManager();
    expect(m.addArchive("data002.kom", kom)).toBe(kom);
    expect(m.size).toBe(kom.entries.length);
  });
});
