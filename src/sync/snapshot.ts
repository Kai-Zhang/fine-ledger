import {
  canonical,
  collections,
  id,
  PROTOCOL,
  validateBook,
  type Collection,
} from "./protocol.ts";
import type { Book } from "../domain/types.ts";

export type Snapshot = {
  protocol: typeof PROTOCOL;
  serverEpoch: string;
  cursor: number;
  book: Book;
  versions: { collection: Collection; id: string; version: number }[];
  checksum: string;
};

export async function verifySnapshot(
  input: unknown,
  expected: { ledgerId: string; serverEpoch: string },
): Promise<Snapshot> {
  const s = structuredClone(input) as Snapshot;
  if (
    !s ||
    s.protocol !== PROTOCOL ||
    !Number.isSafeInteger(s.cursor) ||
    s.cursor < 1
  )
    throw Error("远端快照协议或水位无效，本机账本未修改");
  id(s.serverEpoch);
  validateBook(s.book);
  if (s.book.id !== expected.ledgerId || s.serverEpoch !== expected.serverEpoch)
    throw Error("远端账本或恢复代次已变化，请重新连接并预览");
  if (!Array.isArray(s.versions)) throw Error("远端实体版本缺失");
  const seen = new Set<string>();
  for (const v of s.versions) {
    if (
      !v ||
      ![...collections, "book"].includes(v.collection) ||
      !Number.isSafeInteger(v.version) ||
      v.version < 1
    )
      throw Error("远端实体版本无效");
    id(v.id);
    const key = `${v.collection}/${v.id}`;
    if (seen.has(key)) throw Error("远端实体版本重复");
    seen.add(key);
  }
  for (const c of ["book", ...collections] as const) {
    const rows =
      c === "book"
        ? [s.book]
        : c === "reports"
          ? s.book.settings.savedReports
          : s.book[c];
    for (const row of rows)
      if (!seen.has(`${c}/${row.id}`)) throw Error("远端实体版本不完整");
  }
  const data = {
    protocol: s.protocol,
    serverEpoch: s.serverEpoch,
    cursor: s.cursor,
    book: s.book,
    versions: s.versions,
  };
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical(data)),
  );
  const checksum = Array.from(new Uint8Array(hash), (n) =>
    n.toString(16).padStart(2, "0"),
  ).join("");
  if (s.checksum !== checksum) throw Error("远端快照校验失败，本机账本未修改");
  return s;
}
