-- Loader classification (lj_lex_setup + lj_bcread, shared by the oracle and the exe): every prefix of three dumps, header mutations,
-- chunk names as bcread_error prints them, a dump after a BOM or a `#` line. Source text is NOT tested here: the oracle compiles it, the exe does not.
-- (A dump cut right after the 4 magic bytes is skipped: stock LuaJIT then reads the flags past the end of the buffer, which is undefined.
-- A BOM cut short or a `#` line followed by a second blank line is Lua source for the oracle: not compared either.
-- Damaged bodies are not compared: stock LuaJIT crashes or raises memory errors on them, the TS loader reports "malformed bytecode".)
local function try(label, s, name) local f, e = loadstring(s, name); print(label, f ~= nil, e) end
local d0 = "\027\075\076\129\002\015\002\000\001\000\000\000\002\039\000\042\000\072\000\002\000\000"
for k = 1, #d0 do if k ~= 4 then try("one.luac cut " .. k, d0:sub(1, k), "=x") end end
for pos = 2, 4 do for _, v in ipairs({0, 1, 2, 3, 0x7f, 0x80, 0xff}) do try("one.luac set " .. pos .. "=" .. v, d0:sub(1, pos - 1) .. string.char(v) .. d0:sub(pos + 1), "=x") end end
for _, v in ipairs({3, 0x7f, 0x80, 0xff}) do try("one.luac flags " .. v, d0:sub(1, 4) .. string.char(v) .. d0:sub(6), "=x") end
try("one.luac +NUL", d0 .. "\0", "=x")
try("one.luac dup", d0 .. d0, "=x")
try("one.luac bom", "\239\187\191" .. d0, "=x")
try("one.luac hash", "#!lua\n" .. d0, "=x")
try("one.luac hash crlf", "#!lua\r\n" .. d0, "=x")
try("one.luac hash cr", "#!lua\r" .. d0, "=x")
try("one.luac bom hash", "\239\187\191#!lua\n" .. d0, "=x")
try("one.luac default name", d0)
try("one.luac name @foo.lua", d0:sub(1, 10), "@foo.lua")
try("one.luac ok name @foo.lua", d0, "@foo.lua")
try("one.luac name =foo", d0:sub(1, 10), "=foo")
try("one.luac ok name =foo", d0, "=foo")
try("one.luac name plain name", d0:sub(1, 10), "plain name")
try("one.luac ok name plain name", d0, "plain name")
try("one.luac name @", d0:sub(1, 10), "@")
try("one.luac ok name @", d0, "@")
try("one.luac name =", d0:sub(1, 10), "=")
try("one.luac ok name =", d0, "=")
try("one.luac name ", d0:sub(1, 10), "")
try("one.luac ok name ", d0, "")
try("one.luac name ESCodd", d0:sub(1, 10), "\27odd")
try("one.luac ok name ESCodd", d0, "\27odd")
local d1 = "\027\075\076\129\002\026\002\000\003\000\001\000\004\067\000\000\002\016\001\000\000\037\002\000\000\070\001\003\000\007\104\105\000"
for k = 1, #d1 do if k ~= 4 then try("two.luac cut " .. k, d1:sub(1, k), "=x") end end
for pos = 2, 4 do for _, v in ipairs({0, 1, 2, 3, 0x7f, 0x80, 0xff}) do try("two.luac set " .. pos .. "=" .. v, d1:sub(1, pos - 1) .. string.char(v) .. d1:sub(pos + 1), "=x") end end
for _, v in ipairs({3, 0x7f, 0x80, 0xff}) do try("two.luac flags " .. v, d1:sub(1, 4) .. string.char(v) .. d1:sub(6), "=x") end
try("two.luac +NUL", d1 .. "\0", "=x")
try("two.luac dup", d1 .. d1, "=x")
try("two.luac bom", "\239\187\191" .. d1, "=x")
try("two.luac hash", "#!lua\n" .. d1, "=x")
try("two.luac hash crlf", "#!lua\r\n" .. d1, "=x")
try("two.luac hash cr", "#!lua\r" .. d1, "=x")
try("two.luac bom hash", "\239\187\191#!lua\n" .. d1, "=x")
try("two.luac default name", d1)
try("two.luac name @foo.lua", d1:sub(1, 10), "@foo.lua")
try("two.luac ok name @foo.lua", d1, "@foo.lua")
try("two.luac name =foo", d1:sub(1, 10), "=foo")
try("two.luac ok name =foo", d1, "=foo")
try("two.luac name plain name", d1:sub(1, 10), "plain name")
try("two.luac ok name plain name", d1, "plain name")
try("two.luac name @", d1:sub(1, 10), "@")
try("two.luac ok name @", d1, "@")
try("two.luac name =", d1:sub(1, 10), "=")
try("two.luac ok name =", d1, "=")
try("two.luac name ", d1:sub(1, 10), "")
try("two.luac ok name ", d1, "")
try("two.luac name ESCodd", d1:sub(1, 10), "\27odd")
try("two.luac ok name ESCodd", d1, "\27odd")
local d2 = "\027\075\076\129\002\048\000\000\003\003\001\001\008\043\000\000\000\020\000\000\000\044\000\000\000\043\000\000\000\043\001\001\000\055\001\000\001\043\002\002\000\070\000\004\000\001\128\000\000\002\192\006\120\002\048\003\001\004\001\001\001\008\022\001\000\000\043\002\000\000\019\002\002\000\030\001\002\001\067\002\001\002\049\003\000\000\048\000\000\128\072\003\002\000\000\192\000\001\128\128\144\128\004\094\003\000\006\000\004\002\011\051\000\000\000\049\001\001\000\016\002\001\000\039\003\004\000\037\004\002\000\062\002\003\002\037\003\003\000\040\004\000\000\040\005\001\000\048\000\000\128\070\002\005\000\008\115\116\114\007\118\097\000\001\003\002\000\003\001\003\002\006\120\006\121\004\000\128\128\176\128\004\002\254\255\255\255\015\129\128\128\128\029\246\144\157\144\012\000"
for k = 1, #d2 do if k ~= 4 then try("three.luac cut " .. k, d2:sub(1, k), "=x") end end
for pos = 2, 4 do for _, v in ipairs({0, 1, 2, 3, 0x7f, 0x80, 0xff}) do try("three.luac set " .. pos .. "=" .. v, d2:sub(1, pos - 1) .. string.char(v) .. d2:sub(pos + 1), "=x") end end
for _, v in ipairs({3, 0x7f, 0x80, 0xff}) do try("three.luac flags " .. v, d2:sub(1, 4) .. string.char(v) .. d2:sub(6), "=x") end
try("three.luac +NUL", d2 .. "\0", "=x")
try("three.luac dup", d2 .. d2, "=x")
try("three.luac bom", "\239\187\191" .. d2, "=x")
try("three.luac hash", "#!lua\n" .. d2, "=x")
try("three.luac hash crlf", "#!lua\r\n" .. d2, "=x")
try("three.luac hash cr", "#!lua\r" .. d2, "=x")
try("three.luac bom hash", "\239\187\191#!lua\n" .. d2, "=x")
try("three.luac default name", d2)
try("three.luac name @foo.lua", d2:sub(1, 10), "@foo.lua")
try("three.luac ok name @foo.lua", d2, "@foo.lua")
try("three.luac name =foo", d2:sub(1, 10), "=foo")
try("three.luac ok name =foo", d2, "=foo")
try("three.luac name plain name", d2:sub(1, 10), "plain name")
try("three.luac ok name plain name", d2, "plain name")
try("three.luac name @", d2:sub(1, 10), "@")
try("three.luac ok name @", d2, "@")
try("three.luac name =", d2:sub(1, 10), "=")
try("three.luac ok name =", d2, "=")
try("three.luac name ", d2:sub(1, 10), "")
try("three.luac ok name ", d2, "")
try("three.luac name ESCodd", d2:sub(1, 10), "\27odd")
try("three.luac ok name ESCodd", d2, "\27odd")
