local function p(...) local t = {...} for i = 1, select('#', ...) do t[i] = tostring(t[i]) end print(table.concat(t, " ", 1, select('#', ...))) end
local function dump(t) local r = {} for k, v in pairs(t) do r[#r+1] = tostring(k) .. "=" .. tostring(v) end print(table.concat(r, ",")) end
local t = {}
for _, k in ipairs{"alpha","beta","gamma","delta","epsilon","zeta","eta","theta","iota","kappa","lambda","mu"} do t[k] = #k end
dump(t)
local t2 = {x=1, y=2, z=3, 10, 20, 30, [100]=1, [-1]=2, [2.5]=3, [true]=4}
dump(t2)
local t3 = {}
for i = 1, 20 do t3[i * 3] = i end
dump(t3)
local t4 = {}
for i = 20, 1, -1 do t4[i] = i end
p(#t4); dump(t4)
local t5 = {1, 2, 3, 4, 5}
t5[3] = nil p(#t5)
t5[5] = nil p(#t5)
t5[#t5 + 1] = 9 p(#t5)
local h = {} h[1] = 1 h[2] = 2 h[4] = 4 p(#h)
local h2 = {} h2[2] = 2 h2[3] = 3 p(#h2) h2[1] = 1 p(#h2)
local u = {} for i = 1, 10 do u[i] = i end for i = 1, 10, 2 do u[i] = nil end p(#u) dump(u)
local names = {}
for i = 1, 50 do names["key" .. i] = i end
local c = 0 for k, v in pairs(names) do c = c + v end p(c)
local order = {} for k in pairs(names) do order[#order + 1] = k end p(table.concat(order, ","))
for k, v in pairs(names) do if v % 2 == 0 then names[k] = nil end end
order = {} for k in pairs(names) do order[#order + 1] = k end p(table.concat(order, ","))
for i = 1, 10 do names["new" .. i] = i end
order = {} for k in pairs(names) do order[#order + 1] = k end p(table.concat(order, ","))
local arr = {5, 2, 8, 1, 9, 3, 7, 4, 6, 10}
table.sort(arr) p(table.concat(arr, ","))
table.sort(arr, function(a, b) return a > b end) p(table.concat(arr, ","))
local recs = {}
for i = 1, 30 do recs[i] = {id = i, key = i % 4} end
table.sort(recs, function(a, b) return a.key < b.key end)
local o = {} for i, r in ipairs(recs) do o[i] = r.id end p(table.concat(o, ","))
local words = {"pear", "apple", "fig", "banana", "cherry", "date", "elderberry"}
table.sort(words) p(table.concat(words, ","))
table.sort(words, function(a, b) return #a < #b end) p(table.concat(words, ","))
local q = {1, 2, 3}
table.insert(q, 4) table.insert(q, 1, 0) table.insert(q, 3, 99) p(table.concat(q, ","))
p(table.remove(q), table.remove(q, 1), table.remove(q, 2), table.concat(q, ","))
p(select('#', table.remove({})), table.remove({}, 1), select('#', table.remove({1,2,3}, 7)))
p(table.concat({}, ","), table.concat({1, 2, 3}), table.concat({"a", "b"}, "-"), table.concat({1, 2, 3, 4}, ",", 2, 3))
p(unpack({1, 2, 3})); p(unpack({1, 2, 3}, 2)); p(unpack({1, 2, 3}, 2, 3)); p(select('#', unpack({}, 1, 3)))
p(table.maxn({1, 2, [10] = 3, x = 4}), table.getn({1, 2, 3}))
local big = {} for i = 1, 1000 do big[i] = i end p(#big)
for i = 1, 500 do big[i] = nil end p(#big == 1000 or #big == 0)
local nk = {} nk[1.5] = "a" nk[0] = "z" nk[-5] = "n" nk[1e10] = "big" dump(nk)
local nested = {a = {b = {c = 42}}} p(nested.a.b.c, nested["a"]["b"]["c"], rawget(nested, "a") == nested.a)
local nx = {10, 20, 30, a = 1} local k, v = next(nx) p(k, v) k, v = next(nx, k) p(k, v) p(next({}))
local ip = {} for i, v in ipairs({1, 2, nil, 4}) do ip[#ip + 1] = i end p(#ip)
local t6 = {n = 0} for i = 1, 5 do t6[#t6 + 1] = i * i end p(#t6, t6[5])
local tt = {} tt[1] = 1 tt[2] = 2 tt[3] = 3 tt[4] = 4 tt[2] = nil tt[4] = nil dump(tt) p(#tt)
local m = {} for i = 1, 8 do m["k" .. i] = i end for i = 1, 8 do m["k" .. i] = nil end for i = 1, 8 do m["j" .. i] = i end dump(m)
local mixed = {} for i = 1, 30 do mixed[i % 2 == 0 and i or "s" .. i] = i end dump(mixed)
local keys = {} for i = 1, 100 do keys[#keys + 1] = tostring(i * 7919 % 1000) end
local big2 = {} for _, k in ipairs(keys) do big2[k] = true end
local ord = {} for k in pairs(big2) do ord[#ord + 1] = k end p(#ord, table.concat(ord, ",", 1, 40))
local num = {} for i = 1, 40 do num[(i * 37) % 101] = i end
local ord2 = {} for k in pairs(num) do ord2[#ord2 + 1] = k end p(table.concat(ord2, ","))
local neg = {} for i = -5, 5 do neg[i] = i end local ord3 = {} for k in pairs(neg) do ord3[#ord3 + 1] = k end p(table.concat(ord3, ","), #neg)
local fl = {} for i = 1, 10 do fl[i / 4] = i end local ord4 = {} for k in pairs(fl) do ord4[#ord4 + 1] = k end p(table.concat(ord4, ","))
