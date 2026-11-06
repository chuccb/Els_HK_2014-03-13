local function p(...) local t = {...} for i = 1, select('#', ...) do t[i] = tostring(t[i]) end print(table.concat(t, " ", 1, select('#', ...))) end
p(1+2, 7-10, 3*4, 7/2, 7%3, -7%3, 7%-3, 2^10, 2^0.5, -2^2)
p(10/0, -10/0, 0/0 ~= 0/0, 1e15, 1e14, 123456789012345, 0.1, 1/3, 100, 1e100, -0.0, 3.14159265358979)
p("10"+5, "3"*"4", 10 .. 20, "a".."b".."c", #"hello", -"2")
p(1 < 2, 1 <= 1, "a" < "b", "abc" < "abd", "Z" < "a", "" < "a", 2 > 1, 2 >= 3)
p(1 == 1.0, "1" == 1, nil == false, 0 == -0, "a" == "a")
p(not nil, not 0, not false, nil and 1, false or "x", 1 and 2, nil or false, 1 or error("no"))
local a, b, c = (function() return 1, 2, 3 end)()
p(a, b, c)
local function va(...) return select('#', ...), ... end
p(va()); p(va(nil)); p(va(1, nil, nil)); p(va(1, 2, 3))
p((va(1, 2, 3)))
local t = {va(1, 2)}
p(#t, t[1], t[2], t[3])
local function fib(n) if n < 2 then return n end return fib(n-1) + fib(n-2) end
p(fib(20))
local function tail(n, acc) if n == 0 then return acc end return tail(n-1, acc+n) end
p(tail(100000, 0))
local function counter() local c = 0 return function() c = c + 1 return c end end
local c1, c2 = counter(), counter()
p(c1(), c1(), c2(), c1())
local fns = {}
for i = 1, 3 do fns[i] = function() return i end end
p(fns[1](), fns[2](), fns[3]())
local k = 0
local fs2 = {}
while k < 3 do k = k + 1 local j = k fs2[k] = function() j = j + 10 return j end end
p(fs2[1](), fs2[1](), fs2[2](), fs2[3]())
for i = 10, 1, -3 do io.write(i, " ") end print()
for i = 1, 3 do for j = 1, 3 do if j == 2 then break end io.write(i, ":", j, " ") end end print()
for i = 1.5, 3 do io.write(i, " ") end print()
for i = 3, 1 do io.write("never") end print("done")
local r = 0 repeat local z = r r = r + 1 until z >= 3 p(r)
p(type(nil), type(1), type("s"), type({}), type(print), type(function() end), type(true))
p(tostring(nil), tostring(true), tostring(12), tostring("x"))
p(tonumber("12"), tonumber("0x1f"), tonumber("  5  "), tonumber("5x"), tonumber("1e2"), tonumber(""), tonumber("z", 36), tonumber("ff", 16), tonumber("11", 2), tonumber(nil))
p(select(-1, 1, 2, 3), select(2, "a", "b", "c"))
p(math.floor(-3.5), math.ceil(-3.5), math.floor(3.5), math.max(1, 5, 3), math.min(4, 2, 8), math.abs(-4), math.sqrt(16), math.huge, -math.huge)
p(string.rep("ab", 3), ("x"):rep(0), ("abc"):upper(), ("ABC"):lower(), ("abc"):reverse(), ("abc"):len())
p(#{1, 2, 3, nil}, #{n = 1}, #{1, 2, nil, 4})
local s = 0 for i = 1, 100 do s = s + i % 7 end p(s)
p(8 % 3.5, -8 % 3.5, 2^31, 2^53, 2^53 + 1, 1e308 * 10)
goto skip
p("not printed")
::skip::
p("after goto")

-- NaN in comparisons: the bytecode has ISGE = "not ISLT" and ISGT = "not ISLE" (true for unordered operands), which is
-- visible through negated conditions in if/while/and/or
local nan = 0/0
local function cmp(a, b)
  local r = {}
  if a < b then r[#r + 1] = "lt" end
  if a <= b then r[#r + 1] = "le" end
  if a > b then r[#r + 1] = "gt" end
  if a >= b then r[#r + 1] = "ge" end
  if not (a < b) then r[#r + 1] = "nlt" end
  if not (a <= b) then r[#r + 1] = "nle" end
  if not (a > b) then r[#r + 1] = "ngt" end
  if not (a >= b) then r[#r + 1] = "nge" end
  if a == b then r[#r + 1] = "eq" end
  if a ~= b then r[#r + 1] = "ne" end
  r[#r + 1] = (a < b) and "A" or "B"
  r[#r + 1] = (a >= b) and "C" or "D"
  r[#r + 1] = (a > b) and "E" or "F"
  r[#r + 1] = tostring(a < b) .. tostring(a <= b) .. tostring(a > b) .. tostring(a >= b)
  local n = 0
  while a >= b do n = n + 1; if n > 2 then break end end
  repeat n = n + 10 until a > b or n > 30
  r[#r + 1] = n
  return table.concat(r, ",")
end
p(cmp(nan, 1)) p(cmp(1, nan)) p(cmp(nan, nan)) p(cmp(1, 2)) p(cmp(2, 1)) p(cmp(1, 1)) p(cmp(-1/0, 1/0))
