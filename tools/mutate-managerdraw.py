#!/usr/bin/env python3
"""Mutation check of the dialog manager's draw order: 19 hand-made mutants of `CKTDGUIDialogManager::onFrameRender` / `onFrameRenderTopModal`
(`packages/ui/src/dialogmanager.ts`) against the picture test `packages/ui/test-gpu/manager-draw.test.ts` (FINDINGS 17.20, ARCHITECTURE: the GPU tests).

The unit tests of the manager (`dialogmanager.test.ts`, checked by `mutate-manager.py`) cannot see what the device draws; this test can, so it has its own
list.  Each mutant is one line of the frame (a walk over the wrong group, a pass that is left out, the dragged slot drawn by both calls ...); the test file
runs through `./tools/gpu.sh` (software Vulkan: ~25 s a run) and has to fail.

usage: python3 tools/mutate-managerdraw.py [--list | --check | name-substring]      (run it in a COPY of the tree without .git, or commit first: the source is rewritten and
put back at the end, also when the run is interrupted by an exception, but not when the process is killed)
exit code 1: a mutant survived (or a run that failed without a failing test: run it again alone).
"""
import os, subprocess, sys, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FILE = os.path.join(ROOT, "packages/ui/src/dialogmanager.ts")
TEST = "packages/ui/test-gpu/manager-draw.test.ts"

FRAME = "dialog.m_bFront === bFront && dialog.m_bShow) dialog.onFrameRender(false);"
GUIDE = "dialog.m_bFront === bFront && dialog.m_bShow && dialog.m_pStaticGuideDesc !== null) dialog.m_pStaticGuideDesc.onFrameRender();"
NAMES = '["DLG_ChatBox_EditBox", "DLG_MsgBox", "DLG_OKMsgBox", "OkAndCancelMsgBox"] as const'

M = [
    ("first pass draws the dialogs that are not in front of the call", FRAME, FRAME.replace("===", "!==")),
    ("first pass draws a dialog that is not shown", FRAME, FRAME.replace(" && dialog.m_bShow", "")),
    ("second pass draws the guide static of a dialog of the other group", GUIDE, GUIDE.replace("dialog.m_bFront === bFront && ", "")),
    ("second pass draws the guide static of a dialog that is not shown", GUIDE, GUIDE.replace(" && dialog.m_bShow", "")),
    ("second pass draws no guide static", GUIDE, GUIDE.replace("dialog.m_pStaticGuideDesc.onFrameRender();", "void 0;")),
    ("second pass of the other group", GUIDE, GUIDE.replace("dialog.m_bFront === bFront", "dialog.m_bFront !== bFront")),
    ("the second walk goes on where the first ended", "      walks[walks.length - 1] = head.next;\n      while (walks[walks.length - 1] !== head) {\n        const node = walks[walks.length - 1]!;\n        walks[walks.length - 1] = node.next;\n        second(node.value!);",
     "      while (walks[walks.length - 1] !== head) {\n        const node = walks[walks.length - 1]!;\n        walks[walks.length - 1] = node.next;\n        second(node.value!);"),
    ("the dragged slot is drawn by both calls", "if (CKTDGUISlot.s_pDragSlot !== null && bFront) CKTDGUISlot.s_pDragSlot.renderDragSlot();", "if (CKTDGUISlot.s_pDragSlot !== null) CKTDGUISlot.s_pDragSlot.renderDragSlot();"),
    ("the dragged slot is drawn by the call for the rear", "if (CKTDGUISlot.s_pDragSlot !== null && bFront) CKTDGUISlot.s_pDragSlot.renderDragSlot();", "if (CKTDGUISlot.s_pDragSlot !== null && !bFront) CKTDGUISlot.s_pDragSlot.renderDragSlot();"),
    ("the dragged slot is not drawn", "if (CKTDGUISlot.s_pDragSlot !== null && bFront) CKTDGUISlot.s_pDragSlot.renderDragSlot();", "if (CKTDGUISlot.s_pDragSlot !== null && bFront) void 0;"),
    ("the names of the hidden layer in another order", NAMES, '["DLG_ChatBox_EditBox", "DLG_OKMsgBox", "DLG_MsgBox", "OkAndCancelMsgBox"] as const'),
    ("a manager that is not shown draws", "      if (!this.m_bShow) return 0;\n    } else if (!this.m_bShow) {\n      for (const name of HIDDEN_LAYER_DIALOGS) {\n        const dialog = this.getDialog(name);\n        if (live(dialog) && dialog.m_bShow) dialog.onFrameRender(false);",
     "      if (this.m_bShow) return 0;\n    } else if (!this.m_bShow) {\n      for (const name of HIDDEN_LAYER_DIALOGS) {\n        const dialog = this.getDialog(name);\n        if (live(dialog) && dialog.m_bShow) dialog.onFrameRender(false);"),
    ("a hidden layer draws a named dialog that is not shown", "if (live(dialog) && dialog.m_bShow) dialog.onFrameRender(false);", "if (live(dialog)) dialog.onFrameRender(false);"),
    ("a hidden layer that cannot hide", "    } else if (!this.m_bShow) {\n      for (const name of HIDDEN_LAYER_DIALOGS) {\n        const dialog = this.getDialog(name);\n        if (live(dialog) && dialog.m_bShow) dialog.onFrameRender(false);", "    } else if (this.m_bShow) {\n      for (const name of HIDDEN_LAYER_DIALOGS) {\n        const dialog = this.getDialog(name);\n        if (live(dialog) && dialog.m_bShow) dialog.onFrameRender(false);"),
    ("top modal draws a modal dialog", "if (!(dialog.m_bEnable && dialog.m_bShow && !dialog.m_bModal)) return false;", "if (!(dialog.m_bEnable && dialog.m_bShow)) return false;"),
    ("top modal draws a dialog that is not enabled", "if (!(dialog.m_bEnable && dialog.m_bShow && !dialog.m_bModal)) return false;", "if (!(dialog.m_bShow && !dialog.m_bModal)) return false;"),
    ("top modal draws a dialog that is not shown", "if (!(dialog.m_bEnable && dialog.m_bShow && !dialog.m_bModal)) return false;", "if (!(dialog.m_bEnable && !dialog.m_bModal)) return false;"),
    ("top modal draws every dialog", "        dialog.onFrameRender(false);\n        return true;\n      });", "        dialog.onFrameRender(false);\n        return false;\n      });"),
    ("top modal of a hidden manager", "    if (!this.m_bCanHide || this.m_bShow) {\n      this.walkBackwardPlain((dialog) => {\n        if (!(dialog.m_bEnable", "    if (true) {\n      this.walkBackwardPlain((dialog) => {\n        if (!(dialog.m_bEnable"),
]


def main() -> int:
    args = sys.argv[1:]
    src = open(FILE, encoding="utf-8").read()
    if "--list" in args:
        print("\n".join(name for name, _, _ in M))
        return 0
    if "--check" in args:  # every anchor is in the file exactly once (run it after every edit of `dialogmanager.ts`)
        bad = [(name, src.count(old)) for name, old, new in M if src.count(old) != 1 or old == new]
        print(f"{len(M)} mutants,", "every anchor occurs exactly once" if not bad else f"anchors that do not: {bad}")
        return 1 if bad else 0
    only = args[0] if args else ""
    results = []
    try:
        for i, (name, old, new) in enumerate(M):
            if only not in name:
                continue
            assert src.count(old) == 1, (name, src.count(old))
            assert new != old, name
            open(FILE, "w", encoding="utf-8").write(src.replace(old, new))
            t = time.time()
            p = subprocess.run(["./tools/gpu.sh", "./node_modules/.bin/bun", "test", "--bail", TEST], cwd=ROOT, capture_output=True, text=True, timeout=900)
            out = p.stdout + p.stderr
            failed = [ln for ln in out.splitlines() if ln.startswith("(fail)")]
            status = "killed" if p.returncode != 0 and failed else ("no test failed: run it again" if p.returncode != 0 else "SURVIVED")
            print(f"[{i + 1}/{len(M)}] {status}: {name} ({time.time() - t:.0f} s)" + (f"  <- {failed[0][:120]}" if failed else ""), flush=True)
            results.append(status)
    finally:
        open(FILE, "w", encoding="utf-8").write(src)
    summary = {s: results.count(s) for s in sorted(set(results))}
    print("===", len(results), "mutants:", summary, flush=True)
    return 0 if results and all(r == "killed" for r in results) else 1


if __name__ == "__main__":
    sys.exit(main())
