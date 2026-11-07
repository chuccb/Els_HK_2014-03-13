/** Shared helper for tools: index every entry of every KOM in data/ by (upper-cased) name. */
import { closeSync, openSync, readSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { KomArchive, fileSource } from "@els/kom";
import type { KomEntry } from "@els/kom";
import type { MassFileSource } from "@els/host";

export interface IndexedEntry {
  kom: KomArchive;
  entry: KomEntry;
  komName: string;
}

export const dataDir = join(import.meta.dir, "..", "data");

export async function indexAllKoms(dir = dataDir): Promise<Map<string, IndexedEntry>> {
  const map = new Map<string, IndexedEntry>();
  const files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".kom")).sort();
  for (const f of files) {
    const kom = await KomArchive.open(fileSource(join(dir, f)));
    for (const entry of kom.entries) map.set(entry.name.toUpperCase(), { kom, entry, komName: f });
  }
  return map;
}

/**
 * The archives as the `MassFileSource` of the host layer's `KGCMassFileManager`.  The VM and the UI model are synchronous and a KOM
 * read is not, so a member is resident only after `load`.  `read` remembers a member that was asked for and is not resident, and
 * `settle` loads those and runs again (the caller builds a FRESH world in `run`: a run that missed something is void, because the
 * exe's code was told "no such file" and went on) until a run asks for nothing that is not resident.
 *
 * With `sync` set a member is read from its archive the moment `read` asks for it (`readSync` of the stored bytes, then the same decode),
 * so nothing is ever pending and one world can run on: what a census that draws a thousand dialogs in ONE Lua state needs.
 */
export class KomMassFileSource implements MassFileSource {
  private readonly resident = new Map<string, Uint8Array>();
  /** what `read` was asked for and could not hand out since the last `settle` round began */
  readonly pending = new Set<string>();

  /**
   * @param imageHeaderBytes keep only the first N bytes of an image file (.TGA / .DDS / .BMP / .PNG / .JPG): enough for the image's
   *   header (what `D3DXGetImageInfoFromFileInMemory` reads) when a census only needs sizes; the full bytes of the ~1,300 textures the
   *   dialogs name are 1.3 GB.  Such bytes must never be drawn.
   */
  constructor(
    readonly index: Map<string, IndexedEntry>,
    private readonly imageHeaderBytes = 0,
    /** read a member on the spot when `read` asks for one that is not resident */
    private readonly sync = false,
  ) {}

  /** the archives opened for `readSync`, by file name */
  private readonly fds = new Map<string, number>();

  has(upperName: string): boolean {
    return this.index.has(upperName);
  }

  read(upperName: string): Uint8Array | undefined {
    let bytes = this.resident.get(upperName);
    if (!bytes && this.index.has(upperName)) {
      if (this.sync) bytes = this.loadSync(upperName);
      else this.pending.add(upperName);
    }
    return bytes;
  }

  private shorten(name: string, bytes: Uint8Array): Uint8Array {
    return this.imageHeaderBytes > 0 && /\.(TGA|DDS|BMP|PNG|JPG)$/.test(name) && bytes.length > this.imageHeaderBytes ? bytes.slice(0, this.imageHeaderBytes) : bytes;
  }

  private loadSync(name: string): Uint8Array {
    const hit = this.index.get(name)!;
    let fd = this.fds.get(hit.komName);
    if (fd === undefined) {
      fd = openSync(join(dataDir, hit.komName), "r");
      this.fds.set(hit.komName, fd);
    }
    const stored = new Uint8Array(hit.entry.csize);
    if (readSync(fd, stored, 0, stored.length, hit.entry.offset) !== stored.length) throw new Error(`${hit.komName}: short read of ${name}`);
    const bytes = this.shorten(name, hit.kom.decode(hit.entry, stored));
    this.resident.set(name, bytes);
    return bytes;
  }

  /** close the archives `sync` opened */
  close(): void {
    for (const fd of this.fds.values()) closeSync(fd);
    this.fds.clear();
  }

  async load(upperNames: Iterable<string>): Promise<void> {
    for (const name of upperNames) {
      const hit = this.index.get(name);
      if (hit && !this.resident.has(name)) this.resident.set(name, this.shorten(name, await hit.kom.read(hit.entry)));
    }
  }

  /**
   * Forget the resident files whose name matches `pattern` (the texture bytes of a dialog that is drawn: a census that draws a thousand of
   * them cannot keep the 1.3 GB of all the textures).  A later `read` of one is pending again.
   */
  evict(pattern: RegExp): number {
    let n = 0;
    for (const name of [...this.resident.keys()]) {
      if (pattern.test(name) && this.resident.delete(name)) n++;
    }
    return n;
  }

  /** runs `run` until a run reads only resident members (a run that throws because of a missing member is run again, too) */
  async settle<T>(run: () => T): Promise<T> {
    for (let round = 0; round < 64; round++) {
      this.pending.clear();
      let result: T | undefined;
      let error: unknown;
      let failed = false;
      try {
        result = run();
      } catch (e) {
        failed = true;
        error = e;
      }
      if (this.pending.size === 0) {
        if (failed) throw error;
        return result as T;
      }
      await this.load([...this.pending]);
    }
    throw new Error("the mass files did not settle");
  }
}
