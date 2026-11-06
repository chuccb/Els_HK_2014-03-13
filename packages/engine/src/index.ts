/** `@els/engine`: the engine classes (CKTDX* / CKTDG*) over the D3D9 layer, ported one function at a time from x2.exe (docs/ROADMAP.md Phase 3 "engine classes"). */
export {
  MAX_FRAMES, isCollisionFrameName, isNoDrawFrameName, setupFrameList, setupDrawFrameList, collisionFrames,
} from "./skinmesh-frames.ts";
export type { FrameList, FrameListError } from "./skinmesh-frames.ts";
