/**
 * `General.ess`, the client's string table (`CKTDXStringTable`).
 *
 * Loader: `CKTDXStringTable::LoadStringTable` 328ADEF0 (x2.exe.c L267181), called from `InitializeStringTable` 328ADEE0 for the file
 * `General.ess` (the `Script.ess` name passed next to it is ignored by that function). The file is a plain file next to the exe, not a
 * KOM entry. Format, as the loader reads it:
 *   - the first two bytes (a UTF-16LE BOM) are skipped with `fseek`;
 *   - the rest is read with `fgetws(buf, 2048, fp)` on a binary stream, i.e. UTF-16LE code units, one call per line: at most 2047
 *     code units, stopping after a L'\n' (a longer line would be split in two "lines", which this port reproduces);
 *   - a line is cut at its first L"\r\n", every remaining code unit is XORed with 0x10, and the text is split at the first TAB:
 *     `<decimal index> TAB <text>`;
 *   - the entry is stored only when the index equals the running line number (otherwise an empty string is stored, and the line
 *     number still advances); the two characters `\n` inside the text become CR LF.
 * `GetGeneralString` 328ACCA0 returns the entry for 0 <= id < size and the empty string otherwise. `GetReplacedString` 328ACE00 formats
 * messages with `@1`, `@2`, ... placeholders (see `StringTable.replaced`); its debug-info branch (`m_bEnableDebugInfo`, boost::format
 * prefix) is not ported.
 */

const BOM_BYTES = 2;
const LINE_UNITS = 2047; // fgetws(buf, 2048, ...) reads at most 2047 wide characters

/** `_wtoi`: optional blanks, sign, digits; 0 when there are none; saturates like `wcstol`. */
function wtoi(s: string): number {
  const m = /^[ \t\n\v\f\r]*([+-]?)(\d+)/.exec(s);
  if (!m) return 0;
  const v = Number(m[2]) * (m[1] === "-" ? -1 : 1);
  return Math.max(-2147483648, Math.min(2147483647, v));
}

export interface EssDiagnostics {
  /** entries produced (= calls of fgetws that returned a line) */
  entries: number;
  /** lines whose index field differs from the running line number, or that have no TAB: stored as empty strings */
  indexMismatches: number;
  /** fgetws calls that stopped at the 2047-unit limit instead of a newline (the rest of the line becomes the next "line") */
  cappedLines: number;
  /** stored entries with no text */
  emptyTexts: number;
}

/** Decode the bytes of an `.ess` file exactly like `CKTDXStringTable::LoadStringTable`, and report how clean the file is. */
export function parseEssWithDiagnostics(bytes: Uint8Array): { table: string[]; diagnostics: EssDiagnostics } {
  const units = Math.floor(Math.max(0, bytes.length - BOM_BYTES) / 2);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const table: string[] = [];
  const diagnostics: EssDiagnostics = { entries: 0, indexMismatches: 0, cappedLines: 0, emptyTexts: 0 };
  let at = 0; // in code units after the BOM
  let expected = 0;
  while (at < units) {
    // fgetws
    let line = "";
    let n = 0;
    let last = 0;
    while (n < LINE_UNITS && at < units) {
      last = dv.getUint16(BOM_BYTES + 2 * at, true);
      at++;
      n++;
      line += String.fromCharCode(last);
      if (last === 0x0a) break;
    }
    if (n === LINE_UNITS && last !== 0x0a) diagnostics.cappedLines++;
    // the string constructor in the exe takes wcslen(): the line ends at the first NUL
    const nul = line.indexOf("\0");
    if (nul >= 0) line = line.slice(0, nul);
    // cut at the first CR LF
    if (line.length >= 2) {
      const eol = line.indexOf("\r\n");
      if (eol >= 0) line = line.slice(0, eol);
    }
    let decoded = "";
    for (let i = 0; i < line.length; i++) decoded += String.fromCharCode(line.charCodeAt(i) ^ 0x10);
    const tab = decoded.indexOf("\t");
    const index = wtoi(tab < 0 ? decoded : decoded.slice(0, tab));
    let content = "";
    if (index === expected && tab >= 0) {
      if (tab + 1 < decoded.length) content = decoded.slice(tab + 1);
    } else {
      diagnostics.indexMismatches++;
    }
    if (content === "") diagnostics.emptyTexts++;
    table.push(content.split("\\n").join("\r\n"));
    diagnostics.entries++;
    expected++;
  }
  return { table, diagnostics };
}

/** Decode the bytes of an `.ess` file exactly like `CKTDXStringTable::LoadStringTable`. */
export function parseEss(bytes: Uint8Array): string[] {
  return parseEssWithDiagnostics(bytes).table;
}

/**
 * Exact decimal digits of |v| rounded to `sig` significant digits the way the C runtime does it: the double's exact expansion,
 * ties (only possible for dyadic values such as 1/1024) go to the even digit. JS `toPrecision` / `toFixed` round such ties up.
 */
function sigDigits(v: number, sig: number): { digits: string; exp: number } {
  const [mant, ex] = Math.abs(v).toExponential(Math.min(100, sig - 1 + 60)).split("e");
  const all = mant!.replace(".", "");
  let keep = all.slice(0, sig);
  const rest = all.slice(sig);
  let exp = Number(ex);
  const first = rest.length ? rest.charCodeAt(0) - 48 : 0;
  const up = first > 5 || (first === 5 && (/[1-9]/.test(rest.slice(1)) || (keep.charCodeAt(keep.length - 1) - 48) % 2 === 1));
  if (up) {
    const n = (BigInt(keep) + 1n).toString();
    if (n.length > sig) { keep = n.slice(0, sig); exp += 1; } else keep = n;
  }
  return { digits: keep, exp };
}

/** `%.<decimals>f` with the C runtime's rounding of exact ties (half to even). */
export function formatFixed(v: number, decimals: number): string {
  if (!Number.isFinite(v)) return Number.isNaN(v) ? "nan" : v < 0 ? "-inf" : "inf";
  const neg = v < 0 || Object.is(v, -0);
  const abs = Math.abs(v);
  // toFixed switches to exponent notation from 1e21; such doubles are integers
  const [ip, fp = ""] = abs >= 1e21 ? [BigInt(abs).toString(), "0".repeat(decimals)] : abs.toFixed(Math.min(100, decimals + 60)).split(".");
  let keep = ip! + fp.slice(0, decimals);
  const rest = fp.slice(decimals);
  const first = rest.length ? rest.charCodeAt(0) - 48 : 0;
  if (first > 5 || (first === 5 && (/[1-9]/.test(rest.slice(1)) || (keep.charCodeAt(keep.length - 1) - 48) % 2 === 1))) keep = (BigInt(keep) + 1n).toString().padStart(keep.length, "0");
  const intLen = keep.length - decimals;
  const text = decimals > 0 ? `${keep.slice(0, intLen)}.${keep.slice(intLen)}` : keep;
  return (neg ? "-" : "") + text;
}

/** C++ `std::wostream << double` with the default format: `%g` with 6 significant digits. */
export function formatDefaultDouble(v: number): string {
  if (Number.isNaN(v)) return "nan";
  if (!Number.isFinite(v)) return v < 0 ? "-inf" : "inf";
  const neg = v < 0 || Object.is(v, -0);
  if (v === 0) return neg ? "-0" : "0";
  const P = 6;
  const { digits, exp } = sigDigits(v, P);
  let body: string;
  if (exp < -4 || exp >= P) {
    const m = digits.slice(1).replace(/0+$/, "");
    body = `${digits[0]}${m ? "." + m : ""}e${exp < 0 ? "-" : "+"}${String(Math.abs(exp)).padStart(2, "0")}`;
  } else if (exp >= 0) {
    const frac = digits.slice(exp + 1).replace(/0+$/, "");
    body = digits.slice(0, exp + 1) + (frac ? "." + frac : "");
  } else {
    body = "0." + "0".repeat(-exp - 1) + digits.replace(/0+$/, "");
  }
  return (neg ? "-" : "") + body;
}

export type ReplaceArg = number | string;

export class StringTable {
  constructor(readonly strings: readonly string[]) {}

  static fromEss(bytes: Uint8Array): StringTable {
    return new StringTable(parseEss(bytes));
  }

  /** `CKTDXStringTable::GetGeneralString` (328ACCA0): out-of-range ids give the empty string. */
  get(id: number): string {
    return id >= 0 && id < this.strings.length ? this.strings[id]! : "";
  }

  /**
   * `CKTDXStringTable::GetReplacedString` (328ACE00), normal (non-debug) path: starts from the table entry and, for the i-th
   * character of `types`, replaces every `@<i+1>` by the formatted argument (scanning on after each replacement, so inserted text is
   * never re-scanned; `@1` also matches the start of `@10`, as in the exe). Type characters: `I` string-table id, `L` / `S` / `l` / `s`
   * wide or narrow strings (inserted as given), `i` int, `h` int with a leading `+` when positive, `f` double rounded to two
   * decimals then printed with the stream default (`%g`), `e` like `f` with a leading `+` when positive.
   */
  replaced(id: number, types: string, ...args: ReplaceArg[]): string {
    if (id < 0 || id >= this.strings.length) return "";
    let text = this.strings[id]!;
    for (let x = 0; x < types.length; x++) {
      const arg = args[x];
      let value: string;
      switch (types[x]) {
        case "I": value = this.get(Number(arg)); break;
        case "L": case "S": case "l": case "s": value = String(arg); break;
        case "i": value = String(Math.trunc(Number(arg)) | 0); break;
        case "h": { const v = Math.trunc(Number(arg)) | 0; value = (v > 0 ? "+" : "") + String(v); break; }
        case "f": { value = formatDefaultDouble(Number(formatFixed(Number(arg), 2))); break; }
        case "e": { const r = Number(formatFixed(Number(arg), 2)); value = (r > 0 ? "+" : "") + formatDefaultDouble(r); break; }
        default: value = ""; // the exe's switch has no default: the symbol is replaced by an empty value
      }
      const symbol = `@${x + 1}`;
      let i = 0;
      for (;;) {
        const found = text.indexOf(symbol, i);
        if (found < 0) break;
        text = text.slice(0, found) + value + text.slice(found + symbol.length);
        i = found + value.length;
      }
    }
    return text;
  }
}
