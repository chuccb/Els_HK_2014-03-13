/**
 * Entry point of the web client.  For now the page is the asset viewer; the game proper (boot, login, character select) will take over
 * from here (docs/ROADMAP.md).  `window.__els` is the handle browser tests use (tools/browser-test.ts).
 */
import { Vfs } from "./vfs.ts";
import { Viewer } from "./viewer.ts";
import { el } from "./ui.ts";

interface ElsGlobal { ready: boolean; error?: string; vfs?: Vfs; viewer?: Viewer; open?: (name: string) => Promise<void> }
const els: ElsGlobal = { ready: false };
(window as unknown as { __els: ElsGlobal }).__els = els;

async function boot(): Promise<void> {
  const app = document.getElementById("app")!;
  const progress = el("div", { class: "welcome", text: "Mounting archives ..." });
  app.append(progress);
  try {
    const vfs = await Vfs.mount((done, total) => { progress.textContent = `Mounting archives ${done}/${total} ...`; });
    app.replaceChildren();
    const viewer = new Viewer(app, vfs);
    els.vfs = vfs;
    els.viewer = viewer;
    els.open = async (name) => { await viewer.openName(name); };
    const fromHash = (): void => { const n = decodeURIComponent(location.hash.slice(1)); if (n) void viewer.openName(n); };
    window.addEventListener("hashchange", fromHash);
    els.ready = true;
    fromHash();
  } catch (e) {
    els.error = e instanceof Error ? (e.stack ?? e.message) : String(e);
    progress.className = "err";
    progress.textContent = `Failed to start: ${els.error}`;
    console.error(els.error);
  }
}
void boot();
