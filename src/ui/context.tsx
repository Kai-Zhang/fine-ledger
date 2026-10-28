import { createContext, useContext } from "react";
import type { Book, Entry } from "../domain/types.ts";
import type { Mode } from "../storage/repository.ts";
export type Route = {
  page:
    | "accounts"
    | "transactions"
    | "reports"
    | "settings"
    | "account"
    | "detail"
    | "entry"
    | "archive"
    | "categories"
    | "projects"
    | "trash"
    | "sync";
  id?: string;
  kind?: Entry["kind"];
  originalId?: string;
  filter?: "pending";
  accountId?: string;
  accountIds?: string[];
  postedOnly?: boolean;
  reportKind?: "net" | "expense";
  from?: string;
  to?: string;
  categoryIds?: string[];
  report?: "net" | "expense";
};
export interface AppContextValue {
  views: Map<string, unknown>;
  book: Book;
  mode: Mode;
  route: Route;
  go: (r: Route) => void;
  back: () => void;
  save: (action: string, fn: (book: Book) => void) => Promise<boolean>;
  toast: (message: string) => void;
  setDirty: (v: boolean) => void;
  switchMode: (mode: Mode) => void;
  confirm: (options: {
    title: string;
    message: string;
    label?: string;
    danger?: boolean;
  }) => Promise<boolean>;
  open: (node: React.ReactNode) => void;
  close: () => void;
}
export const AppContext = createContext<AppContextValue>(null!);
export const useApp = () => useContext(AppContext);
