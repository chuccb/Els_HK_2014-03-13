/**
 * A DLG script of the client as a picture that runs: the script is executed by the Lua VM, the ported UI classes (packages/ui) build the dialog, and the
 * dialog manager draws it every frame (`CKTDGUIDialogManager::OnFrameMove`, `OnFrameRender(false)` and `(true)`) through the Direct3D 9 layer on the
 * page's WebGPU canvas, 1024 x 768 as the client lays its dialogs out.  The mouse goes to the dialog manager (`MsgProc`: WM_MOUSEMOVE, the buttons, the
 * wheel), so a button shows its mouse-over and pressed pictures, a list scrolls, a dialog that can be dragged is dragged.  Nothing else of the game is
 * there (no stage, no server): a message a control sends goes to a stage chain that is empty.
 *
 * The UI world is synchronous (the VM and the controls read their files the way `LoadDataFile` does) and the archives are HTTP Range requests, so the
 * world is built again until a build asks for nothing that has not been fetched (`PrefetchSource.settle`); the builds before the last are thrown away.
 * A file a LATER frame asks for (a control made while the dialog runs) is fetched and the dialog is built again from its first frame.  A script that
 * stops (`m_bSuccessInitOpenScript` false: the 32 scripts of the game's states, which need globals a bytecode script sets) is no dialog: the viewer says
 * why and shows the script's listing.
 *
 * `?paused` in the page's address (`PreviewEnv.startPaused`) starts every dialog paused (frames of no time, as the draw tests run them; the mouse still works).
 */
import { StringTable } from "@els/assets";
import { D3DCLEAR } from "@els/d3d9";
import { CX2SlotManager, PrefetchSource, UIWorld } from "@els/ui";
import type { CKTDGUIControl, CKTDGUIDialog } from "@els/ui";
import type { Preview, PreviewEnv } from "../preview.ts";
import { el, fmtBytes } from "../ui.ts";
import type { Vfs } from "../vfs.ts";
import { textPreview } from "./text.ts";

/** the size of the layout, and of the back buffer the dialogs are drawn on */
const WIDTH = 1024;
const HEIGHT = 768;
/** what is behind the dialogs (the GPU tests clear to the same colour) */
const CLEAR = 0xff2d3340;
/** the window messages of the mouse, and the key flags of their `wParam` */
const WM_MOUSEMOVE = 0x200, WM_LBUTTONDOWN = 0x201, WM_LBUTTONUP = 0x202, WM_RBUTTONDOWN = 0x204, WM_RBUTTONUP = 0x205, WM_MOUSEWHEEL = 0x20a;
const MK_LBUTTON = 1, MK_RBUTTON = 2;
/** a frame longer than this is run as this long (a tab that was asleep must not make the dialogs jump) */
const LONGEST_FRAME = 0.1;
/** the bytes of textures that stay fetched after a dialog is built, at most; the next dialog forgets the ones it does not use */
const KEEP_BYTES = 192 * 1024 * 1024;

const sources = new WeakMap<Vfs, PrefetchSource>();
function sourceOf(vfs: Vfs): PrefetchSource {
  let source = sources.get(vfs);
  if (!source) {
    source = new PrefetchSource({
      has: (name) => vfs.manager.has(name),
      load: async (name) => {
        const bytes = await vfs.load(name);
        if (!bytes) throw new Error(`${name}: not in the archives`);
        return bytes;
      },
    });
    sources.set(vfs, source);
  }
  return source;
}

let strings: Promise<StringTable> | null = null;
/** `general.ess`, the string table of the client (a loose file next to the exe) */
function stringTable(vfs: Vfs): Promise<StringTable> {
  strings ??= vfs.fetchLoose("general.ess").then((bytes) => StringTable.fromEss(bytes));
  return strings;
}

interface Built { world: UIWorld; dialog: CKTDGUIDialog }

/** what a host does with a world it drops: its textures, the vertex buffers of its render and the glyph pages of its fonts go back to the GPU */
function release(world: UIWorld): void {
  for (const t of world.devices.devices.values()) {
    t.m_pTexture?.Release();
    t.m_pTexture = null;
  }
  world.devices.devices.clear();
  world.render?.dvb.onLostDevice();
  world.fontManager.Destroy();
}

export async function dialogPreview(env: PreviewEnv, name: string, bytes: Uint8Array): Promise<Preview> {
  const { dev, canvas } = await env.d3d();
  const source = sourceOf(env.vfs);
  const table = await stringTable(env.vfs);
  const script = name.toUpperCase();
  const t0 = performance.now();

  /**
   * One build of the world: the device is reset to its defaults first (the state mirror of the UI starts from them; whatever the preview before left in
   * the device would not be in it), then the client's boot, the dialog from its script, added to the manager, one frame of no time.
   */
  const build = (): Built => {
    dev.Reset(WIDTH, HEIGHT);
    const world = new UIWorld({ source, strings: table, notPorted: "throw", device: dev, backBuffer: { width: WIDTH, height: HEIGHT } });
    try {
      world.boot();
      world.createOwners();
      const dialog = world.openDialog(script, 0, new CX2SlotManager(world));
      // a script that stops (an error of its own, a global a bytecode script of another stage sets) leaves what it had made: that is no dialog to look at
      if (!dialog.m_bSuccessInitOpenScript) throw new Error(`the script stopped: ${world.devices.massFiles.log.entries.at(-1)?.text ?? "no message"}`);
      if (!world.dialogManager.addDlg(dialog)) throw new Error("the dialog manager did not take the dialog");
      world.dialogManager.onFrameMove(0, 0);
      return { world, dialog };
    } catch (e) {
      release(world);
      throw e;
    }
  };
  const drop = (b: Built): void => {
    release(b.world);
    dev.Reset(WIDTH, HEIGHT);
  };
  const settleBuild = async (): Promise<{ built: Built; rounds: number }> => {
    const { result, rounds } = await source.settle(build, drop);
    source.trim(KEEP_BYTES, /\.(TGA|DDS|BMP|PNG|JPG)$/);
    return { built: result, rounds };
  };

  let { built, rounds } = await settleBuild();
  const controls = (): CKTDGUIControl[] => built.dialog.m_ControlsList.filter((c): c is CKTDGUIControl => c !== null && c !== undefined);
  const loadedAt = `${source.loaded} files, ${fmtBytes(source.loadedBytes)} fetched`;

  // ---- the pane
  let paused = env.startPaused === true;
  let showScript = false;
  let frames = 0, time = 0, last = performance.now(), dirty = true, reloading = false, raf = 0, disposed = false;
  let moveError = "", renderError = "", messageError = "";
  canvas.className = "gl dialog";
  const status = el("span", { class: "mono dim" });
  const pauseBtn = el("button", { text: paused ? "play" : "pause", onclick: () => { paused = !paused; pauseBtn.textContent = paused ? "play" : "pause"; dirty = true; } });
  const scriptBtn = el("button", { text: "script listing", onclick: () => { showScript = !showScript; scriptBtn.textContent = showScript ? "picture" : "script listing"; show(); } });
  const listing = textPreview(name, bytes);
  const holder = el("div", { class: "glwrap" }, canvas);
  const pane = el("div", { class: "pane" }, el("div", { class: "bar" }, pauseBtn, scriptBtn, status), holder);
  const show = (): void => {
    holder.replaceChildren(showScript ? listing.el : canvas);
    dirty = true;
  };

  const say = (): void => {
    const quads = built.world.render?.undrawn;
    const undrawn = quads && quads.size > 0 ? `; not drawn: ${[...quads].map(([k, v]) => `${k} x${v}`).join(", ")}` : "";
    const errors = [moveError && `frame: ${moveError}`, renderError && `draw: ${renderError}`, messageError && `mouse: ${messageError}`].filter(Boolean).join(" | ");
    status.textContent = `frame ${frames}${paused ? " (paused)" : ""}${undrawn}${errors ? ` - ${errors}` : ""}`;
  };

  /** the world was built again: the dialog starts from its first frame */
  const reload = async (): Promise<void> => {
    reloading = true;
    status.textContent = "fetching what the dialog asked for ...";
    try {
      await source.load([...source.pending]);
      const old = built;
      const next = await settleBuild();
      drop(old);
      built = next.built;
      rounds = next.rounds;
      frames = 0; time = 0; moveError = renderError = messageError = "";
    } catch (e) {
      renderError = e instanceof Error ? e.message : String(e);
    }
    reloading = false;
    dirty = true;
  };

  const drawFrame = (dt: number): void => {
    const { world } = built;
    time += dt;
    dev.BeginScene();
    try {
      dev.Clear(null, D3DCLEAR.TARGET | D3DCLEAR.ZBUFFER, CLEAR, 1, 0);
      if (!moveError) {
        try {
          world.dialogManager.onFrameMove(time, dt);
        } catch (e) {
          // what a frame does that is not ported: the dialog is drawn as it was left, and does not move again
          moveError = e instanceof Error ? e.message : String(e);
        }
      }
      if (!renderError) {
        try {
          world.dialogManager.onFrameRender(false);
          world.dialogManager.onFrameRender(true);
        } catch (e) {
          renderError = e instanceof Error ? e.message : String(e);
        }
      }
    } finally {
      dev.EndScene();
    }
    dev.Present();
    frames++;
  };

  const tick = (now: number): void => {
    if (disposed) return;
    raf = requestAnimationFrame(tick);
    const dt = Math.min(LONGEST_FRAME, Math.max(0, (now - last) / 1000));
    last = now;
    if (reloading || showScript) return;
    if (paused && !dirty) return;
    dirty = false;
    drawFrame(paused ? 0 : dt);
    say();
    // a file that a frame asked for and the world was told does not exist (the exe's read is synchronous): fetch it and build the dialog again
    if (source.pending.size > 0) void reload();
  };

  // ---- the mouse: the position the dialogs read (`DirectInput`'s), and the window messages
  const at = (e: MouseEvent): number => {
    const r = canvas.getBoundingClientRect();
    const x = Math.max(-1, Math.min(WIDTH, Math.floor(((e.clientX - r.left) * WIDTH) / r.width)));
    const y = Math.max(-1, Math.min(HEIGHT, Math.floor(((e.clientY - r.top) * HEIGHT) / r.height)));
    built.world.mouse.m_XPos = x;
    built.world.mouse.m_YPos = y;
    return ((y & 0xffff) << 16) | (x & 0xffff);
  };
  const send = (message: number, wParam: number, lParam: number): void => {
    try {
      built.world.dialogManager.MsgProc(null, message, wParam, lParam);
    } catch (e) {
      messageError = e instanceof Error ? e.message : String(e);
    }
    dirty = true;
  };
  let buttons = 0;
  canvas.onpointermove = (e) => send(WM_MOUSEMOVE, buttons, at(e));
  canvas.onpointerleave = () => {
    built.world.mouse.m_XPos = built.world.mouse.m_YPos = -1;
    send(WM_MOUSEMOVE, 0, 0xffffffff | 0);
  };
  canvas.onpointerdown = (e) => {
    canvas.setPointerCapture(e.pointerId);
    const right = e.button === 2;
    buttons |= right ? MK_RBUTTON : MK_LBUTTON;
    send(right ? WM_RBUTTONDOWN : WM_LBUTTONDOWN, buttons, at(e));
  };
  canvas.onpointerup = (e) => {
    const right = e.button === 2;
    buttons &= ~(right ? MK_RBUTTON : MK_LBUTTON);
    send(right ? WM_RBUTTONUP : WM_LBUTTONUP, buttons, at(e));
  };
  canvas.oncontextmenu = (e) => e.preventDefault();
  canvas.onwheel = (e) => {
    e.preventDefault();
    const notches = Math.max(-3, Math.min(3, Math.round(-e.deltaY / 100) || (e.deltaY < 0 ? 1 : -1)));
    send(WM_MOUSEWHEEL, ((notches * 120) & 0xffff) << 16 | buttons, at(e));
  };

  raf = requestAnimationFrame(tick);
  const shown = controls().filter((c) => c.m_bShow).length;
  return {
    el: pane,
    info: `dialog: ${controls().length} controls (${shown} shown), built in ${rounds} round${rounds === 1 ? "" : "s"} (${((performance.now() - t0) / 1000).toFixed(1)} s, ${loadedAt}), drawn 1024x768 through packages/ui`,
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      canvas.onpointermove = canvas.onpointerleave = canvas.onpointerdown = canvas.onpointerup = canvas.oncontextmenu = canvas.onwheel = null;
      canvas.className = "gl";
      drop(built);
      listing.dispose();
    },
    async snapshot() {
      const p = await dev.readPixels();
      return { width: p.width, height: p.height, rgba: p.rgba };
    },
    control(o) {
      if (typeof o.paused === "boolean") { paused = o.paused; pauseBtn.textContent = paused ? "play" : "pause"; }
      if (Array.isArray(o.mouse)) {
        const [x, y] = o.mouse as [number, number];
        built.world.mouse.m_XPos = x;
        built.world.mouse.m_YPos = y;
        send(WM_MOUSEMOVE, buttons, ((y & 0xffff) << 16) | (x & 0xffff));
      }
      if (typeof o.button === "string") {
        const left = o.button.startsWith("left");
        const down = o.button.endsWith("down");
        buttons = down ? (buttons | (left ? MK_LBUTTON : MK_RBUTTON)) : (buttons & ~(left ? MK_LBUTTON : MK_RBUTTON));
        const x = built.world.mouse.m_XPos, y = built.world.mouse.m_YPos;
        send(left ? (down ? WM_LBUTTONDOWN : WM_LBUTTONUP) : (down ? WM_RBUTTONDOWN : WM_RBUTTONUP), buttons, ((y & 0xffff) << 16) | (x & 0xffff));
      }
      dirty = true;
    },
    state() {
      const over = built.dialog.getControlMouseOver();
      return {
        frames, time, paused, rounds, reloading, moveError, renderError, messageError,
        controls: controls().length, shown: controls().filter((c) => c.m_bShow).length,
        mouseOver: over ? `${over.constructor.name}:${over.m_Name}` : null,
        mouse: [built.world.mouse.m_XPos, built.world.mouse.m_YPos],
        fetched: source.loaded, fetchedBytes: source.loadedBytes,
      };
    },
  };
}
