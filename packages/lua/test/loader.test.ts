import { describe, expect, test } from "bun:test";
import { call, createLuaState, loadChunk, LuaError, LuaNative, rawToString } from "../src/index.ts";
import type { LuaTable, LuaValue } from "../src/index.ts";

/**
 * Chunk loading of the exe: `cpparser` (33378B50) + `lj_lex_setup` + stock `lj_bcread`, and KOG's `luaL_loadfilex(..., iEncoding)` (33378830).
 * The exe contains no Lua source compiler, so "loading text" must fail exactly like it does there (tests/lua/t15_loader.lua compares the
 * dump-related messages with the native oracle; the oracle itself compiles text, so those cases live here).
 */

const hex = (h: string): Uint8Array => Uint8Array.from(h.trim().split(/\s+/).map((x) => parseInt(x, 16)));
/** `luajit -b -s` of `return 40 + 2` (oracle output): header, flags = strip, one prototype, terminator. */
const RETURN_42 = hex("1b 4b 4c 81 02 0f 02 00 01 00 00 00 02 27 00 2a 00 48 00 02 00 00");
/** `luajit -b -s` of a script with a table constructor, a vararg function, an upvalue, numbers and strings (199 bytes). */
const THREE = Uint8Array.from(Buffer.from(
  "1b4b4c810230000003030101082b000000140000002c0000002b0000002b010100370100012b020200460004000180000002c00678023003010401010108160100" +
  "002b020000130202001e0102014302010231030000300000804803020000c0000180809080045e0300060004020b33000000310101001002010027030400250402" +
  "003e0203022503030028040000280501003000008046020500087374720776610001030200030103020678067904008080b0800402feffffff0f818080801df690" +
  "9d900c00", "hex"));
/** bytes -> a Lua string (one char per byte); strings are taken as latin1 */
const str = (...parts: (string | Uint8Array)[]): string => {
  let s = "";
  for (const p of parts) s += typeof p === "string" ? p : String.fromCharCode(...p);
  return s;
};
const bytes = (...parts: (string | Uint8Array)[]): Uint8Array => Uint8Array.from(str(...parts), (c) => c.charCodeAt(0));
const BOM = "\xef\xbb\xbf";
const BCBAD = "cannot load malformed bytecode";
const BCFMT = "cannot load incompatible bytecode";

function makeState(files: Record<string, Uint8Array> = {}) {
  const G = createLuaState({ write: () => {}, readFile: (p) => files[p] });
  const callG = (name: string, ...args: LuaValue[]) => call(G.main, G.globals.getStr(name), args);
  return { G, callG };
}

describe("loading a chunk", () => {
  test("a dump loads and runs", () => {
    const { G } = makeState();
    expect(call(G.main, loadChunk(G.main, RETURN_42, "=t"), [])).toEqual([42]);
    expect(call(G.main, loadChunk(G.main, str(RETURN_42), "=t"), [])).toEqual([42]); // a Lua string works too
  });

  test("source text is refused like the exe does (no parser): LUA_ERRSYNTAX without a chunk name", () => {
    const { callG } = makeState();
    for (const text of ["return 1", "x = 1", "-- comment\n", "\n", " ", "return", "GAME_OPTION_CURRENT = { A = 1 }"]) {
      expect(callG("loadstring", text)).toEqual([undefined, BCBAD]);
      expect(callG("loadstring", text, "=chunk")).toEqual([undefined, BCBAD]);
      expect(callG("loadstring", text, "@file.lua")).toEqual([undefined, BCBAD]);
    }
  });

  test("an empty buffer, a lone BOM and a lone # line are not chunks either", () => {
    const { callG } = makeState();
    for (const s of ["", BOM, BOM + "return 1", "\xef\xbb", "\xef", "#", "#!lua", "#!lua\n", "#!lua\r\n", "#!lua\nreturn 1", BOM + "#!lua\nreturn 1"]) {
      expect(callG("loadstring", s, "=x")).toEqual([undefined, BCBAD]);
    }
  });

  test("a dump behind a BOM or a # line is refused too (lj_lex_setup: no chunk name is echoed)", () => {
    const { callG } = makeState();
    for (const head of [BOM, "#!lua\n", "#!lua\r\n", "#!lua\r", "#!lua\n\r", BOM + "#!lua\n", "#\n"]) {
      expect(callG("loadstring", str(head, RETURN_42), "=x")).toEqual([undefined, BCBAD]);
      expect(callG("loadstring", str(head, THREE), "@some.lua")).toEqual([undefined, BCBAD]);
    }
    // after "\n\r" a second blank line is not part of the header line any more: that is source text again
    expect(callG("loadstring", str("#!lua\n\r\n", RETURN_42), "=x")).toEqual([undefined, BCBAD]);
    // without a header the same bytes load
    expect(callG("loadstring", str(RETURN_42), "=x")[0]).toBeDefined();
  });

  test("load(reader) goes through the same check", () => {
    const { G, callG } = makeState();
    const feed = (pieces: string[]) => new LuaNative("feed", () => [pieces.shift()]);
    expect(callG("load", feed(["return ", "1"]))).toEqual([undefined, BCBAD]);
    expect(callG("load", feed([]))).toEqual([undefined, BCBAD]); // an empty chunk is not a dump either
    const [fn] = callG("load", feed([str(RETURN_42.subarray(0, 9)), str(RETURN_42.subarray(9))]));
    expect(call(G.main, fn, [])).toEqual([42]);
    expect(callG("load", feed([str(RETURN_42.subarray(0, 9))]), "=part")).toEqual([undefined, `part: ${BCBAD}`]);
  });

  test("errors inside a dump are named like bcread_error: (binary), the name without @ or =, plain names as they are", () => {
    const { callG } = makeState();
    expect(callG("loadstring", "\x1b")).toEqual([undefined, `(binary): ${BCFMT}`]); // the default name is the string itself, which starts with ESC
    expect(callG("loadstring", "\x1b", "=foo")).toEqual([undefined, `foo: ${BCFMT}`]);
    expect(callG("loadstring", "\x1b", "@foo.lua")).toEqual([undefined, `foo.lua: ${BCFMT}`]);
    expect(callG("loadstring", "\x1b", "hello world")).toEqual([undefined, `hello world: ${BCFMT}`]);
    expect(callG("loadstring", "\x1b", "")).toEqual([undefined, `: ${BCFMT}`]);
    expect(callG("loadstring", "\x1b", "\x1bodd")).toEqual([undefined, `(binary): ${BCFMT}`]);
    // damaged after a good header: malformed
    expect(callG("loadstring", str(RETURN_42.subarray(0, 12)), "=x")).toEqual([undefined, `x: ${BCBAD}`]);
    // wrong version / unknown flags: incompatible
    expect(callG("loadstring", "\x1bKL\x7f\x02", "=x")).toEqual([undefined, `x: ${BCFMT}`]);
    expect(callG("loadstring", str(RETURN_42.subarray(0, 4), "\x08", RETURN_42.subarray(5)), "=x")).toEqual([undefined, `x: ${BCFMT}`]);
  });

  test("a dump that ends where the terminator should be is complete (stock reads the NUL after the string)", () => {
    const { G } = makeState();
    expect(call(G.main, loadChunk(G.main, RETURN_42.subarray(0, RETURN_42.length - 1), "=t"), [])).toEqual([42]);
    expect(() => loadChunk(G.main, bytes(RETURN_42, RETURN_42), "=t")).toThrow(); // two dumps in a row: trailing data
  });

  test("a dump of the other byte order is swapped (bcread_swap), not refused", () => {
    const { G } = makeState();
    const be = Uint8Array.from(RETURN_42);
    be[4] = 0x03; // BE | STRIP
    // header (5) + proto length, flags, numparams, framesize, sizeuv, sizekgc, sizekn, sizebc (8): then two 32-bit instruction words
    for (let w = 0; w < 2; w++) be.subarray(13 + w * 4, 17 + w * 4).reverse();
    expect(call(G.main, loadChunk(G.main, be, "=t"), [])).toEqual([42]);
  });

  test("damaged dumps never crash or hang the loader: only the two LuaJIT messages come out", () => {
    const { G } = makeState();
    let loaded = 0, refused = 0;
    const attempt = (m: Uint8Array) => {
      try {
        loadChunk(G.main, m, "=x");
        loaded++;
      } catch (e) {
        refused++;
        expect(e).toBeInstanceOf(LuaError);
        expect([BCBAD, BCFMT].some((msg) => rawToString((e as LuaError).value).endsWith(msg))).toBe(true);
      }
    };
    for (const d of [THREE, RETURN_42]) {
      for (let pos = 0; pos < d.length; pos++) {
        for (const v of [0, 1, 2, 0x7f, 0x80, 0xff]) {
          const m = Uint8Array.from(d);
          m[pos] = v;
          attempt(m);
        }
      }
      for (let k = 0; k <= d.length; k++) attempt(d.subarray(0, k));
    }
    expect(loaded).toBeGreaterThan(100); // stock LuaJIT checks the structure only, not the instructions
    expect(refused).toBeGreaterThan(100);
    // absurd sizes are rejected before anything is allocated (sizebc = 2^32 - 1)
    const huge = hex("1b 4b 4c 81 02 0f 02 00 01 00 00 00 ff ff ff ff 0f 27 00 2a 00 48 00 02 00 00");
    expect(() => loadChunk(G.main, huge, "=x")).toThrow(/malformed/);
  });
});

describe("loadfile / dofile / dofile_UTF8 (luaL_loadfilex with iEncoding)", () => {
  const files = {
    "bc.lua": RETURN_42,
    "bom_bc.lua": bytes(BOM, RETURN_42),
    "txt.lua": bytes("return 1\n"),
    "bom_txt.lua": bytes(BOM, "return 1\n"),
    "bad_bom.lua": bytes("\xef\xbbx"),
    "empty.lua": new Uint8Array(0),
  };

  test("encoding 0 (a fresh state): no BOM needed, a BOM is consumed", () => {
    const { callG } = makeState(files);
    expect(callG("dofile", "bc.lua")).toEqual([42]);
    // unlike stock LuaJIT the BOM never reaches the lexer, so "BOM + dump" loads
    expect(callG("dofile", "bom_bc.lua")).toEqual([42]);
    expect(callG("loadfile", "txt.lua")).toEqual([undefined, BCBAD]);
    expect(callG("loadfile", "bom_txt.lua")).toEqual([undefined, BCBAD]);
    expect(callG("loadfile", "empty.lua")).toEqual([undefined, BCBAD]);
    expect(callG("loadfile", "bad_bom.lua")).toEqual([undefined, "invalid encoding bad_bom.lua"]);
    expect(callG("loadfile", "nope.lua")).toEqual([undefined, "cannot open nope.lua: No such file or directory"]);
  });

  test("encoding 1 (what the game sets with lua_setencoding): the file must start with a BOM or be a dump", () => {
    const { G, callG } = makeState(files);
    G.encoding = 1;
    expect(callG("dofile", "bc.lua")).toEqual([42]);
    expect(callG("dofile", "bom_bc.lua")).toEqual([42]);
    expect(callG("loadfile", "txt.lua")).toEqual([undefined, "invalid encoding txt.lua"]);
    expect(callG("loadfile", "empty.lua")).toEqual([undefined, "invalid encoding empty.lua"]);
    expect(callG("loadfile", "bom_txt.lua")).toEqual([undefined, BCBAD]);
  });

  test("encoding 2: no check at all, so a BOM is part of the chunk and 'BOM + dump' is refused", () => {
    const { G, callG } = makeState(files);
    G.encoding = 2;
    expect(callG("dofile", "bc.lua")).toEqual([42]);
    expect(callG("loadfile", "bom_bc.lua")).toEqual([undefined, BCBAD]);
    expect(callG("loadfile", "txt.lua")).toEqual([undefined, BCBAD]);
    expect(callG("loadfile", "bad_bom.lua")).toEqual([undefined, BCBAD]);
  });

  test("dofile raises the message, dofile_UTF8 always demands UTF-8", () => {
    const { callG } = makeState(files);
    expect(() => callG("dofile", "txt.lua")).toThrow(BCBAD);
    expect(() => callG("dofile", "nope.lua")).toThrow("cannot open nope.lua: No such file or directory");
    expect(callG("dofile_UTF8", "bc.lua")).toEqual([42]);
    expect(callG("dofile_UTF8", "bom_bc.lua")).toEqual([42]);
    expect(() => callG("dofile_UTF8", "txt.lua")).toThrow("invalid encoding txt.lua");
  });

  test("require wraps the loader error like loaderror() in lib_package.c", () => {
    const { G, callG } = makeState({ "mod.lua": bytes("x = 1") });
    (G.globals.getStr("package") as LuaTable).setStr("path", "?.lua");
    expect(() => callG("require", "mod")).toThrow("error loading module 'mod' from file 'mod.lua':\n\tcannot load malformed bytecode");
  });
});
