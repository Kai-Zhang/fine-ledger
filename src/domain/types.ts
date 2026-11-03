export type Kind = "expense" | "income" | "transfer" | "refund" | "adjustment";
export type Currency = string;
export interface Group {
  id: string;
  name: string;
  order: number;
}
export interface Account {
  id: string;
  name: string;
  groupId: string;
  currency: Currency;
  type: "bank" | "cash" | "wallet" | "credit" | "investment";
  creditLimitMinor?: string;
  openingMinor: string;
  openingAt: string;
  icon: string;
  order: number;
  archived: boolean;
  netWorth: boolean;
}
export interface Category {
  id: string;
  name: string;
  parentId?: string;
  kind: "expense" | "income";
  icon: string;
  color: string;
  order: number;
  archived: boolean;
}
export interface Project {
  id: string;
  name: string;
  archived: boolean;
}
export interface Split {
  id: string;
  categoryId: string;
  amountMinor: string;
  projectId?: string;
  note?: string;
}
export interface Entry {
  id: string;
  kind: Kind;
  accountId: string;
  toAccountId?: string;
  amountMinor: string;
  // Entered currency may differ from the account only while unposted.
  amountCurrency?: Currency;
  originalAmount?: { currency: Currency; amountMinor: string };
  estimatedMinor?: string;
  transferId?: string;
  receivedMinor?: string;
  description: string;
  occurredAt: string;
  receivedAt?: string;
  posted: boolean;
  splits: Split[];
  originalId?: string;
  refundReference?: {
    source: "moneywiz";
    originalId: string;
    reason: "over-limit" | "cross-currency";
  };
  note?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
  revision: number;
}
export interface Book {
  schema: 3 | 4;
  id: string;
  name: string;
  currency: Currency;
  timeZone: string;
  createdAt: string;
  revision: number;
  groups: Group[];
  accounts: Account[];
  categories: Category[];
  projects: Project[];
  entries: Entry[];
  settings: {
    timeZoneMode?: "system" | "fixed";
    theme: "system" | "light" | "dark";
    savedReports: SavedReport[];
  };
}
export type ReportType =
  | "net"
  | "expense"
  | "income"
  | "project"
  | "expense-trend"
  | "income-trend"
  | "cashflow"
  | "balance";
export type ReportGrain = "day" | "week" | "month" | "quarter" | "year";
export type ReportMetric = "expense" | "net" | "refund";
export interface SavedReport {
  id: string;
  name: string;
  type: ReportType;
  days: string;
  from: string;
  to: string;
  accountIds: string[];
  categoryIds: string[];
  projectIds?: string[];
  grain?: ReportGrain;
  metric?: ReportMetric;
  chart?: "bar" | "line";
}
export interface Change {
  collection: string;
  id: string;
  before?: unknown;
  after?: unknown;
}
export interface Operation {
  id: string;
  bookId: string;
  at: string;
  revision: number;
  action: string;
  changes?: Change[];
}
export const uid = () => crypto.randomUUID();
