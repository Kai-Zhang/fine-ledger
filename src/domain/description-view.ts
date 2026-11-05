import type { Book, Entry, Kind } from "./types.ts";
import { compareTime } from "./dates.ts";
const indexes = new WeakMap<
  Book["entries"],
  Map<Kind, { key: string; entry: Entry }[]>
>();
const norm = (s: string) => s.normalize("NFKC").toLocaleLowerCase();
// Immutable UI snapshots: normalize/deduplicate/sort once, not per keystroke.
export function descriptionSuggestions(book: Book, kind: Kind, query: string) {
  let index = indexes.get(book.entries);
  if (!index) indexes.set(book.entries, (index = new Map()));
  let rows = index.get(kind);
  if (!rows) {
    const seen = new Set<string>();
    rows = book.entries
      .filter((e) => !e.deletedAt && e.kind === kind)
      .sort((a, b) => compareTime(b.updatedAt, a.updatedAt))
      .flatMap((entry) => {
        const key = norm(entry.description);
        if (seen.has(key)) return [];
        seen.add(key);
        return [{ key, entry }];
      });
    index.set(kind, rows);
  }
  const q = norm(query.trim()),
    prefix: Entry[] = [],
    contains: Entry[] = [];
  for (const row of rows) {
    if (row.key.startsWith(q)) {
      prefix.push(row.entry);
      if (prefix.length === 8) break;
    } else if (contains.length < 8 && row.key.includes(q))
      contains.push(row.entry);
  }
  return [...prefix, ...contains].slice(0, 8);
}
