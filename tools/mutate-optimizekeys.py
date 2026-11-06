#!/usr/bin/env python3
"""Mutation check of the OptimizeKeys port: apply one small change at a time to packages/engine/src/kac-keys.ts, run
packages/engine/test/kac-keys.test.ts (or, with --live, tools/verify-optimizekeys.ts against the exe under CPU emulation) and report
whether something notices (killed) or not (SURVIVED).  22 mutants: the widening budget and tolerances of the vector reducer, the sign-bit
gate of the scale reducer, the slerp threshold / weight / switch and the 180-degree step of the rotation reducer, the key order fix-ups
(negative times, duplicates, unsorted input) and the end keys (FINDINGS section 16).

    python3 tools/mutate-optimizekeys.py [--live] [substring of a mutant name ...]

Four mutants are expected to survive (equivalent to the original or unreachable; the reason is printed).  The source is restored after every
mutant (also on Ctrl-C), but do not run it with uncommitted edits in kac-keys.ts you cannot afford to lose.  Needs `bun` in ./node_modules/.bin;
the unit-test run takes a few seconds, --live (600 synthetic cases per mutant, needs Python + unicorn, see tools/peemu.py) a few seconds per mutant.
Exit code 1 if a mutant that should be killed survives.
"""
import os, subprocess, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'packages/engine/src/kac-keys.ts')
BUN = os.path.join(ROOT, 'node_modules/.bin/bun')
orig = open(SRC).read()
# (name, original text, mutated text, why it may survive ('' = must be killed))
M = [
 ('count < 10 (vector)', '      if (count < 10) {\n        const r = f(f(count) * ratio);\n        if (r <= 10) {\n          let c1 = count + 1;\n          const want = Math.ceil(r);\n          if (c1 <= want) c1 = want;\n          sum += c1;\n          if (sum <= 10) { // widen', '      if (count < 9) {\n        const r = f(f(count) * ratio);\n        if (r <= 10) {\n          let c1 = count + 1;\n          const want = Math.ceil(r);\n          if (c1 <= want) c1 = want;\n          sum += c1;\n          if (sum <= 10) { // widen', 'equivalent: a run of 9 skipped keys would widen by 10, and the widening budget `sum` (starts at 1) may not exceed 10'),
 ('sum <= 10 (vector)', 'if (sum <= 10) { // widen', 'if (sum <= 11) { // widen', ''),
 ('r <= 10 (vector)', '        const r = f(f(count) * ratio);\n        if (r <= 10) {\n          let c1 = count + 1;\n          const want = Math.ceil(r);\n          if (c1 <= want) c1 = want;\n          sum += c1;\n          if (sum <= 10) { // widen', '        const r = f(f(count) * ratio);\n        if (r < 10) {\n          let c1 = count + 1;\n          const want = Math.ceil(r);\n          if (c1 <= want) c1 = want;\n          sum += c1;\n          if (sum <= 10) { // widen', 'equivalent: r == 10 widens by 10 (max(count + 1, ceil(r))), which the same budget refuses'),
 ('tolSeg init', 'state = 2; count = 1; sum = 1; tolSeg = f(tol / 10);\n      } else { emit(i); state = 0; }', 'state = 2; count = 1; sum = 1; tolSeg = f(tol / 9);\n      } else { emit(i); state = 0; }', ''),
 ('vector refit tol', 'tolSeg = f(f(tol / 10) * f(c1));\n            advance();', 'tolSeg = f(f(tol / 10) * f(c1 + 1));\n            advance();', ''),
 ('flush in state 1 (vector)', 'if (state === 1) emit(i - 1); // the last key of the run that was skipped\n      if (ok)', 'if (state === 1 && false) emit(i - 1);\n      if (ok)', ''),
 ('sign mask', '(bits & 0x30) !== 0x30 && (bits & 0xc) !== 0xc && (bits & 3) !== 3', '(bits & 0x30) !== 0x30 && (bits & 0xc) !== 0xc', ''),
 ('min axis', 'const MIN_AXIS = 0.0009765625;', 'const MIN_AXIS = 0.001953125;', ''),
 ('slerp s2 weight', 'const s2 = f(f(Math.sin(f(t * omega))) * inv);', 'const s2 = f(f(Math.sin(f(t * omega * 1.0000001))) * inv);', ''),
 ('rot refit atan', '            inv = s < MIN_AXIS ? 0 : f(1 / s);\n            omega = f(Math.atan2(s, d.w));\n            invDt = f(1 / dt);', '            inv = s < MIN_AXIS ? 0 : f(1 / s);\n            omega = f(Math.atan2(s, d.w) * 0.999);\n            invDt = f(1 / dt);', ''),
 ('rot stale d after flush', 'if (state === 1) emitLast(i - 1); // the last key of the run that was skipped (d stays the one computed against the older key)', 'if (state === 1) { emitLast(i - 1); d = quatMultiply(qn, { x: -qlast.x, y: -qlast.y, z: -qlast.z, w: qlast.w }); }', ''),
 ('rot identityish w', 'if (tol < ew && f(Math.max(Math.abs(d.w), 1) * tol) < ew) return false;', 'if (tol < ew) return false;', 'needs |d.w| > 1 by rounding AND the error within 1e-7 (relative) of the tolerance; the unit tests cannot hit that on purpose'),
 ('rot d2.w', 'if (d2.w <= 0) close = true;', 'if (d2.w < 0) close = true;', ''),
 ('rot switch inv==0', 'if (s >= MIN_AXIS && inv === 0) {', 'if (s >= MIN_AXIS && inv === 0 && false) {', ''),
 ('correct order: back key', 'if (i !== start) { back = i - 1; if (timeI <= 0) back = -1; }', 'if (i !== start) { back = i - 1; }', ''),
 ('last key emit', 'if (state !== 0) emit(n - 1);\n  return o + 1;\n}\n\n// ----', 'if (state !== 0 && n > 3) emit(n - 1);\n  return o + 1;\n}\n\n// ----', ''),
 ('unique first/last', '    if (a[v2 * stride] !== a[v4 * stride]) { v2++;', '    if (a[v2 * stride] < a[v4 * stride]) { v2++;', 'equivalent: std::unique runs on the sorted array, where `!==` and `<` agree'),
 ('sort reversed', 'rows.sort((p, q) => (p[0]! < q[0]! ? -1 : p[0]! > q[0]! ? 1 : 0));', 'rows.sort((p, q) => (p[0]! < q[0]! ? 1 : p[0]! > q[0]! ? -1 : 0));', ''),
 ('single key negative', 'if (start + 1 === end) { if (T(start) < 0) a[start * stride] = 0; return; }', 'if (start + 1 === end) { return; }', ''),
 ('all-negative start', 'if (i + 1 === end) { a[i * stride] = 0; r.start = i; return; } // all negative', 'if (i + 1 === end) { a[i * stride] = 0; r.start = i + 1; return; } // all negative', ''),
 ('one nonneg key', 'if (timeI !== 0) { i--; a[i * stride] = 0; }', 'if (timeI !== 0) { a[i * stride] = 0; }', ''),
 ('first key flip', 'if (!(q0.w >= 0)) q0 = negQ(q0);', 'if (q0.w < -0.5) q0 = negQ(q0);', ''),
]

def main():
    args = sys.argv[1:]
    live = '--live' in args
    pick = [a for a in args if a != '--live']
    cmd = ([BUN, 'run', os.path.join(ROOT, 'tools/verify-optimizekeys.ts'), '--synthetic', '600', '--corpus', '0', '--seed', '5']
           if live else [BUN, 'test', os.path.join(ROOT, 'packages/engine/test/kac-keys.test.ts')])
    bad = survived = 0
    try:
        for name, a, b, why in M:
            if pick and not any(p in name for p in pick):
                continue
            assert a in orig, 'anchor not found: ' + name
            open(SRC, 'w').write(orig.replace(a, b, 1))
            killed = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True).returncode != 0
            if killed:
                print('killed    ' + name)
            elif why:
                survived += 1
                print('survived  ' + name + '  (expected: ' + why + ')')
            else:
                bad += 1
                print('SURVIVED  ' + name)
    finally:
        open(SRC, 'w').write(orig)
    print('%d unexpected survivor(s), %d expected' % (bad, survived))
    sys.exit(1 if bad else 0)

main()
