local function p(...) local t = {...} for i = 1, select('#', ...) do t[i] = tostring(t[i]) end print(table.concat(t, " ", 1, select('#', ...))) end
local V = {}
V.__index = V
V.__add = function(a, b) return setmetatable({x = a.x + b.x}, V) end
V.__sub = function(a, b) return setmetatable({x = a.x - b.x}, V) end
V.__mul = function(a, b) if type(a) == "number" then return setmetatable({x = a * b.x}, V) end return setmetatable({x = a.x * (type(b) == "number" and b or b.x)}, V) end
V.__div = function(a, b) return setmetatable({x = a.x / b.x}, V) end
V.__mod = function(a, b) return setmetatable({x = a.x % b.x}, V) end
V.__pow = function(a, b) return setmetatable({x = a.x ^ b}, V) end
V.__unm = function(a) return setmetatable({x = -a.x}, V) end
V.__eq = function(a, b) return a.x == b.x end
V.__lt = function(a, b) return a.x < b.x end
V.__le = function(a, b) return a.x <= b.x end
V.__concat = function(a, b) return (type(a) == "table" and a.x or a) .. "&" .. (type(b) == "table" and b.x or b) end
V.__len = function(a) return 99 end
V.__tostring = function(a) return "V(" .. a.x .. ")" end
V.__call = function(self, y) return self.x + y end
function V.new(x) return setmetatable({x = x}, V) end
function V:get() return self.x end
local a, b = V.new(3), V.new(4)
p(tostring(a + b), tostring(a - b), tostring(a * b), tostring(2 * a), tostring(a * 2), tostring(b / a), tostring(b % a), tostring(a ^ 2), tostring(-a))
p(a == b, a == V.new(3), a ~= b, a < b, a <= b, a > b, a >= b, rawequal(a, V.new(3)))
p(a .. b, a .. "s", "s" .. a, 1 .. a, #a, a(10), a:get(), V.get(b))
local D = setmetatable({}, {__index = function(t, k) return "default_" .. tostring(k) end})
p(D.foo, D[1], rawget(D, "foo"))
local log = {}
local W = setmetatable({}, {__newindex = function(t, k, v) log[#log + 1] = k rawset(t, k, v) end})
W.a = 1 W.b = 2 W.a = 3 p(table.concat(log, ","), W.a, W.b)
local chain = setmetatable({}, {__index = setmetatable({mid = "m"}, {__index = {deep = "d"}})})
p(chain.mid, chain.deep, chain.none)
local ro = setmetatable({}, {__newindex = function() error("readonly") end, __metatable = "locked"})
p(pcall(function() ro.x = 1 end), getmetatable(ro), pcall(setmetatable, ro, {}))
local Base = {} Base.__index = Base function Base.new(n) return setmetatable({name = n}, Base) end function Base:hello() return "hello " .. self.name end
local Derived = setmetatable({}, {__index = Base}) Derived.__index = Derived
function Derived.new(n) local o = Base.new(n) return setmetatable(o, Derived) end function Derived:bye() return "bye " .. self.name end
local d = Derived.new("D") p(d:hello(), d:bye(), getmetatable(d) == Derived)
local cnt = setmetatable({}, {__index = function(t, k) local v = k * 2 rawset(t, k, v) return v end})
p(cnt[5], rawget(cnt, 5), cnt[5])
p(getmetatable("abc").__index == string, ("x"):rep(2))
local prox = setmetatable({}, {__index = string}) p(prox.format("%d", 5))
local e1 = setmetatable({}, {__eq = function() return true end}) local e2 = setmetatable({}, {__eq = function() return false end})
p(e1 == e2, e1 == setmetatable({}, getmetatable(e1)), e1 == 1)
local function err(f) local ok, m = pcall(f) return ok, (tostring(m):gsub("^[^:]*:%d+: ", "")) end
p(err(function() return {} < {} end)) p(err(function() return 1 < "2" end)) p(err(function() return nil .. "x" end))
p(err(function() local x x.y = 1 end)) p(err(function() return #nil end)) p(err(function() return -{} end)) p(err(function() undefinedfn() end))
local ud = newproxy(true) getmetatable(ud).__tostring = function() return "UD" end getmetatable(ud).__len = function() return 7 end p(tostring(ud), #ud, type(ud))
local lt = setmetatable({}, {__lt = function(a, b) return true end}) p(pcall(function() return lt <= lt end))
local idx = setmetatable({}, {__index = {a = 1}}) p(idx.a, rawget(idx, "a"))
local callable = setmetatable({}, {__call = function(self, ...) return select('#', ...), ... end}) p(callable(1, 2, 3)) p(pcall(callable, "x"))
local mt = {__index = function(t, k) return k .. "!" end} local obj = setmetatable({}, mt) p(obj.a, obj[1], obj.zz)
local cmp = setmetatable({}, {__lt = function(a, b) return false end}) local cmp2 = setmetatable({}, getmetatable(cmp)) p(cmp < cmp2, cmp > cmp2, cmp >= cmp2)
local bad = setmetatable({}, {__index = function() error("boom") end}) p(err(function() return bad.x end))
local selfref = {} selfref.__index = selfref setmetatable(selfref, selfref) p(err(function() return selfref.foo end))

-- LuaJIT's comparison metamethod order (lj_meta_comp): a > b is `not __le(a, b)`, a >= b is `not __lt(a, b)`;
-- with only __lt, a <= b is `not __lt(b, a)`; with only __le, a < b is an error
do
  local log = {}
  local function mk(lt, le)
    local mt = {}
    if lt then mt.__lt = function(a, b) log[#log + 1] = "lt(" .. a.n .. "," .. b.n .. ")"; return a.n < b.n end end
    if le then mt.__le = function(a, b) log[#log + 1] = "le(" .. a.n .. "," .. b.n .. ")"; return a.n <= b.n end end
    return setmetatable({ n = 1 }, mt), setmetatable({ n = 2 }, mt)
  end
  local function run(name, lt, le)
    log = {}
    local A, B = mk(lt, le)
    A.n, B.n = 1, 2
    -- the metatables differ per object here, so share them: use the same metatable for both
    setmetatable(B, getmetatable(A))
    local r = {}
    r[1] = pcall(function() return A < B end)
    local ok1, v1 = pcall(function() return A < B end)
    local ok2, v2 = pcall(function() return A <= B end)
    local ok3, v3 = pcall(function() return A > B end)
    local ok4, v4 = pcall(function() return A >= B end)
    local ok5, v5 = pcall(function() return B > A end)
    local ok6, v6 = pcall(function() return B >= A end)
    p(name, ok1, v1, ok2, v2, ok3, v3, ok4, v4, ok5, v5, ok6, v6)
    p(table.concat(log, " "))
  end
  run("both", true, true)
  run("lt-only", true, false)
  run("le-only", false, true)
  run("none", false, false)
end
p(pcall(function() return 2 > setmetatable({}, {}) end))
p(pcall(function() return setmetatable({}, {}) >= 2 end))
p(pcall(function() return "a" < 1 end))
p(pcall(function() return 1 <= "a" end))
p(pcall(function() return nil < nil end))
p(pcall(function() return true < false end))
p(pcall(function() return {} < {} end))
p(pcall(function() return print >= print end))
p("a" < "b", "a" >= "b", "b" > "a", "a" <= "a", "a\0b" < "a\0c", "" < "a", "Z" < "a")
