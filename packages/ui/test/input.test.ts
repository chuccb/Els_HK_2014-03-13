import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { CKTDGUIControl, CKTDGUIDialog, CKTDGUISlot, UCT } from "../src/index.ts";
import type { UIStage } from "../src/index.ts";
import { rig } from "./rig.ts";
import { setup } from "./harness.ts";

/**
 * The input of a dialog: `CKTDGUIDialog::MsgProc` (32958350) and `HandleMouse` (32957AA0).
 *
 * Every case below is a script that `tools/oracle-input.py` ran on x2.exe itself, on the Unicorn CPU emulator: the exe's MsgProc and
 * HandleMouse (with GetControlAtPointAbsolute / ForStatic, OnMouseMove, RequestFocus, SetShow, SetPos, SendInternelEvent, the base
 * ContainsPoint, GetHideDialog, the IME's StaticMsgProc ...) on a dialog, three or four controls, a stage and a dialog manager built in the
 * emulated memory.  The controls' input slots are stubs that write down the call (`A.mouse(513,20,20,0,0)`, `A.key(257,9,1)`, `A.msg(...)`,
 * `A.in`, `A.out`) and answer what the case says; the stage writes down the messages (`stage(1127,5,0)`: 0x467, the custom message 5, lParam 0).
 * `packages/ui/test/input-cases.json` is the script with the exe's answers (the return value, the calls in order, and the state of the dialog
 * afterwards); this file runs the same steps on the TypeScript port: it builds the same objects, sets the same fields, answers the same way,
 * and compares everything.  Every case was also worked out by hand from the decompile first (see the comments of `MsgProc` in dialog.ts and
 * the switches of 32958350: the jump tables at 329589C4 / 329589D4 / 329589E8).
 */

type Op = [string, ...unknown[]];
interface Expect { ret: number; events: string[]; state: string }

const SCRIPT = JSON.parse(readFileSync(new URL("./input-cases.json", import.meta.url), "utf8")) as Op[];

/** the scenes: a `reset` starts one */
const SCENES: Op[][] = [];
for (const op of SCRIPT) {
  if (op[0] === "reset") SCENES.push([]);
  SCENES[SCENES.length - 1]!.push(op);
}

const APP_HWND = 0x00c0ffee;
const TYPES = { button: UCT.BUTTON, combobox: UCT.COMBOBOX, ime: UCT.IME_EDITBOX } as const;
const DIALOG_BOOLS = new Set([
  "m_bModal", "m_bEnable", "m_bShow", "m_bCloseOnFocusOut", "m_bEnableMoveByDrag", "m_bMouseDownForDrag", "m_bIsMouseOver",
  "m_bDisableUnderWindow", "m_bIsOverControl",
]);
const CONTROL_BOOLS = new Set(["m_bEnable", "m_bShow", "m_bOutofList", "m_bMouseOver"]);

/** a control whose input is written down and answered as the case says (the exe's stub of the same name) */
class Probe extends CKTDGUIControl {
  readonly answers: { mouse?: number; key?: number; msg?: number } = {};
  readonly effects: { mouse?: () => void } = {};
  constructor(w: ConstructorParameters<typeof CKTDGUIControl>[0], readonly label: string, private readonly log: string[]) {
    super(w);
    this.m_Name = label;
  }
  override handleMouse(uMsg: number, x: number, y: number, wParam: number, lParam: number): boolean {
    this.log.push(`${this.label}.mouse(${uMsg},${x},${y},${wParam},${lParam})`);
    this.effects.mouse?.();
    return this.answers.mouse === 1;
  }
  override handleKeyboard(uMsg: number, wParam: number, lParam: number): boolean {
    this.log.push(`${this.label}.key(${uMsg},${wParam},${lParam})`);
    return this.answers.key === 1;
  }
  override msgProc(hWnd: unknown, uMsg: number, wParam: number, lParam: number): boolean {
    this.log.push(`${this.label}.msg(${String(hWnd)},${uMsg},${wParam},${lParam})`);
    return this.answers.msg === 1;
  }
  override onFocusIn(): void {
    this.log.push(`${this.label}.in`);
  }
  override onFocusOut(): void {
    this.log.push(`${this.label}.out`);
  }
}

function runScene(ops: Op[]): void {
  const log: string[] = [];
  let now = 0;
  const scaled = ops.some((op) => op[0] === "scale");
  // a scale other than 1 needs a render (the back buffer 1536 x 1536 makes (1.5, 2)); without one the layout is not scaled
  const { w } = scaled ? rig({ tickCount: () => now }) : setup(undefined, { tickCount: () => now });
  const dialogs = new Map<string, CKTDGUIDialog>();
  const controls = new Map<string, Probe>();
  const labelOf = (v: unknown): string => {
    for (const [name, d] of dialogs) if (d === v) return name;
    return typeof v === "number" ? String(v) : v === null ? "0" : "?";
  };
  const stage: UIStage = {
    MsgProc: (msg: number, wParam: number | string, lParam: unknown) => {
      log.push(`stage(${msg},${wParam},${labelOf(lParam)})`);
      return true;
    },
  };
  const manager = w.dialogManager;
  manager.countModalDialog = (d: CKTDGUIDialog | null) => void log.push(`modalCount(${d === null ? 0 : labelOf(d)})`);
  w.ime.resetCompositionString = () => void log.push("resetComp");
  const slotClass = CKTDGUISlot as unknown as { returnDraggingItem: () => void };
  const realReturn = slotClass.returnDraggingItem;
  slotClass.returnDraggingItem = () => void log.push("returnDrag");
  try {
    for (const op of ops) {
      const [kind, ...a] = op;
      switch (kind) {
        case "reset":
          break;
        case "scale": {
          const s = w.render?.resolutionScale;
          expect([s?.x, s?.y]).toEqual([a[0] as number, a[1] as number]);
          break;
        }
        case "dialog": {
          const [label, , o] = a as [string, number, { pos: [number, number]; modal: boolean; enable: boolean; show: boolean; stage: boolean; manager: boolean; guide: boolean }];
          const d = new CKTDGUIDialog(w);
          d.m_Pos.set(o.pos[0], o.pos[1]);
          d.m_bModal = o.modal;
          d.m_bEnable = o.enable;
          d.m_bShow = o.show;
          d.m_pStage = o.stage ? stage : null;
          d.m_pkUIDialogManager = o.manager ? manager : null;
          if (o.guide) d.m_pDialogGuideDesc = new CKTDGUIDialog(w);
          dialogs.set(label, d);
          if (o.guide) dialogs.set(`${label}.guide`, d.m_pDialogGuideDesc!);
          break;
        }
        case "control": {
          const [label, , o] = a as [string, string, { rect: number[]; type: keyof typeof TYPES; offset: number[]; show: boolean; enable: boolean; outOfList: boolean; tab: string; prev: string }];
          const c = new Probe(w, label, log);
          const [l, t, r, b] = o.rect as [number, number, number, number];
          c.m_NowPoint.leftTopPoint.set(l, t);
          c.m_NowPoint.rightTopPoint.set(r, t);
          c.m_NowPoint.leftBottomPoint.set(l, b);
          c.m_NowPoint.rightBottomPoint.set(r, b);
          c.m_ControlType = TYPES[o.type];
          c.m_OffsetPos.set(o.offset[0]!, o.offset[1]!);
          c.m_bShow = o.show;
          c.m_bEnable = o.enable;
          c.m_bOutofList = o.outOfList;
          c.m_TabControlName = o.tab;
          c.m_PrevTabControlName = o.prev;
          controls.set(label, c);
          break;
        }
        case "register": {
          const [dialog, labels] = a as [string, string[]];
          const d = dialogs.get(dialog)!;
          d.m_ControlsList.length = 0;
          d.m_ControlsMap.clear();
          for (const n of labels) d.AddControl(controls.get(n));
          break;
        }
        case "set": {
          const [label, field, value] = a as [string, string, number | string | number[]];
          const c = controls.get(label);
          if (c) {
            if (field === "tab") c.m_TabControlName = value as string;
            else if (field === "prev") c.m_PrevTabControlName = value as string;
            else if (field === "offset") c.m_OffsetPos.set((value as number[])[0]!, (value as number[])[1]!);
            else if (field === "rect") {
              const [l, t, r, b] = value as [number, number, number, number];
              c.m_NowPoint.leftTopPoint.set(l, t);
              c.m_NowPoint.rightTopPoint.set(r, t);
              c.m_NowPoint.leftBottomPoint.set(l, b);
              c.m_NowPoint.rightBottomPoint.set(r, b);
            } else (c as unknown as Record<string, unknown>)[field] = CONTROL_BOOLS.has(field) ? value !== 0 : value;
          } else {
            const d = dialogs.get(label)!;
            if (field === "timerStart") d.m_TimerToSelfDelete._start_time = value as number;
            else (d as unknown as Record<string, unknown>)[field] = DIALOG_BOOLS.has(field) ? value !== 0 : value;
          }
          break;
        }
        case "focus":
          w.controlFocus = a[0] === null ? null : controls.get(a[0] as string)!;
          break;
        case "answer": {
          const [label, which, value, effect] = a as [string, "mouse" | "key" | "msg", number, string | null];
          const c = controls.get(label)!;
          c.answers[which] = value;
          if (effect === "hide") c.effects.mouse = () => { c.m_pDialog!.m_bShow = false; };
          break;
        }
        case "mouse":
          w.mouse.m_XPos = a[0] as number;
          w.mouse.m_YPos = a[1] as number;
          break;
        case "clock":
          now = a[0] as number;
          break;
        case "hideDialogs":
          manager.m_bCanHide = a[0] as boolean;
          manager.m_bShow = false;
          break;
        case "ime":
          w.ime.s_bEnableImeSystem = a[0] as boolean;
          break;
        case "slot": {
          const slot = new CKTDGUISlot(w);
          slot.m_pDialog = dialogs.get(a[0] as string)!;
          CKTDGUISlot.s_pDragSlot = slot;
          break;
        }
        case "act": {
          const [name, dialog, how, args, flags, want] = a as [string, string, "msg" | "mouse", number[], string[], Expect];
          const d = dialogs.get(dialog)!;
          log.length = 0;
          const ret = how === "msg"
            ? d.msgProc(APP_HWND, args[0]!, args[1]!, args[2]!)
            : d.handleMouse(args[0]!, args[1]!, args[2]!, args[3]!, args[4]!);
          const f = (v: number) => String(v);
          const focus = w.controlFocus === null ? "none" : (w.controlFocus as Probe).label;
          let state = `over=${+d.m_bIsOverControl} mouseOver=${+d.m_bIsMouseOver} down=${+d.m_bMouseDownForDrag} show=${+d.m_bShow} enable=${+d.m_bEnable} ` +
            `pos=(${f(d.m_Pos.x)},${f(d.m_Pos.y)}) goal=(${f(d.m_GoalPos.x)},${f(d.m_GoalPos.y)}) prev=(${d.m_PrevMousePointX},${d.m_PrevMousePointY}) focus=${focus}`;
          if (d.m_pDialogGuideDesc !== null) state += ` guide.show=${+d.m_pDialogGuideDesc.m_bShow}`;
          if (flags.length > 0) state += ` mouseOverFlags=${flags.map((n) => +controls.get(n)!.m_bMouseOver).join("")}`;
          if (name.startsWith("I1")) state += ` hideCaret=${+w.ime.s_bHideCaret}`;
          // the three things the exe answered: the return value, the calls in order, the state afterwards
          expect([name, +ret, log.slice(), state]).toEqual([name, want.ret, want.events, want.state]);
          break;
        }
        default:
          throw new Error(`unknown step ${kind}`);
      }
    }
  } finally {
    slotClass.returnDraggingItem = realReturn;
    CKTDGUISlot.s_pDragSlot = null;
  }
}

describe("CKTDGUIDialog::MsgProc (32958350) and HandleMouse (32957AA0) against the exe's own answers (tools/oracle-input.py)", () => {
  for (const scene of SCENES) {
    const acts = scene.filter((op) => op[0] === "act");
    const first = acts[0]![1] as string;
    test(acts.length === 1 ? first : `${first} (+${acts.length - 1} more)`, () => runScene(scene));
  }
});
