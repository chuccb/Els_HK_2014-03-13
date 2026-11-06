-- Reference oracle: lists the bytecode of every game script with stock LuaJIT 2.0 (jit.bc), built with the
-- client's private dump header (see tools/lua/README.md).
--   LUA_PATH=<luajit>/src/?.lua luajit native_dump_bc.lua <dir> <listfile> > out.txt
local bc = require("jit.bc")
local dir, listfile = arg[1], arg[2]
local io_write = io.write
for name in io.lines(listfile) do
  local f, err = loadfile(dir .. "/" .. name)
  io_write("=== ", name, "\n")
  if not f then
    io_write("LOAD ERROR: ", tostring(err), "\n")
  else
    bc.dump(f, io.stdout, true)
  end
end
