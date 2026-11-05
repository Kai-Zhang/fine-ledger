import type { Entry, ReportType, ReportGrain } from "../domain/types.ts";
import type { ServicePage } from "../sync/service.ts";
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
  entryIds?: string[];
  from?: string;
  to?: string;
  categoryIds?: string[];
  report?: ReportType;
};
