import { blankBook } from "./ledger.ts";
import { uid, type Book, type Entry } from "./types.ts";
export function exampleBook(): Book {
  const b = blankBook();
  b.name = "示例账本";
  const now = new Date(),
    ago = (days: number, hour = 12) => {
      const d = new Date(now);
      d.setDate(d.getDate() - days);
      d.setHours(
        days === 0 ? Math.max(0, now.getHours() - 1) : hour,
        days === 0 ? 0 : 24,
        36,
        0,
      );
      return d.toISOString();
    };
  const opening = ago(120);
  b.accounts = [
    {
      id: "bank",
      name: "日常储蓄卡",
      type: "bank",
      groupId: "daily",
      currency: "CNY",
      openingMinor: "4862000",
      openingAt: opening,
      icon: "Landmark",
      order: 0,
      archived: false,
      netWorth: true,
    },
    {
      id: "wallet",
      name: "零钱",
      type: "wallet",
      groupId: "daily",
      currency: "CNY",
      openingMinor: "365820",
      openingAt: opening,
      icon: "Wallet",
      order: 1,
      archived: false,
      netWorth: true,
    },
    {
      id: "card",
      name: "日常信用卡",
      type: "credit",
      groupId: "credit",
      currency: "CNY",
      openingMinor: "-215800",
      openingAt: opening,
      icon: "CreditCard",
      order: 0,
      archived: false,
      netWorth: true,
    },
    {
      id: "jpy",
      name: "日元旅行账户",
      type: "bank",
      groupId: "daily",
      currency: "JPY",
      openingMinor: "0",
      openingAt: opening,
      icon: "Plane",
      order: 2,
      archived: false,
      netWorth: true,
    },
    {
      id: "saving",
      name: "长期储蓄",
      type: "investment",
      groupId: "investment",
      currency: "CNY",
      openingMinor: "12000000",
      openingAt: opening,
      icon: "Sprout",
      order: 0,
      archived: false,
      netWorth: true,
    },
  ];
  b.projects = [{ id: "trip", name: "秋日旅行", archived: false }];
  const add = (
    days: number,
    description: string,
    amount: string,
    category: string,
    account = "card",
    kind: Entry["kind"] = "expense",
  ) => {
    const e: Entry = {
      id: uid(),
      kind,
      accountId: account,
      amountMinor: amount,
      description,
      occurredAt: ago(days),
      createdAt: ago(days),
      updatedAt: ago(days),
      posted: true,
      revision: 1,
      splits: [{ id: uid(), categoryId: category, amountMinor: amount }],
    };
    b.entries.push(e);
    return e;
  };
  for (let i = 0; i < 3; i++) {
    add(i * 30 + 4, "工资", "1800000", "earning-0", "bank", "income");
    add(i * 30 + 2, "日常采购", "32850", "shopping-0", "wallet");
    add(i * 30 + 7, "房租", "420000", "life-0", "bank");
    add(i * 30 + 9, "周末晚餐", "18600", "food-0");
    add(i * 30 + 15, "地铁", "600", "transport-0", "wallet");
    add(i * 30 + 18, "咖啡", "2800", "food-1", "wallet");
  }
  add(0, "午餐", "3800", "food-0", "wallet");
  add(1, "咖啡", "2600", "food-1", "wallet");
  add(2, "书店与咖啡", "12600", "leisure-2").splits = [
    { id: uid(), categoryId: "leisure-2", amountMinor: "9800" },
    { id: uid(), categoryId: "food-1", amountMinor: "2800" },
  ];
  const purchase = add(3, "日用品", "12900", "shopping-0");
  const refund = add(1, "日用品退款", "2900", "shopping-0", "card", "refund");
  refund.originalId = purchase.id;
  const pending = add(0, "网购待入账", "26800", "shopping-0");
  pending.posted = false;
  for (const days of [60, 5]) {
    const transfer = add(
      days,
      "换入日元",
      "300000",
      "food-0",
      "bank",
      "transfer",
    );
    transfer.toAccountId = "jpy";
    transfer.receivedMinor = days === 60 ? "62000" : "63500";
    transfer.splits = [];
  }
  add(20, "旅行餐食", "1800", "food-0", "jpy").splits[0].projectId = "trip";
  const repayment = add(
    8,
    "信用卡还款",
    "215800",
    "food-0",
    "bank",
    "transfer",
  );
  repayment.toAccountId = "card";
  repayment.receivedMinor = "215800";
  repayment.splits = [];
  return b;
}
