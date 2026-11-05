import type { ReferenceQuote } from "../domain/reference-rates.ts";
import { createContext, useContext } from "react";
import type { Book } from "../domain/types.ts";
import type { Mode } from "../storage/repository.ts";
import type { LocalSyncView } from "../sync/local-view.ts";
import type { Route } from "../navigation/routes.ts";
export type { Route } from "../navigation/routes.ts";
export interface AppContextValue {
  preview?: boolean;
  frameKey?: number;
  localSync: LocalSyncView;
  currentReferenceQuotes: readonly ReferenceQuote[];
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
