-- Differential fuzz of library algorithms whose exact behaviour scripts can observe:
-- table.sort (tie order of the quicksort, invalid order functions), Lua pattern matching (random patterns), os.date/os.time on fixed times.
local seed = 20140313
local function rnd(n) seed = (seed * 16807) % 2147483647 return seed % n + 1 end
local function strip(m) if type(m) == "string" then return (m:gsub("^[^:]*:%d+: ", "")) end return m end
local function show(ok, ...)
  local t = {}
  for i = 1, select("#", ...) do
    local v = (select(i, ...))
    if not ok then v = strip(v) end
    t[i] = type(v) == "string" and string.format("%q", v) or (type(v) == "table" or type(v) == "function") and type(v) or tostring(v)
  end
  return (ok and "ok " or "err ") .. table.concat(t, ",")
end

-- sort ---------------------------------------------------------------------------------------------------------------
local cmps = {
  ["<"] = function(a, b) return a.k < b.k end,
  [">"] = function(a, b) return a.k > b.k end,
  ["<="] = function(a, b) return a.k <= b.k end,
  [">="] = function(a, b) return a.k >= b.k end,
  ["true"] = function(a, b) return true end,
  ["false"] = function(a, b) return false end,
  ["nil"] = function(a, b) end,
  ["num"] = function(a, b) return a.k - b.k end,
  ["id"] = function(a, b) return a.id < b.id end,
  ["mod"] = function(a, b) return a.k % 3 < b.k % 3 end,
  ["err"] = function(a, b) if a.k == 4 and b.k == 5 then error("boom") end return a.k < b.k end,
}
local names = {"<", ">", "<=", ">=", "true", "false", "nil", "num", "id", "mod", "err"}
for round = 1, 60 do
  local n = (round <= 40) and rnd(14) - 1 or rnd(60)
  local range = round % 4 == 0 and 3 or round % 4 == 1 and 6 or 20
  local base = {}
  for i = 1, n do base[i] = {k = rnd(range), id = i} end
  for _, nm in ipairs(names) do
    local t = {}
    for i = 1, n do t[i] = base[i] end
    local ok, e = pcall(table.sort, t, cmps[nm])
    local ids = {}
    for i = 1, n do ids[i] = t[i] and t[i].id or "nil" end
    print("sort", round, n, nm, show(ok, e), table.concat(ids, " "))
  end
  local t = {}
  for i = 1, n do t[i] = base[i].k end
  table.sort(t)
  print("sort default", round, table.concat(t, " "))
  local u = {}
  for i = 1, n do u[i] = base[i].k end
  table.sort(u, function(a, b) return a > b end)
  print("sort desc", round, table.concat(u, " "))
end
print("sort misc", show(pcall(table.sort, {3, "a", 1})), show(pcall(table.sort, {3, 2, 1}, 5)), show(pcall(table.sort, {{}, {}})), show(pcall(table.sort)))
local mixed = {"b", "a", "C", "B", "", "ab", "a\0b", "a\0a"}
table.sort(mixed)
print("sort strings", table.concat(mixed, "|"):gsub("%z", "0"))
local nan = {3, 0 / 0, 1, 2, 0 / 0, 5}
print("sort nan", show(pcall(table.sort, nan)), table.concat(nan, " "))

-- patterns -----------------------------------------------------------------------------------------------------------
local toks = {".", "%a", "%d", "%s", "%w", "%p", "%l", "%u", "%x", "%c", "%A", "%S", "[a-c]", "[^abc]", "[%a_]", "[%d.]", "[]]", "[^]]", "[a-]", "[%]]", "a", "b", "c", "x", "1", " ", "%.", "%%", "*", "+", "-", "?", "^", "$", "(", ")", "()", "%b()", "%b[]", "%f[%w]", "%f[^%w]", "%1", "%2", "[", "%", "(.-)", "(%w+)", "(%d+)", ".-", ".*", "%s*", "%w+", "a*", "a-b", "[a-z]+", "[^,]*", "([^=]+)=(.*)"}
local subjects = {"", "abc", "aXb12 c_d", "hello world", "(a(b)c)", "a.b*c-d", "THE (quick) fox", "x=1, y=22", "  trim me  ", "%d", "aaa", "abcabc", "key = value", "[x]]", "a\0b c", "-1.5e3", "é ü"}
local function gmatch_all(s, p)
  local out, n = {}, 0
  for a, b in string.gmatch(s, p) do
    n = n + 1
    out[#out + 1] = tostring(a) .. "/" .. tostring(b)
    if n >= 6 then break end
  end
  return table.concat(out, ",")
end
for round = 1, 500 do
  local k = rnd(6)
  local parts = {}
  for i = 1, k do parts[i] = toks[rnd(#toks)] end
  local pat = table.concat(parts)
  local line = {}
  for _, s in ipairs(subjects) do
    line[#line + 1] = show(pcall(string.find, s, pat))
    line[#line + 1] = show(pcall(string.match, s, pat))
  end
  local s = subjects[rnd(#subjects)]
  line[#line + 1] = show(pcall(string.find, s, pat, 3))
  line[#line + 1] = show(pcall(string.find, s, pat, -2))
  line[#line + 1] = show(pcall(string.find, s, pat, 1, true))
  line[#line + 1] = show(pcall(string.gsub, s, pat, "<%0>"))
  line[#line + 1] = show(pcall(string.gsub, s, pat, "<%1>", 2))
  line[#line + 1] = show(pcall(string.gsub, s, pat, "%%"))
  line[#line + 1] = show(pcall(string.gsub, s, pat, function(a, b) return a and ("[" .. a .. "]") end))
  line[#line + 1] = show(pcall(string.gsub, s, pat, {a = "A", b = true, x = false}))
  line[#line + 1] = show(pcall(gmatch_all, s, pat))
  print("pat", round, string.format("%q", pat), table.concat(line, " | "))
end
print("pat misc", show(pcall(string.gsub, "abc", "", "-")), show(pcall(string.gsub, "abc", "b*", "-")), show(pcall(string.gsub, "abc", ".", "%2")),
  show(pcall(string.gsub, "abc", "(a)", "%2")), show(pcall(string.gsub, "abc", "a", "%")), show(pcall(string.gsub, "abc", "a", "%x")), show(pcall(string.rep, "ab", 3, "")),
  show(pcall(string.find, "a", "(((((((((((((((((((((((((((((((((a)))))))))))))))))))))))))))))))))")), show(pcall(string.find, string.rep("a", 300), string.rep("a?", 300) .. string.rep("a", 300))))

-- os.date / os.time on fixed instants ---------------------------------------------------------------------------------
-- (the exe's msvcr100 only accepts 1970..3000, glibc more: stay inside)
local stamps = {0, 1, 86399, 86400, 951782400, 1078012800, 1394668800, 1394706000, 1700000000, 2147483647, 2^31, 4102444800, 1e10, 32535215999, 1.9, 59.5}
for _, t in ipairs(stamps) do
  print("date", t, show(pcall(os.date, "!%Y-%m-%d %H:%M:%S|%y|%j|%a %A|%b %B|%w|%U|%W|%I %p|%%", t)))
  local ok, d = pcall(os.date, "!*t", t)
  if ok and d then print("date*t", t, d.year, d.month, d.day, d.hour, d.min, d.sec, d.wday, d.yday, tostring(d.isdst)) else print("date*t", t, show(ok, d)) end
end
print("date bad", show(pcall(os.date, "!%Q", 0)), show(pcall(os.date, "!%E", 0)), show(pcall(os.date, "!%", 0)), show(pcall(os.date, "!%Ey", 0)), show(pcall(os.date, "!%\n", 0)))
print("date fmt", show(pcall(os.date, "!abc", 0)), show(pcall(os.date, "!", 0)), show(pcall(os.date, "!%H%M%S", 3661)), show(pcall(os.date, "!%d/%m/%y", 1e9)), show(pcall(os.date, "!*tx", 0)), show(pcall(os.date, "!*t", "5")))
for _, f in ipairs{"%Y", "%m", "%d", "%H"} do print("date local", f, #os.date(f, 0) > 0) end
print("time", show(pcall(os.time, {year = 2014, month = 3, day = 13, hour = 0})), show(pcall(os.time, {year = 2014, month = 14, day = 35, hour = 25, min = 61, sec = 61})),
  show(pcall(os.time, {year = 1970, month = 1, day = 2, hour = 12})), show(pcall(os.time, {year = "2014", month = "3", day = "13"})), show(pcall(os.time, {year = 2014, month = 3})),
  show(pcall(os.time, {year = 2014.9, month = 3.9, day = 13.9, hour = 1.9, min = 2.9, sec = 3.9})), show(pcall(os.time, {})), show(pcall(os.time, 5)),
  show(pcall(os.time, {year = 3000, month = 1, day = 1})))
local rt = os.time{year = 2014, month = 3, day = 13, hour = 12}
local back = os.date("*t", rt)
print("roundtrip", back.year, back.month, back.day, back.hour, back.min, back.sec, back.wday, back.yday)
print("difftime", show(pcall(os.difftime, 10, 4)), show(pcall(os.difftime, 4)), show(pcall(os.difftime)))
