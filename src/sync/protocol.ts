import { Temporal } from "@js-temporal/polyfill";
import { validateEntry } from "../domain/ledger.ts";
import type { Book, Entry } from "../domain/types.ts";

export const PROTOCOL = "fine-ledger-sync-v1";
export class ApiError extends Error {
  statusCode: number;
  code: string;
  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}
export function ensure(condition: unknown, message: string): asserts condition {
  if (!condition) throw new ApiError(400, "INVALID_REQUEST", message);
}
export function text(
  value: unknown,
  name: string,
  max = 200,
): asserts value is string {
  ensure(
    typeof value === "string" && value.trim().length > 0 && value.length <= max,
    `${name}无效`,
  );
}
export function id(value: unknown): asserts value is string {
  text(value, "ID", 128);
}
export function timestamp(value: unknown) {
  text(value, "时间", 64);
  try {
    Temporal.Instant.from(value);
  } catch {
    throw new ApiError(400, "INVALID_REQUEST", "时间必须包含有效的 UTC 偏移");
  }
}
export function minor(value: unknown) {
  ensure(
    typeof value === "string" &&
      /^-?(0|[1-9]\d{0,39})$/.test(value) &&
      value !== "-0",
    "金额必须是精确的最小单位整数字符串",
  );
}
export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  return (
    "{" +
    Object.keys(value)
      .sort()
      .map(
        (k) =>
          JSON.stringify(k) +
          ":" +
          canonical((value as Record<string, unknown>)[k]),
      )
      .join(",") +
    "}"
  );
}
export const collections = [
  "groups",
  "accounts",
  "categories",
  "projects",
  "entries",
  "reports",
] as const;
export type Collection = (typeof collections)[number] | "book";
export type Change = {
  collection: Collection;
  id: string;
  value: unknown | null;
};
export type Command = {
  operationId: string;
  ledgerId: string;
  serverEpoch: string;
  expected: { collection: Collection; id: string; version: number }[];
  dependsOn: string[];
  changes: Change[];
};
export function validateCommand(input: unknown): asserts input is Command {
  ensure(input && typeof input === "object", "操作无效");
  const c = input as Command;
  id(c.operationId);
  id(c.ledgerId);
  id(c.serverEpoch);
  ensure(
    Array.isArray(c.changes) && c.changes.length > 0 && c.changes.length <= 200,
    "操作变更数量无效",
  );
  ensure(Array.isArray(c.expected) && c.expected.length <= 500, "版本前提无效");
  ensure(Array.isArray(c.dependsOn) && c.dependsOn.length <= 100, "依赖无效");
  c.dependsOn.forEach(id);
  const keys = new Set<string>();
  for (const e of c.expected) {
    ensure(
      e && [...collections, "book"].includes(e.collection),
      "版本对象无效",
    );
    id(e.id);
    ensure(Number.isSafeInteger(e.version) && e.version >= 0, "版本无效");
    const k = `${e.collection}/${e.id}`;
    ensure(!keys.has(k), "版本前提重复");
    keys.add(k);
  }
  const changed = new Set<string>();
  for (const ch of c.changes) {
    ensure(
      ch && [...collections, "book"].includes(ch.collection),
      "变更对象无效",
    );
    id(ch.id);
    const k = `${ch.collection}/${ch.id}`;
    ensure(!changed.has(k) && keys.has(k), "每个变更必须有且仅有一个版本前提");
    changed.add(k);
    ensure(
      ch.value === null ||
        (ch.value && typeof ch.value === "object" && !Array.isArray(ch.value)),
      "变更负载无效",
    );
    if (ch.value !== null)
      ensure((ch.value as { id?: string }).id === ch.id, "对象 ID 不一致");
    if (ch.collection === "book")
      ensure(ch.id === c.ledgerId && ch.value !== null, "不能删除账本");
  }
}

// Portable business data deliberately excludes device appearance, credentials and outbox.
export function portableBook(book: Book): Book {
  return {
    ...book,
    settings: {
      savedReports: book.settings.savedReports,
      theme: "system",
      timeZoneMode: book.settings.timeZoneMode,
    },
  };
}
export function validateBook(
  input: unknown,
  previous?: Book,
): asserts input is Book {
  ensure(input && typeof input === "object", "账本无效");
  const b = input as Book;
  ensure(b.schema === 3 || b.schema === 4, "不支持的账本结构版本，请更新厘序");
  ensure(!previous || b.schema >= previous.schema, "不能降级账本结构版本");
  id(b.id);
  text(b.name, "账本名称");
  ensure(
    typeof b.currency === "string" && /^[A-Z]{3}$/.test(b.currency),
    "主币无效",
  );
  text(b.timeZone, "时区", 100);
  try {
    new Intl.DateTimeFormat("en", { timeZone: b.timeZone });
  } catch {
    throw new ApiError(400, "INVALID_REQUEST", "时区无效");
  }
  timestamp(b.createdAt);
  ensure(Number.isSafeInteger(b.revision) && b.revision >= 0, "账本修订无效");
  ensure(
    b.settings && ["system", "light", "dark"].includes(b.settings.theme),
    "账本设置无效",
  );
  ensure(
    b.settings.timeZoneMode === undefined ||
      ["system", "fixed"].includes(b.settings.timeZoneMode),
    "时区偏好无效",
  );
  const maps = new Map<string, Set<string>>();
  for (const c of collections) {
    const rows = c === "reports" ? b.settings.savedReports : b[c];
    ensure(Array.isArray(rows) && rows.length <= 100000, `${c}数据无效`);
    const seen = new Set<string>();
    for (const row of rows) {
      ensure(row && typeof row === "object", "对象无效");
      id(row.id);
      ensure(!seen.has(row.id), `${c} ID 重复`);
      seen.add(row.id);
    }
    maps.set(c, seen);
  }
  const categoryMap = new Map(b.categories.map((c) => [c.id, c]));
  const entryMap = new Map(b.entries.map((e) => [e.id, e]));
  const previousAccounts = new Map(previous?.accounts.map((a) => [a.id, a]));
  const previousEntries = new Map(previous?.entries.map((e) => [e.id, e]));
  const usedAccounts = new Set(
    previous?.entries.flatMap((e) => [e.accountId, e.toAccountId]),
  );
  for (const g of b.groups) {
    text(g.name, "分组名称");
    ensure(Number.isFinite(g.order), "排序无效");
  }
  for (const a of b.accounts) {
    text(a.name, "账户名称");
    ensure(
      ["bank", "cash", "wallet", "credit", "investment"].includes(a.type),
      "账户类型无效",
    );
    ensure(
      typeof a.currency === "string" && /^[A-Z]{3}$/.test(a.currency),
      "账户币种无效",
    );
    ensure(
      a.groupId === "" || maps.get("groups")!.has(a.groupId),
      "账户分组不存在",
    );
    if (a.creditLimitMinor !== undefined) {
      minor(a.creditLimitMinor);
      ensure(
        b.schema >= 4 &&
          a.type === "credit" &&
          BigInt(a.creditLimitMinor) >= 0n,
        "信用额度无效",
      );
    }
    minor(a.openingMinor);
    timestamp(a.openingAt);
    text(a.icon, "账户图标");
    ensure(
      typeof a.archived === "boolean" &&
        typeof a.netWorth === "boolean" &&
        Number.isFinite(a.order),
      "账户状态无效",
    );
    const old = previousAccounts.get(a.id);
    if (old && old.currency !== a.currency)
      ensure(
        !usedAccounts.has(a.id) && BigInt(old.openingMinor) === 0n,
        "已有金额记录的账户不能修改币种",
      );
  }
  for (const c of b.categories) {
    text(c.name, "类目名称");
    text(c.icon, "类目图标");
    text(c.color, "类目颜色", 100);
    ensure(
      ["expense", "income"].includes(c.kind) &&
        typeof c.archived === "boolean" &&
        Number.isFinite(c.order),
      "类目状态无效",
    );
    const seen = new Set([c.id]);
    let parent = c.parentId;
    while (parent) {
      ensure(!seen.has(parent), "类目不能循环引用");
      seen.add(parent);
      const p = categoryMap.get(parent);
      ensure(p && p.kind === c.kind, "父类目不存在或类型不一致");
      parent = p.parentId;
    }
  }
  for (const p of b.projects) {
    text(p.name, "项目名称");
    ensure(typeof p.archived === "boolean", "项目状态无效");
  }
  if (previous && previous.currency !== b.currency)
    ensure(
      previous.entries.length === 0 &&
        previous.accounts.every((a) => BigInt(a.openingMinor) === 0n),
      "已有金额记录后主币锁定",
    );
  for (const e of b.entries) {
    ensure(
      ["expense", "income", "transfer", "refund", "adjustment"].includes(
        e.kind,
      ),
      "交易类型无效",
    );
    if (
      e.amountCurrency !== undefined ||
      e.originalAmount !== undefined ||
      e.estimatedMinor !== undefined ||
      e.transferId !== undefined
    )
      ensure(b.schema >= 4, "原币与关联费用需要新版账本结构");
    if (e.amountCurrency !== undefined)
      ensure(
        typeof e.amountCurrency === "string" &&
          /^[A-Z]{3}$/.test(e.amountCurrency),
        "金额币种无效",
      );
    if (e.originalAmount !== undefined) {
      ensure(
        e.originalAmount &&
          typeof e.originalAmount.currency === "string" &&
          /^[A-Z]{3}$/.test(e.originalAmount.currency),
        "原币无效",
      );
      minor(e.originalAmount.amountMinor);
      ensure(BigInt(e.originalAmount.amountMinor) > 0n, "原币金额需要大于零");
    }
    if (e.estimatedMinor !== undefined) {
      minor(e.estimatedMinor);
      ensure(BigInt(e.estimatedMinor) > 0n, "暂估金额需要大于零");
    }
    if (e.transferId !== undefined) id(e.transferId);
    minor(e.amountMinor);
    timestamp(e.occurredAt);
    timestamp(e.createdAt);
    timestamp(e.updatedAt);
    if (e.receivedAt) timestamp(e.receivedAt);
    if (e.deletedAt) timestamp(e.deletedAt);
    if (e.receivedMinor !== undefined) minor(e.receivedMinor);
    text(e.description, "交易描述", 4000);
    ensure(
      e.note === undefined ||
        (typeof e.note === "string" && e.note.length <= 20000),
      "备注无效",
    );
    ensure(
      typeof e.posted === "boolean" &&
        Number.isSafeInteger(e.revision) &&
        e.revision >= 0,
      "交易状态无效",
    );
    ensure(Array.isArray(e.splits) && e.splits.length <= 1000, "拆分无效");
    const splitIds = new Set();
    for (const s of e.splits) {
      id(s.id);
      ensure(!splitIds.has(s.id), "拆分 ID 重复");
      splitIds.add(s.id);
      minor(s.amountMinor);
    }
    // Full snapshots must validate historical archived references without treating them as new entries.
    const old = previous ? previousEntries.get(e.id) : e;
    // Unchanged records were validated when first committed; archived historical references
    // may still be checked as themselves when the surrounding category/account changes.
    try {
      validateEntry(b, e, old);
    } catch (err) {
      throw new ApiError(400, "BUSINESS_RULE", (err as Error).message);
    }
    if (e.originalId) {
      const original = entryMap.get(e.originalId);
      ensure(
        e.kind === "refund" && original?.kind === "expense",
        "退款引用无效",
      );
    }
    if (e.refundReference !== undefined) {
      const reference = e.refundReference;
      ensure(
        reference &&
          reference.source === "moneywiz" &&
          ["over-limit", "cross-currency"].includes(reference.reason) &&
          Object.keys(reference).every((key) =>
            ["source", "originalId", "reason"].includes(key),
          ) &&
          e.kind === "refund" &&
          !e.originalId,
        "历史退款关联无效",
      );
      id(reference.originalId);
      ensure(
        entryMap.get(reference.originalId)?.kind === "expense",
        "历史退款关联的原记录不存在",
      );
    }
  }
  for (const r of b.settings.savedReports) {
    text(r.name, "报表名称");
    ensure(
      [
        "net",
        "expense",
        "income",
        "project",
        "expense-trend",
        "income-trend",
        "cashflow",
        "balance",
      ].includes(r.type),
      "报表类型无效",
    );
    for (const k of ["days", "from", "to"] as const)
      ensure(typeof r[k] === "string" && r[k].length <= 100, "报表范围无效");
    for (const k of ["accountIds", "categoryIds"] as const) {
      ensure(Array.isArray(r[k]) && r[k].length <= 10000, "报表筛选无效");
      r[k].forEach(id);
    }
    if (r.projectIds !== undefined) {
      ensure(
        Array.isArray(r.projectIds) && r.projectIds.length <= 10000,
        "报表项目无效",
      );
      r.projectIds.forEach(id);
    }
    if (r.grain !== undefined)
      ensure(
        ["day", "week", "month", "quarter", "year"].includes(r.grain),
        "报表聚合粒度无效",
      );
    if (r.metric !== undefined)
      ensure(["expense", "net", "refund"].includes(r.metric), "报表指标无效");
    if (r.chart !== undefined)
      ensure(["bar", "line"].includes(r.chart), "报表图形无效");
    if (r.type === "balance")
      ensure(r.accountIds.length === 1, "余额报表需要一个账户");
  }
}
