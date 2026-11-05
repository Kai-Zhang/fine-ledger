import type { Book, Entry } from "../domain/types.ts";
import type { Change, Collection } from "./protocol.ts";
import { entity, same } from "./model.ts";

// A form's intent depends on more than the record it writes. In particular,
// an unchanged minor-unit amount must never acquire a new account currency.
export function checkEditDependencies(
  base: Book,
  current: Book,
  changes: Change[],
) {
  const refs = new Map<string, [Collection, string]>();
  const add = (collection: Collection, id?: string) => {
    if (id) refs.set(`${collection}/${id}`, [collection, id]);
  };
  for (const change of changes) {
    if (change.collection !== "entries" || !change.value) continue;
    const entry = change.value as Entry;
    add("accounts", entry.accountId);
    add("accounts", entry.toAccountId);
    add("entries", entry.originalId || entry.refundReference?.originalId);
    add("entries", entry.transferId);
    for (const split of entry.splits) {
      add("categories", split.categoryId);
      add("projects", split.projectId);
    }
  }
  for (const [collection, id] of refs.values()) {
    if (!same(entity(base, collection, id), entity(current, collection, id)))
      throw Error(
        "关联账户、类目或来源在编辑期间发生变化，输入仍保留，请先核对",
      );
  }
}
