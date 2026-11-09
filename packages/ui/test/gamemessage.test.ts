import { describe, expect, test } from "bun:test";
import { STAGE_STATE } from "../src/index.ts";
import type { UIGameStage } from "../src/index.ts";
import { setup } from "./harness.ts";

/**
 * `CKTDXApp::SendGameMessage(uMsg, wParam, lParam, bDirectProcess)` (328CCCD0), as the controls reach it (`g_pKTDXApp->SendGameMessage`): a direct
 * message goes to the stages of `m_vecStageChain` that are active, in order, until one answers yes; any other message goes into the queue.  The
 * expected values are worked out by hand from the decompile: the loop `do { stage = chain[i]; if (stage->m_eStageState == 1) { r = stage->MsgProc(
 * hWnd, msg, wParam, lParam); if (r == 1) break; } ++i; } while (i < size)` (the size read again each time round), the result `r` of the last stage
 * asked (0 when none was), and for a queued message `m_GameMsgQ.push` and the result 1.
 */
describe("CKTDXApp::SendGameMessage (328CCCD0)", () => {
  const rigStages = (answers: (boolean | null)[], states: number[] = answers.map(() => STAGE_STATE.ACTIVE)) => {
    const { w } = setup();
    const asked: string[] = [];
    answers.forEach((answer, i) => {
      const stage: UIGameStage = {
        m_eStageState: states[i]!,
        MsgProc: answer === null ? undefined : (msg, wParam, lParam) => {
          asked.push(`${i}:${msg},${wParam},${String(lParam)}`);
          return answer;
        },
      };
      w.stageChain.push(stage);
    });
    return { w, asked };
  };

  test("an empty chain has nobody to ask: no", () => {
    const { w } = setup();
    expect(w.sendGameMessage(0x466, 2, "L", true)).toBe(false);
  });

  test("the stages are asked in order until one answers yes; the ones after it are not asked", () => {
    const { w, asked } = rigStages([false, true, true]);
    expect(w.sendGameMessage(0x466, 2, "L", true)).toBe(true);
    expect(asked).toEqual(["0:1126,2,L", "1:1126,2,L"]);
  });

  test("when nobody says yes every active stage was asked and the answer is the last one's", () => {
    const { w, asked } = rigStages([false, false, false]);
    expect(w.sendGameMessage(0x467, 9, "L", true)).toBe(false);
    expect(asked).toEqual(["0:1127,9,L", "1:1127,9,L", "2:1127,9,L"]);
  });

  test("only an active stage is asked (0 null, 1 active, 2 deactivated, 3 ready to be deleted); the answer is that of the last stage asked", () => {
    const { w, asked } = rigStages([true, false, true, true], [STAGE_STATE.NULL, STAGE_STATE.ACTIVE, STAGE_STATE.DEACTIVE, STAGE_STATE.READY_TO_DELETE]);
    expect(w.sendGameMessage(0x466, 1, "L", true)).toBe(false);
    expect(asked).toEqual(["1:1126,1,L"]);
    const none = rigStages([true], [STAGE_STATE.DEACTIVE]);
    expect(none.w.sendGameMessage(0x466, 1, "L", true)).toBe(false);
    expect(none.asked).toEqual([]);
  });

  test("a stage without a message proc answers no", () => {
    const { w, asked } = rigStages([null, true]);
    expect(w.sendGameMessage(0x466, 1, "L", true)).toBe(true);
    expect(asked).toEqual(["1:1126,1,L"]);
  });

  test("the chain is read again after each call: a stage that a message proc adds to the end is asked too", () => {
    const { w, asked } = rigStages([false, false]);
    const late: UIGameStage = { m_eStageState: STAGE_STATE.ACTIVE, MsgProc: () => { asked.push("late"); return true; } };
    const first = w.stageChain[0]!;
    const proc = first.MsgProc!;
    first.MsgProc = (m, wp, lp) => {
      w.stageChain.push(late);
      return proc(m, wp, lp);
    };
    expect(w.sendGameMessage(0x466, 3, "L", true)).toBe(true);
    expect(asked).toEqual(["0:1126,3,L", "1:1126,3,L", "late"]);
  });

  test("a message that is not direct is queued: nobody is asked, the answer is yes", () => {
    const { w, asked } = rigStages([true]);
    expect(w.sendGameMessage(0x46a, 5, "L", false)).toBe(true);
    expect(asked).toEqual([]);
    expect(w.gameMessages).toEqual([{ uMsg: 0x46a, wParam: 5, lParam: "L" }]);
    w.sendGameMessage(0x466, 6, "M", false);
    expect(w.gameMessages.map((m) => [m.uMsg, m.wParam])).toEqual([[0x46a, 5], [0x466, 6]]);
  });
});
