-- Differential fuzz of number <-> string conversion (tostring, string.format, tonumber, coercions) and of the int32 conversions of the library.
-- Only IEEE +,-,*,/ and floor are used to build the inputs (libm functions may differ in the last ulp between V8 and glibc).
local seed = 424242
local function rnd(n) seed = (seed * 1103515245 + 12345) % 2147483648 return math.floor(seed / 65536) % n + 1 end
local function randdouble()
  local x = (rnd(1000000) * 1000000 + rnd(1000000)) / (rnd(3) == 1 and 1 or 1000000)
  local e = rnd(45) - 23
  local scale = 1
  for i = 1, math.abs(e) do scale = scale * 10 end
  if e < 0 then x = x / scale else x = x * scale end
  local k = rnd(12)
  if k == 1 then x = -x elseif k == 2 then x = math.floor(x) elseif k == 3 then x = x * 1e290 * 1e10 elseif k == 4 then x = x / 1e290 / 1e30
  elseif k == 5 then x = -math.floor(x) elseif k == 6 then x = math.floor(x * 100 + 0.5) / 100 elseif k == 7 then x = rnd(100000) / 8 end
  return x
end
local specs = {"%.14g", "%g", "%e", "%.3e", "%f", "%.0f", "%10.4f", "%-12.2f|", "%+.3g", "%#g", "%#.0f", "%5.0f", "%.20g", "%.17g", "%G", "%E", "%.1f", "%.2f", "%08.3f", "% .5g", "%.10g", "%.0e", "%#.3x" == nil and "" or "%.15g"}
for i = 1, 700 do
  local x = randdouble()
  local parts = {tostring(x)}
  for _, spec in ipairs(specs) do parts[#parts + 1] = string.format(spec, x) end
  parts[#parts + 1] = tostring(tonumber(string.format("%.17g", x)) == x)
  parts[#parts + 1] = tostring(tonumber(tostring(x)) == x)
  parts[#parts + 1] = x .. ""
  print(i, table.concat(parts, " "))
end

-- special values
for _, x in ipairs{0, -0, 1 / 0, -1 / 0, 0 / 0, 1e15, 1e16, 123456789012345, 2 ^ 53, 2 ^ 63, 1e100, -1e-100, 5e-324, 1.7976931348623157e308, 0.1, 0.5, 100, 255, 1 / 3, 2 / 3, 1e21, 1e-5, 123456.789e3} do
  local t = {tostring(x)}
  for _, spec in ipairs{"%g", "%.14g", "%f", "%e", "%5.1f", "%d", "%x", "%s", "%10.3g", "%.0f", "%i"} do t[#t + 1] = string.format(spec, x) end
  print("special", table.concat(t, " "))
end

-- integer conversions (the bit-library conversion: modular wrap) for %d %x %o %u %c
for i = 1, 300 do
  local v = (rnd(2000000) - 1000000) * (rnd(4000) - 2000) + (rnd(3) - 2) * 0.5 * (rnd(2) - 1)
  local parts = {}
  for _, spec in ipairs{"%d", "%5d", "%-6d|", "%06d", "%+d", "% d", "%x", "%X", "%o", "%u", "%#x", "%#o", "%.3d", "%8.3d"} do
    local ok, r = pcall(string.format, spec, v)
    parts[#parts + 1] = ok and r or "E"
  end
  print("int", v, table.concat(parts, " "))
end
for _, v in ipairs{2 ^ 31, 2 ^ 31 - 1, -2 ^ 31, -2 ^ 31 - 1, 2 ^ 32, 2 ^ 32 + 5, 2 ^ 52, 2 ^ 53, -2 ^ 53, 2 ^ 51, 2 ^ 51 - 1, 1e15, 1e19, 1 / 0, -1 / 0, 0 / 0} do
  local t = {}
  for _, spec in ipairs{"%d", "%x", "%o", "%u"} do local ok, r = pcall(string.format, spec, v) t[#t + 1] = ok and r or "E" end
  print("wrap", tostring(v), table.concat(t, " "))
end

-- int32 conversion of library arguments (cvttsd2si): out of range and NaN become INT32_MIN
local h = "hello"
local function try(f, ...) local ok, r = pcall(f, ...) return ok and tostring(r) or "E:" .. tostring(r) end
for _, v in ipairs{math.huge, -math.huge, 2 ^ 31, 2 ^ 31 - 1, -2 ^ 31, -2 ^ 31 - 1, 2 ^ 32 + 2, 0 / 0, 1.9, -1.9, 0.5, -0.5, "2", "0x2", " 3 ", 1e6 - 1, 300} do
  local t = {}
  t[#t + 1] = string.format("%q", h:sub(v)) t[#t + 1] = string.format("%q", h:sub(2, v)) t[#t + 1] = string.format("%q", h:sub(v, 3))
  t[#t + 1] = (type(v) == "number" and v >= 1e6 and v < 2 ^ 31) and "skip" or try(function() return #string.rep("x", v) end)
  t[#t + 1] = tostring(select("#", h:byte(v, 3)))
  t[#t + 1] = (type(v) == "number" and v >= 1e6 and v < 2 ^ 31) and "skip" or try(function() return select("#", unpack({1, 2, 3}, 1, v)) end)
  t[#t + 1] = try(string.char, v) t[#t + 1] = try(select, v, 1, 2, 3) t[#t + 1] = tostring(select("#", pcall(select, v, 1, 2, 3)))
  print("int32", tostring(v), table.concat(t, " "))
end
print(pcall(string.rep, "ab", 3, "-")) print(pcall(string.rep, "ab", 1, "-")) print(pcall(string.rep, "", 3, "-")) print(pcall(string.rep, "ab", 0, "-"))
print(pcall(string.rep, "ab", 3, nil)) print(pcall(string.rep, "ab", 3, 7)) print(pcall(string.rep, "ab", 3, {})) print(pcall(string.rep, "", 3, "")) print(pcall(string.rep, "abc", 2, "--"))
print(pcall(string.format, "%")) print(pcall(string.format, "%\0", 1)) print(pcall(string.format, "%y", 1)) print(pcall(string.format, "%5", 1)) print(pcall(string.format, "%-+ #0d", 1))

-- tonumber on strings and bases
local strs = {"0", "-0", "+5", "  12  ", "12abc", "1e5", "1e", "1e+", ".5", "5.", ".", "-.5", "0x", "0x1F", "0X1f", "0x1.8p1", "0x.8", "1_000", "inf", "-inf", "nan", "NaN", "Infinity", "", " ", "1 2", "0b11", "1e308", "1e309", "-1e309", "1e-400",
  "123456789012345678901234567890", "0.1", "00012", "0x7fffffff", "0xffffffff", "0x100000000", "0xFFFFFFFFFFFFFFFF", "1e5x", "\t7\n", "7\0", "1,5", "--1", "- 1", "+-1", "0e0", "0x0p0", "1.e2", "0x1p", "0x1p-2", "9007199254740993", "4.9e-324", "2.5e-324"}
for _, s in ipairs(strs) do
  local r = {tostring(tonumber(s))}
  for _, b in ipairs{2, 8, 10, 16, 36} do r[#r + 1] = tostring(tonumber(s, b)) end
  local ok, v = pcall(function() return s + 0 end) r[#r + 1] = ok and tostring(v) or "E"
  ok, v = pcall(function() return s * "2" end) r[#r + 1] = ok and tostring(v) or "E"
  ok, v = pcall(function() return -s end) r[#r + 1] = ok and tostring(v) or "E"
  print("tonumber", string.format("%q", s), table.concat(r, " "))
end
for _, b in ipairs{1, 2, 3, 7, 10, 16, 36, 37, 0, -1, 2.5} do
  local r = {}
  for _, s in ipairs{"11", "ff", "FF", "zz", "-11", "+11", "1.5", " 11 ", "", "8", "9z"} do r[#r + 1] = tostring(select(2, pcall(tonumber, s, b))) end
  print("base", b, table.concat(r, " "))
end
print(pcall(tonumber), pcall(tonumber, nil), pcall(tonumber, {}), pcall(tonumber, true), pcall(tonumber, 12, 10), pcall(tonumber, "12", "x"))
print(1 .. "", 1.5 .. "", -0 .. "", 1e100 .. "", (2 ^ 53) .. "", 1e15 .. "", 1e16 .. "", 0.1 + 0.2 .. "", 100 / 3 .. "", 3 .. 4, "x" .. 1 .. 2)
print(10 == "10", "abc" < "abd", "a" < "B", "" < "a", "10" < "9", pcall(function() return 10 < "9" end))
print(0x7fffffff + 1, 0xffffffff, 0x100000000, -0x80000000, 1e3, 0xA, 1E2, .5, 3., 0x.1, 08, 1e-2)
print(math.floor(-0.5), math.ceil(-0.5), math.floor(2 ^ 40 + 0.5), math.max(1, 2, 3), 7 % 3, -7 % 3, 7 % -3, -7 % -3, 5.5 % 2, -5.5 % 2, 1 % 0, 0 % 0, 2 ^ 0.5 == math.sqrt(2))
