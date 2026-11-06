-- the set of names in every standard library table must match the oracle (LuaJIT 2.0.2 with the exe's LUA_COMPAT_GFIND / LUA_COMPAT_MOD)
local libs = {"_G","string","table","math","bit","os","io","coroutine","debug","jit","package"}
for _, ln in ipairs(libs) do
  local t = ln == "_G" and _G or _G[ln]
  local names = {}
  if t then for k in pairs(t) do names[#names+1] = tostring(k) end end
  table.sort(names)
  print(ln, #names, table.concat(names, " "))
end
