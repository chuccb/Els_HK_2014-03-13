local function p(...) local t = {...} for i = 1, select('#', ...) do t[i] = tostring(t[i]) end print(table.concat(t, " ", 1, select('#', ...))) end
local function strip(m) return (tostring(m):gsub("^[^:]*:%d+: ", "")) end
-- environments
local env = {print = print, tostring = tostring}
local f = function() x = 5 return x end
setfenv(f, env) p(f(), env.x, rawget(_G, "x"))
p(getfenv(1) == _G, getfenv(f) == env)
-- globals
gvar = 10 p(gvar, _G.gvar, _G["gvar"]) _G.gvar2 = 20 p(gvar2)
setmetatable(_G, {__index = function(_, k) return "missing:" .. k end}) p(undefined_thing) setmetatable(_G, nil)
-- varargs
local function v1(...) local a, b = ... return a, b, select('#', ...) end
p(v1()) p(v1(1)) p(v1(1, 2, 3))
local function v2(...) return {...}, select('#', ...) end
local t, n = v2(nil, nil, 3) p(#t == 3 or #t == 0, n)
local function v3(...) local t = {n = select('#', ...), ...} return t.n, t[1], t[t.n] end
p(v3("a", "b", "c"))
p((function(...) return ... end)(1, 2, 3))
local function many() return 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 end
p(many()) p((many())) p(({many()})[10], #{many(), many()})
p(select('#', many(), many()))
local function bigva(...) return select('#', ...) end
local bigt = {} for i = 1, 200 do bigt[i] = i end p(bigva(unpack(bigt)))
p(math.max(unpack(bigt)))
p(string.char(unpack({72, 101, 108, 108, 111})))
-- multiple assignment evaluation order
local a, b = 1, 2 a, b = b, a p(a, b)
local tt = {} local i = 1 i, tt[i] = i + 1, 20 p(i, tt[1], tt[2])
local x, y, z = 1 p(x, y, z)
local q1, q2 = (function() return 1, 2 end)() p(q1, q2)
-- nested functions and upvalues
local function mk() local n = 0 return function() n = n + 1 return n end, function() return n end end
local inc, get = mk() inc() inc() p(get())
local ups = {} for i = 1, 3 do local j = i * 10 ups[i] = {function() j = j + 1 return j end, function() return j end} end
ups[1][1]() ups[1][1]() p(ups[1][2](), ups[2][2](), ups[3][2]())
-- closures in while with break
local cl = {} local ii = 0 while true do ii = ii + 1 local c = ii cl[ii] = function() return c end if ii >= 3 then break end end p(cl[1](), cl[2](), cl[3]())
-- numeric for edge cases
local out = {} for i = 1, 3 do local i = i * 2 out[#out + 1] = i end p(table.concat(out, ","))
out = {} for i = 1, 2, 0.5 do out[#out + 1] = i end p(table.concat(out, ","))
out = {} for i = 5, 1, -2 do out[#out + 1] = i end p(table.concat(out, ","))
out = {} for i = 0.1, 0.5, 0.1 do out[#out + 1] = i end p(#out)
out = {} for i = "1", "3" do out[#out + 1] = i end p(table.concat(out, ","))
-- generic for
local function iter(s, c) if c < s then return c + 1, c * c end end
out = {} for a, b in iter, 3, 0 do out[#out + 1] = a .. ":" .. b end p(table.concat(out, ","))
out = {} for k, v in next, {10, 20, 30} do out[#out + 1] = k .. "=" .. v end p(table.concat(out, ","))
out = {} for i, v in ipairs({"a", "b", "c"}) do out[#out + 1] = i .. v end p(table.concat(out, ","))
-- string coercions
p(10 .. "", 1.5 .. "", -0 .. "", 2^63 .. "", "5" * "2", "0x10" + 0, "1e1" + 0, pcall(function() return "x" + 1 end))
p(#tostring(12345.678), tostring(1e100), 255 .. "", (2^53) .. "")
-- integer/float keys
local nk = {} nk[1] = "a" nk[1.0] = "b" nk["1"] = "c" p(nk[1], nk["1"], #nk)
nk[2^53] = "big" p(nk[2^53], nk[2^53 + 1])
-- long strings and escapes
local ls = [[
line1
line2]] p(#ls, ls:byte(1), ("\65\066\x43"):len())
p("tab\there", 'single\'quote', "nl\\n", "\z
   continued")
p(#[==[a]]b]==], [==[a]]b]==])
-- integer division and modulo semantic checks
p(7 % 3, -7 % 3, 7 % -3, -7 % -3, 7.5 % 2, -7.5 % 2)
-- and/or chains
local function tf(v) return v end
p(tf(nil) or "d", tf(false) or nil, tf(0) and "zero", tf("") and "empty", nil and nil, false and error("x"))
-- comparison chains
p(1 < 2 == true, "a" .. "b" == "ab", not (1 == 2), 1 ~= 2)
-- os/io basics
p(type(os.time()), type(os.clock()), type(os.date()), os.date("%Y") + 0 >= 2024, type(os.getenv("PATH")))
io.write("a", 1, 2.5, "\n")
p(io.write("") == io.stdout)
-- load / loadstring / dofile / require availability
p(type(loadstring), type(load), type(dofile), type(require), type(collectgarbage), type(rawequal), type(newproxy), type(gcinfo), type(getfenv), type(unpack), type(module))
p(collectgarbage("count") > 0, collectgarbage(), collectgarbage("step"), collectgarbage("collect"))
p(type(_VERSION), _VERSION)
-- table.concat with numbers, sort errors
p(table.concat({1, 2.5, "x"}, "|"), pcall(table.concat, {1, {}, 3}))
p(pcall(table.sort, {3, 1, "x"}))
-- tostring of integers valued doubles
p(3.0, -0.0, 1e0, 100 / 2, 2^2)
