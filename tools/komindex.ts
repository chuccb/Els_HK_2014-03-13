/** Shared helper for tools: index every entry of every KOM in data/ by (upper-cased) name. */
import { readdirSync } from "node:fs";
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
 */
export class KomMassFileSource implements MassFileSource {
  private readonly resident = new Map<string, Uint8Array>();
  /** what `read` was asked for and could not hand out since the last `settle` round began */
  readonly pending = new Set<string>();

  constructor(readonly index: Map<string, IndexedEntry>) {}

  has(upperName: string): boolean {
    return this.index.has(upperName);
  }

  read(upperName: string): Uint8Array | undefined {
    const bytes = this.resident.get(upperName);
    if (!bytes && this.index.has(upperName)) this.pending.add(upperName);
    return bytes;
  }

  async load(upperNames: Iterable<string>): Promise<void> {
    for (const name of upperNames) {
      const hit = this.index.get(name);
      if (hit && !this.resident.has(name)) this.resident.set(name, await hit.kom.read(hit.entry));
    }
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
