#!/usr/bin/env bash
# usage: ./tools/gpu.sh <command...>
# Runs <command> with the software Vulkan driver from ./tools/setup-gpu.sh visible to Dawn (LD_LIBRARY_PATH has to be set
# before the process starts, because Dawn dlopen()s libvulkan.so.1).  Without SwiftShader, or with ELS_GPU_NATIVE=1 (a real GPU
# is present), the command runs unchanged; tests that need an adapter then skip themselves.
DIR="${ELS_GPU_DIR:-/home/user/work/swsh}/sw"
if [ -z "${ELS_GPU_NATIVE:-}" ] && [ -f "$DIR/vk_swiftshader_icd.json" ]; then
  export LD_LIBRARY_PATH="$DIR${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
  export VK_ICD_FILENAMES="$DIR/vk_swiftshader_icd.json"
fi
exec "$@"
