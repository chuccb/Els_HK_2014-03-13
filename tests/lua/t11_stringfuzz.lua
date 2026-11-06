-- Differential fuzz of the string library: patterns (find/match/gmatch/gsub), sub/byte/char/rep/reverse/upper/lower, error messages.
local seed = 8675309
local function rnd(n) seed = (seed * 1103515245 + 12345) % 2147483648 return math.floor(seed / 65536) % n + 1 end
local function pick(t) return t[rnd(#t)] end

local pieces = {"a", "b", "c", ".", "%a", "%d", "%s", "%w", "%p", "%l", "%u", "%x", "%c", "%A", "%D", "%S", "%W", "%.", "%%", "[abc]", "[^abc]", "[a-c]", "[%a_]", "[%d%s]", "[]]", "[^]]", "[a-]", "[%]]",
  "a*", "a+", "a-", "a?", ".*", ".-", ".+", "%s*", "%d+", "%w+", "(a)", "(b*)", "()", "(.-)", "(%d+)", "%1", "%2", "%b()", "%b[]", "%f[%w]", "%f[%s]", "%f[^%w]", "^", "$", "x", "1", " ", "-", "+", "(", ")", "[", "]", "%"}
local alphabet = {"a", "b", "c", "a", "b", " ", "1", "2", "3", ".", "(", ")", "[", "]", "x", "A", "B", "_", "\n", "-", "%", "\0"}

local function randstr(maxlen)
  local n = rnd(maxlen + 1) - 1
  local t = {}
  for i = 1, n do t[i] = pick(alphabet) end
  return table.concat(t)
end
local function randpat()
  local n = rnd(5)
  local t = {}
  for i = 1, n do t[i] = pick(pieces) end
  return table.concat(t)
end
local function show(...)
  local n = select("#", ...)
  local t = {}
  for i = 1, n do
    local v = select(i, ...)
    t[i] = type(v) == "string" and string.format("%q", v) or tostring(v)
  end
  return n .. ":" .. table.concat(t, ",")
end
local function try(f, ...) return show(pcall(f, ...)) end

for i = 1, 1500 do
  local s, p = randstr(14), randpat()
  local init = rnd(6) - 3
  print(i, string.format("%q", s), string.format("%q", p), init)
  print(" find", try(string.find, s, p), try(string.find, s, p, init), try(string.find, s, p, init, true))
  print(" match", try(string.match, s, p), try(string.match, s, p, init))
  local all = {}
  local ok, err = pcall(function() local n = 0 for a, b, c in string.gmatch(s, p) do n = n + 1 all[#all + 1] = show(a, b, c) if n > 30 then break end end end)
  print(" gmatch", ok, ok and table.concat(all, ";") or err)
  print(" gsub", try(string.gsub, s, p, "<%0>"), try(string.gsub, s, p, "%1"), try(string.gsub, s, p, "#", 2), try(string.gsub, s, p, {a = "A", b = false, [""] = "E"}),
    try(string.gsub, s, p, function(a, b) return a and (a .. "!") or nil end))
end

-- sub / byte / char / rep / misc with odd indices
local idx = {-100, -5, -2, -1, 0, 1, 2, 3, 5, 100}
for _, s in ipairs{"", "a", "hello", "hello world\0x"} do
  for _, i in ipairs(idx) do
    local line = {}
    for _, j in ipairs(idx) do line[#line + 1] = string.format("%q", s:sub(i, j)) .. "/" .. show(s:byte(i, j)) end
    print("sub", string.format("%q", s), i, table.concat(line, " "))
  end
end
print(try(string.char), try(string.char, 65, 66, 0, 255), try(string.char, 256), try(string.char, -1), try(string.char, "65"), try(string.char, 65.5))
print(try(string.rep, "ab", 3), try(string.rep, "ab", 3, "-"), try(string.rep, "", 5), try(string.rep, "x", 0), try(string.rep, "x", -3), try(string.rep, "x"))
print(try(string.reverse, "abc\0d"), try(string.upper, "aBc\200"), try(string.lower, "ABC\200z"), try(string.len, "a\0b"), try(string.len))
print(try(string.sub, "hello"), try(string.sub, "hello", "2"), try(string.sub, "hello", 2.5), try(string.sub, 12345, 2, 3), try(string.sub, nil, 1))
print(try(string.format, "%d %s %q", 1, "x", "y\n"), try(string.format, "%5d|%-5d|%05d|%+d|% d", 42, 42, 42, 42, 42), try(string.format, "%x %X %o %c", 255, 255, 8, 65))
print(try(string.format, "%s %s %s", nil, true, {}) == nil, try(string.format, "%d", "x"), try(string.format, "%d", 1.5), try(string.format, "%z", 1), try(string.format, "%", 1), try(string.format, "%d"))
print(try(string.format, "%10.3s|", "abcdef"), try(string.format, "%-10s|", "ab"), try(string.format, "%.0s", "abc"), try(string.format, "%s", "a\0b"), try(string.format, "%q", "a\0b\r\n\"\\"))
print(try(string.format, "%i", 42), try(string.format, "%u", 42), try(string.format, "%5.1f", 3.14159), try(string.format, "%e", 12345.6789), try(string.format, "%G", 1e-10))
print(try(("x"):rep(3)), try(("%d"):format(7)), #("abc"):rep(1000), ("abc"):find("b", 1, true), ("a.b"):find(".", 1, true), ("a.b"):find("%.", 1))
print(try(string.find, "abc", "b", nil, nil), try(string.find, "abc", "", 10), try(string.find, "abc", "", 4), try(string.find, "", ""), try(string.match, "abc", "()"), try(string.match, "abc", "(a)(b)(c)(d?)"))
print(try(string.gsub, "abc", "", "-"), try(string.gsub, "hello world", "o", "0", 1), try(string.gsub, "abc", "%w", "%%"), try(string.gsub, "abc", "(a)", "%2"), try(string.gsub, "abc", "a", "%"))
print(try(string.gsub, "abc def", "(%w+) (%w+)", "%2 %1"), try(string.gsub, "x", "x", "%0%0"), try(string.gsub, "abc", ".", {a = 1, b = true}), try(string.gsub, "abc", ".", function() return {} end))
print(try(string.rep, "x", 1e10))
