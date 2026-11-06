/** The asset viewer: every member of the mounted archives and every loose file of data/, with a preview per type. */
import type { Preview, PreviewEnv } from "./preview.ts";
import { el, fmtBytes } from "./ui.ts";
import type { Row, Vfs } from "./vfs.ts";
import { getBrowserD3D } from "./gpu.ts";
import { audioPreview } from "./previews/audio.ts";
import { imagePreview } from "./previews/image.ts";
import { meshPreview } from "./previews/mesh.ts";
import { moviePreview } from "./previews/movie.ts";
import { tablePreview, textPreview } from "./previews/text.ts";

interface Item { name: string; lower: string; kom: string | null; size: number; ext: string }

const KINDS: { id: string; label: string; exts: readonly string[] | null }[] = [
  { id: "all", label: "all", exts: null },
  { id: "image", label: "images", exts: ["tga", "dds", "bmp", "png", "jpg"] },
  { id: "mesh", label: "meshes", exts: ["x", "y"] },
  { id: "script", label: "lua", exts: ["lua"] },
  { id: "table", label: "tables", exts: ["xet", "tet", "kim", "ess"] },
  { id: "audio", label: "audio", exts: ["ogg", "wav"] },
  { id: "movie", label: "movies", exts: ["avi"] },
  { id: "text", label: "text", exts: ["txt", "xml", "fx", "ini"] },
];
const MAX_ROWS = 400;

export class Viewer implements PreviewEnv {
  private items: Item[] = [];
  private shown: Item[] = [];
  private kind = "all";
  private needle = "";
  private selected = -1;
  private current: Preview | null = null;
  private opening = 0;
  private gpuPromise: ReturnType<typeof getBrowserD3D> | null = null;
  private searchEl!: HTMLInputElement;
  private chipsEl!: HTMLElement;
  private readonly listEl = el("div", { class: "list", tabindex: "0" });
  private readonly countEl = el("div", { class: "count" });
  private readonly nameEl = el("div", { class: "name" });
  private readonly infoEl = el("div", { class: "info" });
  private readonly viewEl = el("div", { id: "view" });
  private readonly statusEl = el("div", { id: "status" });
  readonly opened: { name: string; ms: number }[] = [];

  constructor(root: HTMLElement, readonly vfs: Vfs) {
    this.items = [
      ...vfs.rows.map((r: Row) => ({ name: r.name, lower: r.name.toLowerCase(), kom: r.kom, size: r.size, ext: r.ext })),
      ...vfs.loose.map((l) => ({ name: l.name, lower: l.name.toLowerCase(), kom: null, size: l.size, ext: l.name.slice(l.name.lastIndexOf(".") + 1).toLowerCase() })),
    ];
    const chips = this.chipsEl = el("div", { class: "chips" });
    for (const k of KINDS) {
      const b = el("button", { text: k.label, class: k.id === this.kind ? "on" : "", onclick: () => { this.setKind(k.id); this.refresh(); } });
      chips.append(b);
    }
    const search = this.searchEl = el("input", { type: "search", placeholder: "filter (all words must match), e.g. elsword .x", oninput: () => { this.needle = search.value.toLowerCase(); this.refresh(); } });
    this.listEl.onkeydown = (e) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); this.select(this.selected + (e.key === "ArrowDown" ? 1 : -1)); }
    };
    root.append(
      el("aside", {}, el("h1", { text: "Elsword HK 2014-03-13 - assets" }), el("div", { class: "sub", text: `${vfs.manager.archives.length} archives, ${vfs.manager.size.toLocaleString()} members, ${vfs.loose.length} loose files` }), search, chips, this.countEl, this.listEl),
      el("main", {}, el("header", {}, this.nameEl, this.infoEl), this.viewEl),
      this.statusEl,
    );
    this.refresh();
    this.welcome();
  }

  // ---- PreviewEnv
  d3d(): ReturnType<typeof getBrowserD3D> { return (this.gpuPromise ??= getBrowserD3D()); }
  status(text: string): void { this.statusEl.textContent = text; }

  // ---- the list
  private setKind(id: string): void {
    this.kind = id;
    KINDS.forEach((k, i) => this.chipsEl.children[i]?.classList.toggle("on", k.id === id));
  }

  private refresh(): void {
    const exts = KINDS.find((k) => k.id === this.kind)!.exts;
    const words = this.needle.split(/\s+/).filter(Boolean);
    const out: Item[] = [];
    let total = 0;
    for (const it of this.items) {
      if (exts && !exts.includes(it.ext)) continue;
      if (words.length && !words.every((w) => it.lower.includes(w))) continue;
      total++;
      if (out.length < MAX_ROWS) out.push(it);
    }
    this.shown = out;
    this.selected = -1;
    this.listEl.replaceChildren(...out.map((it, i) => el("div", { class: "item", title: it.kom ?? "loose file", onclick: () => this.select(i) }, el("span", { text: it.name }), el("span", { class: "dim", text: fmtBytes(it.size) }))));
    this.countEl.textContent = total > out.length ? `${total.toLocaleString()} matches, first ${out.length} shown` : `${total.toLocaleString()} matches`;
  }

  private select(i: number): void {
    if (i < 0 || i >= this.shown.length) return;
    const rows = this.listEl.children;
    rows[this.selected]?.classList.remove("sel");
    this.selected = i;
    rows[i]!.classList.add("sel");
    rows[i]!.scrollIntoView({ block: "nearest" });
    void this.openItem(this.shown[i]!);
  }

  private welcome(): void {
    const link = (name: string, text = name): HTMLElement => el("a", { text, onclick: () => void this.openName(name) });
    this.viewEl.replaceChildren(el("div", { class: "welcome" },
      el("h2", { text: "Original client data, in the browser" }),
      el("p", {}, `Every member of the ${this.vfs.manager.archives.length} KOM archives is read over HTTP Range requests through the same mass-file manager the exe has (packages/kom), decoded by packages/assets and drawn by the Direct3D 9 layer on WebGPU (packages/d3d9).`),
      el("p", {}, "Try: ", link("MESH_ELSWORD_BASIC_WEAPON.X"), ", ", link("dlg_first_loading0_hk.tga"), ", ", link("movie/movie_create_aisha_base.avi"), ", ", link("general.ess", "general.ess (hex)"), "."),
      el("p", { class: "dim", text: "Keys: up / down in the list. Mesh view: drag to orbit, wheel to zoom." })));
  }

  // ---- opening things
  /** open by name: a member of the archives (any case) or a loose file such as `movie/x.avi` */
  async openName(name: string): Promise<void> {
    const lower = name.toLowerCase();
    const it = this.items.find((x) => x.lower === lower);
    if (!it) { this.showError(`${name}: no such file`); return; }
    let idx = this.shown.indexOf(it);
    if (idx < 0) { // not in the list that is shown: filter for the name so that it is, and select it there
      this.setKind("all");
      this.searchEl.value = name;
      this.needle = lower;
      this.refresh();
      idx = this.shown.indexOf(it);
    }
    if (idx >= 0) this.select(idx);
    else await this.openItem(it);
  }

  async openItem(it: Item): Promise<void> {
    const ticket = ++this.opening;
    const t0 = performance.now();
    this.nameEl.textContent = it.name;
    this.infoEl.textContent = `${it.kom ?? "loose file"}, ${fmtBytes(it.size)} - loading ...`;
    this.current?.dispose();
    this.current = null;
    this.viewEl.replaceChildren();
    try {
      const bytes = it.kom !== null ? await this.vfs.load(it.name) : await this.vfs.fetchLoose(it.name);
      if (!bytes) throw new Error("not found in the archives");
      if (ticket !== this.opening) return;
      let preview: Preview;
      let note = "";
      switch (it.ext) {
        case "tga": case "dds": case "bmp": case "png": case "jpg": preview = await imagePreview(it.name, bytes); break;
        case "avi": preview = moviePreview(it.name, bytes); break;
        case "ogg": case "wav": preview = audioPreview(it.name, bytes); break;
        case "x": case "y":
          try { preview = await meshPreview(this, it.name, bytes); }
          catch (e) { note = ` (not shown as a mesh: ${e instanceof Error ? e.message : e})`; preview = textPreview(it.name, bytes); }
          break;
        case "xet": case "tet": preview = tablePreview(it.name, bytes); break;
        default: preview = textPreview(it.name, bytes);
      }
      if (ticket !== this.opening) { preview.dispose(); return; }
      this.current = preview;
      this.viewEl.replaceChildren(preview.el);
      this.infoEl.textContent = `${it.kom ?? "loose file"}, ${fmtBytes(it.size)} - ${preview.info}${note}`;
      const ms = performance.now() - t0;
      this.opened.push({ name: it.name, ms });
      this.status(`${it.name}: ${ms.toFixed(0)} ms`);
    } catch (e) {
      if (ticket !== this.opening) return;
      this.showError(`${it.name}: ${e instanceof Error ? e.message : e}`);
    }
  }

  private showError(message: string): void {
    this.infoEl.textContent = "error";
    this.viewEl.replaceChildren(el("div", { class: "err", text: message }));
    this.status(message);
    console.error("[viewer]", message);
  }

  // ---- for tests
  get preview(): Preview | null { return this.current; }
}
