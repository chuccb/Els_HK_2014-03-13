-- Differential fuzz of the table implementation: array/hash sizing, rehash, the border returned by #, next() order, sort with ties.
-- Keys avoid GC objects (their order depends on addresses); everything is deterministic through a private LCG.
local seed = 20140313
local function rnd(n) seed = (seed * 1103515245 + 12345) % 2147483648 return math.floor(seed / 65536) % n + 1 end

local pool = {}
for i = -3, 40 do pool[#pool + 1] = i end                       -- integers around the array part, negative and zero
for i = 1, 12 do pool[#pool + 1] = i + 0.5 end                  -- non-integral floats
pool[#pool + 1] = 2 ^ 31 pool[#pool + 1] = 2 ^ 53 pool[#pool + 1] = -0.0 pool[#pool + 1] = 1e100 pool[#pool + 1] = 1 / 0 pool[#pool + 1] = -1 / 0
for _, s in ipairs{"a", "b", "c", "name", "id", "x", "y", "z", "alpha", "beta", "gamma", "delta", "key1", "key2", "key10", "", " ", "n", "t", "val", "Item", "SetItem", "UI", "GAME", "ELSWORD", "LIRE", "ARME"} do pool[#pool + 1] = s end
pool[#pool + 1] = true pool[#pool + 1] = false

local function show(k, v) return tostring(k) .. "=" .. tostring(v) end
local function dump(t)
  local order = {}
  for k, v in pairs(t) do order[#order + 1] = show(k, v) end
  return table.concat(order, ",")
end
local function nextdump(t)
  local order, k, v = {}, next(t)
  while k ~= nil do order[#order + 1] = tostring(k) k, v = next(t, k) end
  return table.concat(order, ",")
end

for round = 1, 120 do
  local t = {}
  local lens = {}
  local nsteps = 10 + rnd(70)
  for step = 1, nsteps do
    local op = rnd(10)
    local k = pool[rnd(#pool)]
    if op <= 5 then
      if k ~= k or k == nil then k = 1 end
      t[k] = step
    elseif op <= 7 then t[k] = nil
    elseif op == 8 then t[#t + 1] = step
    elseif op == 9 then table.insert(t, step)
    else
      local n = #t
      if n > 0 then t[n] = nil end
    end
    lens[#lens + 1] = #t
  end
  print(round, table.concat(lens, " "))
  print(dump(t))
  print(nextdump(t))
  print(select("#", unpack(t)), (select("#", unpack(t, 1, 5))), #t, rawlen and rawlen(t) or "-")
end

-- constructors: array part sizes, holes, trailing nils, mixed
local ctors = {
  {1, 2, 3}, {1, nil, 3}, {nil, nil, 3}, {1, 2, nil}, {nil}, {n = 1, 1, 2}, {[1] = 1, [2] = 2, [4] = 4}, {[3] = 3, [2] = 2, [1] = 1},
  {1, 2, 3, [10] = 10}, {[1] = "a", "b"}, {"a", [1] = "b"}, {[0] = 0, 1, 2}, {[-1] = -1, [1] = 1},
}
for i, t in ipairs(ctors) do print("ctor", i, #t, dump(t)) end
local function va(...) return {...}, select("#", ...) end
for _, args in ipairs{{1, 2, 3}, {1, nil, 3}, {nil, nil}, {nil, 2}, {1, 2, nil, nil, 5}} do
  local t, n = va(unpack(args, 1, 5))
  print("vararg", n, #t, dump(t))
end

-- growth patterns
local g = {} for i = 1, 100 do g[i] = i end for i = 1, 100, 2 do g[i] = nil end print("holes", #g, dump(g):sub(1, 120))
local h = {} for i = 100, 1, -1 do h[i] = i end print("reverse", #h, nextdump(h):sub(1, 120))
local s = {} for i = 1, 40 do s["k" .. i] = i end for i = 1, 40, 3 do s["k" .. i] = nil end print("strings", nextdump(s))
local m = {} for i = 1, 20 do m[i] = i m["s" .. i] = i m[i + 0.5] = i end print("mixed", #m, nextdump(m))

-- table library on those shapes
local r = {} for i = 1, 10 do r[i] = i end
table.insert(r, 3, "x") table.insert(r, 1, "first") table.insert(r, #r + 1, "last")
print(table.concat(r, ","), table.remove(r), table.remove(r, 1), table.remove(r, 3), #r, table.maxn(r), table.remove({}), table.remove({}, 1))
print(pcall(table.insert, r, 20, "bad"))
print(pcall(table.insert, r, 0, "bad"))
print(select("#", table.remove({}, 0)), table.remove({}, #{}))

-- sort: ties and comparator semantics (the same algorithm must produce the same permutation)
local recs = {}
for i = 1, 60 do recs[i] = {key = rnd(6), id = i} end
table.sort(recs, function(a, b) return a.key < b.key end)
local ids = {} for i, v in ipairs(recs) do ids[i] = v.key .. ":" .. v.id end print("sort ties", table.concat(ids, " "))
table.sort(recs, function(a, b) return a.key > b.key end)
ids = {} for i, v in ipairs(recs) do ids[i] = v.key .. ":" .. v.id end print("sort desc", table.concat(ids, " "))
local words = {"pear", "Apple", "fig", "apple", "Fig", "banana", "kiwi", "Kiwi", "cherry", "date", "Elderberry", "grape", "10", "9", "2", "1"}
table.sort(words) print(table.concat(words, " "))
table.sort(words, function(a, b) return #a < #b end) print(table.concat(words, " "))
print(pcall(table.sort, {3, 2, 1, "x"}))
print(pcall(table.sort, {1, 2, 3, 4, 5}, function(a, b) return true end))
local big = {} for i = 1, 300 do big[i] = rnd(50) end table.sort(big) print(big[1], big[150], big[300])
