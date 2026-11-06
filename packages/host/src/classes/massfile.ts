/**
 * `KGCMassFileManager` (the exe's virtual file system over the KOM archives).
 *
 * What scripts reach: the localisation mapping `MassFileMappingList_HK.lua` fills (CX2Main::LoadLuaEnum runs it), `AddMappingList_LUA`
 * (328D4160) and `AddMappingTime_LUA` (328D43E0).  `m_mapMassFileMappingList` is a `std::map<int, std::map<std::string, std::string>>`:
 * group -> (the name a caller asks for -> the name that is really opened).  `AddMappingList(group, requested, actual)` is an `emplace`: an
 * entry that exists is NOT replaced.  `m_mapMassFileMappingTime` maps a group to `MASSFILE_MAPPING_TIME { CTime tStartTime, tEndTime }`, also
 * inserted only if the group is absent.  The dates are `"YYYY-MM-DD HH:MM:SS"` (`KncUtil::ConvertStringToCTime`, 328D5160): the characters
 * before the 6th separator (' ', '-', ':') are split into six fields of digits (and '.'), `_wtoi` each, and CTime(y, m, d, h, mi, s) ->
 * `mktime` in LOCAL time; a string shorter than 19 characters leaves the time 0.
 *
 * What the engine reaches: the file table `m_mapMassFile` (every member of every registered archive, by upper-cased name), `IsValidFile`
 * (328D5DF0: an exact lookup of the upper-cased name, NO mapping), `LoadDataFile` (328D62A0), `LoadTwoDataFiles` (328D7800) and
 * `MassFileMapping` (328D7BA0).  The mapping is not applied per lookup: `MassFileMapping()` re-points the TABLE.  It first restores what the
 * previous call re-pointed, then takes `now = m_ServerCurrentTime + (GetTickCount() - m_TickCountAtGetTime) / 1000` (`SetServerCurrentTime`,
 * 328D88A0, fills the two; before the server tells the time `now` is a few seconds after 1970, so no window is open) and, for every group
 * (ascending) whose window holds `now`, for every (requested, actual) pair (ascending by the narrow requested name): both names upper-cased,
 * and only if BOTH are in the table, `table[requested] = table[actual]`.  A later group wins over an earlier one for the same name.
 * Callers: start-up and the places that receive the server time (L528619, L1299845, L1546473, L1550795 of x2.exe.c).
 *
 * The archives are behind a `MassFileSource`: the VM and the UI model are synchronous, so the source hands out bytes that were fetched
 * beforehand; a member that is in the table but not resident reads as undefined, and a source that fetches lazily (tools/komindex.ts)
 * remembers what was asked for, loads it and has the caller run again.
 */
import type { KGCMassFileManager_Methods } from "../api.generated.ts";

/** `_wtoi`: optional white space, sign, digits; stops at the first other character (a field like "05.7" is 5) */
function wtoi(s: string): number {
  const m = /^[ \t\n\v\f\r]*([+-]?\d+)/.exec(s);
  if (!m) return 0;
  const n = Number(m[1]);
  return n > 2147483647 ? 2147483647 : n < -2147483648 ? -2147483648 : n;
}

/** the CTime of a `MappingTime` date string (seconds since the epoch, local time); throws where the exe throws an ATL exception */
export function parseMappingTime(text: string): number {
  if (text.length < 19) return 0; // wstring::size() >= 0x13 is required
  const fields: string[] = ["", "", "", "", "", ""];
  let i = 0;
  for (const ch of text) {
    if (ch === " " || ch === "-" || ch === ":") i++;
    else if ((ch >= "0" && ch <= "9") || ch === ".") fields[i] += ch;
    if (i >= 6) break;
  }
  const [y, mo, d, h, mi, s] = fields.map(wtoi) as [number, number, number, number, number, number];
  // CTime's checks: the date must exist as a day / month, the year >= 1900 (and not 1900-01-01 00:00:00 exactly)
  if (!(d >= 1 && d <= 31 && mo >= 1 && mo <= 12 && y >= 1900 && (y !== 1900 || mo !== 1 || d !== 1 || mi !== 0 || s !== 0))) return 0;
  if ((y < 1970 && !(y === 1969 && mo === 12 && d === 31)) || h > 23 || mi > 59 || s > 59) throw new Error("ATL::AtlThrow(E_FAIL): invalid date " + JSON.stringify(text));
  const date = new Date(y, mo - 1, d, h, mi, s); // __mktime64 with tm_isdst = -1
  const t = Math.floor(date.getTime() / 1000);
  if (Number.isNaN(t)) throw new Error("ATL::AtlThrow(E_INVALIDARG): mktime failed for " + JSON.stringify(text));
  return t;
}

/** the members of the registered archives: names are upper-cased, bytes decrypted and inflated */
export interface MassFileSource {
  /** `m_mapMassFile` membership */
  has(upperName: string): boolean;
  /** the member's bytes, or undefined when it is not resident (yet) */
  read(upperName: string): Uint8Array | undefined;
}

/** `CKTDXLog::PushErrorLog(&g_CKTDXLog, id, text)`: the exe passes a message id (the table of texts is not ported) and one argument */
export class ErrorLog {
  readonly entries: { id: number; text: string }[] = [];
  push(id: number, text = ""): void {
    this.entries.push({ id, text });
  }
}

/** `_towupper` in the "C" locale the exe runs in: ASCII only (file names are ASCII) */
export function towupperAscii(s: string): string {
  return s.replace(/[a-z]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 32));
}

/** `std::string::operator<`: unsigned byte order of the UTF-8 encoding */
function compareNarrow(a: string, b: string): number {
  const enc = new TextEncoder();
  const x = enc.encode(a), y = enc.encode(b);
  const n = Math.min(x.length, y.length);
  for (let i = 0; i < n; i++) if (x[i] !== y[i]) return x[i]! - y[i]!;
  return x.length - y.length;
}

export class KGCMassFileManager implements Partial<KGCMassFileManager_Methods> {
  /** m_mapMassFileMappingList */
  readonly mappingList = new Map<number, Map<string, string>>();
  /** m_mapMassFileMappingTime: group -> [start, end] in seconds */
  readonly mappingTime = new Map<number, { start: number; end: number }>();

  /** the archives (`AddMassFile`) */
  source?: MassFileSource;
  readonly log = new ErrorLog();
  /** `GetTickCount` in milliseconds */
  tickCount: () => number = () => Math.floor(performance.now());
  /** m_ServerCurrentTime (seconds since the epoch; 0 until `SetServerCurrentTime`) and m_TickCountAtGetTime */
  serverCurrentTime = 0;
  tickCountAtGetTime = 0;
  /** `m_mapMassFile` entries `MassFileMapping` re-pointed: requested (upper-case) -> the member whose data it now has */
  private readonly remapped = new Map<string, string>();

  AddMappingList(group: number, requested: string, actual: string): boolean {
    let m = this.mappingList.get(group);
    if (!m) this.mappingList.set(group, (m = new Map()));
    if (!m.has(requested)) m.set(requested, actual); // std::map::emplace keeps the first value
    return true;
  }

  AddMappingTime(group: number, start: string, end: string): boolean {
    const startTime = parseMappingTime(start);
    const endTime = parseMappingTime(end);
    if (!this.mappingTime.has(group)) this.mappingTime.set(group, { start: startTime, end: endTime });
    return true;
  }

  /** `SetServerCurrentTime(wstring)` (328D88A0): `ConvertStringToCTime` into m_ServerCurrentTime (a string shorter than 19 characters leaves it as it was) */
  setServerCurrentTime(text: string): void {
    if (text.length >= 19) this.serverCurrentTime = parseMappingTime(text);
    this.tickCountAtGetTime = this.tickCount();
  }

  /** the table entry of an (upper-cased) name: the member whose data it reads, undefined when the name is not in the table */
  private lookup(upperName: string): string | undefined {
    const r = this.remapped.get(upperName);
    if (r !== undefined) return r;
    return this.source?.has(upperName) ? upperName : undefined;
  }

  /** `MassFileMapping()` (328D7BA0); returns how many table entries were re-pointed */
  massFileMapping(): number {
    this.remapped.clear(); // m_mapMassFileBackup is put back
    const now = this.serverCurrentTime + Math.floor((this.tickCount() - this.tickCountAtGetTime) / 1000);
    let applied = 0;
    for (const group of [...this.mappingTime.keys()].sort((a, b) => a - b)) {
      const win = this.mappingTime.get(group)!;
      if (!(win.start <= now && now <= win.end)) continue;
      const list = this.mappingList.get(group);
      if (!list) continue;
      for (const requested of [...list.keys()].sort(compareNarrow)) {
        const v = towupperAscii(requested), r = towupperAscii(list.get(requested)!);
        const target = this.lookup(r);
        if (this.lookup(v) === undefined || target === undefined) continue; // both must be in the table
        this.remapped.set(v, target);
        applied++;
      }
    }
    return applied;
  }

  /** `IsValidFile(wstring)` (328D5DF0): the exact, upper-cased name is in the table (the mapping is already part of the table) */
  isValidFile(name: string): boolean {
    return name.length !== 0 && this.lookup(towupperAscii(name)) !== undefined;
  }

  /** `LoadDataFile(wstring, true)` (328D62A0): the bytes of a member; a name that is not in the table is error 0x87 */
  loadDataFile(name: string): Uint8Array | undefined {
    if (name.length === 0) return undefined;
    const upper = towupperAscii(name);
    const member = this.lookup(upper);
    if (member === undefined) {
      this.log.push(0x87, upper);
      return undefined;
    }
    return this.source!.read(member);
  }

  /** `LoadTwoDataFiles` (328D7800): the second file is optional (no error when it is not there) and is only looked for when the first one is */
  loadTwoDataFiles(name1: string, name2: string): { first?: Uint8Array; second?: Uint8Array } {
    const first = this.loadDataFile(name1);
    if (first === undefined && this.lookup(towupperAscii(name1)) === undefined) return {};
    let second: Uint8Array | undefined;
    if (name2.length !== 0) {
      const member = this.lookup(towupperAscii(name2));
      if (member !== undefined) second = this.source!.read(member);
    }
    return { first, second };
  }
}
