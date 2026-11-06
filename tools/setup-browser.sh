#!/usr/bin/env bash
# Headless Chromium with WebGPU for browser tests of apps/client (no GPU and no display in the sandbox, and only registry.npmjs.org /
# github.com are reachable).  The npm package @sparticuz/chromium ships a complete headless Chromium (bin/chromium.br, 67 MB), the shared
# libraries it needs (al2023.tar.br), fonts, and Chromium's own SwiftShader (the software Vulkan driver ./tools/setup-gpu.sh also uses): with
# `--enable-unsafe-webgpu` it exposes `navigator.gpu` with a SwiftShader adapter.  puppeteer-core drives it.
#
# Output: $ELS_BROWSER_DIR (default /home/user/work/browser) with node_modules, and /tmp/chromium (+ /tmp/al2023, /tmp/fonts, /tmp/*.so,
# unpacked by the package itself).  Idempotent; use it through `node tools/browser.mjs` (which also re-extracts after a /tmp wipe).
set -euo pipefail
DIR="${ELS_BROWSER_DIR:-/home/user/work/browser}"
VER="${CHROMIUM_PKG_VERSION:-153.0.0}"
mkdir -p "$DIR"
cd "$DIR"
if [ ! -d node_modules/puppeteer-core ] || [ ! -d node_modules/@sparticuz/chromium ]; then
  [ -f package.json ] || npm init -y >/dev/null
  npm i --no-audit --no-fund "@sparticuz/chromium@$VER" puppeteer-core
fi
if [ ! -x /tmp/chromium ]; then
  # the package only unpacks the shared libraries when it believes it runs on AWS Lambda
  AWS_EXECUTION_ENV=AWS_Lambda_nodejs22.x node --input-type=module -e 'import c from "@sparticuz/chromium"; console.log(await c.executablePath())'
fi
echo "ok: node tools/browser.mjs <url> --shot out.png"
