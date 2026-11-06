-- Differential "stub environment" runner for the script corpus (see tools/corpus-diff.sh).
--
-- Runs one game script (precompiled KL\x81 bytecode) in a sandbox where every unknown global is a stub object
-- (a userdata that logs gets/sets/calls and answers arithmetic), then calls the functions the script defined. Everything the
-- script does to the outside world is written to stdout, one event per line. The very same bytecode of this driver and of
-- the script runs on the native LuaJIT 2.0.2 oracle and on the TypeScript VM; the two outputs must be identical.
--
--   luajit stubrun.luac <script.lua> <listfile> [flavor]
--
-- Nothing in the log may depend on addresses, time, or table iteration order of non-string keys.

local scriptPath, listFile = arg[1], arg[2]
local flavor = tonumber(arg[3] or "1")
local MAXLINES, MAXCALLS = 3000, 120

local type, tostring, tonumber, pairs, ipairs, pcall, select, unpack, error, setmetatable, getmetatable, rawget, rawset =
  type, tostring, tonumber, pairs, ipairs, pcall, select, unpack, error, setmetatable, getmetatable, rawget, rawset
local sformat, ssub, sgsub, srep = string.format, string.sub, string.gsub, string.rep
local concat, sort = table.concat, table.sort
local write = io.write

local LIMIT = {}
local nlines, ncalls = 0, 0
local function log(...)
  nlines = nlines + 1
  if nlines > MAXLINES then error(LIMIT, 0) end
  write(concat({ ... }, " "), "\n")
end

-- stable ids instead of addresses
local ids, nid = {}, 0
local paths = {}
local function desc(v, limit)
  local t = type(v)
  if t == "nil" or t == "boolean" then return tostring(v) end
  if t == "number" then return sformat("%.14g", v) end
  if t == "string" then
    limit = limit or 48
    if #v > limit then v = ssub(v, 1, limit) .. "~" end
    return sformat("%q", v)
  end
  local p = paths[v]
  if p then return "<" .. p .. ">" end
  local id = ids[v]
  if not id then
    nid = nid + 1
    id = nid
    ids[v] = id
  end
  return t .. "#" .. id
end

local function descs(...)
  local n = select("#", ...)
  local t = {}
  for i = 1, n do t[i] = desc((select(i, ...))) end
  return concat(t, ",")
end

-- like descs, but strings (error messages) are kept up to 240 characters
local function descl(...)
  local n = select("#", ...)
  local t = {}
  for i = 1, n do t[i] = desc((select(i, ...)), 240) end
  return concat(t, ",")
end

-- ---- stubs --------------------------------------------------------------------------------------------------------
local proto = newproxy(true)
local mt = getmetatable(proto)
local children = {}
local function stub(path)
  local u = newproxy(proto)
  paths[u] = path
  return u
end
local function keystr(k)
  if type(k) == "string" then return k end
  return "[" .. desc(k) .. "]"
end
mt.__index = function(self, k)
  local c = children[self]
  if not c then c = {}; children[self] = c end
  local key = k
  local v = c[key]
  if v == nil then
    v = stub(paths[self] .. "." .. keystr(k))
    if type(k) == "string" or type(k) == "number" then c[key] = v end
  end
  return v
end
mt.__newindex = function(self, k, v) log("set", paths[self] .. "." .. keystr(k), "=", desc(v)) end
mt.__call = function(self, ...)
  log("call", paths[self], "(" .. descs(...) .. ")")
  if flavor == 2 then return end
  if flavor == 3 then return 0 end
  return stub(paths[self] .. "()")
end
mt.__add = function(a, b) return 1 end
mt.__sub = function(a, b) return 1 end
mt.__mul = function(a, b) return 1 end
mt.__div = function(a, b) return 1 end
mt.__mod = function(a, b) return 1 end
mt.__pow = function(a, b) return 1 end
mt.__unm = function(a) return -1 end
mt.__concat = function(a, b) return "s" end
mt.__len = function(a) return 0 end
mt.__lt = function(a, b) return false end
mt.__le = function(a, b) return true end
mt.__eq = function(a, b) return false end
mt.__tostring = function(a) return "stub:" .. paths[a] end

-- ---- sandbox -------------------------------------------------------------------------------------------------------
local E = {}
local base = {}
local real = _G
local function put(name, v) E[name] = v; base[name] = true end

for _, n in ipairs({ "string", "table", "math", "bit", "coroutine", "type", "pairs", "ipairs", "next", "select", "unpack",
  "pcall", "xpcall", "error", "assert", "setmetatable", "getmetatable", "rawget", "rawset", "rawequal", "tonumber",
  "collectgarbage", "loadstring", "_VERSION", "newproxy", "gcinfo" }) do
  put(n, real[n])
end
put("_G", E)
put("tostring", function(v)
  local t = type(v)
  if t == "table" or t == "function" or t == "thread" then return desc(v) end
  if t == "userdata" then return desc(v) end
  return tostring(v)
end)
put("print", function(...)
  local n = select("#", ...)
  local t = {}
  for i = 1, n do t[i] = E.tostring((select(i, ...))) end
  log("print", concat(t, "\t"))
end)
put("os", {
  time = function() return 1400000000 end,
  clock = function() return 1.5 end,
  date = function(f) return "date" end,
  getenv = function() return nil end,
  difftime = function(a, b) return (a or 0) - (b or 0) end,
})
put("io", {
  write = function(...) log("io.write", descs(...)); return true end,
})
put("jit", nil)

local lower = {}
for name in io.lines(listFile) do lower[string.lower(name)] = name end
local loaded = {}
local function runfile(name, mustExist)
  local real_name = lower[string.lower(name)]
  if not real_name then
    log("dofile-missing", name)
    return
  end
  local f, e = loadfile(scriptPath:match("^(.*)/[^/]*$") .. "/" .. real_name)
  if not f then log("load-error", real_name, tostring(e)); return end
  setfenv(f, E)
  return f()
end
put("dofile", function(name)
  log("dofile", tostring(name))
  return runfile(name)
end)
put("loadfile", function(name) return nil, "no" end)
put("require", function(name) log("require", tostring(name)); return stub("require(" .. tostring(name) .. ")") end)
put("module", function(name) log("module", tostring(name)) end)

setmetatable(E, {
  __index = function(_, k)
    if type(k) ~= "string" then return nil end
    local s = stub(k)
    return s
  end,
})

-- ---- run -----------------------------------------------------------------------------------------------------------
local function try(name, f)
  if ncalls >= MAXCALLS then return end
  ncalls = ncalls + 1
  for variant = 1, 2 do
    local r
    if variant == 1 then
      r = { pcall(f) }
    else
      r = { pcall(f, stub("a1"), stub("a2"), stub("a3"), stub("a4"), stub("a5"), stub("a6")) }
    end
    if not r[1] and r[2] == LIMIT then error(LIMIT, 0) end
    log("fn", name, variant, r[1] and "ok" or "err", descl(unpack(r, 2, math.min(#r, 6))))
  end
end

local function callall()
  local names = {}
  for k in pairs(E) do
    if type(k) == "string" and not base[k] then names[#names + 1] = k end
  end
  sort(names)
  for _, k in ipairs(names) do
    local v = rawget(E, k)
    if type(v) == "function" then
      try(k, v)
    elseif type(v) == "table" then
      local fk = {}
      for kk, vv in pairs(v) do
        if type(kk) == "string" and type(vv) == "function" then fk[#fk + 1] = kk end
      end
      sort(fk)
      for _, kk in ipairs(fk) do try(k .. "." .. kk, v[kk]) end
    end
  end
end

local bxor, rol = bit.bxor, bit.rol
local sbyte = string.byte
local function hashstr(h, str)
  for i = 1, #str do h = bxor(rol(h, 5), sbyte(str, i)) end
  return h
end

-- canonical serialisation of a value (keys sorted, so it does not depend on iteration order) folded into a hash
local function ser(v, h, depth, seen)
  local t = type(v)
  if t == "table" then
    if seen[v] then return hashstr(h, "@cycle") end
    if depth > 6 then return hashstr(h, "@deep") end
    seen[v] = true
    local keys = {}
    for k in pairs(v) do
      local kt = type(k)
      if kt == "string" or kt == "number" or kt == "boolean" then keys[#keys + 1] = k end
    end
    sort(keys, function(a, b)
      local ta, tb = type(a), type(b)
      if ta ~= tb then return ta < tb end
      if ta == "boolean" then return (a and 1 or 0) < (b and 1 or 0) end
      return a < b
    end)
    h = hashstr(h, "{")
    for _, k in ipairs(keys) do
      h = hashstr(h, desc(k))
      h = ser(rawget(v, k), h, depth + 1, seen)
    end
    seen[v] = nil
    return hashstr(h, "}")
  elseif t == "function" or t == "thread" then
    return hashstr(h, t)
  else
    return hashstr(h, desc(v))
  end
end

local function order(v)
  local parts, n, h, stable = {}, 0, 0, true
  for k in pairs(v) do
    local kt = type(k)
    local ks
    if kt == "string" or kt == "number" or kt == "boolean" then ks = desc(k) else ks = "?"; stable = false end
    n = n + 1
    if n <= 10 then parts[n] = ks end
    h = hashstr(h, ks)
  end
  return concat(parts, ","), h, stable
end

local function dumpglobals()
  local names = {}
  for k, v in pairs(E) do
    if type(k) == "string" and not base[k] then names[#names + 1] = k end
  end
  sort(names)
  for _, k in ipairs(names) do
    local v = rawget(E, k)
    local extra = ""
    if type(v) == "table" then
      local n, ln = 0, #v
      for _ in pairs(v) do n = n + 1 end
      local first, oh, stable = order(v)
      extra = " n=" .. n .. " #=" .. ln .. " sum=" .. ser(v, 0, 0, {})
      if stable then extra = extra .. " order=" .. oh .. " [" .. first .. "]" end
    end
    log("global", k, desc(v) .. extra)
  end
end

local ok, err = pcall(function()
  local f, e = loadfile(scriptPath)
  if not f then log("load-error", tostring(e)); return end
  setfenv(f, E)
  local r = { pcall(f) }
  if not r[1] and r[2] == LIMIT then error(LIMIT, 0) end
  log("main", r[1] and "ok" or "err", descl(unpack(r, 2, math.min(#r, 4))))
  dumpglobals()
  callall()
end)
if not ok then
  if err == LIMIT then write("LIMIT\n") else write("DRIVER-ERROR ", tostring(err), "\n") end
end
write("END lines=", nlines, " calls=", ncalls, "\n")
