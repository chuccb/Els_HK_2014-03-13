/**
 * `ID3DXKeyframedAnimationSet` and `ID3DXAnimationController`: what the exe's skinned-mesh classes (CKTDXDeviceXSkinMesh, CKTDGXSkinAnim) use of D3DX animation
 * (x2.exe.c L436200..436420 `CKTDGXSkinAnim::ChangeAnim`, L448733 / L450438 / L450508 the KAC path that builds the sets).
 *
 * How the exe drives the controller: it creates it with 2 tracks and 30 events, registers the animation sets, and changes animation by
 * `ResetTime()`, `UnkeyAllTrackEvents(0|1)`, then for a cross-fade: old track `KeyTrackEnable(false, t + d)`, `KeyTrackSpeed(0, 0, d, LINEAR)`, `KeyTrackWeight(0, 0, d, LINEAR)`;
 * new track `SetTrackAnimationSet`, `SetTrackEnable(true)`, `SetTrackSpeed(0)`, `SetTrackWeight(0)`, `KeyTrackSpeed(playSpeed, 0, d, LINEAR)`, `KeyTrackWeight(1, 0, d, LINEAR)`,
 * `SetTrackPosition(start)`; every frame `AdvanceTime(dt, null)` and `GetTrackDesc`.  Without a transition the speed / weight keys last 1e-5 s.
 *
 * Semantics implemented (D3DX is documented, there is no oracle here; assumptions are listed in FINDINGS 12.5):
 *  - Track state (priority, weight, speed, position, enable) is stored in the track; keyed events change the state as controller time passes: an event starts
 *    at its start time (the current state value becomes its start value), moves the value to the target over `duration` (LINEAR, or EASEINEASEOUT = smoothstep)
 *    and ends there; `GetTrackDesc` returns the state as of the last `AdvanceTime`.  A newer event of the same kind on a track replaces a running one.
 *    Enable / position events are instantaneous.  The track position advances by the integral of the speed over the time step (exact for linear, Simpson for smoothstep).
 *  - Pose = for each registered output, the weighted sum of the SRT of the enabled tracks that animate it (scale and translation summed with the weights, rotations
 *    summed after aligning their hemispheres and normalised), computed separately for the LOW and the HIGH priority group; both groups present -> lerp by the priority blend.
 *    Weights are not normalised.  The result is written as `S * R * T` (row vectors) into the output matrix, and into the separate scale / rotation / translation outputs.
 *  - **The rotation keys are in the X-file convention**: the matrix is built from the *conjugate* of the interpolated key (`D3DXMatrixRotationQuaternion(conj(q))`), the
 *    separate rotation output and `GetSRT` hand out the key itself.  Decided on data twice: the exe registers the KAC keys as stored (L450508 `RegisterAnimationSRTKeys`, no
 *    conjugation), and for 30,009 of 31,533 informative first-key / rest-matrix pairs of the 1,031 KSM files `R(conj(key0))` is the frame's rest rotation (0 times `R(key0)`);
 *    the X files agree (FINDINGS 12.4).  The separate rotation output being the unconjugated key is a guess (the exe registers matrices only).
 *  - `ResetTime` rebases the events (their start times shift by the old time) and sets the time to 0.
 */
import { matIdentity, matMultiply, matRotationQuaternion, matScaling, matTranslation, quatConjugate, quatSlerp } from "./d3dx-math.ts";
import type { Mat4, Quat, Vec3 } from "./d3dx-math.ts";
import { D3DERR_INVALIDCALL, D3D_OK } from "./hresult.ts";

export const D3DXPLAY = { LOOP: 0, ONCE: 1, PINGPONG: 2 } as const;
export const D3DXPRIORITY = { LOW: 0, HIGH: 1 } as const;
export const D3DXTRANSITION = { LINEAR: 0, EASEINEASEOUT: 1 } as const;
export const D3DXEVENT = { TRACKSPEED: 0, TRACKWEIGHT: 1, TRACKPOSITION: 2, TRACKENABLE: 3, PRIORITYBLEND: 4 } as const;

const f = Math.fround;

/** D3DXKEY_VECTOR3 */
export interface D3DXKeyVector3 { Time: number; Value: Vec3 }
/** D3DXKEY_QUATERNION (D3DXQUATERNION component order x, y, z, w) */
export interface D3DXKeyQuaternion { Time: number; Value: Quat }
/** D3DXKEY_CALLBACK */
export interface D3DXKeyCallback { Time: number; pCallbackData: unknown }
/** D3DXTRACK_DESC */
export interface D3DXTrackDesc { Priority: number; Weight: number; Speed: number; Position: number; Enable: boolean }
/** D3DXEVENT_DESC */
export interface D3DXEventDesc { Type: number; Track: number; StartTime: number; Duration: number; Transition: number; Weight: number; Speed: number; Position: number; Enable: boolean }

/** ID3DXAnimationSet (the part the controller needs). */
export interface ID3DXAnimationSet {
  GetName(): string | null;
  GetPeriod(): number;
  GetPeriodicPosition(position: number): number;
  GetNumAnimations(): number;
  GetAnimationNameByIndex(index: number): { hr: number; name: string | null };
  GetAnimationIndexByName(name: string): { hr: number; index: number };
  GetSRT(periodicPosition: number, animation: number): { hr: number; scale: Vec3; rotation: Quat; translation: Vec3 };
}

interface AnimationEntry { name: string; scale: D3DXKeyVector3[]; rotation: D3DXKeyQuaternion[]; translation: D3DXKeyVector3[] }

const V1: Vec3 = { x: 1, y: 1, z: 1 };
const V0: Vec3 = { x: 0, y: 0, z: 0 };
const QI: Quat = { x: 0, y: 0, z: 0, w: 1 };

function sampleVec(keys: readonly D3DXKeyVector3[], time: number, def: Vec3): Vec3 {
  if (keys.length === 0) return { ...def };
  if (keys.length === 1 || time <= keys[0]!.Time) return { ...keys[0]!.Value };
  const last = keys[keys.length - 1]!;
  if (time >= last.Time) return { ...last.Value };
  let lo = 0, hi = keys.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (keys[mid]!.Time <= time) lo = mid; else hi = mid; }
  const a = keys[lo]!, b = keys[hi]!;
  const t = f((time - a.Time) / (b.Time - a.Time));
  return { x: f(a.Value.x + f((b.Value.x - a.Value.x) * t)), y: f(a.Value.y + f((b.Value.y - a.Value.y) * t)), z: f(a.Value.z + f((b.Value.z - a.Value.z) * t)) };
}
function sampleQuat(keys: readonly D3DXKeyQuaternion[], time: number): Quat {
  if (keys.length === 0) return { ...QI };
  if (keys.length === 1 || time <= keys[0]!.Time) return { ...keys[0]!.Value };
  const last = keys[keys.length - 1]!;
  if (time >= last.Time) return { ...last.Value };
  let lo = 0, hi = keys.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (keys[mid]!.Time <= time) lo = mid; else hi = mid; }
  const a = keys[lo]!, b = keys[hi]!;
  return quatSlerp(a.Value, b.Value, f((time - a.Time) / (b.Time - a.Time)));
}

export class D3DXKeyframedAnimationSet implements ID3DXAnimationSet {
  private readonly anims: AnimationEntry[] = [];
  private readonly byName = new Map<string, number>();
  private period = 0;

  constructor(readonly name: string | null, readonly ticksPerSecond: number, readonly playback: number, readonly maxAnimations: number, readonly callbackKeys: readonly D3DXKeyCallback[] = []) {
    for (const k of callbackKeys) this.period = Math.max(this.period, k.Time / ticksPerSecond);
  }

  /** `RegisterAnimationSRTKeys`: an empty key list leaves that channel at its default (scale 1, identity rotation, translation 0). */
  RegisterAnimationSRTKeys(name: string, scaleKeys: readonly D3DXKeyVector3[], rotationKeys: readonly D3DXKeyQuaternion[], translationKeys: readonly D3DXKeyVector3[]): { hr: number; index: number } {
    if (!name || this.anims.length >= this.maxAnimations || this.byName.has(name)) return { hr: D3DERR_INVALIDCALL, index: -1 };
    const e: AnimationEntry = { name, scale: scaleKeys.map((k) => ({ Time: k.Time, Value: { ...k.Value } })), rotation: rotationKeys.map((k) => ({ Time: k.Time, Value: { ...k.Value } })), translation: translationKeys.map((k) => ({ Time: k.Time, Value: { ...k.Value } })) };
    for (const list of [e.scale, e.rotation, e.translation]) if (list.length) this.period = Math.max(this.period, list[list.length - 1]!.Time / this.ticksPerSecond);
    this.byName.set(name, this.anims.length);
    this.anims.push(e);
    return { hr: D3D_OK, index: this.anims.length - 1 };
  }

  GetName(): string | null { return this.name; }
  GetPlaybackType(): number { return this.playback; }
  GetSourceTicksPerSecond(): number { return this.ticksPerSecond; }
  /** The largest key time (of every animation and callback key) in seconds. */
  GetPeriod(): number { return this.period; }
  GetPeriodicPosition(position: number): number {
    const p = this.period;
    if (p <= 0) return 0;
    switch (this.playback) {
      case D3DXPLAY.ONCE: return Math.min(Math.max(position, 0), p);
      case D3DXPLAY.PINGPONG: { const x = position - Math.floor(position / (2 * p)) * 2 * p; return x > p ? 2 * p - x : x; }
      default: return position - Math.floor(position / p) * p;
    }
  }
  GetNumAnimations(): number { return this.anims.length; }
  GetAnimationNameByIndex(index: number): { hr: number; name: string | null } {
    const a = this.anims[index];
    return a ? { hr: D3D_OK, name: a.name } : { hr: D3DERR_INVALIDCALL, name: null };
  }
  GetAnimationIndexByName(name: string): { hr: number; index: number } {
    const i = this.byName.get(name);
    return i === undefined ? { hr: D3DERR_INVALIDCALL, index: -1 } : { hr: D3D_OK, index: i };
  }
  GetSRT(periodicPosition: number, animation: number): { hr: number; scale: Vec3; rotation: Quat; translation: Vec3 } {
    const a = this.anims[animation];
    if (!a) return { hr: D3DERR_INVALIDCALL, scale: { ...V1 }, rotation: { ...QI }, translation: { ...V0 } };
    const t = f(periodicPosition * this.ticksPerSecond);
    return { hr: D3D_OK, scale: sampleVec(a.scale, t, V1), rotation: sampleQuat(a.rotation, t), translation: sampleVec(a.translation, t, V0) };
  }
  /** `ID3DXKeyframedAnimationSet::GetNumScaleKeys` / `GetNumRotationKeys` / `GetNumTranslationKeys` (0 for an index that does not exist) */
  GetNumScaleKeys(i: number): number { return this.anims[i]?.scale.length ?? 0; }
  GetNumRotationKeys(i: number): number { return this.anims[i]?.rotation.length ?? 0; }
  GetNumTranslationKeys(i: number): number { return this.anims[i]?.translation.length ?? 0; }
  /** The key lists of animation `i` (copies). */
  GetKeys(i: number): { scale: D3DXKeyVector3[]; rotation: D3DXKeyQuaternion[]; translation: D3DXKeyVector3[] } | null {
    const a = this.anims[i];
    return a ? { scale: a.scale.map((k) => ({ ...k })), rotation: a.rotation.map((k) => ({ ...k })), translation: a.translation.map((k) => ({ ...k })) } : null;
  }
}

/** `D3DXCreateKeyframedAnimationSet` */
export function D3DXCreateKeyframedAnimationSet(name: string | null, ticksPerSecond: number, playbackType: number, numAnimations: number, callbackKeys: readonly D3DXKeyCallback[] = []): { hr: number; set: D3DXKeyframedAnimationSet | null } {
  if (!(ticksPerSecond > 0) || numAnimations < 1 || playbackType < 0 || playbackType > 2) return { hr: D3DERR_INVALIDCALL, set: null }; // numAnimations 0 is D3DERR_INVALIDCALL in Wine's tested implementation
  return { hr: D3D_OK, set: new D3DXKeyframedAnimationSet(name, ticksPerSecond, playbackType, numAnimations, callbackKeys) };
}

// ------------------------------------------------------------------------------------------------------- controller
/** An animation output: the matrix (and / or S, R, T parts) that a named animation drives. */
export interface AnimationOutput { name: string; matrix: Float32Array | null; scale: Vec3 | null; rotation: Quat | null; translation: Vec3 | null }

interface TrackState extends D3DXTrackDesc { set: ID3DXAnimationSet | null; outputIndex: Int32Array | null; outputsVersion: number }
interface KeyedEvent {
  handle: number; type: number; track: number; start: number; duration: number; transition: number;
  value: number; started: boolean; startValue: number;
}

const ease = (u: number, transition: number): number => (transition === D3DXTRANSITION.EASEINEASEOUT ? u * u * (3 - 2 * u) : u);

export class D3DXAnimationController {
  private time = 0;
  private priorityBlend = 0;
  private readonly tracks: TrackState[];
  private outputs: AnimationOutput[] = [];
  private outputsVersion = 0;
  private sets: ID3DXAnimationSet[] = [];
  private events: KeyedEvent[] = [];
  private nextHandle = 1;

  constructor(readonly maxOutputs: number, readonly maxSets: number, readonly maxTracks: number, readonly maxEvents: number) {
    this.tracks = Array.from({ length: maxTracks }, () => ({ Priority: D3DXPRIORITY.LOW, Weight: 1, Speed: 1, Position: 0, Enable: false, set: null, outputIndex: null, outputsVersion: -1 }));
  }

  GetMaxNumAnimationOutputs(): number { return this.maxOutputs; }
  GetMaxNumAnimationSets(): number { return this.maxSets; }
  GetMaxNumTracks(): number { return this.maxTracks; }
  GetMaxNumEvents(): number { return this.maxEvents; }

  // --- registration -----------------------------------------------------------------------------------------------
  RegisterAnimationOutput(name: string, matrix: Float32Array | null, scale: Vec3 | null, rotation: Quat | null, translation: Vec3 | null): number {
    if (!name || (!matrix && !scale && !rotation && !translation)) return D3DERR_INVALIDCALL;
    if (this.outputs.length >= this.maxOutputs) return D3DERR_INVALIDCALL;
    this.outputs.push({ name, matrix, scale, rotation, translation });
    this.outputsVersion++;
    return D3D_OK;
  }
  RegisterAnimationSet(set: ID3DXAnimationSet): number {
    if (this.sets.includes(set) || this.sets.length >= this.maxSets) return D3DERR_INVALIDCALL;
    this.sets.push(set);
    return D3D_OK;
  }
  UnregisterAnimationSet(set: ID3DXAnimationSet): number {
    const i = this.sets.indexOf(set);
    if (i < 0) return D3DERR_INVALIDCALL;
    this.sets.splice(i, 1);
    for (const t of this.tracks) if (t.set === set) { t.set = null; t.outputIndex = null; }
    return D3D_OK;
  }
  GetNumAnimationSets(): number { return this.sets.length; }
  GetAnimationSet(index: number): { hr: number; set: ID3DXAnimationSet | null } { const s = this.sets[index]; return s ? { hr: D3D_OK, set: s } : { hr: D3DERR_INVALIDCALL, set: null }; }
  GetAnimationSetByName(name: string): { hr: number; set: ID3DXAnimationSet | null } {
    const s = this.sets.find((x) => x.GetName() === name);
    return s ? { hr: D3D_OK, set: s } : { hr: D3DERR_INVALIDCALL, set: null };
  }

  // --- tracks -----------------------------------------------------------------------------------------------------
  private track(i: number): TrackState | null { return Number.isInteger(i) && i >= 0 && i < this.tracks.length ? this.tracks[i]! : null; }
  SetTrackAnimationSet(track: number, set: ID3DXAnimationSet | null): number {
    const t = this.track(track);
    if (!t) return D3DERR_INVALIDCALL;
    t.set = set; t.outputIndex = null; t.outputsVersion = -1;
    return D3D_OK;
  }
  GetTrackAnimationSet(track: number): { hr: number; set: ID3DXAnimationSet | null } { const t = this.track(track); return t ? { hr: D3D_OK, set: t.set } : { hr: D3DERR_INVALIDCALL, set: null }; }
  SetTrackPriority(track: number, priority: number): number { const t = this.track(track); if (!t || (priority !== 0 && priority !== 1)) return D3DERR_INVALIDCALL; t.Priority = priority; return D3D_OK; }
  SetTrackSpeed(track: number, speed: number): number { const t = this.track(track); if (!t || !Number.isFinite(speed)) return D3DERR_INVALIDCALL; t.Speed = f(speed); return D3D_OK; }
  SetTrackWeight(track: number, weight: number): number { const t = this.track(track); if (!t || !Number.isFinite(weight)) return D3DERR_INVALIDCALL; t.Weight = f(weight); return D3D_OK; }
  SetTrackPosition(track: number, position: number): number { const t = this.track(track); if (!t) return D3DERR_INVALIDCALL; t.Position = position; return D3D_OK; }
  SetTrackEnable(track: number, enable: boolean): number { const t = this.track(track); if (!t) return D3DERR_INVALIDCALL; t.Enable = enable; return D3D_OK; }
  SetTrackDesc(track: number, d: D3DXTrackDesc): number {
    const t = this.track(track);
    if (!t || !Number.isFinite(d.Speed) || !Number.isFinite(d.Weight) || (d.Priority !== 0 && d.Priority !== 1)) return D3DERR_INVALIDCALL;
    t.Priority = d.Priority; t.Weight = f(d.Weight); t.Speed = f(d.Speed); t.Position = d.Position; t.Enable = d.Enable;
    return D3D_OK;
  }
  GetTrackDesc(track: number): { hr: number; desc: D3DXTrackDesc | null } {
    const t = this.track(track);
    return t ? { hr: D3D_OK, desc: { Priority: t.Priority, Weight: t.Weight, Speed: t.Speed, Position: t.Position, Enable: t.Enable } } : { hr: D3DERR_INVALIDCALL, desc: null };
  }
  SetPriorityBlend(w: number): number { if (w < 0 || w > 1) return D3DERR_INVALIDCALL; this.priorityBlend = f(w); return D3D_OK; }
  GetPriorityBlend(): number { return this.priorityBlend; }

  // --- events -----------------------------------------------------------------------------------------------------
  private addEvent(type: number, track: number, start: number, duration: number, transition: number, value: number): number {
    if (type !== D3DXEVENT.PRIORITYBLEND && !this.track(track)) return 0;
    if (this.events.length >= this.maxEvents || start < 0 || duration < 0) return 0;
    const e: KeyedEvent = { handle: this.nextHandle++, type, track, start, duration, transition, value, started: false, startValue: 0 };
    this.events.push(e);
    return e.handle;
  }
  KeyTrackSpeed(track: number, newSpeed: number, startTime: number, duration: number, transition: number): number { return !Number.isFinite(newSpeed) ? 0 : this.addEvent(D3DXEVENT.TRACKSPEED, track, startTime, duration, transition, f(newSpeed)); }
  KeyTrackWeight(track: number, newWeight: number, startTime: number, duration: number, transition: number): number { return !Number.isFinite(newWeight) ? 0 : this.addEvent(D3DXEVENT.TRACKWEIGHT, track, startTime, duration, transition, f(newWeight)); }
  KeyTrackPosition(track: number, newPosition: number, startTime: number): number { return this.addEvent(D3DXEVENT.TRACKPOSITION, track, startTime, 0, 0, newPosition); }
  KeyTrackEnable(track: number, newEnable: boolean, startTime: number): number { return this.addEvent(D3DXEVENT.TRACKENABLE, track, startTime, 0, 0, newEnable ? 1 : 0); }
  KeyPriorityBlend(newBlendWeight: number, startTime: number, duration: number, transition: number): number { return newBlendWeight < 0 || newBlendWeight > 1 ? 0 : this.addEvent(D3DXEVENT.PRIORITYBLEND, -1, startTime, duration, transition, f(newBlendWeight)); }
  UnkeyEvent(handle: number): number { const i = this.events.findIndex((e) => e.handle === handle); if (i < 0) return D3DERR_INVALIDCALL; this.events.splice(i, 1); return D3D_OK; }
  UnkeyAllTrackEvents(track: number): number { if (!this.track(track)) return D3DERR_INVALIDCALL; this.events = this.events.filter((e) => e.track !== track); return D3D_OK; }
  UnkeyAllPriorityBlends(): number { this.events = this.events.filter((e) => e.type !== D3DXEVENT.PRIORITYBLEND); return D3D_OK; }
  ValidateEvent(handle: number): number { return this.events.some((e) => e.handle === handle) ? D3D_OK : D3DERR_INVALIDCALL; }
  GetEventDesc(handle: number): { hr: number; desc: D3DXEventDesc | null } {
    const e = this.events.find((x) => x.handle === handle);
    if (!e) return { hr: D3DERR_INVALIDCALL, desc: null };
    return { hr: D3D_OK, desc: { Type: e.type, Track: e.track, StartTime: e.start, Duration: e.duration, Transition: e.transition, Weight: e.type === D3DXEVENT.TRACKWEIGHT || e.type === D3DXEVENT.PRIORITYBLEND ? e.value : 0, Speed: e.type === D3DXEVENT.TRACKSPEED ? e.value : 0, Position: e.type === D3DXEVENT.TRACKPOSITION ? e.value : 0, Enable: e.type === D3DXEVENT.TRACKENABLE && e.value !== 0 } };
  }
  /** The event of `type` on `track` that is running at the current time (0 when none). */
  GetCurrentTrackEvent(track: number, type: number): number {
    const e = this.events.find((x) => x.track === track && x.type === type && x.started && this.time < x.start + x.duration);
    return e ? e.handle : 0;
  }
  GetCurrentPriorityBlend(): number { return this.events.find((x) => x.type === D3DXEVENT.PRIORITYBLEND && x.started)?.handle ?? 0; }
  /** The next event of the track after `handle` (in start-time order; handle 0 = the first one). */
  GetUpcomingTrackEvent(track: number, handle: number): number {
    const list = this.events.filter((e) => e.track === track).sort((a, b) => a.start - b.start || a.handle - b.handle);
    if (handle === 0) return list.find((e) => e.start >= this.time)?.handle ?? 0;
    const i = list.findIndex((e) => e.handle === handle);
    return i >= 0 && list[i + 1] ? list[i + 1]!.handle : 0;
  }
  GetUpcomingPriorityBlend(handle: number): number {
    const list = this.events.filter((e) => e.type === D3DXEVENT.PRIORITYBLEND).sort((a, b) => a.start - b.start || a.handle - b.handle);
    if (handle === 0) return list.find((e) => e.start >= this.time)?.handle ?? 0;
    const i = list.findIndex((e) => e.handle === handle);
    return i >= 0 && list[i + 1] ? list[i + 1]!.handle : 0;
  }

  // --- time -------------------------------------------------------------------------------------------------------
  GetTime(): number { return this.time; }
  /** Time back to 0; events keep their place relative to it. */
  ResetTime(): number {
    const old = this.time;
    for (const e of this.events) e.start -= old;
    this.time = 0;
    return D3D_OK;
  }

  private value(t: TrackState, type: number): number { return type === D3DXEVENT.TRACKSPEED ? t.Speed : t.Weight; }
  private setValue(t: TrackState, type: number, v: number): void { if (type === D3DXEVENT.TRACKSPEED) t.Speed = f(v); else t.Weight = f(v); }

  /** Start the events whose time has come; `a` is the beginning of the segment. */
  private startEvents(a: number): void {
    const due = this.events.filter((e) => !e.started && e.start <= a).sort((x, y) => x.start - y.start || x.handle - y.handle);
    for (const e of due) {
      e.started = true;
      if (e.type === D3DXEVENT.PRIORITYBLEND) {
        for (const o of this.events) if (o !== e && o.type === e.type && o.started) o.duration = -1; // replaced
        e.startValue = this.priorityBlend;
        continue;
      }
      const t = this.tracks[e.track]!;
      switch (e.type) {
        case D3DXEVENT.TRACKENABLE: t.Enable = e.value !== 0; break;
        case D3DXEVENT.TRACKPOSITION: t.Position = e.value; break;
        default:
          for (const o of this.events) if (o !== e && o.track === e.track && o.type === e.type && o.started) o.duration = -1; // a newer event of the same kind replaces a running one
          e.startValue = this.value(t, e.type);
      }
    }
    this.events = this.events.filter((e) => e.duration >= 0);
  }

  /** Current value of a running event at time `x` (clamped to its end). */
  private eventValue(e: KeyedEvent, x: number): number {
    if (e.duration <= 0 || x >= e.start + e.duration) return e.value;
    const u = Math.max(0, (x - e.start) / e.duration);
    return e.startValue + (e.value - e.startValue) * ease(u, e.transition);
  }

  AdvanceTime(timeDelta: number, _callbackHandler: unknown = null): number {
    if (!(timeDelta >= 0)) return D3DERR_INVALIDCALL;
    const t0 = this.time, t1 = t0 + timeDelta;
    const pts = new Set<number>([t0, t1]);
    for (const e of this.events) {
      if (e.start > t0 && e.start < t1) pts.add(e.start);
      const end = e.start + e.duration;
      if (end > t0 && end < t1) pts.add(end);
    }
    const bounds = [...pts].sort((x, y) => x - y);
    for (let i = 0; i < bounds.length; i++) {
      const a = bounds[i]!;
      this.startEvents(a);
      const b = i + 1 < bounds.length ? bounds[i + 1]! : a;
      if (b > a) {
        for (let k = 0; k < this.tracks.length; k++) {
          const t = this.tracks[k]!;
          if (!t.Enable) continue;
          const sp = this.events.find((e) => e.track === k && e.type === D3DXEVENT.TRACKSPEED && e.started);
          let advance: number;
          if (!sp) advance = t.Speed * (b - a);
          else {
            const va = this.eventValue(sp, a), vb = this.eventValue(sp, b);
            advance = sp.transition === D3DXTRANSITION.EASEINEASEOUT && sp.duration > 0 ? (b - a) * (va + 4 * this.eventValue(sp, (a + b) / 2) + vb) / 6 : (b - a) * (va + vb) / 2;
          }
          t.Position += advance;
        }
      }
      // values at the end of the segment; finished events set their target exactly and go away
      for (const e of this.events) {
        if (!e.started) continue;
        if (e.type === D3DXEVENT.PRIORITYBLEND) { this.priorityBlend = f(this.eventValue(e, b)); continue; }
        if (e.type === D3DXEVENT.TRACKSPEED || e.type === D3DXEVENT.TRACKWEIGHT) this.setValue(this.tracks[e.track]!, e.type, this.eventValue(e, b));
      }
      this.events = this.events.filter((e) => !(e.started && b >= e.start + e.duration));
    }
    this.time = t1;
    this.evaluate();
    return D3D_OK;
  }

  // --- pose ---------------------------------------------------------------------------------------------------------
  private evaluate(): void {
    const n = this.outputs.length;
    if (n === 0) return;
    type Acc = { w: number; s: [number, number, number]; t: [number, number, number]; q: [number, number, number, number] };
    const fresh = (): Acc => ({ w: 0, s: [0, 0, 0], t: [0, 0, 0], q: [0, 0, 0, 0] });
    const acc: [Acc | null, Acc | null][] = Array.from({ length: n }, () => [null, null]);
    for (const tr of this.tracks) {
      if (!tr.Enable || !tr.set || !(tr.Weight > 0)) continue;
      if (tr.outputIndex === null || tr.outputsVersion !== this.outputsVersion) {
        const map = new Int32Array(n);
        for (let o = 0; o < n; o++) { const r = tr.set.GetAnimationIndexByName(this.outputs[o]!.name); map[o] = r.hr >= 0 ? r.index : -1; }
        tr.outputIndex = map; tr.outputsVersion = this.outputsVersion;
      }
      const pos = tr.set.GetPeriodicPosition(tr.Position);
      const w = tr.Weight;
      for (let o = 0; o < n; o++) {
        const idx = tr.outputIndex[o]!;
        if (idx < 0) continue;
        const srt = tr.set.GetSRT(pos, idx);
        if (srt.hr < 0) continue;
        const g = (acc[o]![tr.Priority] ??= fresh());
        g.w += w;
        g.s[0] += w * srt.scale.x; g.s[1] += w * srt.scale.y; g.s[2] += w * srt.scale.z;
        g.t[0] += w * srt.translation.x; g.t[1] += w * srt.translation.y; g.t[2] += w * srt.translation.z;
        let { x, y, z, w: qw } = srt.rotation;
        if (g.q[0] * x + g.q[1] * y + g.q[2] * z + g.q[3] * qw < 0) { x = -x; y = -y; z = -z; qw = -qw; }
        g.q[0] += w * x; g.q[1] += w * y; g.q[2] += w * z; g.q[3] += w * qw;
      }
    }
    const b = this.priorityBlend;
    for (let o = 0; o < n; o++) {
      const [low, high] = acc[o]!;
      if (!low && !high) continue;
      const fin = (g: Acc): { s: Vec3; t: Vec3; q: Quat } => {
        const len = Math.hypot(g.q[0], g.q[1], g.q[2], g.q[3]);
        return { s: { x: g.s[0], y: g.s[1], z: g.s[2] }, t: { x: g.t[0], y: g.t[1], z: g.t[2] }, q: len > 0 ? { x: g.q[0] / len, y: g.q[1] / len, z: g.q[2] / len, w: g.q[3] / len } : { ...QI } };
      };
      let r: { s: Vec3; t: Vec3; q: Quat };
      if (low && high) {
        const l = fin(low), h = fin(high);
        r = {
          s: { x: l.s.x * (1 - b) + h.s.x * b, y: l.s.y * (1 - b) + h.s.y * b, z: l.s.z * (1 - b) + h.s.z * b },
          t: { x: l.t.x * (1 - b) + h.t.x * b, y: l.t.y * (1 - b) + h.t.y * b, z: l.t.z * (1 - b) + h.t.z * b },
          q: quatSlerp(l.q, h.q, b),
        };
      } else r = fin((low ?? high)!);
      const out = this.outputs[o]!;
      if (out.scale) { out.scale.x = f(r.s.x); out.scale.y = f(r.s.y); out.scale.z = f(r.s.z); }
      if (out.rotation) { out.rotation.x = f(r.q.x); out.rotation.y = f(r.q.y); out.rotation.z = f(r.q.z); out.rotation.w = f(r.q.w); }
      if (out.translation) { out.translation.x = f(r.t.x); out.translation.y = f(r.t.y); out.translation.z = f(r.t.z); }
      if (out.matrix) out.matrix.set(composeSRT(r.s, quatConjugate(r.q), r.t)); // the rotation keys are in the X-file convention: the matrix is built from their conjugate (see the header)
    }
  }

  /** `CloneAnimationController`: same sets, tracks, events and time, but no outputs (the clone is registered with its own frame hierarchy). */
  CloneAnimationController(maxOutputs: number, maxSets: number, maxTracks: number, maxEvents: number): { hr: number; controller: D3DXAnimationController | null } {
    if (maxSets < this.sets.length || maxTracks < 1 || maxEvents < this.events.length) return { hr: D3DERR_INVALIDCALL, controller: null };
    const c = new D3DXAnimationController(maxOutputs, maxSets, maxTracks, maxEvents);
    for (const s of this.sets) c.sets.push(s);
    this.tracks.forEach((t, i) => { const d = c.tracks[i]; if (d) { d.Priority = t.Priority; d.Weight = t.Weight; d.Speed = t.Speed; d.Position = t.Position; d.Enable = t.Enable; d.set = t.set; } });
    c.events = this.events.map((e) => ({ ...e }));
    c.nextHandle = this.nextHandle;
    c.time = this.time;
    c.priorityBlend = this.priorityBlend;
    return { hr: D3D_OK, controller: c };
  }
}

/** `S * R * T` for row vectors. */
export function composeSRT(s: Vec3, q: Quat, t: Vec3): Mat4 {
  return matMultiply(matMultiply(matScaling(s.x, s.y, s.z), matRotationQuaternion(q)), matTranslation(t.x, t.y, t.z));
}

/** `D3DXCreateAnimationController` */
export function D3DXCreateAnimationController(maxOutputs: number, maxSets: number, maxTracks: number, maxEvents: number): { hr: number; controller: D3DXAnimationController | null } {
  if (maxOutputs < 1 || maxSets < 1 || maxTracks < 1 || maxEvents < 0) return { hr: D3DERR_INVALIDCALL, controller: null };
  return { hr: D3D_OK, controller: new D3DXAnimationController(maxOutputs, maxSets, maxTracks, maxEvents) };
}
void matIdentity;
