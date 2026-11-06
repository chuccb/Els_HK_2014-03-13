import type { Preview } from "../preview.ts";
import { el, fmtBytes } from "../ui.ts";

/** ogg / wav: the browser decodes them (the original used FMOD). */
export function audioPreview(name: string, bytes: Uint8Array): Preview {
  const type = name.toLowerCase().endsWith(".wav") ? "audio/wav" : "audio/ogg";
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
  const audio = el("audio", { controls: true, src: url });
  return { el: el("div", { class: "pane" }, el("div", { class: "bar" }, audio)), info: `${type}, ${fmtBytes(bytes.length)}`, dispose() { audio.pause(); URL.revokeObjectURL(url); } };
}
