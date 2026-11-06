/**
 * The client's file system: the 173 KOM archives mounted into a `KGCMassFileManager` (packages/kom/src/massfile.ts) over HTTP Range
 * requests, plus the loose files of data/ the server lists.
 */
import { MassFileManager, httpSource, mountClientArchives } from "@els/kom";

export interface Row { name: string; upper: string; kom: string; size: number; ext: string }
export interface LooseFile { name: string; size: number }

export class Vfs {
  readonly manager = new MassFileManager((m) => console.warn("[massfile]", m));
  rows: Row[] = [];
  loose: LooseFile[] = [];
  missing: string[] = [];

  static async mount(onProgress?: (done: number, total: number) => void): Promise<Vfs> {
    const vfs = new Vfs();
    const t0 = performance.now();
    const r = await mountClientArchives(
      vfs.manager,
      async (name) => { try { return await httpSource(`/data/${name}`); } catch { return null; } },
      { concurrency: 12, onProgress, onMissing: (n) => console.warn("[vfs] archive missing:", n) },
    );
    vfs.missing = r.missing;
    for (const { name: komName, kom } of vfs.manager.archives) {
      for (const e of kom.entries) {
        const dot = e.name.lastIndexOf(".");
        vfs.rows.push({ name: e.name, upper: e.name.toUpperCase(), kom: komName, size: e.size, ext: dot < 0 ? "" : e.name.slice(dot + 1).toLowerCase() });
      }
    }
    vfs.loose = (await (await fetch("/api/files")).json()) as LooseFile[];
    console.log(`[vfs] ${r.mounted} archives, ${vfs.manager.size} members, ${vfs.loose.length} loose files in ${(performance.now() - t0).toFixed(0)} ms`);
    return vfs;
  }

  /** a member of the archives (`LoadDataFile`), or null */
  load(name: string): Promise<Uint8Array | null> { return this.manager.loadDataFile(name); }

  /** a loose file of data/ (`LoadDataFile_LocalFile`) */
  async fetchLoose(name: string): Promise<Uint8Array> {
    const res = await fetch(`/data/${name}`);
    if (!res.ok) throw new Error(`GET /data/${name}: ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }
}
