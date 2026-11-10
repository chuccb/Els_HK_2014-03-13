import type { BrowserD3D } from "./gpu.ts";
import type { Vfs } from "./vfs.ts";

/** What a preview needs from the viewer. */
export interface PreviewEnv {
  vfs: Vfs;
  d3d: () => Promise<BrowserD3D>;
  status: (text: string) => void;
  /** dialogs start paused (`?paused` in the address; tests set it): frames of no time, as the draw tests run them */
  startPaused?: boolean;
}

export interface Preview {
  readonly el: HTMLElement;
  /** one line for the header of the pane */
  readonly info: string;
  dispose(): void;
  /** pixels of what is shown (tests): the 2D canvas, the D3D back buffer or the video frame */
  snapshot?(): Promise<{ width: number; height: number; rgba: Uint8Array } | null>;
  /** state for tests (frame counter, animation time ...) */
  state?(): Record<string, unknown>;
  /** tests: put the view in a defined state (mesh: camera, animation set, animation time, pause) */
  control?(options: Record<string, unknown>): void;
}
