/**
 * What the UI draws with: `g_pKTDXApp->m_pd3dDevice`, the render-state mirror (`CKTDGStateManager`), the dynamic vertex buffer manager
 * (`g_pKTDXApp->m_pDVBManager`) and `g_pKTDXApp->m_ResolutionScale`, plus the 28-byte vertex the UI draws quads with.
 *
 * Without one (`UIContext.render` is null) a control builds its data but draws nothing: the census and most tests run that way.
 */
import { D3DRS, D3DSAMP, D3DTA, D3DTADDRESS, D3DTEXF, D3DTOP, D3DTSS } from "@els/d3d9";
import type { Direct3DTexture9, Direct3DVertexDeclaration9 } from "@els/d3d9";
import { CKTDGDynamicVBManager, CKTDGStateManager, DYNAMIC_VB_MODE, STATE_TYPE, akStates } from "@els/engine";
import type { DynamicVBDevice, KStateID, StateDevice } from "@els/engine";
import { Vec2 } from "@els/host";

/** the device calls the UI makes (`IDirect3DDevice9`; `Direct3DDevice9` of `@els/d3d9` is one) */
export interface UIDevice extends StateDevice, DynamicVBDevice {
  SetTexture(stage: number, texture: Direct3DTexture9 | null): number;
  GetVertexDeclaration(): Direct3DVertexDeclaration9 | null;
  SetVertexDeclaration(declaration: Direct3DVertexDeclaration9 | null): number;
}

/**
 * `CKTDGUIControl::VERTEX_UI m_Vertex[4]`: four vertices of x, y, z, rhw (floats), the colour (`D3DCOLOR`, ARGB) and u, v (floats), 28
 * bytes each, in the order left-top, right-top, left-bottom, right-bottom: the corners of a `D3DPT_TRIANGLESTRIP` quad.  The bytes are
 * what `DrawPrimitive` copies into the vertex buffer (FVF `D3DFVF_XYZRHW | D3DFVF_DIFFUSE | D3DFVF_TEX1`, 324).
 */
export class VertexUI4 {
  static readonly STRIDE = 28;
  readonly bytes = new Uint8Array(4 * VertexUI4.STRIDE);
  private readonly f32 = new Float32Array(this.bytes.buffer);
  private readonly u32 = new Uint32Array(this.bytes.buffer);

  x(i: number): number { return this.f32[i * 7]!; }
  y(i: number): number { return this.f32[i * 7 + 1]!; }
  z(i: number): number { return this.f32[i * 7 + 2]!; }
  rhw(i: number): number { return this.f32[i * 7 + 3]!; }
  color(i: number): number { return this.u32[i * 7 + 4]!; }
  u(i: number): number { return this.f32[i * 7 + 5]!; }
  v(i: number): number { return this.f32[i * 7 + 6]!; }
  setX(i: number, value: number): void { this.f32[i * 7] = value; }
  setY(i: number, value: number): void { this.f32[i * 7 + 1] = value; }
  setZ(i: number, value: number): void { this.f32[i * 7 + 2] = value; }
  setRhw(i: number, value: number): void { this.f32[i * 7 + 3] = value; }
  setColor(i: number, value: number): void { this.u32[i * 7 + 4] = value >>> 0; }
  setU(i: number, value: number): void { this.f32[i * 7 + 5] = value; }
  setV(i: number, value: number): void { this.f32[i * 7 + 6] = value; }
}

/** `akRSICKTDGUIDialog` (x2.exe.c L140886): the states a dialog draws its controls with.  `CKTDGManager::m_RSICKTDGUIDialog` */
export const RSI_UI_DIALOG: KStateID = [
  { m_eType: STATE_TYPE.RENDER, m_dwStage: 0, m_dwType: D3DRS.ALPHABLENDENABLE, m_dwValue: 1 },
  { m_eType: STATE_TYPE.RENDER, m_dwStage: 0, m_dwType: D3DRS.ALPHATESTENABLE, m_dwValue: 0 },
  { m_eType: STATE_TYPE.RENDER, m_dwStage: 0, m_dwType: D3DRS.ZENABLE, m_dwValue: 0 },
  { m_eType: STATE_TYPE.RENDER, m_dwStage: 0, m_dwType: D3DRS.ZWRITEENABLE, m_dwValue: 0 },
  { m_eType: STATE_TYPE.TEXTURE_STAGE, m_dwStage: 0, m_dwType: D3DTSS.COLOROP, m_dwValue: D3DTOP.MODULATE },
  { m_eType: STATE_TYPE.TEXTURE_STAGE, m_dwStage: 0, m_dwType: D3DTSS.COLORARG1, m_dwValue: D3DTA.TEXTURE },
  { m_eType: STATE_TYPE.TEXTURE_STAGE, m_dwStage: 0, m_dwType: D3DTSS.COLORARG2, m_dwValue: D3DTA.DIFFUSE },
  { m_eType: STATE_TYPE.TEXTURE_STAGE, m_dwStage: 0, m_dwType: D3DTSS.ALPHAOP, m_dwValue: D3DTOP.MODULATE },
  { m_eType: STATE_TYPE.TEXTURE_STAGE, m_dwStage: 0, m_dwType: D3DTSS.ALPHAARG1, m_dwValue: D3DTA.TEXTURE },
  { m_eType: STATE_TYPE.TEXTURE_STAGE, m_dwStage: 0, m_dwType: D3DTSS.ALPHAARG2, m_dwValue: D3DTA.DIFFUSE },
];

/**
 * The sampler states `CKTDGUIDialog::OnFrameRender` sets before its controls draw, in the order it sets them: linear minification,
 * magnification and mip filter, then mirrored addressing, on the stages 0 and 1.
 */
export const DIALOG_SAMPLER_STATES: readonly { stage: number; type: number; value: number }[] = [
  { stage: 0, type: D3DSAMP.MINFILTER, value: D3DTEXF.LINEAR },
  { stage: 0, type: D3DSAMP.MAGFILTER, value: D3DTEXF.LINEAR },
  { stage: 0, type: D3DSAMP.MIPFILTER, value: D3DTEXF.LINEAR },
  { stage: 1, type: D3DSAMP.MINFILTER, value: D3DTEXF.LINEAR },
  { stage: 1, type: D3DSAMP.MAGFILTER, value: D3DTEXF.LINEAR },
  { stage: 1, type: D3DSAMP.MIPFILTER, value: D3DTEXF.LINEAR },
  { stage: 0, type: D3DSAMP.ADDRESSU, value: D3DTADDRESS.MIRROR },
  { stage: 0, type: D3DSAMP.ADDRESSV, value: D3DTADDRESS.MIRROR },
  { stage: 1, type: D3DSAMP.ADDRESSU, value: D3DTADDRESS.MIRROR },
  { stage: 1, type: D3DSAMP.ADDRESSV, value: D3DTADDRESS.MIRROR },
];

export class UIRender {
  /** `g_pd3dDevice` / `g_pKTDXApp->m_pd3dDevice` */
  readonly device: UIDevice;
  /** the statics of `CKTDGStateManager` */
  readonly states: CKTDGStateManager;
  /** `g_pKTDXApp->m_pDVBManager` */
  readonly dvb: CKTDGDynamicVBManager;
  /** `g_pKTDXApp->m_ResolutionScale`: the factor from the 1024 x 768 the UI is laid out in to the pixels of the back buffer */
  readonly resolutionScale = new Vec2(1, 1);

  /**
   * Not in the exe: what the UI was asked to draw whose drawing is not ported yet (a control class, or a part of one such as its strings),
   * with how often.  The census of the gap: what a picture of a dialog is missing.
   */
  readonly undrawn = new Map<string, number>();

  /**
   * The device has been through `CKTDGManager::OnResetDevice` (32960880): `RestoreDeviceObjects` (the mirror of the state manager) and then
   * the game's baseline `akStates`, the states the controls find when they set none themselves.  A button, for one, pushes no blend state:
   * it blends with the SRCALPHA / INVSRCALPHA of the baseline.
   */
  constructor(device: UIDevice, dynamicVBMode: number = DYNAMIC_VB_MODE.DYNAMICVB) {
    this.device = device;
    this.states = new CKTDGStateManager(device);
    this.states.set(akStates);
    this.dvb = new CKTDGDynamicVBManager(device, dynamicVBMode);
  }

  /**
   * `CKTDXApp::OnResetDevice` (328C4FC0) derives the scale from the back buffer: `x = (float)width * 0.0009765625` (1 / 1024) and
   * `y = (float)height / 768`, so the 1024 x 768 layout of the dialogs fills the window.
   */
  setBackBufferSize(width: number, height: number): void {
    this.resolutionScale.set(Math.fround(Math.fround(width) * 0.0009765625), Math.fround(Math.fround(height) / 768));
  }

  /** a drawing step that is not ported: counted, not drawn */
  noteUndrawn(what: string): void {
    this.undrawn.set(what, (this.undrawn.get(what) ?? 0) + 1);
  }
}
