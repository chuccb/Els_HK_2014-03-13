/**
 * The replay of the scripts the emulator oracles write (`tools/oracle-input.py`, `tools/oracle-controls.py`, ...): each script is a list of
 * steps -- build a dialog, controls, a stage; set a field; give the focus; say what a stub answers; put the mouse somewhere; send a message --
 * and, for every message, what x2.exe answered: the return value, the calls the controls and the stage saw (in order) and the state afterwards.
 * `describeCases(title, file)` runs each scene (the steps from a `reset` to the next one) on the TypeScript port: it builds the same objects, sets
 * the same fields, answers the same way, sends the same message, and compares all three.  The calls are written the way the oracle writes them:
 * `A.mouse(513,20,20,0,0)`, `A.key(257,9,1)`, `A.msg(...)`, `A.in`, `A.out`, `A.change(state,force)`, `A.sound(up)`, `stage(1127,5,A)` (a message
 * to the stage: 0x467, the custom message 5, lParam the control A; for 0x468 the second number is the function name), `gameMsg(1126,2,A,1)`,
 * `returnDrag`, `modalCount(D)`, `resetComp`, `capture` / `release` (the window takes and gives back the mouse), `A.setChecked(b,double,input)`
 * (a radio button's `SetCheckedInternal`, replaced on both sides by its first statement `m_bChecked = b` and the call written down; a slot's
 `ChangeState` is written down the same way as a button's, `A.change(state,force)`, and `ReturnDraggingItem` as `returnDrag`).
 * The window system under an edit box is written down the same way: `ks(16)` (`GetKeyState`: the script's `keys` say what it answers), `clip.open`,
 * `clip.empty`, `clip.set(text)`, `clip.get`, `clip.close` (the clipboard: the script's `clip` says what it holds and whether it can be opened or locked), and
 * `time` (`DXUTGetGlobalTimer()->GetAbsoluteTime()`: the script's `timer` gives the base and the step it advances by for every call).
 * The state after a message is a list of `key=value` the oracle chooses by the kind of control (`STATE_MEMBERS` maps a key to the member of the port
 * that holds it; a rectangle is `l,t,r,b`, a point `x,y`, a flag 0 or 1).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  CKTDGUIButton, CKTDGUICheckBox, CKTDGUIComboBox, CKTDGUIContolList, CKTDGUIControl, CKTDGUIDialog, CKTDGUIEditBox, CKTDGUIListBox, CKTDGUINavigation,
  CKTDGUIRadioButton, CKTDGUIScrollBar, CKTDGUISlider, CKTDGUISlot, CKTDGUIStatic, CPictureData, RadioButtonGroupInfo, UCT, UIPointData, newRect, setRect,
} from "../src/index.ts";
import type { DeviceSound, UIClipboard, UIStage } from "../src/index.ts";
import { rig } from "./rig.ts";
import { setup } from "./harness.ts";
import { configureBuffer, dec } from "./unifont.ts";
import type { Enc } from "./unifont.ts";

export type Op = [string, ...unknown[]];
interface Expect { ret: number; events: string[]; state: string }

const APP_HWND = 0x00c0ffee;
const TYPES = { button: UCT.BUTTON, combobox: UCT.COMBOBOX, ime: UCT.IME_EDITBOX } as const;
const DIALOG_BOOLS = new Set([
  "m_bModal", "m_bEnable", "m_bShow", "m_bCloseOnFocusOut", "m_bEnableMoveByDrag", "m_bMouseDownForDrag", "m_bIsMouseOver",
  "m_bDisableUnderWindow", "m_bIsOverControl",
]);
const CONTROL_BOOLS = new Set(["m_bEnable", "m_bShow", "m_bOutofList", "m_bMouseOver", "m_bHasFocus", "m_bChecked", "m_bPressed", "m_bOpened", "m_bMousePointAdjust"]);
/** the two sounds a button holds (the oracle's fake pointers 0x5550 and 0x5554) */
const SOUND_UP = { id: "up" } as unknown as DeviceSound;
const SOUND_DOWN = { id: "down" } as unknown as DeviceSound;
const SOUND_CHECK = { id: "check" } as unknown as DeviceSound;

/** what `act_ctl` writes down of a control after the message: the key the oracle names a field with -> the member of the port that holds it */
const STATE_MEMBERS: Record<string, string> = {
  hasFocus: "m_bHasFocus", checked: "m_bChecked", pressed: "m_bPressed", rdown: "m_bRButtonDown",
  value: "m_nValue", dragX: "m_nDragX", dragOffset: "m_nDragOffset", buttonX: "m_nButtonX", button: "m_rcButton", box: "m_rcBoundingBox",
  pos: "m_nPosition", arrow: "m_Arrow", arrowTS: "m_dArrowTS", upClicked: "m_bIsUpButtonClicked", downClicked: "m_bIsDownButtonClicked",
  drag: "m_bDrag", showThumb: "m_bShowThumb", last: "m_LastMouse", thumb: "m_rcThumb",
  dragging: "m_bDraggingWindow", ptLast: "m_ptLastMouse", rcBG: "m_rcBG", rcWindow: "m_rcWindow",
  state: "m_eControlState",
  opened: "m_bOpened", selected: "m_iSelected", focused: "m_iFocused", adjust: "m_bMousePointAdjust",
  sel: "m_nSelected", start: "m_nSelStart",
  caret: "m_nCaret", selstart: "m_nSelStart", first: "m_nFirstVisible", insert: "m_bInsertMode", caretOn: "m_bCaretOn", blink: "m_dfLastBlink", mdrag: "m_bMouseDrag",
};

/** a text as the oracle writes it into a state: the printable ASCII but the space and `%` as they are, every UTF-16 unit else as `%XXXX` (null: `null`) */
function escText(t: string | null): string {
  if (t === null) return "null";
  let out = "";
  for (let i = 0; i < t.length; i++) {
    const c = t.charCodeAt(i);
    out += c >= 0x21 && c <= 0x7e && c !== 0x25 ? t[i]! : `%${c.toString(16).toUpperCase().padStart(4, "0")}`;
  }
  return out;
}

/** what the script says of an edit box (`EditOracle.edit_`) */
interface EditSpec {
  rect: number[]; quad: number[][] | null; offset: number[]; text: Enc; size: number; caret: number; sel: number; first: number; insert: boolean; caretOn: boolean;
  blink: number; drag: boolean; enable: boolean; show: boolean; enableInput: boolean; change: number; enter: number; focusOut: number; sound: boolean;
  rcText: number[]; lengthLimit: number; oneChar: boolean; onlyNum: boolean; widthLimit: number; lineLimit: number; autoUpper: boolean; byteLimit: boolean;
  byteMax: number; hasFocus: boolean;
}

function showField(v: unknown): string {
  if (typeof v === "boolean") return String(+v);
  if (v !== null && typeof v === "object") {
    const o = v as Record<string, number>;
    return "left" in o ? `${o.left},${o.top},${o.right},${o.bottom}` : `${o.x},${o.y}`;
  }
  return String(v);
}

/** the text of the state the oracle wrote (`want`), as the port reads it: the same keys, in the same order */
function stateOf(w: ReturnType<typeof setup>["w"], c: CKTDGUIControl, want: string, focus: string, labelOf: (v: unknown) => string, clip = "null"): string {
  return want.split(" ").map((kv) => {
    const key = kv.slice(0, kv.indexOf("="));
    if (key === "focus") return `focus=${focus}`;
    // an edit box: its buffer's text, room and flag, and what is on the clipboard
    if (key === "text") return `text=${escText((c as CKTDGUIEditBox).m_Buffer.m_pwszBuffer)}`;
    if (key === "size") return `size=${(c as CKTDGUIEditBox).m_Buffer.m_nBufferSize}`;
    if (key === "analyse") return `analyse=${+(c as CKTDGUIEditBox).m_Buffer.m_bAnalyseRequired}`;
    if (key === "clip") return `clip=${clip}`;
    // a slot: the slot that was dropped on it and the one that is being dragged (`s_pDragSlot`), by label (none: null)
    if (key === "dropped") return `dropped=${(c as CKTDGUISlot).m_pDroppedSlot === null ? "none" : labelOf((c as CKTDGUISlot).m_pDroppedSlot)}`;
    if (key === "dragSlot") return `dragSlot=${CKTDGUISlot.s_pDragSlot === null ? "none" : labelOf(CKTDGUISlot.s_pDragSlot)}`;
    if (key === "down") return `down=${+c.m_pDialog!.m_bMouseDownForDrag}`;
    if (key === "thumbOffsetY") return `thumbOffsetY=${w.statics.thumbOffsetY}`;
    if (key === "btnOffset") return `btnOffset=${(c as CKTDGUIComboBox).m_ButtonOffsetX},${(c as CKTDGUIComboBox).m_ButtonOffsetY}`;
    // a list box: the rows' flags (selected, shown) as a string of 0 / 1 and the time left of each row, equal neighbours grouped (`7.5*3|50`)
    if (key === "rows") return `rows=${(c as CKTDGUIListBox).m_Items.map((r) => +r.bSelected).join("")}`;
    if (key === "shown") return `shown=${(c as CKTDGUIListBox).m_Items.map((r) => +r.m_bShow).join("")}`;
    if (key === "left") {
      const groups: [string, number][] = [];
      for (const r of (c as CKTDGUIListBox).m_Items) {
        const text = String(r.m_fTimeLeftShow);
        const last = groups[groups.length - 1];
        if (last !== undefined && last[0] === text) last[1]++;
        else groups.push([text, 1]);
      }
      return `left=${groups.map(([t, n]) => (n === 1 ? t : `${t}*${n}`)).join("|")}`;
    }
    if (key === "winPoint") { // the eight floats of the navigation's window point, corner by corner
      const p = (c as CKTDGUINavigation).m_pWindowPoint!;
      return `winPoint=${[p.leftTopPoint, p.rightTopPoint, p.leftBottomPoint, p.rightBottomPoint].map((v) => `${v.x},${v.y}`).join(",")}`;
    }
    return `${key}=${showField((c as unknown as Record<string, unknown>)[STATE_MEMBERS[key]!])}`;
  }).join(" ");
}

/** a control whose input is written down and answered as the case says (the exe's stub of the same name) */
class Probe extends CKTDGUIControl {
  readonly answers: { mouse?: number; key?: number; msg?: number } = {};
  readonly effects: { mouse?: () => void } = {};
  /** what a scroll bar has that a combo box or a list box asks (`m_nPosition`, `m_nPageSize`, `Scroll`): the probe is the bar of the case's box */
  m_nPosition = 0;
  m_nPageSize = 0;
  constructor(w: ConstructorParameters<typeof CKTDGUIControl>[0], readonly label: string, private readonly log: string[]) {
    super(w);
    this.m_Name = label;
  }
  scroll(delta: number): void {
    this.log.push(`${this.label}.scroll(${delta})`);
  }
  override handleMouse(uMsg: number, x: number, y: number, wParam: number, lParam: number): boolean {
    // the oracle writes the arguments as the signed 32-bit numbers they are on the stack
    this.log.push(`${this.label}.mouse(${uMsg},${x},${y},${wParam | 0},${lParam | 0})`);
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
  let dxutTime = 0;
  const scaleOp = ops.find((op) => op[0] === "scale") as [string, number, number] | undefined;
  // a scale other than 1 needs a render: the back buffer of (1024 * x, 768 * y) pixels makes the scale (x, y) (1536 x 1536: (1.5, 2)); without one the layout is not scaled
  const { w } = scaleOp
    ? rig({ backBuffer: { width: scaleOp[1] * 1024, height: scaleOp[2] * 768 }, tickCount: () => now })
    : setup(undefined, { tickCount: () => now });
  const dialogs = new Map<string, CKTDGUIDialog>();
  const controls = new Map<string, CKTDGUIControl>();
  const labelOf = (v: unknown): string => {
    for (const [name, d] of dialogs) if (d === v) return name;
    for (const [name, c] of controls) if (c === v) return name;
    return typeof v === "number" ? String(v) : v === null ? "0" : "?";
  };
  // `watch`: a message of a slot is written down with the slot's m_pDroppedSlot of that moment (what the stage's handler sees)
  let watchDropped = false;
  const stage: UIStage = {
    MsgProc: (msg: number, wParam: number | string, lParam: unknown) => {
      let seen = watchDropped && lParam instanceof CKTDGUISlot ? `[dropped=${lParam.m_pDroppedSlot === null ? "none" : labelOf(lParam.m_pDroppedSlot)}]` : "";
      // a combo box's message is written down with its selection of that moment (the handler may ask for it)
      if (lParam instanceof CKTDGUIComboBox) seen = `[sel=${lParam.m_iSelected} foc=${lParam.m_iFocused} open=${+lParam.m_bOpened}]`;
      // a list box's message with its selection and the rows' flags of that moment
      if (lParam instanceof CKTDGUIListBox) seen = `[sel=${lParam.m_nSelected} start=${lParam.m_nSelStart} rows=${lParam.m_Items.map((r) => +r.bSelected).join("")}]`;
      // an edit box's message with its text, caret, selection, first visible character, caret flag and blink time of that moment
      if (lParam instanceof CKTDGUIEditBox) {
        seen = `[text=${escText(lParam.m_Buffer.m_pwszBuffer)} caret=${lParam.m_nCaret} sel=${lParam.m_nSelStart} first=${lParam.m_nFirstVisible} on=${+lParam.m_bCaretOn} blink=${lParam.m_dfLastBlink}]`;
      }
      log.push(`stage(${msg},${wParam},${labelOf(lParam)})${seen}`);
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
  // the timer of an edit box's scene: the n-th call answers base + step * n (and is written down); a scene without one has the fixed time of `time`
  let timer: { base: number; step: number; calls: number } | null = null;
  w.devices.absoluteTime = () => {
    if (timer === null) return dxutTime;
    log.push("time");
    return timer.base + timer.step * timer.calls++;
  };
  // GetKeyState: the SHORT the script says for a key (up: 0), written down
  const keyStates = new Map<number, number>();
  w.getKeyState = (vk: number) => {
    log.push(`ks(${vk})`);
    return ((keyStates.get(vk) ?? 0) << 16) >> 16;
  };
  // the clipboard: what it holds, whether another program has it open, whether the block it holds cannot be locked
  const clip = { text: null as string | null, busy: false, lockFails: false };
  const clipboard: UIClipboard = {
    open: () => {
      log.push("clip.open");
      return !clip.busy;
    },
    empty: () => {
      log.push("clip.empty");
      clip.text = null;
    },
    setText: (text: string) => {
      clip.text = text;
      log.push(`clip.set(${escText(text)})`);
    },
    getText: () => {
      log.push("clip.get");
      return clip.lockFails ? null : clip.text;
    },
    close: () => void log.push("clip.close"),
  };
  w.clipboard = clipboard;
  // the errors a text buffer writes to the log: `error 42` or `error 42 text`
  (w.devices.massFiles.log as { push: (id: number, text?: string) => void }).push = (id, text) => void log.push(text === undefined ? `error ${id}` : `error ${id} ${text}`);
  w.setCapture = () => void log.push("capture");
  w.releaseCapture = () => void log.push("release");
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
        case "checkbox": {
          const [label, , o] = a as [string, string, {
            rect: number[]; enable: boolean; show: boolean; checked: boolean; pressed: boolean; msgChecked: number; msgUnchecked: number;
            funcChecked: string; funcUnchecked: string;
          }];
          const c = new CKTDGUICheckBox(w);
          c.m_Name = label;
          setQuad(c, o.rect);
          c.m_bEnable = o.enable;
          c.m_bShow = o.show;
          c.m_bChecked = o.checked;
          c.m_bPressed = o.pressed;
          c.m_CustomMsgChecked = o.msgChecked;
          c.m_CustomMsgUnChecked = o.msgUnchecked;
          c.m_CustomFuncChecked = o.funcChecked;
          c.m_CustomFuncUnChecked = o.funcUnchecked;
          c.m_pSndCheck = SOUND_CHECK;
          c.playSound = (s) => void log.push(`${label}.sound(${s === SOUND_CHECK ? "check" : "none"})`);
          controls.set(label, c);
          break;
        }
        case "radio": {
          const [label, , o] = a as [string, string, {
            rect: number[]; group: number; enable: boolean; show: boolean; checked: boolean; pressed: boolean; rdown: boolean; dbl: boolean;
            toggle: boolean; rmsg: number;
          }];
          const c = new CKTDGUIRadioButton(w);
          c.m_Name = label;
          setQuad(c, o.rect);
          c.m_GroupID = o.group;
          c.m_bEnable = o.enable;
          c.m_bShow = o.show;
          c.m_bChecked = o.checked;
          c.m_bPressed = o.pressed;
          c.m_bRButtonDown = o.rdown;
          c.m_bEnableDoubleClick = o.dbl;
          c.m_bEnableCheckToggle = o.toggle;
          c.m_CustomMsgRButtonUp = o.rmsg;
          c.m_pSndCheck = SOUND_CHECK;
          c.playSound = (s) => void log.push(`${label}.sound(${s === SOUND_CHECK ? "check" : "none"})`);
          c.setCheckedInternal = (checked, double, input) => {
            c.m_bChecked = checked;
            log.push(`${label}.setChecked(${+checked},${+double},${+input})`);
          };
          controls.set(label, c);
          break;
        }
        case "slider": {
          const [label, , o] = a as [string, string, {
            x: number; y: number; width: number; height: number; bw: number; bh: number; value: number; min: number; max: number; msg: number;
            pressed: boolean; enable: boolean; show: boolean; update: boolean;
          }];
          const c = new CKTDGUISlider(w);
          c.m_Name = label;
          c.m_x = o.x;
          c.m_y = o.y;
          c.m_width = o.width;
          c.m_height = o.height;
          c.m_iButtonWidth = o.bw;
          c.m_iButtonHeight = o.bh;
          c.m_nValue = o.value;
          c.m_nMin = o.min;
          c.m_nMax = o.max;
          c.m_CustomMsgValueChanged = o.msg;
          c.m_bPressed = o.pressed;
          c.m_bEnable = o.enable;
          c.m_bShow = o.show;
          if (o.update) c.updateRects();
          controls.set(label, c);
          break;
        }
        case "scrollbar": {
          const [label, , o] = a as [string, string, {
            x: number; y: number; width: number; height: number; pos: number; page: number; start: number; end: number; enable: boolean;
            show: boolean; thumb: boolean; track: boolean; sound: boolean;
          }];
          const c = new CKTDGUIScrollBar(w);
          c.m_Name = label;
          c.m_x = o.x;
          c.m_y = o.y;
          c.m_width = o.width;
          c.m_height = o.height;
          c.m_nPosition = o.pos;
          c.m_nPageSize = o.page;
          c.m_nStart = o.start;
          c.m_nEnd = o.end;
          c.m_bEnable = o.enable;
          c.m_bShow = o.show;
          c.m_bEnableThumb = o.thumb;
          c.m_bEnableTrack = o.track;
          c.m_pSndMouseDown = o.sound ? SOUND_DOWN : undefined;
          c.playSound = (s) => void log.push(`${label}.sound(${s === SOUND_DOWN ? "down" : "none"})`);
          c.updateRects();
          controls.set(label, c);
          break;
        }
        case "contollist": { // a control list: the scroll bars are controls the case made before (the ones that write their calls down)
          const [label, , o] = a as [string, string, { x: string | null; y: string | null; enable: boolean; show: boolean }];
          const c = new CKTDGUIContolList(w);
          c.m_Name = label;
          c.m_bEnable = o.enable;
          c.m_bShow = o.show;
          c.m_pScrollBarX = o.x === null ? null : (controls.get(o.x) as unknown as CKTDGUIScrollBar);
          c.m_pScrollBarY = o.y === null ? null : (controls.get(o.y) as unknown as CKTDGUIScrollBar);
          controls.set(label, c);
          break;
        }
        case "combo": {
          const [label, , o] = a as [string, string, {
            box: number[]; drop: number[]; items: [number[], boolean, string | null][]; bar: string | null; selected: number; focused: number; opened: boolean;
            pressed: boolean; enable: boolean; show: boolean; selMsg: number; openMsg: number; closeMsg: number; sound: boolean; adjust: boolean; btnOff: number[];
          }];
          const c = new CKTDGUIComboBox(w);
          c.m_Name = label;
          const rect4 = (v: number[]): [number, number, number, number] => [v[0]!, v[1]!, v[2]!, v[3]!];
          setRect(c.m_rcBoundingBox2, ...rect4(o.box));
          setRect(c.m_rcDropdown, ...rect4(o.drop));
          for (const [rect, visible, control] of o.items) {
            const rc = newRect();
            setRect(rc, ...rect4(rect));
            c.m_Items.push({ strText: "", pData: null, rcActive: rc, bVisible: visible, pControl: control === null ? null : controls.get(control)! });
          }
          c.m_pScrollBar = o.bar === null ? null : (controls.get(o.bar) as unknown as CKTDGUIScrollBar);
          c.m_iSelected = o.selected;
          c.m_iFocused = o.focused;
          c.m_bOpened = o.opened;
          c.m_bPressed = o.pressed;
          c.m_bEnable = o.enable;
          c.m_bShow = o.show;
          c.m_CustomMsgSelectionChanged = o.selMsg;
          c.m_CustomMsgOpenDropdown = o.openMsg;
          c.m_CustomMsgCloseDropdown = o.closeMsg;
          c.m_pSndButtonMouseDown = o.sound ? SOUND_DOWN : undefined;
          c.m_bMousePointAdjust = o.adjust;
          c.m_ButtonOffsetX = o.btnOff[0]!;
          c.m_ButtonOffsetY = o.btnOff[1]!;
          c.playSound = (s) => void log.push(`${label}.sound(${s === SOUND_DOWN ? "down" : "none"})`);
          controls.set(label, c);
          break;
        }
        case "list": {
          const [label, , o] = a as [string, string, {
            sel: number[]; text: number[]; th: number; items: [boolean, string | null, boolean, number][]; bar: string | null; style: number; selected: number;
            start: number; drag: boolean; atMove: boolean; disappear: boolean; ignore: boolean; enable: boolean; show: boolean; selMsg: number; dblMsg: number;
            endMsg: number; rMsg: number; sound: boolean;
          }];
          const c = new CKTDGUIListBox(w);
          c.m_Name = label;
          const rect4 = (v: number[]): [number, number, number, number] => [v[0]!, v[1]!, v[2]!, v[3]!];
          setRect(c.m_rcSelection, ...rect4(o.sel));
          setRect(c.m_rcText, ...rect4(o.text));
          c.m_nTextHeight = o.th;
          for (const [flag, control, shown, left] of o.items) {
            c.addItem("", null, 0, 0, false, 0);
            const row = c.getLastItem()!;
            row.bSelected = flag;
            row.pControl = control === null ? null : controls.get(control)!;
            row.m_bShow = shown;
            row.m_fTimeLeftShow = left;
          }
          c.m_pScrollBar = o.bar === null ? null : (controls.get(o.bar) as unknown as CKTDGUIScrollBar);
          c.m_dwStyle = o.style;
          c.m_nSelected = o.selected;
          c.m_nSelStart = o.start;
          c.m_bDrag = o.drag;
          c.m_bIsSelectItemAtMouseMove = o.atMove;
          c.m_bUseItemDisappear = o.disappear;
          c.m_bIgnoreListClick = o.ignore;
          c.m_bEnable = o.enable;
          c.m_bShow = o.show;
          c.m_CustomMsgSelection = o.selMsg;
          c.m_CustomMsgItemDoubleClick = o.dblMsg;
          c.m_CustomMsgSelection_End = o.endMsg;
          c.m_CustomMsgSelectionByRButton = o.rMsg;
          c.m_pSndMouseDown = o.sound ? SOUND_DOWN : undefined;
          c.playSound = (s) => void log.push(`${label}.sound(${s === SOUND_DOWN ? "down" : "none"})`);
          controls.set(label, c);
          break;
        }
        case "wheel": // the operating system's lines per notch; asking is written down
          w.wheelScrollLines = () => {
            log.push("spi");
            return a[0] as number;
          };
          break;
        case "navigation": {
          const [label, , o] = a as [string, string, {
            bg: number[]; win: number[]; enable: boolean; show: boolean; drag: boolean; last: number[]; downMsg: number; dragMsg: number;
            sound: boolean; refresh: boolean;
          }];
          const c = new CKTDGUINavigation(w);
          c.m_Name = label;
          const point = (r: number[]): UIPointData => {
            const p = new UIPointData();
            p.leftTopPoint.set(r[0]!, r[1]!);
            p.rightTopPoint.set(r[2]!, r[1]!);
            p.leftBottomPoint.set(r[0]!, r[3]!);
            p.rightBottomPoint.set(r[2]!, r[3]!);
            return p;
          };
          const cut = (rc: { left: number; top: number; right: number; bottom: number }, r: number[]): void => {
            Object.assign(rc, { left: Math.trunc(r[0]!), top: Math.trunc(r[1]!), right: Math.trunc(r[2]!), bottom: Math.trunc(r[3]!) });
          };
          c.m_pBGPoint = point(o.bg);
          c.m_pWindowPoint = point(o.win);
          if (o.refresh) {
            cut(c.m_rcBG, o.bg);
            cut(c.m_rcWindow, o.win);
          }
          c.m_bEnable = o.enable;
          c.m_bShow = o.show;
          c.m_bDraggingWindow = o.drag;
          c.m_ptLastMouse.x = o.last[0]!;
          c.m_ptLastMouse.y = o.last[1]!;
          c.m_CustomMsgLButtonDown = o.downMsg;
          c.m_CustomMsgMouseDragging = o.dragMsg;
          c.m_pSndMouseDown = o.sound ? SOUND_DOWN : undefined;
          c.playSound = (s) => void log.push(`${label}.sound(${s === SOUND_DOWN ? "down" : "none"})`);
          controls.set(label, c);
          break;
        }
        case "put": { // a field of a slider or a scroll bar: a number, a flag (0 / 1), a rectangle or a point (a list)
          const [label, field, value] = a as [string, string, number | number[]];
          const c = controls.get(label) as unknown as Record<string, unknown>;
          const cur = c[field];
          if (typeof cur === "boolean") c[field] = value !== 0;
          else if (Array.isArray(value) && value.length === 4) Object.assign(cur as object, { left: value[0], top: value[1], right: value[2], bottom: value[3] });
          else if (Array.isArray(value)) Object.assign(cur as object, { x: value[0], y: value[1] });
          else c[field] = value;
          break;
        }
        case "time":
          dxutTime = a[0] as number;
          break;
        case "thumbOffset":
          w.statics.thumbOffsetY = a[0] as number;
          break;
        case "timer": // the n-th call of GetAbsoluteTime from now on answers base + step * n
          timer = { base: a[0] as number, step: a[1] as number, calls: 0 };
          break;
        case "keys": // the SHORT GetKeyState answers for each key (the others: 0)
          keyStates.clear();
          for (const [vk, value] of Object.entries(a[0] as Record<string, number>)) keyStates.set(Number(vk), value);
          break;
        case "clip": // what the clipboard holds (null: no text), whether it is busy, whether the block cannot be locked
          clip.text = dec(a[0] as Enc);
          clip.busy = a[1] as boolean;
          clip.lockFails = a[2] as boolean;
          break;
        case "edit": {
          const [label, , o] = a as [string, string, EditSpec];
          const e = new CKTDGUIEditBox(w);
          e.m_Name = label;
          if (o.quad !== null) {
            const [lt, rt, lb, rb] = o.quad as [number[], number[], number[], number[]];
            e.m_NowPoint.leftTopPoint.set(lt[0]!, lt[1]!);
            e.m_NowPoint.rightTopPoint.set(rt[0]!, rt[1]!);
            e.m_NowPoint.leftBottomPoint.set(lb[0]!, lb[1]!);
            e.m_NowPoint.rightBottomPoint.set(rb[0]!, rb[1]!);
          } else setQuad(e, o.rect);
          e.m_OffsetPos.set(o.offset[0]!, o.offset[1]!);
          e.m_bShow = o.show;
          e.m_bEnable = o.enable;
          e.m_bHasFocus = o.hasFocus;
          e.m_CustomMsgEditBoxChange = o.change;
          e.m_CustomMsgEditBoxEnter = o.enter;
          e.m_CustomMsgEditBoxFocusOut = o.focusOut;
          e.m_bEnableInput = o.enableInput;
          // the buffer the oracle builds: no number-and-letter mode, a font of 17 / 1, nothing hidden, nothing to analyse
          configureBuffer(e.m_Buffer, {
            text: o.text, size: o.size, lengthLimit: o.lengthLimit, oneChar: o.oneChar, onlyNum: o.onlyNum, widthLimit: o.widthLimit, lineLimit: o.lineLimit,
            onlyNumEnglish: false, checkCase: false, big: true, byteLimit: o.byteLimit, byteMax: o.byteMax, autoUpper: o.autoUpper, hide: [false, 0], font: [17, 1],
            analyse: false,
          }, w.render?.resolutionScale ?? { x: 1, y: 1 });
          Object.assign(e.m_rcText, { left: o.rcText[0], top: o.rcText[1], right: o.rcText[2], bottom: o.rcText[3] });
          e.m_dfLastBlink = o.blink;
          e.m_bCaretOn = o.caretOn;
          e.m_nCaret = o.caret;
          e.m_bInsertMode = o.insert;
          e.m_nSelStart = o.sel;
          e.m_nFirstVisible = o.first;
          e.m_bMouseDrag = o.drag;
          e.m_pSndKeyDown = o.sound ? SOUND_DOWN : undefined;
          e.playSound = (s) => void log.push(`${label}.sound(${s === SOUND_DOWN ? "down" : "none"})`);
          controls.set(label, e);
          break;
        }
        case "group": {
          const [dialog, id, max] = a as [string, number, number];
          const info = new RadioButtonGroupInfo(id);
          info.m_iMaxCheckCount = max;
          dialogOf(dialog).m_mapRadioButtonGroupInfo.set(id, info);
          break;
        }
        case "slotctl": { // a slot as a control: the state it is in, the custom messages, the sounds, the guide text's position, the mouse-over point
          const [label, , o] = a as [string, string, {
            rect: number[]; enable: boolean; show: boolean; state: number; dragable: boolean; down: number; up: number; rightUp: number; drop: number;
            sndUp: boolean; sndDown: boolean; guide: (number | string)[]; offset: (number | string)[]; over: number[] | null;
          }];
          const c = new CKTDGUISlot(w);
          c.m_Name = label;
          setQuad(c, o.rect);
          c.m_bEnable = o.enable;
          c.m_bShow = o.show;
          c.m_eControlState = o.state;
          c.m_bDragable = o.dragable;
          c.m_CustomMsgMouseDown = o.down;
          c.m_CustomMsgMouseUp = o.up;
          c.m_CustomMsgMouseRightUp = o.rightUp;
          c.m_CustomMsgDropped = o.drop;
          c.m_pSndMouseUp = o.sndUp ? SOUND_UP : undefined;
          c.m_pSndMouseDown = o.sndDown ? SOUND_DOWN : undefined;
          c.m_vGuideDescAbsolutePos.set(Number(o.guide[0]), Number(o.guide[1]));
          c.m_vGuideDescOffsetPos.set(Number(o.offset[0]), Number(o.offset[1]));
          if (o.over !== null) { // the eight coordinates: left-top, right-top, left-bottom, right-bottom
            const p = new UIPointData();
            const v = o.over as [number, number, number, number, number, number, number, number];
            p.leftTopPoint.set(v[0], v[1]);
            p.rightTopPoint.set(v[2], v[3]);
            p.leftBottomPoint.set(v[4], v[5]);
            p.rightBottomPoint.set(v[6], v[7]);
            c.m_pMouseOverPoint = p;
          }
          c.playSound = (s) => void log.push(`${label}.sound(${s === SOUND_UP ? "up" : s === SOUND_DOWN ? "down" : "none"})`);
          c.ChangeState = (state, force) => void log.push(`${label}.change(${state},${+force})`);
          controls.set(label, c);
          break;
        }
        case "watch":
          watchDropped = a[0] as boolean;
          break;
        case "dragslot": // `CKTDGUISlot::s_pDragSlot` is this slot (null: nobody)
          CKTDGUISlot.s_pDragSlot = a[0] === null ? null : (controls.get(a[0] as string) as CKTDGUISlot);
          break;
        case "putGuide": { // the guide text's absolute position and offset of any control
          const [label, guide, offset] = a as [string, (number | string)[], (number | string)[]];
          const c = controls.get(label)!;
          c.m_vGuideDescAbsolutePos.set(Number(guide[0]), Number(guide[1]));
          c.m_vGuideDescOffsetPos.set(Number(offset[0]), Number(offset[1]));
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
          // the keys of the state are the ones the oracle wrote down for this kind of control
          expect([name, +ret, log.slice(), stateOf(w, c, want.state, focusLabel(), labelOf)]).toEqual([name, want.ret, want.events, want.state]);
          break;
        }
        case "act_out": { // OnFocusOut()
          const [name, label, want] = a as [string, string, Expect];
          const c = controls.get(label)!;
          log.length = 0;
          c.onFocusOut();
          expect([name, 0, log.slice(), stateOf(w, c, want.state, focusLabel(), labelOf)]).toEqual([name, want.ret, want.events, want.state]);
          break;
        }
        case "act_hotkey": { // OnHotkey() of a combo box
          const [name, label, want] = a as [string, string, Expect];
          const c = controls.get(label) as CKTDGUIComboBox;
          log.length = 0;
          c.onHotkey();
          expect([name, 0, log.slice(), stateOf(w, c, want.state, focusLabel(), labelOf)]).toEqual([name, want.ret, want.events, want.state]);
          break;
        }
        case "act_listproc": { // the list box's own MsgProc(uMsg, wParam, lParam)
          const [name, label, args, want] = a as [string, string, number[], Expect];
          const c = controls.get(label) as CKTDGUIListBox;
          log.length = 0;
          const ret = c.listBoxMsgProc(args[0]!, args[1]!, args[2]!);
          expect([name, +ret, log.slice(), stateOf(w, c, want.state, focusLabel(), labelOf)]).toEqual([name, want.ret, want.events, want.state]);
          break;
        }
        case "act_edit": { // a call to an edit box: the virtual function `what` (key, msg, mouse, out) or a member (contain, clear, delete, copy, paste, place)
          const [name, label, what, args, want] = a as [string, string, string, number[], Expect];
          const e = controls.get(label) as CKTDGUIEditBox;
          log.length = 0;
          let ret = 0;
          switch (what) {
            case "key": ret = +e.handleKeyboard(args[0]!, args[1]!, args[2]!); break;
            case "msg": ret = +e.msgProc(APP_HWND, args[0]!, args[1]!, args[2]!); break;
            case "mouse": ret = +e.handleMouse(args[0]!, args[1]!, args[2]!, args[3]!, args[4]!); break;
            case "out": e.onFocusOut(); break;
            case "contain": ret = +e.ContainPTForEditBox(args[0]! | 0, args[1]! | 0); break;
            case "clear": e.ClearText(); break;
            case "delete": e.DeleteSelectionText(); break;
            case "copy": e.CopyToClipboard(); break;
            case "paste": e.PasteFromClipboard(); break;
            case "place": e.PlaceCaret(args[0]! | 0); break;
            default: throw new Error(`unknown call ${what}`);
          }
          expect([name, ret, log.slice(), stateOf(w, e, want.state, focusLabel(), labelOf, escText(clip.text))]).toEqual([name, want.ret, want.events, want.state]);
          break;
        }
        case "act_guide": { // GetGuideDescPos() as the point `x,y`, or GetIsGuideDescAbsolutePos() as 0 / 1
          const [name, label, what, want] = a as [string, string, "pos" | "isAbsolute", string];
          const c = controls.get(label)!;
          let got: string;
          if (what === "pos") {
            const p = c.getGuideDescPos();
            got = `${p.x},${p.y}`;
          } else got = String(+c.getIsGuideDescAbsolutePos());
          expect([name, got]).toEqual([name, want]);
          break;
        }
        case "act_msg": { // the scroll bar's and the navigation's own MsgProc(uMsg, wParam, lParam)
          const [name, label, args, want] = a as [string, string, number[], Expect];
          const c = controls.get(label) as CKTDGUIScrollBar | CKTDGUINavigation;
          log.length = 0;
          const ret = c instanceof CKTDGUINavigation ? c.navigationMsgProc(args[0]!, args[1]!, args[2]!) : c.scrollBarMsgProc(args[0]!, args[1]!, args[2]!);
          expect([name, +ret, log.slice(), stateOf(w, c, want.state, focusLabel(), labelOf)]).toEqual([name, want.ret, want.events, want.state]);
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
