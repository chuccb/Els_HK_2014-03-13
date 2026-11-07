/**
 * `CKTDGStateManager` and `KD3DStack`: the client's mirror of the device state and the push / pop stack the draw code uses to change a
 * state for one draw and put it back.
 *
 * Every state the client changes goes through `CKTDGStateManager`.  Its `ms_adwRenderState[256]`, `ms_adwTextureStageState[8][33]`
 * (index `33 * stage + type`), `ms_adwSamplerState[16][14]` (index `14 * stage + type`) and `ms_apd3dTextures[16]` are statics; here they
 * are the members of one object, which the application creates once for its device.  `RestoreDeviceObjects` (328D1BD0) writes every state to
 * the values of its tables `aeDRS` / `aeDTSS` / `aeDSSS` and copies them to the mirror; the D3D9 layer's defaults are those tables
 * (`defaultRenderStates` ...), so the mirror starts as a copy of them and the device already holds the same values.
 *
 * The code that sets a state is inlined everywhere (a macro in the source): it pushes `{type, stage, state, old value}` on `ms_akStack`
 * and calls the device only when the new value differs from the mirror.  `KD3DStack` remembers the stack pointer when it is made; its
 * destructor (328D9B50) pops down to it and puts every old value back (again only when it differs from the mirror).  `KD3DStack(KStateID)`
 * (328D9980) first applies a whole table of states the same way.  Both are here as `setRenderState` / `setTextureStageState` /
 * `setSamplerState`, `push` and `KD3DStack.dispose`.
 */
import { defaultRenderStates, defaultSamplerStates, defaultTextureStageStates, NUM_SAMP, NUM_STAGES, NUM_TSS } from "@els/d3d9";
import type { Direct3DTexture9 } from "@els/d3d9";

/** `CKTDGStateManager::EStateType` */
export const STATE_TYPE = { RENDER: 0, TEXTURE_STAGE: 1, SAMPLER: 2 } as const;

/** `CKTDGStateManager::KState`: one state of a table (`m_dwStage` is 0 for a render state) */
export interface KState {
  readonly m_eType: number;
  readonly m_dwStage: number;
  readonly m_dwType: number;
  readonly m_dwValue: number;
}

/** `CKTDGStateManager::KStateID`: a table of states (`m_pkStates`, `m_uNumStates`) */
export type KStateID = readonly KState[];

/** the device calls the state manager makes (`g_pd3dDevice->SetRenderState` ...) */
export interface StateDevice {
  SetRenderState(state: number, value: number): number;
  SetTextureStageState(stage: number, type: number, value: number): number;
  SetSamplerState(sampler: number, type: number, value: number): number;
}

/** `ms_akStack` entries */
interface StackEntry {
  m_eType: number;
  m_dwStage: number;
  m_dwType: number;
  m_dwValue: number;
}

/** the size of `ms_apd3dTextures` and of the sampler mirror */
export const STATE_MANAGER_SAMPLERS = 16;

export class CKTDGStateManager {
  /** `ms_adwRenderState` */
  readonly adwRenderState: Uint32Array;
  /** `ms_adwTextureStageState`, `33 * stage + type` */
  readonly adwTextureStageState: Uint32Array;
  /** `ms_adwSamplerState`, `14 * stage + type` */
  readonly adwSamplerState: Uint32Array;
  /** `ms_apd3dTextures`: the texture the mirror believes each stage holds (`CKTDXDeviceTexture::SetDeviceTexture` keeps it) */
  readonly apd3dTextures: (Direct3DTexture9 | null)[] = new Array<Direct3DTexture9 | null>(STATE_MANAGER_SAMPLERS).fill(null);
  /** `ms_akStack` (its length is `ms_iStackPointer`) */
  private readonly stack: StackEntry[] = [];
  /** `g_pd3dDevice` */
  readonly device: StateDevice;

  constructor(device: StateDevice, hasDepthStencil = true) {
    this.device = device;
    this.adwRenderState = defaultRenderStates(hasDepthStencil);
    this.adwTextureStageState = defaultTextureStageStates();
    this.adwSamplerState = defaultSamplerStates().slice(0, STATE_MANAGER_SAMPLERS * NUM_SAMP);
    if (this.adwTextureStageState.length !== NUM_STAGES * NUM_TSS) throw new Error("texture stage table size");
  }

  /** `ms_iStackPointer` */
  get stackPointer(): number {
    return this.stack.length;
  }

  /** the inlined `SetRenderState`: the old value goes on the stack, the device is called when the value changes */
  setRenderState(type: number, value: number): void {
    value >>>= 0;
    const old = this.adwRenderState[type]!;
    this.stack.push({ m_eType: STATE_TYPE.RENDER, m_dwStage: 0, m_dwType: type, m_dwValue: old });
    if (old !== value) {
      this.device.SetRenderState(type, value);
      this.adwRenderState[type] = value;
    }
  }

  /** the inlined `SetTextureStageState` (mirror index `33 * stage + type`) */
  setTextureStageState(stage: number, type: number, value: number): void {
    value >>>= 0;
    const at = stage * NUM_TSS + type;
    const old = this.adwTextureStageState[at]!;
    this.stack.push({ m_eType: STATE_TYPE.TEXTURE_STAGE, m_dwStage: stage, m_dwType: type, m_dwValue: old });
    if (old !== value) {
      this.device.SetTextureStageState(stage, type, value);
      this.adwTextureStageState[at] = value;
    }
  }

  /** the inlined `SetSamplerState` (mirror index `14 * stage + type`) */
  setSamplerState(stage: number, type: number, value: number): void {
    value >>>= 0;
    const at = stage * NUM_SAMP + type;
    const old = this.adwSamplerState[at]!;
    this.stack.push({ m_eType: STATE_TYPE.SAMPLER, m_dwStage: stage, m_dwType: type, m_dwValue: old });
    if (old !== value) {
      this.device.SetSamplerState(stage, type, value);
      this.adwSamplerState[at] = value;
    }
  }

  /** `KD3DStack::KD3DStack(const KStateID*)` (328D9980): every state of the table is set in order, each one pushed */
  apply(id: KStateID): void {
    for (const s of id) {
      if (s.m_eType === STATE_TYPE.RENDER) this.setRenderState(s.m_dwType, s.m_dwValue);
      else if (s.m_eType === STATE_TYPE.TEXTURE_STAGE) this.setTextureStageState(s.m_dwStage, s.m_dwType, s.m_dwValue);
      else if (s.m_eType === STATE_TYPE.SAMPLER) this.setSamplerState(s.m_dwStage, s.m_dwType, s.m_dwValue);
    }
  }

  /**
   * `KD3DStack::~KD3DStack` (328D9B50): pop to `top`, newest first; a state whose old value differs from the mirror goes back to the
   * device.  (An entry of another type is skipped.)
   */
  popTo(top: number): void {
    while (this.stack.length > top) {
      const e = this.stack.pop()!;
      if (e.m_eType === STATE_TYPE.RENDER) {
        if (this.adwRenderState[e.m_dwType] !== e.m_dwValue) {
          this.device.SetRenderState(e.m_dwType, e.m_dwValue);
          this.adwRenderState[e.m_dwType] = e.m_dwValue;
        }
      } else if (e.m_eType === STATE_TYPE.TEXTURE_STAGE) {
        const at = e.m_dwStage * NUM_TSS + e.m_dwType;
        if (this.adwTextureStageState[at] !== e.m_dwValue) {
          this.device.SetTextureStageState(e.m_dwStage, e.m_dwType, e.m_dwValue);
          this.adwTextureStageState[at] = e.m_dwValue;
        }
      } else if (e.m_eType === STATE_TYPE.SAMPLER) {
        const at = e.m_dwStage * NUM_SAMP + e.m_dwType;
        if (this.adwSamplerState[at] !== e.m_dwValue) {
          this.device.SetSamplerState(e.m_dwStage, e.m_dwType, e.m_dwValue);
          this.adwSamplerState[at] = e.m_dwValue;
        }
      }
    }
  }
}

/** `KD3DStack`: the stack pointer at construction; `dispose` is the destructor */
export class KD3DStack {
  /** `m_iStackTop` */
  readonly m_iStackTop: number;

  /** `KD3DStack::KD3DStack(const KStateID*)` when an id is given (the states are applied), otherwise only the marker is taken */
  constructor(private readonly states: CKTDGStateManager, id?: KStateID) {
    this.m_iStackTop = states.stackPointer;
    if (id) states.apply(id);
  }

  dispose(): void {
    this.states.popTo(this.m_iStackTop);
  }
}
