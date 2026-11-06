import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { formatDefaultDouble, formatFixed, parseEss, parseEssWithDiagnostics, StringTable } from "../src/index.ts";

/** Encode lines the way the exe decodes them: UTF-16LE BOM, per line `index TAB text` XORed with 0x10, then CR LF. */
function encodeEss(lines: string[], opts: { finalNewline?: boolean } = {}): Uint8Array {
  const units: number[] = [0xfeff];
  lines.forEach((l, i) => {
    for (const ch of l) units.push(ch.charCodeAt(0) ^ 0x10);
    if (i < lines.length - 1 || opts.finalNewline !== false) units.push(0x0d, 0x0a);
  });
  const out = new Uint8Array(units.length * 2);
  const dv = new DataView(out.buffer);
  units.forEach((u, i) => dv.setUint16(2 * i, u, true));
  return out;
}

describe("parseEss (CKTDXStringTable::LoadStringTable)", () => {
  test("index TAB text, XOR 0x10, literal \\n becomes CR LF", () => {
    const t = parseEss(encodeEss(["0\t艾爾之光", "1\tline one\\nline two", "2\t"]));
    expect(t).toEqual(["艾爾之光", "line one\r\nline two", ""]);
  });

  test("a line whose index is not the running line number is stored empty but still counts", () => {
    const t = parseEss(encodeEss(["0\ta", "5\tb", "2\tc", "no tab at all", "4\te"]));
    expect(t).toEqual(["a", "", "c", "", "e"]);
  });

  test("the last line may lack CR LF; an empty file gives an empty table", () => {
    expect(parseEss(encodeEss(["0\tx", "1\ty"], { finalNewline: false }))).toEqual(["x", "y"]);
    expect(parseEss(new Uint8Array([0xff, 0xfe]))).toEqual([]);
    expect(parseEss(new Uint8Array(0))).toEqual([]);
  });

  test("fgetws reads at most 2047 code units: a longer line becomes two lines and shifts the numbering", () => {
    const long = "0\t" + "a".repeat(2100);
    const t = parseEss(encodeEss([long, "1\tnext"]));
    // first call: 2047 units ("0 TAB" + 2045 a's, no CR LF found in them), second: the rest (index "aaa..." -> 0 != 1), third: "1\tnext" is line 2
    expect(t.length).toBe(3);
    expect(t[0]).toBe("a".repeat(2045));
    expect(t[1]).toBe("");
    expect(t[2]).toBe("");
    expect(parseEssWithDiagnostics(encodeEss([long, "1\tnext"])).diagnostics).toEqual({ entries: 3, indexMismatches: 2, cappedLines: 1, emptyTexts: 2 });
  });

  test("the real General.ess of the client", () => {
    const path = new URL("../../../data/general.ess", import.meta.url).pathname;
    if (!existsSync(path)) return;
    const { table: t, diagnostics } = parseEssWithDiagnostics(new Uint8Array(readFileSync(path)));
    expect(diagnostics).toEqual({ entries: 30584, indexMismatches: 0, cappedLines: 0, emptyTexts: 3625 }); // every index lines up
    expect(t.length).toBe(30584);
    expect(t[0]).toBe("艾爾之光");
    expect(t[2]).toBe("開啟BookTable失敗");
    expect(t[1000]).toBe("製造成功取得上述道具。");
    expect(t[5000]).toContain("@1%");
    expect(t[5000]).toContain("\r\n"); // "\n" markers were expanded
  });
});

describe("StringTable", () => {
  const table = new StringTable(["zero", "Hello @1, you have @2 items (@3)", "id one", "a @1 b @1", "@10 and @1"]);

  test("GetGeneralString: out-of-range ids give the empty string", () => {
    expect(table.get(0)).toBe("zero");
    expect(table.get(-1)).toBe("");
    expect(table.get(5)).toBe("");
  });

  test("GetReplacedString: types and placeholders", () => {
    expect(table.replaced(1, "sih", "Bob", 3, 7)).toBe("Hello Bob, you have 3 items (+7)");
    expect(table.replaced(1, "SiI", "Al", -2, 2)).toBe("Hello Al, you have -2 items (id one)");
    expect(table.replaced(3, "s", "X")).toBe("a X b X"); // every occurrence
    expect(table.replaced(3, "s", "@1")).toBe("a @1 b @1"); // inserted text is not scanned again
    expect(table.replaced(4, "ss", "A", "B")).toBe("A0 and A"); // "@1" matches the start of "@10", as in the exe
    expect(table.replaced(99, "s", "x")).toBe("");
    expect(table.replaced(1, "fef", 1.005, 2.5, 0.125)).toBe("Hello 1, you have +2.5 items (0.12)");
  });
});

describe("C-style number formatting (glibc printf reference values)", () => {
  test("%.2f rounds exact ties to even", () => {
    const cases: Array<[number, string]> = [[0.125, "0.12"], [0.375, "0.38"], [2.675, "2.67"], [1 / 1024, "0.00"], [1234565, "1234565.00"], [-0.125, "-0.12"], [1.005, "1.00"], [999999.5, "999999.50"], [3, "3.00"], [1e21, "1000000000000000000000.00"], [0.1 + 0.2, "0.30"]];
    for (const [v, s] of cases) expect(formatFixed(v, 2)).toBe(s);
    expect(formatFixed(0.5, 0)).toBe("0");
    expect(formatFixed(1.5, 0)).toBe("2");
    expect(formatFixed(2.5, 0)).toBe("2");
    expect(formatFixed(9.999, 2)).toBe("10.00");
  });

  test("%g (6 significant digits)", () => {
    const cases: Array<[number, string]> = [[0.125, "0.125"], [1 / 1024, "0.000976562"], [1234565, "1.23456e+06"], [100, "100"], [12.5, "12.5"], [0.0001234, "0.0001234"], [0.00001234, "1.234e-05"], [1234567.891, "1.23457e+06"], [1e-5, "1e-05"], [123456.5, "123456"], [999999.5, "1e+06"], [0.5, "0.5"], [3, "3"], [1e21, "1e+21"], [5e-324, "4.94066e-324"], [0.1 + 0.2, "0.3"], [-0.125, "-0.125"], [0, "0"]];
    for (const [v, s] of cases) expect(formatDefaultDouble(v)).toBe(s);
  });
});
