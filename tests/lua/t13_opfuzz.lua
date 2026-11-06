-- Differential fuzz of the VM operators over every combination of operand types (through pcall).
-- Metamethod objects log their calls so that the order and arguments of metamethod dispatch are compared as well.
local log = {}
local function desc(v)
  local t = type(v)
  if t == "table" then local mt = getmetatable(v) return mt and ("table*" .. (mt.__tag or "")) or "table"
  elseif t == "string" then return string.format("%q", v)
  elseif t == "function" or t == "userdata" or t == "thread" then return t
  else return tostring(v) end
end
local function ts(v)
  local t = type(v)
  if t == "table" or t == "function" or t == "userdata" or t == "thread" then return t end
  return tostring(v)
end
local function myprint(...)
  local t = {}
  for i = 1, select("#", ...) do t[i] = desc((select(i, ...))) end
  print("P", table.concat(t, ","))
end
local function mm(name, ret)
  return function(a, b)
    log[#log + 1] = name .. "(" .. desc(a) .. "," .. desc(b) .. ")"
    if ret ~= nil then return ret end
    return name
  end
end
local full = {__tag = "full"}
for _, n in ipairs{"__add", "__sub", "__mul", "__div", "__mod", "__pow", "__unm", "__concat", "__len", "__eq", "__lt", "__le", "__call"} do full[n] = mm(n) end
full.__index = function(t, k) log[#log + 1] = "__index(" .. desc(k) .. ")" return "idx:" .. ts(k) end
full.__newindex = function(t, k, v) log[#log + 1] = "__newindex(" .. desc(k) .. "," .. desc(v) .. ")" end
local ltonly = {__tag = "lt", __lt = mm("__lt", true), __eq = mm("__eq", true)}
local leonly = {__tag = "le", __le = mm("__le", false)}
local other = {__tag = "other", __eq = mm("__eq", true), __lt = mm("__lt", false)}
local falsey = {__tag = "falsey", __eq = mm("__eq", false), __lt = mm("__lt", nil), __le = mm("__le", false), __concat = mm("__concat", false), __add = mm("__add", false)}
local idxtab = {__tag = "idxtab", __index = {x = 1, [1] = "one"}, __newindex = {}}
local NIL = {}
local vals = {NIL, false, true, 0, -0, 1, -1, 2.5, 1 / 0, -1 / 0, 0 / 0, 2 ^ 31, 2 ^ 53, "10", "0x10", "abc", "", " 5 ", "1e2", "nan", {}, setmetatable({}, full), setmetatable({}, full),
  setmetatable({}, ltonly), setmetatable({}, leonly), setmetatable({}, other), setmetatable({}, falsey), setmetatable({}, idxtab), myprint, function() end, coroutine.create(function() end), io.stdout}
local function val(x) if x == NIL then return nil end return x end

local function res(ok, ...)
  local n = select("#", ...)
  local t = {}
  for i = 1, n do
    local v = (select(i, ...))
    if not ok and type(v) == "string" then v = v:gsub("^[^:]*:%d+: ", "") end
    t[i] = desc(v)
  end
  local s = (ok and "ok " or "err ") .. table.concat(t, ",")
  if #log > 0 then s = s .. " [" .. table.concat(log, ";") .. "]" log = {} end
  return s
end

local bin = {
  function(a, b) return a + b end, function(a, b) return a - b end, function(a, b) return a * b end, function(a, b) return a / b end, function(a, b) return a % b end, function(a, b) return a ^ b end,
  function(a, b) return a .. b end, function(a, b) return a == b end, function(a, b) return a ~= b end, function(a, b) return a < b end, function(a, b) return a <= b end,
  function(a, b) return a > b end, function(a, b) return a >= b end, function(a, b) return a and b end, function(a, b) return a or b end, function(a, b) return not (a < b) end,
  function(a, b) return a .. b .. a end, function(a, b) return a .. 1 .. b end, function(a, b) return a .. b .. "x" end, function(a, b) return a, b, a + b end,
  function(a, b) return a[b] end, function(a, b) a[b] = 7 return "set" end, function(a, b) return a(b) end, function(a, b) return a(b, 1, nil) end,
  function(a, b) local n = 0 for i = a, b do n = n + 1 if n > 20 then break end end return n end,
  function(a, b) local n = 0 for i = 1, a, b do n = n + 1 if n > 20 then break end end return n end,
  function(a, b) local n = 0 for i = a, 5, b do n = n + 1 if n > 20 then break end end return n end,
  function(a, b) local n = 0 for i = a, b, 0.25 do n = n + 1 if n > 20 then break end end return n end,
  function(a, b) local s, c = 0, 0 for i = a, b, 0.1 do s = s + i c = c + 1 if i > 3 or c > 50 then break end end return s end,
  function(a, b) return rawequal(a, b), rawlen and 0 or 0, select("#", a, b) end,
  function(a, b) return math.max(a, b) end, function(a, b) return math.min(a, b) end, function(a, b) return string.rep(a, 2, b) end, function(a, b) return ts(a) .. ts(b) end,
  function(a, b) local t = {} t[a] = 1 t[b] = 2 local n = 0 for _ in pairs(t) do n = n + 1 end return n, #t end,
  function(a, b) local t = {a, b, a} return #t, select("#", unpack(t)) end,
  function(a, b) return setmetatable({}, {__index = a})[b] end, function(a, b) return setmetatable({}, {__call = a})(b) end,
  function(a, b) local t = setmetatable({}, {__newindex = a}) t[b] = 1 return rawget(t, b) end,
  function(a, b) return next({}, a), next({[b] = 1}, b) end, function(a, b) return type(a) == type(b) end,
  function(a, b) return a == 1 or b == 2, a ~= "x" and b ~= nil end,
}
local una = {
  function(a) return -a end, function(a) return not a end, function(a) return #a end, function(a) return a + 3 end, function(a) return 3 + a end, function(a) return a - 3 end, function(a) return 3 - a end,
  function(a) return a * 3 end, function(a) return 3 * a end, function(a) return a / 3 end, function(a) return 3 / a end, function(a) return a % 3 end, function(a) return 3 % a end,
  function(a) return a ^ 3 end, function(a) return 3 ^ a end, function(a) return a ^ 0.5 end, function(a) return 2 ^ a end, function(a) return a .. "s" end, function(a) return "s" .. a end, function(a) return 1 .. a end,
  function(a) return a == 3 end, function(a) return a ~= 3 end, function(a) return a == "x" end, function(a) return a == nil end, function(a) return a ~= nil end, function(a) return a == true end, function(a) return a ~= false end,
  function(a) return a < 3 end, function(a) return 3 < a end, function(a) return a <= 3 end, function(a) return 3 <= a end, function(a) return a > 3 end, function(a) return a >= 3 end,
  function(a) return a < "x" end, function(a) return "x" < a end, function(a) return a <= "" end,
  function(a) return a.x end, function(a) return a[1] end, function(a) return a[0] end, function(a) a.x = 1 return "set" end, function(a) a[1] = 1 return "set" end, function(a) a[nil] = 1 return "set" end,
  function(a) return a() end, function(a) return a(1) end, function(a) return a.x.y end, function(a) return a:len() end, function(a) return a:foo() end,
  function(a) return #a + 1 end, function(a) return -a .. "x" end, function(a) return (a .. "x") .. "y" end, function(a) return a .. a end, function(a) return a .. a .. a end,
  function(a) local n = 0 for i = 1, 3 do n = n + (a and 1 or 2) end return n end, function(a) for i = a, 3 do return i end return "none" end, function(a) for i = 1, a do return i end return "none" end,
  function(a) for i = 1, 3, a do return i end return "none" end, function(a) for k, v in pairs(a) do return k, v end return "empty" end, function(a) for k, v in ipairs(a) do return k, v end return "empty" end,
  function(a) for k, v in a do return k, v end return "empty" end, function(a) return ts(a), tonumber(a), type(a) end, function(a) return select("#", a), select(-1, a) end,
  function(a) return string.len(a), string.upper(a) end, function(a) if type(a) == "table" or type(a) == "function" or type(a) == "userdata" or type(a) == "thread" then return "skip" end return string.format("%s|%5s|%-5s|", a, a, a) end, function(a) return string.format("%d", a) end, function(a) return string.format("%g", a) end,
  function(a) return table.concat({a, a}, "-") end, function(a) return table.concat({1, 2}, a) end, function(a) return unpack(a) end,
  function(a) return math.floor(a), math.ceil(a), math.abs(a) end, function(a) return math.sqrt(a) end, function(a) return setmetatable({}, a) end, function(a) return getmetatable(a) ~= nil end,
  function(a) return rawget(a, 1) end, function(a) return rawset(a, 1, 2) ~= nil end, function(a) return rawequal(a, a), rawequal(a, nil) end, function(a) return next(a) end,
  function(a) return pcall(a) end, function(a) return select(2, pcall(error, a)) end, function(a) return assert(a) end, function(a) return assert(a, "m") end, function(a) return assert(false, a) end,
  function(a) local t = {} t[a] = 1 return next(t) end, function(a) local t = {10, 20, 30} return t[a] end, function(a) local t = {[a] = 1} return t[a] end,
  function(a) return coroutine.status(a) end, function(a) return coroutine.resume(a) end, function(a) return coroutine.wrap(a) ~= nil end, function(a) return string.char(a) end, function(a) return string.rep("x", a) end,
  function(a) return ("x"):rep(a) end, function(a) return ("abc"):sub(a) end, function(a) return ("abc"):sub(1, a) end, function(a) return ("abc"):byte(a) end, function(a) return ("abc"):find(a) end,
  function(a) return ("abc"):gsub("b", a) end, function(a) return ("a,b"):gsub(",", a, 1) end, function(a) if a == nil then return "nil" end return os.time(a) end, function(a) if a == nil then return "nil" end return os.date(a, 0) end, function(a) return string.format(a, 1) end,
  function(a) return getfenv(a) end, function(a) return ts(setfenv(function() end, a)) end, function(a) return xpcall(a, myprint) end,
  function(a) return math.fmod(a, 3), math.pow(a, 2) end, function(a) return math.max(a), math.min(a, 1) end, function(a) return math.random(a) end, function(a) return bit.band(a, 1), bit.tobit(a) end,
}
for bi, f in ipairs(bin) do
  for i = 1, #vals do
    local line = {}
    for j = 1, #vals do
      line[#line + 1] = res(pcall(f, val(vals[i]), val(vals[j])))
    end
    print("bin", bi, i, table.concat(line, " | "))
  end
end
for ui, f in ipairs(una) do
  local line = {}
  for i = 1, #vals do line[#line + 1] = res(pcall(f, val(vals[i]))) end
  print("una", ui, table.concat(line, " | "))
end
