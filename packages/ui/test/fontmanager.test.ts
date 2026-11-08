import { describe, expect, test } from "bun:test";
import { UIFonts } from "../src/font.ts";
import { CKTDGFontManager } from "../src/fontmanager.ts";
import { CX2Main } from "../src/main.ts";
import { fontWorld } from "./fontworld.ts";

/**
 * CKTDGFontManager::InstallFont (328B71A0) and GetFontMemory (328B6D80), CreateNewUIUKFont (328B5110) and CX2Main::InstallFont (329F3F50):
 * a font manager on a host whose mass-file manager answers from a table, so that what it is asked and what is logged can be read off.
 */
function manager(files: Record<string, Uint8Array | undefined> = {}) {
  const loads: string[] = [];
  const log: { id: number; text?: string }[] = [];
  const boxes: { text: string; caption: string }[] = [];
  const host = {
    render: null,
    clock: () => 0,
    messageBox: (text: string, caption: string) => void boxes.push({ text, caption }),
    devices: {
      d3dDevice: null,
      massFiles: {
        loadDataFile: (name: string) => {
          loads.push(name);
          return files[name];
        },
        log: { push: (id: number, text?: string) => void log.push({ id, text }) },
      },
    },
  };
  const fonts = new UIFonts();
  const fm = new CKTDGFontManager(fonts, host as never);
  return { fm, fonts, loads, log, boxes };
}

const bytes = (...v: number[]) => Uint8Array.from(v);

describe("CKTDGFontManager::InstallFont (328B71A0)", () => {
  test("the name and the path are upper-cased letter by letter (a to z), the file is read by the upper-cased path and kept under it", () => {
    const data = bytes(1, 2, 3);
    const { fm, loads, log, boxes } = manager({ "DIR/MIXED-CASE_9.TTF": data });
    fm.InstallFont("abcdefghijklmnopqrstuvwxyz-Az", "dir/Mixed-case_9.ttf");
    expect([...fm.m_mapFontNameFile]).toEqual([["ABCDEFGHIJKLMNOPQRSTUVWXYZ-AZ", "DIR/MIXED-CASE_9.TTF"]]);
    expect(loads).toEqual(["DIR/MIXED-CASE_9.TTF"]);
    expect(fm.m_mapFontFileMemory.get("DIR/MIXED-CASE_9.TTF")).toBe(data);
    expect([log.length, boxes.length]).toEqual([0, 0]);
  });

  test("neither the name nor the path may be empty: nothing at all happens", () => {
    const { fm, loads, log, boxes } = manager({ "A.TTF": bytes(1) });
    fm.InstallFont("", "a.ttf");
    fm.InstallFont("a", "");
    fm.InstallFont("", "");
    expect([fm.m_mapFontNameFile.size, fm.m_mapFontFileMemory.size, loads.length, log.length, boxes.length]).toEqual([0, 0, 0, 0, 0]);
  });

  test("a file that is there is not read again: a second name for it (any case) only maps the name", () => {
    const { fm, loads } = manager({ "F.TTF": bytes(9, 9) });
    fm.InstallFont("one", "f.ttf");
    fm.InstallFont("two", "F.TTF");
    expect(loads).toEqual(["F.TTF"]);
    expect([...fm.m_mapFontNameFile]).toEqual([["ONE", "F.TTF"], ["TWO", "F.TTF"]]);
    expect(fm.GetFontMemory("two")).toBe(fm.GetFontMemory("one"));
  });

  test("installing a name again replaces what it was mapped to", () => {
    const { fm } = manager({ "A.TTF": bytes(1), "B.TTF": bytes(2) });
    fm.InstallFont("x", "a.ttf");
    fm.InstallFont("x", "b.ttf");
    expect([...fm.m_mapFontNameFile]).toEqual([["X", "B.TTF"]]);
    expect([...fm.GetFontMemory("x")]).toEqual([2]);
  });

  test("a file of no bytes is error 0x10 with the path and a message box \"Font Error!\" with the path; the name stays mapped to a file without bytes", () => {
    const { fm, log, boxes } = manager({ "E.TTF": new Uint8Array(0) });
    fm.InstallFont("e", "e.ttf");
    expect(log).toEqual([{ id: 0x10, text: "E.TTF" }]);
    expect(boxes).toEqual([{ text: "E.TTF", caption: "Font Error!" }]);
    expect(fm.m_mapFontFileMemory.has("E.TTF")).toBe(false);
    expect(fm.m_mapFontNameFile.get("E")).toBe("E.TTF");
    expect(fm.GetFontMemory("e").length).toBe(0);
  });

  test("a file that cannot be read at all is the same error; installing it again tries again (nothing was kept)", () => {
    const { fm, loads, log, boxes } = manager({});
    fm.InstallFont("n", "gone.ttf");
    fm.InstallFont("n", "gone.ttf");
    expect(loads).toEqual(["GONE.TTF", "GONE.TTF"]);
    expect(log).toEqual([{ id: 0x10, text: "GONE.TTF" }, { id: 0x10, text: "GONE.TTF" }]);
    expect(boxes).toEqual([{ text: "GONE.TTF", caption: "Font Error!" }, { text: "GONE.TTF", caption: "Font Error!" }]);
    expect(fm.GetFontMemory("n").length).toBe(0);
  });
});

describe("CKTDGFontManager::GetFontMemory (328B6D80)", () => {
  test("the bytes of the file a name was installed from, found by the name in any case; a name nobody installed, or an empty one, has an empty answer", () => {
    const data = bytes(5, 6, 7, 8);
    const { fm } = manager({ "ARIAL.TTF": data });
    fm.InstallFont("Arial", "arial.ttf");
    expect(fm.GetFontMemory("ARIAL")).toBe(data);
    expect(fm.GetFontMemory("arial")).toBe(data);
    expect(fm.GetFontMemory("aRiAl")).toBe(data);
    expect(fm.GetFontMemory("nobody").length).toBe(0);
    expect(fm.GetFontMemory("").length).toBe(0);
  });
});

describe("CKTDGFontManager::CreateNewUIUKFont (328B5110)", () => {
  test("the glyph font is loaded at once (the CUKFont constructor calls Load) and the font is listed and entered under its id", () => {
    const w = fontWorld();
    const fm = w.w.fontManager;
    fm.CreateNewUIUKFont(7, "BOXFONT", 16, 400, 1, 0, true);
    const font = w.w.fonts.getUKFont(7)!;
    expect(font.m_pUKFont!.m_bLoad).toBe(true);
    expect([font.m_pUKFont!.m_iFontSize, font.m_pUKFont!.m_iFontCacheSize]).toEqual([16, 18]);
    expect(fm.m_UKFontList).toEqual([font]);
  });
});

describe("CX2Main::InstallFont (329F3F50)", () => {
  test("the font manager installs the font; the answer is true (and the file is remembered) only for a file that is on disk", () => {
    const { fm } = manager({ "LOOSE.TTF": bytes(1), "INKOM.TTF": bytes(2) });
    const main = new CX2Main(fm, (name) => name === "loose.ttf");
    expect(main.InstallFont("A", "loose.ttf")).toBe(true);
    expect(main.m_UseFontNameList).toEqual(["loose.ttf"]);
    expect(main.InstallFont("B", "inkom.ttf")).toBe(false);
    expect(main.m_UseFontNameList).toEqual(["loose.ttf"]);
    expect([...fm.m_mapFontNameFile]).toEqual([["A", "LOOSE.TTF"], ["B", "INKOM.TTF"]]);
    expect(main.InstallFont("C", "loose.ttf")).toBe(true);
    expect(main.m_UseFontNameList).toEqual(["loose.ttf", "loose.ttf"]);
  });

  test("with no way to look at the disk no file is local", () => {
    const { fm } = manager({ "F.TTF": bytes(1) });
    const main = new CX2Main(fm);
    expect(main.InstallFont("F", "f.ttf")).toBe(false);
    expect(main.m_UseFontNameList).toEqual([]);
  });
});
