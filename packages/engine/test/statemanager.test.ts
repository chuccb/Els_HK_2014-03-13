/**
 * `CKTDGStateManager` / `KD3DStack` (x2.exe 328D1BD0, 328D9980, 328D9B50 and the inlined `SetRenderState` ...): what the mirror holds,
 * when the device is called, and how the stack puts the old values back.
 */
import { describe, expect, test } from "bun:test";
import { D3DBLEND, D3DRS, D3DSAMP, D3DTA, D3DTADDRESS, D3DTEXF, D3DTOP, D3DTSS, NUM_SAMP, NUM_TSS } from "@els/d3d9";
import { CKTDGStateManager, KD3DStack, STATE_TYPE, akStates } from "../src/index.ts";
import type { KStateID, StateDevice } from "../src/index.ts";

/** a device that only writes down what it is told */
class Recorder implements StateDevice {
  readonly calls: string[] = [];
  SetRenderState(state: number, value: number): number {
    this.calls.push(`rs ${state} ${value}`);
    return 0;
  }
  SetTextureStageState(stage: number, type: number, value: number): number {
    this.calls.push(`tss ${stage} ${type} ${value}`);
    return 0;
  }
  SetSamplerState(sampler: number, type: number, value: number): number {
    this.calls.push(`ss ${sampler} ${type} ${value}`);
    return 0;
  }
}

const make = (): { dev: Recorder; sm: CKTDGStateManager } => {
  const dev = new Recorder();
  return { dev, sm: new CKTDGStateManager(dev) };
};

describe("CKTDGStateManager: the mirror", () => {
  test("starts as the values RestoreDeviceObjects writes (the Direct3D defaults of the tables aeDRS / aeDTSS / aeDSSS)", () => {
    const { sm } = make();
    expect(sm.adwRenderState[D3DRS.ZENABLE]).toBe(1);
    expect(sm.adwRenderState[D3DRS.ALPHABLENDENABLE]).toBe(0);
    expect(sm.adwRenderState[D3DRS.SRCBLEND]).toBe(D3DBLEND.ONE);
    expect(sm.adwRenderState[D3DRS.DESTBLEND]).toBe(D3DBLEND.ZERO);
    expect(sm.adwTextureStageState[D3DTSS.COLOROP]).toBe(D3DTOP.MODULATE);
    expect(sm.adwTextureStageState[NUM_TSS + D3DTSS.COLOROP]).toBe(D3DTOP.DISABLE);
    expect(sm.adwSamplerState[D3DSAMP.MINFILTER]).toBe(D3DTEXF.POINT);
    expect(sm.adwSamplerState[D3DSAMP.ADDRESSU]).toBe(D3DTADDRESS.WRAP);
    expect(sm.adwSamplerState.length).toBe(16 * NUM_SAMP);
    expect(sm.apd3dTextures.length).toBe(16);
    expect(sm.apd3dTextures.every((t) => t === null)).toBe(true);
    expect(sm.stackPointer).toBe(0);
  });

  test("a state is set on the device only when its value changes, and always pushed", () => {
    const { dev, sm } = make();
    sm.setRenderState(D3DRS.ALPHABLENDENABLE, 1);
    expect(dev.calls).toEqual([`rs ${D3DRS.ALPHABLENDENABLE} 1`]);
    expect(sm.adwRenderState[D3DRS.ALPHABLENDENABLE]).toBe(1);
    sm.setRenderState(D3DRS.ALPHABLENDENABLE, 1); // same value: no call, but the stack grows
    expect(dev.calls.length).toBe(1);
    expect(sm.stackPointer).toBe(2);
  });

  test("the texture-stage mirror is indexed 33 * stage + type, the sampler mirror 14 * stage + type", () => {
    const { dev, sm } = make();
    sm.setTextureStageState(1, D3DTSS.COLORARG1, D3DTA.DIFFUSE);
    sm.setSamplerState(1, D3DSAMP.MAGFILTER, D3DTEXF.LINEAR);
    expect(dev.calls).toEqual([`tss 1 ${D3DTSS.COLORARG1} ${D3DTA.DIFFUSE}`, `ss 1 ${D3DSAMP.MAGFILTER} ${D3DTEXF.LINEAR}`]);
    expect(sm.adwTextureStageState[33 * 1 + D3DTSS.COLORARG1]).toBe(D3DTA.DIFFUSE);
    expect(sm.adwTextureStageState[D3DTSS.COLORARG1]).toBe(D3DTA.TEXTURE); // stage 0 is untouched
    expect(sm.adwSamplerState[14 * 1 + D3DSAMP.MAGFILTER]).toBe(D3DTEXF.LINEAR);
    expect(sm.adwSamplerState[D3DSAMP.MAGFILTER]).toBe(D3DTEXF.POINT);
  });

  test("a value is an unsigned 32 bit number (a negative one is its bit pattern)", () => {
    const { dev, sm } = make();
    sm.setRenderState(D3DRS.AMBIENT, -1);
    expect(dev.calls).toEqual([`rs ${D3DRS.AMBIENT} 4294967295`]);
    expect(sm.adwRenderState[D3DRS.AMBIENT]).toBe(0xffffffff);
  });
});

describe("KD3DStack", () => {
  test("the destructor puts the old values back, newest first, and calls the device only for a state that is not at its old value", () => {
    const { dev, sm } = make();
    const stack = new KD3DStack(sm);
    expect(stack.m_iStackTop).toBe(0);
    sm.setRenderState(D3DRS.ZENABLE, 0);
    sm.setRenderState(D3DRS.ZENABLE, 1); // back to the start value by hand
    sm.setRenderState(D3DRS.CULLMODE, 1);
    dev.calls.length = 0;
    stack.dispose();
    // newest first: CULLMODE back to 3; the second ZENABLE entry (old value 0) and then the first (old value 1) undo each other's change
    expect(dev.calls).toEqual([`rs ${D3DRS.CULLMODE} 3`, `rs ${D3DRS.ZENABLE} 0`, `rs ${D3DRS.ZENABLE} 1`]);
    expect(sm.stackPointer).toBe(0);
    expect(sm.adwRenderState[D3DRS.ZENABLE]).toBe(1);
    expect(sm.adwRenderState[D3DRS.CULLMODE]).toBe(3);
  });

  test("nothing is called for a push that changed nothing", () => {
    const { dev, sm } = make();
    const stack = new KD3DStack(sm);
    sm.setRenderState(D3DRS.ZWRITEENABLE, 1); // already 1
    sm.setSamplerState(0, D3DSAMP.ADDRESSU, D3DTADDRESS.WRAP); // already wrap
    expect(dev.calls).toEqual([]);
    stack.dispose();
    expect(dev.calls).toEqual([]);
    expect(sm.stackPointer).toBe(0);
  });

  test("a stack made later pops only its own entries", () => {
    const { dev, sm } = make();
    const outer = new KD3DStack(sm);
    sm.setRenderState(D3DRS.ALPHABLENDENABLE, 1);
    const inner = new KD3DStack(sm);
    expect(inner.m_iStackTop).toBe(1);
    sm.setRenderState(D3DRS.SRCBLEND, D3DBLEND.SRCALPHA);
    sm.setRenderState(D3DRS.DESTBLEND, D3DBLEND.INVSRCALPHA);
    inner.dispose();
    expect(sm.stackPointer).toBe(1);
    expect(sm.adwRenderState[D3DRS.SRCBLEND]).toBe(D3DBLEND.ONE);
    expect(sm.adwRenderState[D3DRS.DESTBLEND]).toBe(D3DBLEND.ZERO);
    expect(sm.adwRenderState[D3DRS.ALPHABLENDENABLE]).toBe(1); // the outer one is still in force
    outer.dispose();
    expect(sm.adwRenderState[D3DRS.ALPHABLENDENABLE]).toBe(0);
    expect(dev.calls).toEqual([
      `rs ${D3DRS.ALPHABLENDENABLE} 1`,
      `rs ${D3DRS.SRCBLEND} ${D3DBLEND.SRCALPHA}`,
      `rs ${D3DRS.DESTBLEND} ${D3DBLEND.INVSRCALPHA}`,
      `rs ${D3DRS.DESTBLEND} ${D3DBLEND.ZERO}`,
      `rs ${D3DRS.SRCBLEND} ${D3DBLEND.ONE}`,
      `rs ${D3DRS.ALPHABLENDENABLE} 0`,
    ]);
  });

  test("a texture-stage and a sampler entry are restored through their own mirrors", () => {
    const { dev, sm } = make();
    const stack = new KD3DStack(sm);
    sm.setTextureStageState(0, D3DTSS.ALPHAOP, D3DTOP.MODULATE);
    sm.setSamplerState(1, D3DSAMP.ADDRESSV, D3DTADDRESS.MIRROR);
    dev.calls.length = 0;
    stack.dispose();
    expect(dev.calls).toEqual([`ss 1 ${D3DSAMP.ADDRESSV} ${D3DTADDRESS.WRAP}`, `tss 0 ${D3DTSS.ALPHAOP} ${D3DTOP.SELECTARG1}`]);
    expect(sm.adwTextureStageState[D3DTSS.ALPHAOP]).toBe(D3DTOP.SELECTARG1);
    expect(sm.adwSamplerState[14 + D3DSAMP.ADDRESSV]).toBe(D3DTADDRESS.WRAP);
  });

  test("KD3DStack(KStateID) sets a whole table in order and the destructor undoes it", () => {
    const { dev, sm } = make();
    const table: KStateID = [
      { m_eType: STATE_TYPE.RENDER, m_dwStage: 0, m_dwType: D3DRS.ALPHABLENDENABLE, m_dwValue: 1 },
      { m_eType: STATE_TYPE.TEXTURE_STAGE, m_dwStage: 0, m_dwType: D3DTSS.ALPHAOP, m_dwValue: D3DTOP.MODULATE },
      { m_eType: STATE_TYPE.SAMPLER, m_dwStage: 1, m_dwType: D3DSAMP.MINFILTER, m_dwValue: D3DTEXF.LINEAR },
      { m_eType: 9, m_dwStage: 0, m_dwType: 0, m_dwValue: 0 }, // an unknown type: skipped
    ];
    const stack = new KD3DStack(sm, table);
    expect(dev.calls).toEqual([
      `rs ${D3DRS.ALPHABLENDENABLE} 1`,
      `tss 0 ${D3DTSS.ALPHAOP} ${D3DTOP.MODULATE}`,
      `ss 1 ${D3DSAMP.MINFILTER} ${D3DTEXF.LINEAR}`,
    ]);
    expect(sm.stackPointer).toBe(3);
    dev.calls.length = 0;
    stack.dispose();
    expect(dev.calls).toEqual([`ss 1 ${D3DSAMP.MINFILTER} ${D3DTEXF.POINT}`, `tss 0 ${D3DTSS.ALPHAOP} ${D3DTOP.SELECTARG1}`, `rs ${D3DRS.ALPHABLENDENABLE} 0`]);
    expect(sm.stackPointer).toBe(0);
  });

  test("the same state pushed twice comes back through both old values", () => {
    const { dev, sm } = make();
    const stack = new KD3DStack(sm);
    sm.setRenderState(D3DRS.SRCBLEND, D3DBLEND.SRCALPHA);
    sm.setRenderState(D3DRS.SRCBLEND, D3DBLEND.ONE);
    dev.calls.length = 0;
    stack.dispose();
    expect(dev.calls).toEqual([`rs ${D3DRS.SRCBLEND} ${D3DBLEND.SRCALPHA}`, `rs ${D3DRS.SRCBLEND} ${D3DBLEND.ONE}`]);
  });
});

describe("akStates: the baseline CKTDGManager::OnResetDevice sets after RestoreDeviceObjects (x2.exe.c L140817)", () => {
  test("the table, as numbers: LIGHTING 0, SPECULAR 0, ALPHABLEND 0, ALPHATEST 1, Z 1 / 1, CULL 3, SRCBLEND 5, DESTBLEND 6; sampler 0 min, mag, mip LINEAR", () => {
    expect(akStates.map((s) => [s.m_eType, s.m_dwStage, s.m_dwType, s.m_dwValue])).toEqual([
      [0, 0, 137, 0], [0, 0, 29, 0], [0, 0, 27, 0], [0, 0, 15, 1], [0, 0, 7, 1], [0, 0, 14, 1], [0, 0, 22, 3], [0, 0, 19, 5], [0, 0, 20, 6],
      [2, 0, 6, 2], [2, 0, 5, 2], [2, 0, 7, 2],
    ]);
  });

  test("set() calls the device only for what differs from the Direct3D defaults the mirror starts with, pushes nothing, and is idempotent", () => {
    const { dev, sm } = make();
    sm.set(akStates);
    // the defaults already hold SPECULAR 0, ALPHABLEND 0, Z 1 / 1 and CULL 3
    expect(dev.calls).toEqual(["rs 137 0", "rs 15 1", "rs 19 5", "rs 20 6", "ss 0 6 2", "ss 0 5 2", "ss 0 7 2"]);
    expect(sm.stackPointer).toBe(0);
    expect([sm.adwRenderState[D3DRS.LIGHTING], sm.adwRenderState[D3DRS.ALPHATESTENABLE], sm.adwRenderState[D3DRS.SRCBLEND], sm.adwRenderState[D3DRS.DESTBLEND]]).toEqual([0, 1, 5, 6]);
    expect([sm.adwSamplerState[D3DSAMP.MINFILTER], sm.adwSamplerState[D3DSAMP.MAGFILTER], sm.adwSamplerState[D3DSAMP.MIPFILTER]]).toEqual([2, 2, 2]);
    expect(sm.adwSamplerState[NUM_SAMP + D3DSAMP.MINFILTER]).toBe(D3DTEXF.POINT); // stage 1 is not in the table
    dev.calls.length = 0;
    sm.set(akStates);
    expect(dev.calls).toEqual([]);
  });

  test("set() writes a texture-stage state too (a table of another kind)", () => {
    const { dev, sm } = make();
    sm.set([{ m_eType: STATE_TYPE.TEXTURE_STAGE, m_dwStage: 1, m_dwType: D3DTSS.COLOROP, m_dwValue: D3DTOP.MODULATE }]);
    expect(dev.calls).toEqual([`tss 1 ${D3DTSS.COLOROP} ${D3DTOP.MODULATE}`]);
    expect(sm.adwTextureStageState[NUM_TSS + D3DTSS.COLOROP]).toBe(D3DTOP.MODULATE);
    expect(sm.stackPointer).toBe(0);
  });
});
