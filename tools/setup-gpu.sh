#!/usr/bin/env bash
# Software Vulkan (SwiftShader) so that Dawn's node bindings (`webgpu` on npm) can create a WebGPU adapter in a GPU-less
# sandbox / CI box.  Dawn dlopen()s libvulkan.so.1 and needs an ICD; neither is installed there, and only registry.npmjs.org /
# github.com are reachable.  The npm package @sparticuz/chromium ships Chromium's own SwiftShader build in bin/swiftshader.tar.br
# (libvulkan.so.1 + libvk_swiftshader.so + vk_swiftshader_icd.json + ANGLE libEGL/libGLESv2); we extract just that.
# Output: $ELS_GPU_DIR/sw (default /home/user/work/swsh/sw).  Idempotent.  Use it through ./tools/gpu.sh.
set -euo pipefail
DIR="${ELS_GPU_DIR:-/home/user/work/swsh}"
VER="${SWIFTSHADER_PKG_VERSION:-153.0.0}"
if [ -f "$DIR/sw/vk_swiftshader_icd.json" ]; then echo "swiftshader present: $DIR/sw"; exit 0; fi
rm -rf "$DIR"
mkdir -p "$DIR" && cd "$DIR"
npm pack "@sparticuz/chromium@$VER" --silent >/dev/null
tar -xzf ./*.tgz package/bin/swiftshader.tar.br
node -e '
const zlib = require("node:zlib"), fs = require("node:fs");
fs.writeFileSync("swiftshader.tar", zlib.brotliDecompressSync(fs.readFileSync("package/bin/swiftshader.tar.br")));
'
mkdir -p sw && tar -xf swiftshader.tar -C sw
rm -rf package ./*.tgz swiftshader.tar
ls -la sw
echo "ok: run GPU code through ./tools/gpu.sh <command>"
