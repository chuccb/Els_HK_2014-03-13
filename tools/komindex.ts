/** Shared helper for tools: index every entry of every KOM in data/ by (upper-cased) name. */
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { KomArchive, fileSource } from "@els/kom";
import type { KomEntry } from "@els/kom";

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
