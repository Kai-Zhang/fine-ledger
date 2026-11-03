import { compareTime, deviceTimeZone } from "./dates.ts";
import {
  uid,
  type Book,
  type Entry,
  type Account,
  type Kind,
} from "./types.ts";
import { sum, roundedRatio } from "./money.ts";
import { convertedSplits } from "./report-amounts.ts";
export function blankBook(currency = "CNY", name = "我的账本"): Book {
  return {
    schema: 3,
    id: uid(),
    name,
    currency,
    timeZone: deviceTimeZone(),
    createdAt: new Date().toISOString(),
    revision: 0,
    groups: [
      { id: "daily", name: "日常账户", order: 0 },
      { id: "credit", name: "信用账户", order: 1 },
      { id: "investment", name: "储蓄与投资", order: 2 },
    ],
    accounts: [],
    categories: defaultCategories(),
    projects: [],
    entries: [],
    settings: { timeZoneMode: "system", theme: "system", savedReports: [] },
  };
}
export function defaultCategories(): Book["categories"] {
  return [
    ["food", "餐饮", "Utensils", "#4E7D68", ["餐食", "咖啡茶饮", "买菜"]],
    ["transport", "交通", "TramFront", "#5C7E9B", ["公共交通", "打车", "汽车"]],
    ["shopping", "购物", "ShoppingBag", "#B7845D", ["日用品", "衣物", "数码"]],
    ["life", "生活", "House", "#6B8264", ["居住", "通讯", "医疗"]],
    ["leisure", "休闲", "Sparkles", "#8F78A5", ["娱乐", "旅行", "学习"]],
    [
      "earning",
      "收入",
      "BriefcaseBusiness",
      "#25705A",
      ["工资", "奖金", "其他收入"],
    ],
  ].flatMap(([id, name, icon, color, children], i) => [
    {
      id: id as string,
      name: name as string,
      icon: icon as string,
      color: color as string,
      kind: i === 5 ? ("income" as const) : ("expense" as const),
      order: i,
      archived: false,
    },
    ...(children as string[]).map((name, j) => ({
      id: `${id}-${j}`,
      name,
      parentId: id as string,
      icon: [
        "Utensils",
        "Coffee",
        "Carrot",
        "TrainFront",
        "CarFront",
        "Fuel",
        "Package",
        "Shirt",
        "Laptop",
        "House",
        "Smartphone",
        "HeartPulse",
        "Ticket",
        "Plane",
        "BookOpen",
        "BriefcaseBusiness",
        "Gift",
        "Coins",
      ][i * 3 + j],
      color: color as string,
      kind: i === 5 ? ("income" as const) : ("expense" as const),
      order: j,
      archived: false,
    })),
  ]);
}
export function liveEntries(book: Book) {
  return book.entries.filter((e) => !e.deletedAt);
}
export function balance(
  book: Book,
  id: string,
  at = new Date().toISOString(),
  excluding?: string,
): bigint {
  const a = book.accounts.find((a) => a.id === id);
  if (!a) return 0n;
  let result = compareTime(a.openingAt, at) <= 0 ? BigInt(a.openingMinor) : 0n;
  for (const e of liveEntries(book)) {
    if (!e.posted || e.id === excluding) continue;
    if (e.accountId === id && compareTime(e.occurredAt, at) <= 0) {
      const n = BigInt(e.amountMinor);
      result += e.kind === "expense" || e.kind === "transfer" ? -n : n;
    }
    if (
      e.kind === "transfer" &&
      e.toAccountId === id &&
      compareTime(e.receivedAt || e.occurredAt, at) <= 0
    )
      result += BigInt(e.receivedMinor || e.amountMinor);
  }
  return result;
}
// Compute all balances at the same instant with one pass over the ledger.
export function accountBalances(book: Book, at: string) {
  const result = new Map(
    book.accounts.map((a) => [
      a.id,
      compareTime(a.openingAt, at) <= 0 ? BigInt(a.openingMinor) : 0n,
    ]),
  );
  for (const e of book.entries) {
    if (!e.posted || e.deletedAt) continue;
    const source = result.get(e.accountId);
    if (source !== undefined && compareTime(e.occurredAt, at) <= 0) {
      const amount = BigInt(e.amountMinor);
      result.set(
        e.accountId,
        source +
          (e.kind === "expense" || e.kind === "transfer" ? -amount : amount),
      );
    }
    if (e.kind === "transfer" && e.toAccountId) {
      const destination = result.get(e.toAccountId);
      if (
        destination !== undefined &&
        compareTime(e.receivedAt || e.occurredAt, at) <= 0
      )
        result.set(
          e.toAccountId,
          destination + BigInt(e.receivedMinor || e.amountMinor),
        );
    }
  }
  return result;
}
export function remainingRefund(book: Book, id: string) {
  const e = book.entries.find((e) => e.id === id);
  if (!e) return 0n;
  const currency = book.accounts.find((a) => a.id === e.accountId)?.currency;
  const refunds = refundTotals(book, id);
  if (refunds.some((total) => total.currency !== currency)) return null;
  // A same-currency difference is a suggestion, never a refund limit.
  return BigInt(e.amountMinor) - sum(refunds.map((r) => r.amountMinor));
}
// Read v2 source references as ordinary associations for backward compatibility.
export const refundOriginalId = (entry: Entry) =>
  entry.originalId || entry.refundReference?.originalId;
export function refundTotals(book: Book, id: string) {
  const totals = new Map<string, bigint>();
  for (const entry of liveEntries(book)) {
    if (entry.kind !== "refund" || refundOriginalId(entry) !== id) continue;
    const currency = book.accounts.find(
      (a) => a.id === entry.accountId,
    )?.currency;
    if (currency)
      totals.set(
        currency,
        (totals.get(currency) || 0n) + BigInt(entry.amountMinor),
      );
  }
  return [...totals].map(([currency, amount]) => ({
    currency,
    amountMinor: amount.toString(),
  }));
}
export function entryCurrency(book: Book, e: Entry) {
  return (
    e.amountCurrency ||
    book.accounts.find((a) => a.id === e.accountId)?.currency ||
    book.currency
  );
}
export function needsSettlement(book: Book, e: Entry) {
  return (
    entryCurrency(book, e) !==
    book.accounts.find((a) => a.id === e.accountId)?.currency
  );
}
export function validateEntry(book: Book, e: Entry, old?: Entry) {
  const a = book.accounts.find((a) => a.id === e.accountId);
  if (!a) throw Error("请选择账户");
  if (e.amountCurrency !== undefined && !/^[A-Z]{3}$/.test(e.amountCurrency))
    throw Error("金额币种无效");
  if (
    e.originalAmount &&
    (!/^[A-Z]{3}$/.test(e.originalAmount.currency) ||
      !/^\d+$/.test(e.originalAmount.amountMinor) ||
      BigInt(e.originalAmount.amountMinor) <= 0n)
  )
    throw Error("原币金额无效");
  if (
    e.estimatedMinor !== undefined &&
    (!/^\d+$/.test(e.estimatedMinor) || BigInt(e.estimatedMinor) <= 0n)
  )
    throw Error("暂估金额需要大于零");
  const foreign = needsSettlement(book, e);
  if (foreign && (e.posted || !["expense", "income"].includes(e.kind)))
    throw Error("请先填写账户币种的实际入账金额");
  if (
    foreign &&
    (!e.originalAmount ||
      e.originalAmount.currency !== e.amountCurrency ||
      e.originalAmount.amountMinor !== e.amountMinor)
  )
    throw Error("原币记录与录入金额不一致");
  if (e.originalAmount && !["expense", "income"].includes(e.kind))
    throw Error("此交易类型不支持原始消费金额");
  if (e.transferId) {
    const transfer = book.entries.find((t) => t.id === e.transferId);
    if (e.kind !== "expense" || transfer?.kind !== "transfer")
      throw Error("关联转账不存在或类型无效");
    if (!old && transfer.deletedAt) throw Error("不能为已删除转账新增费用");
  }
  if (a.archived && old?.accountId !== a.id)
    throw Error("请先取消账户归档，再新增交易");
  if (!e.description.trim()) throw Error("请填写描述");
  if (!/^-?\d+$/.test(e.amountMinor)) throw Error("金额无效");
  const n = BigInt(e.amountMinor);
  if (e.kind !== "adjustment" && n <= 0n) throw Error("金额需要大于零");
  if (e.kind === "adjustment" && n === 0n) throw Error("余额没有变化");
  if (!Number.isFinite(+new Date(e.occurredAt))) throw Error("时间无效");
  if (e.kind === "transfer") {
    const to = book.accounts.find((a) => a.id === e.toAccountId);
    if (!to || to.id === a.id) throw Error("请选择不同的转入账户");
    if (to.archived && old?.toAccountId !== to.id)
      throw Error("转入账户已归档");
    if (!/^\d+$/.test(e.receivedMinor || "") || BigInt(e.receivedMinor!) <= 0n)
      throw Error("请填写转入金额");
    if (a.currency === to.currency && e.receivedMinor !== e.amountMinor)
      throw Error("同币种转账两边金额需要一致");
    if (e.receivedAt && !Number.isFinite(+new Date(e.receivedAt)))
      throw Error("接收时间无效");
  }
  if (["expense", "income", "refund"].includes(e.kind)) {
    if (!e.splits.length) throw Error("请选择类目");
    if (sum(e.splits.map((s) => s.amountMinor)) !== n)
      throw Error("各类目金额合计需要等于交易总额");
    const inherited =
      e.kind === "refund"
        ? book.entries.find((t) => t.id === refundOriginalId(e))?.splits
        : undefined;
    for (const s of e.splits) {
      const c = book.categories.find((c) => c.id === s.categoryId);
      if (!c || c.kind !== (e.kind === "income" ? "income" : "expense"))
        throw Error("请选择有效类目");
      if (
        c.archived &&
        !old?.splits.some((previous) => previous.categoryId === c.id) &&
        !inherited?.some((previous) => previous.categoryId === c.id)
      )
        throw Error("类目已归档，请选择其他类目");
      if (s.projectId) {
        const project = book.projects.find((p) => p.id === s.projectId);
        if (
          !project ||
          (project.archived &&
            !old?.splits.some(
              (previous) => previous.projectId === s.projectId,
            ) &&
            !inherited?.some((previous) => previous.projectId === s.projectId))
        )
          throw Error("项目不可用于新增交易");
      }
      if (BigInt(s.amountMinor) <= 0n) throw Error("每个类目的金额需要大于零");
    }
  }
  const originalId = refundOriginalId(e);
  if (originalId) {
    const original = book.entries.find((t) => t.id === originalId);
    if (e.kind !== "refund" || original?.kind !== "expense")
      throw Error("退款关联的原记录不存在或类型无效");
  }
}
export function upsertEntry(book: Book, e: Entry) {
  const index = book.entries.findIndex((t) => t.id === e.id),
    old = book.entries[index];
  if (old && old.revision !== e.revision)
    throw Error("这笔交易已在其他页面更新，请重新打开");
  validateEntry(book, e, old);
  if (e.amountCurrency || e.originalAmount || e.estimatedMinor || e.transferId)
    book.schema = 4;
  const saved = {
    ...e,
    description: e.description.trim(),
    updatedAt: new Date().toISOString(),
    revision: (old?.revision || 0) + 1,
  };
  if (index < 0) book.entries.push(saved);
  else book.entries[index] = saved;
}
export function changePosted(book: Book, id: string) {
  const e = book.entries.find((t) => t.id === id && !t.deletedAt);
  if (!e) throw Error("交易不存在");
  if (!e.posted && needsSettlement(book, e))
    throw Error("请先确认实际入账金额");
  e.posted = !e.posted;
  e.revision++;
  e.updatedAt = new Date().toISOString();
}
export function removeEntry(book: Book, id: string, withRefunds = false) {
  const entries = book.entries.filter(
    (e) => e.id === id || (withRefunds && refundOriginalId(e) === id),
  );
  for (const e of entries) {
    e.deletedAt = new Date().toISOString();
    e.revision++;
  }
}
export function restoreEntry(book: Book, id: string) {
  const e = book.entries.find((t) => t.id === id);
  if (e) {
    delete e.deletedAt;
    e.revision++;
  }
}
export function descriptions(book: Book, kind: Kind, query: string) {
  const norm = (s: string) => s.normalize("NFKC").toLocaleLowerCase();
  const q = norm(query.trim()),
    seen = new Set<string>();
  return [...liveEntries(book)]
    .filter((e) => e.kind === kind)
    .sort((a, b) => compareTime(b.updatedAt, a.updatedAt))
    .filter((e) => {
      const k = norm(e.description);
      if (seen.has(k) || !k.includes(q)) return false;
      seen.add(k);
      return true;
    })
    .sort(
      (a, b) =>
        Number(norm(b.description).startsWith(q)) -
        Number(norm(a.description).startsWith(q)),
    )
    .slice(0, 8);
}
export function rateFor(
  book: Book,
  accountId: string,
  at: string,
  seen = new Set<string>(),
): { n: bigint; d: bigint; provisional: boolean } | null {
  const a = book.accounts.find((a) => a.id === accountId);
  if (!a) return null;
  if (a.currency === book.currency) return { n: 1n, d: 1n, provisional: false };
  if (seen.has(accountId)) return null;
  seen.add(accountId);
  const anchors = liveEntries(book)
    .filter(
      (e) =>
        e.posted &&
        e.kind === "transfer" &&
        e.toAccountId === accountId &&
        BigInt(e.receivedMinor || "0") > 0n,
    )
    .sort((a, b) =>
      compareTime(a.receivedAt || a.occurredAt, b.receivedAt || b.occurredAt),
    );
  for (const anchor of [
    ...anchors.filter(
      (e) => compareTime(e.receivedAt || e.occurredAt, at) >= 0,
    ),
    ...anchors.slice(-1),
  ]) {
    const source = rateFor(
      book,
      anchor.accountId,
      anchor.occurredAt,
      new Set(seen),
    );
    if (source)
      return {
        n: BigInt(anchor.amountMinor) * source.n,
        d: BigInt(anchor.receivedMinor!) * source.d,
        provisional:
          compareTime(anchor.receivedAt || anchor.occurredAt, at) < 0 ||
          source.provisional,
      };
  }
  return null;
}
export function netWorth(
  book: Book,
  at: string,
  ids = book.accounts.filter((a) => a.netWorth).map((a) => a.id),
  balances?: ReadonlyMap<string, bigint>,
  getRate = (id: string, at: string) => rateFor(book, id, at),
) {
  let total = 0n,
    provisional = false;
  const missing: { account: Account; amount: bigint }[] = [];
  for (const id of ids) {
    const a = book.accounts.find((a) => a.id === id);
    if (!a) continue;
    const amount = balances?.get(id) ?? balance(book, id, at),
      rate = getRate(id, at);
    if (rate) {
      total += roundedRatio(amount, rate.n, rate.d);
      provisional ||= rate.provisional && amount !== 0n;
    } else if (amount !== 0n) missing.push({ account: a, amount });
  }
  return { total, missing, provisional };
}
export function categoryStats(
  book: Book,
  from: string,
  to: string,
  accountIds: string[],
  categoryIds: string[],
  getRate = (id: string, at: string) => rateFor(book, id, at),
) {
  const selected = new Set(categoryIds);
  const matches = (id: string) =>
    !selected.size ||
    selected.has(id) ||
    selected.has(book.categories.find((c) => c.id === id)?.parentId || "");
  const values = new Map<string, bigint>();
  const rows: {
    entry: Entry;
    amount: bigint;
    native: bigint;
    missing: boolean;
  }[] = [];
  let expense = 0n,
    refund = 0n;
  let missingCount = 0;
  for (const e of liveEntries(book)) {
    if (
      !e.posted ||
      !["expense", "refund"].includes(e.kind) ||
      compareTime(e.occurredAt, from) < 0 ||
      compareTime(e.occurredAt, to) > 0 ||
      !accountIds.includes(e.accountId)
    )
      continue;
    const rate = getRate(e.accountId, e.occurredAt);
    const matching = e.splits.filter((s) => matches(s.categoryId));
    if (!matching.length) continue;
    let matched = 0n,
      native = 0n;
    const converted = rate ? convertedSplits(e, rate.n, rate.d) : [];
    for (const s of matching) {
      native += BigInt(s.amountMinor);
      if (!rate) continue;
      const amount =
        converted[e.splits.indexOf(s)] * (e.kind === "refund" ? -1n : 1n);
      matched += amount;
      values.set(s.categoryId, (values.get(s.categoryId) || 0n) + amount);
      if (e.kind === "refund") refund -= amount;
      else expense += amount;
    }
    if (!rate) missingCount++;
    rows.push({ entry: e, amount: matched, native, missing: !rate });
  }
  return { values, rows, expense, refund, net: expense - refund, missingCount };
}

export function removeEmptyGroup(book: Book, id: string) {
  if (!book.groups.some((group) => group.id === id)) throw Error("分组不存在");
  if (book.accounts.some((account) => account.groupId === id))
    throw Error("请先移出该分组内的账户（包括已归档账户）");
  book.groups = book.groups
    .filter((group) => group.id !== id)
    .sort((a, b) => a.order - b.order)
    .map((group, order) => ({ ...group, order }));
}
