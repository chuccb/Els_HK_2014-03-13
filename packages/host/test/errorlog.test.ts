import { describe, expect, test } from "bun:test";
import { ErrorLog } from "../src/index.ts";

describe("CKTDXLog::SetLastErrorLog (328B17C0)", () => {
  test("the last text it was given is kept; the entries PushErrorLog makes are another list", () => {
    const log = new ErrorLog();
    expect(log.lastErrorLog).toBe("");
    log.setLastErrorLog("DLG_A");
    log.setLastErrorLog("DLG_B");
    expect([log.lastErrorLog, log.entries.length]).toEqual(["DLG_B", 0]);
    log.push(0x87, "FILE.LUA");
    expect([log.lastErrorLog, log.entries.map((e) => `${e.id}:${e.text}`)]).toEqual(["DLG_B", ["135:FILE.LUA"]]);
    log.setLastErrorLog("");
    expect([log.lastErrorLog, log.entries.length]).toEqual(["", 1]);
  });
});
