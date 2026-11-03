import type { ServicePage } from "../sync/service.ts";
import { createContext, useContext } from "react";
import type { Book, Entry, ReportType, ReportGrain } from "../domain/types.ts";
import type { Mode } from "../storage/repository.ts";
import type { LocalSyncView } from "../sync/local-view.ts";
export type Route = {
  page:
    | "accounts"
    | "transactions"
    | "reports"
    | "report"
    | "settings"
    | "account"
    | "detail"
    | "entry"
    | "archive"
    | "categories"
    | "projects"
    | "trash"
    | "sync"
    | "local-backup";
  id?: string;
  servicePage?: ServicePage;
  kind?: Entry["kind"];
  originalId?: string;
  savedReportId?: string;
  filter?: "pending";
  accountId?: string;
  accountIds?: string[];
  postedOnly?: boolean;
  reportKind?: "net" | "expense";
  reportKinds?: Entry["kind"][];
  projectIds?: string[];
  reportCurrency?: string;
  reportMeasure?: "income" | "expense" | "refund" | "net" | "surplus";
  grain?: ReportGrain;
  reportDays?: string;
  reportIssue?: "unpriced";
  entryIds?: string[];
  from?: string;
  to?: string;
  categoryIds?: string[];
  report?: ReportType;
};
export interface AppContextValue {
  preview?: boolean;
  frameKey?: number;
  localSync: LocalSyncView;
  views: Map<string, unknown>;
  restored: () => void;
  book: Book;
  mode: Mode;
  route: Route;
  go: (r: Route) => void;
  back: () => void;
  backAfterSave: () => void;
  forward: () => void;
  swipe: (direction: "back" | "forward") => void;
  registerLayer: (close: () => void, dirty?: () => boolean) => () => void;
  leave: (action: () => void, dirty?: boolean) => void;
  save: (action: string, fn: (book: Book) => void) => Promise<boolean>;
  toast: (message: string) => void;
  setDirty: (v: boolean) => void;
  confirm: (options: {
    title: string;
    message: string;
    label?: string;
    danger?: boolean;
    cancelLabel?: string;
  }) => Promise<boolean>;
  open: (node: React.ReactNode) => void;
  close: () => void;
}
export const AppContext = createContext<AppContextValue>(null!);
export const useApp = () => useContext(AppContext);
