/**
 * `KGCMassFileManager` (the exe's virtual file system over the KOM archives), the part scripts reach: the localisation mapping
 * `MassFileMappingList_HK.lua` fills (CX2Main::LoadLuaEnum runs it).  `AddMappingList_LUA` (328D4160) and `AddMappingTime_LUA` (328D43E0).
 *
 * `m_mapMassFileMappingList` is a `std::map<int, std::map<std::string, std::string>>`: group -> (the name a caller asks for -> the name
 * that is really opened).  `AddMappingList(group, requested, actual)` is an `emplace`: an entry that exists is NOT replaced.
 * `m_mapMassFileMappingTime` maps a group to `MASSFILE_MAPPING_TIME { CTime tStartTime, tEndTime }`, also inserted only if the group is
 * absent.  The dates are `"YYYY-MM-DD HH:MM:SS"`: the characters before the 6th separator (' ', '-', ':') are split into six fields of digits
 * (and '.'), `_wtoi` each, and CTime(y, m, d, h, mi, s) -> `mktime` in LOCAL time; a string shorter than 19 characters leaves the time 0.
 * Which group applies when is decided by the file lookup (`LoadDataFile`), which is not ported yet.
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

export class KGCMassFileManager implements Partial<KGCMassFileManager_Methods> {
  /** m_mapMassFileMappingList */
  readonly mappingList = new Map<number, Map<string, string>>();
  /** m_mapMassFileMappingTime: group -> [start, end] in seconds */
  readonly mappingTime = new Map<number, { start: number; end: number }>();

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
}
