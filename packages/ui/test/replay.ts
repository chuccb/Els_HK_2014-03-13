/**
 * The replay of the scripts the emulator oracles write (`tools/oracle-input.py`, `tools/oracle-controls.py`, ...): each script is a list of
 * steps -- build a dialog, controls, a stage; set a field; give the focus; say what a stub answers; put the mouse somewhere; send a message --
 * and, for every message, what x2.exe answered: the return value, the calls the controls and the stage saw (in order) and the state afterwards.
 * `describeCases(title, file)` runs each scene (the steps from a `reset` to the next one) on the TypeScript port: it builds the same objects, sets
 * the same fields, answers the same way, sends the same message, and compares all three.  The calls are written the way the oracle writes them:
 * `A.mouse(513,20,20,0,0)`, `A.key(257,9,1)`, `A.msg(...)`, `A.in`, `A.out`, `A.change(state,force)`, `A.sound(up)`, `stage(1127,5,A)` (a message
 * to the stage: 0x467, the custom message 5, lParam the control A; for 0x468 the second number is the function name), `gameMsg(1126,2,A,1)`,
 * `returnDrag`, `modalCount(D)`, `resetComp`.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  CKTDGUIButton, CKTDGUIControl, CKTDGUIDialog, CKTDGUISlot, CKTDGUIStatic, CPictureData, UCT, UIPointData,
} from "../src/index.ts";
import type { DeviceSound, UIStage } from "../src/index.ts";
import { rig } from "./rig.ts";
import { setup } from "./harness.ts";

export type Op = [string, ...unknown[]];
interface Expect { ret: number; events: string[]; state: string }

const APP_HWND = 0x00c0ffee;
const TYPES = { button: UCT.BUTTON, combobox: UCT.COMBOBOX, ime: UCT.IME_EDITBOX } as const;
const DIALOG_BOOLS = new Set([
  "m_bModal", "m_bEnable", "m_bShow", "m_bCloseOnFocusOut", "m_bEnableMoveByDrag", "m_bMouseDownForDrag", "m_bIsMouseOver",
  "m_bDisableUnderWindow", "m_bIsOverControl",
]);
const CONTROL_BOOLS = new Set(["m_bEnable", "m_bShow", "m_bOutofList", "m_bMouseOver", "m_bHasFocus"]);
/** the two sounds a button holds (the oracle's fake pointers 0x5550 and 0x5554) */
const SOUND_UP = { id: "up" } as unknown as DeviceSound;
const SOUND_DOWN = { id: "down" } as unknown as DeviceSound;

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
    super.onFocusIn();
  }
  override onFocusOut(): void {
    this.log.push(`${this.label}.out`);
    super.onFocusOut();
  }
}

function setQuad(c: CKTDGUIControl, rect: number[]): void {
  const [l, t, r, b] = rect as [number, number, number, number];
  c.m_NowPoint.leftTopPoint.set(l, t);
  c.m_NowPoint.rightTopPoint.set(r, t);
  c.m_NowPoint.leftBottomPoint.set(l, b);
  c.m_NowPoint.rightBottomPoint.set(r, b);
}

export function runScene(ops: Op[]): void {
  const log: string[] = [];
  let now = 0;
  const scaled = ops.some((op) => op[0] === "scale");
  // a scale other than 1 needs a render (the back buffer 1536 x 1536 makes (1.5, 2)); without one the layout is not scaled
  const { w } = scaled ? rig({ tickCount: () => now }) : setup(undefined, { tickCount: () => now });
  const dialogs = new Map<string, CKTDGUIDialog>();
  const controls = new Map<string, CKTDGUIControl>();
  const labelOf = (v: unknown): string => {
    for (const [name, d] of dialogs) if (d === v) return name;
    for (const [name, c] of controls) if (c === v) return name;
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
  w.sendGameMessage = (uMsg: number, wParam: number, lParam: unknown, direct: boolean) => {
    log.push(`gameMsg(${uMsg},${wParam},${labelOf(lParam)},${+direct})`);
    return false;
  };
  const slotClass = CKTDGUISlot as unknown as { returnDraggingItem: () => void };
  const realReturn = slotClass.returnDraggingItem;
  slotClass.returnDraggingItem = () => void log.push("returnDrag");
  const dialogOf = (label: string): CKTDGUIDialog => dialogs.get(label)!;
  const focusLabel = (): string => (w.controlFocus === null ? "none" : labelOf(w.controlFocus));
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
          setQuad(c, o.rect);
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
        case "button": {
          const [label, , o] = a as [string, string, { rect: number[]; enable: boolean; show: boolean; enableClick: boolean; up: number; rightUp: number; dbl: number; func: string }];
          const b = new CKTDGUIButton(w);
          b.m_Name = label;
          setQuad(b, o.rect);
          b.m_bEnable = o.enable;
          b.m_bShow = o.show;
          b.m_bEnableClick = o.enableClick;
          b.m_CustomMsgMouseUp = o.up;
          b.m_CustomMsgMouseRightUp = o.rightUp;
          b.m_CustomMsgMouseDblClk = o.dbl;
          b.m_CustomFuncMouseUp = o.func;
          b.m_pSndMouseUp = SOUND_UP;
          b.m_pSndMouseDown = SOUND_DOWN;
          b.playSound = (s) => void log.push(`${label}.sound(${s === SOUND_UP ? "up" : s === SOUND_DOWN ? "down" : "none"})`);
          b.ChangeState = (state, force) => void log.push(`${label}.change(${state},${+force})`);
          controls.set(label, b);
          break;
        }
        case "static": {
          const [label, , o] = a as [string, string, { pictures: (number[] | null)[]; enable: boolean; show: boolean; up: number; dbl: number }];
          const st = new CKTDGUIStatic(w);
          st.m_Name = label;
          for (const shape of o.pictures) {
            const pic = new CPictureData(w);
            if (shape) {
              const p = new UIPointData();
              const [l, t, r, b] = shape as [number, number, number, number];
              p.leftTopPoint.set(l, t);
              p.rightTopPoint.set(r, t);
              p.leftBottomPoint.set(l, b);
              p.rightBottomPoint.set(r, b);
              pic.pPoint = p;
            } else pic.pPoint = null;
            st.m_PictureDataList.push(pic);
          }
          st.m_bEnable = o.enable;
          st.m_bShow = o.show;
          st.m_CustomMsgMouseUp = o.up;
          st.m_CustomMsgMouseDblClk = o.dbl;
          controls.set(label, st);
          break;
        }
        case "register": {
          const [dialog, labels] = a as [string, string[]];
          const d = dialogOf(dialog);
          d.m_ControlsList.length = 0;
          d.m_ControlsMap.clear();
          for (const n of labels) d.AddControl(controls.get(n));
          break;
        }
        case "managed":
          if (a[1]) manager.m_setDialog.add(dialogOf(a[0] as string));
          else manager.m_setDialog.delete(dialogOf(a[0] as string));
          break;
        case "gone": // what ~CKTDGUIDialog does to the handle: the dialog leaves the manager's set, and a handle to it is stale
          manager.m_setDialog.delete(dialogOf(a[0] as string));
          dialogOf(a[0] as string).destroyed = true;
          break;
        case "set": {
          const [label, field, value] = a as [string, string, number | string | number[]];
          const c = controls.get(label);
          if (c) {
            if (field === "tab") c.m_TabControlName = value as string;
            else if (field === "prev") c.m_PrevTabControlName = value as string;
            else if (field === "offset") c.m_OffsetPos.set((value as number[])[0]!, (value as number[])[1]!);
            else if (field === "rect") setQuad(c, value as number[]);
            else (c as unknown as Record<string, unknown>)[field] = CONTROL_BOOLS.has(field) ? value !== 0 : value;
          } else {
            const d = dialogOf(label);
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
          const c = controls.get(label) as Probe;
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
          slot.m_pDialog = dialogOf(a[0] as string);
          CKTDGUISlot.s_pDragSlot = slot;
          break;
        }
        case "act": {
          const [name, dialog, how, args, flags, want] = a as [string, string, "msg" | "mouse", number[], string[], Expect];
          const d = dialogOf(dialog);
          log.length = 0;
          const ret = how === "msg"
            ? d.msgProc(APP_HWND, args[0]!, args[1]!, args[2]!)
            : d.handleMouse(args[0]!, args[1]!, args[2]!, args[3]!, args[4]!);
          const f = (v: number) => String(v);
          let state = `over=${+d.m_bIsOverControl} mouseOver=${+d.m_bIsMouseOver} down=${+d.m_bMouseDownForDrag} show=${+d.m_bShow} enable=${+d.m_bEnable} ` +
            `pos=(${f(d.m_Pos.x)},${f(d.m_Pos.y)}) goal=(${f(d.m_GoalPos.x)},${f(d.m_GoalPos.y)}) prev=(${d.m_PrevMousePointX},${d.m_PrevMousePointY}) focus=${focusLabel()}`;
          if (d.m_pDialogGuideDesc !== null) state += ` guide.show=${+d.m_pDialogGuideDesc.m_bShow}`;
          if (flags.length > 0) state += ` mouseOverFlags=${flags.map((n) => +controls.get(n)!.m_bMouseOver).join("")}`;
          if (name.startsWith("I1")) state += ` hideCaret=${+w.ime.s_bHideCaret}`;
          // the three things the exe answered: the return value, the calls in order, the state afterwards
          expect([name, +ret, log.slice(), state]).toEqual([name, want.ret, want.events, want.state]);
          break;
        }
        case "act_ctl": {
          const [name, label, args, want] = a as [string, string, number[], Expect];
          const c = controls.get(label)!;
          log.length = 0;
          const ret = c.handleMouse(args[0]!, args[1]!, args[2]!, args[3]!, args[4]!);
          const state = `hasFocus=${+c.m_bHasFocus} focus=${focusLabel()} down=${+c.m_pDialog!.m_bMouseDownForDrag}`;
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

/** the scenes of a script: a `reset` starts one */
export function scenesOf(file: string): Op[][] {
  const script = JSON.parse(readFileSync(new URL(file, import.meta.url), "utf8")) as Op[];
  const scenes: Op[][] = [];
  for (const op of script) {
    if (op[0] === "reset") scenes.push([]);
    scenes[scenes.length - 1]!.push(op);
  }
  return scenes;
}

export function describeCases(title: string, file: string, actKinds: string[] = ["act", "act_ctl"]): void {
  describe(title, () => {
    for (const scene of scenesOf(file)) {
      const acts = scene.filter((op) => actKinds.includes(op[0]));
      const first = (acts[0]![0] === "act" ? acts[0]![1] : acts[0]![1]) as string;
      test(acts.length === 1 ? first : `${first} (+${acts.length - 1} more)`, () => runScene(scene));
    }
  });
}
