import type { Book } from "../domain/types.ts";
import type { Command } from "./protocol.ts";
import type { ConflictItem, VersionedChange } from "./model.ts";
import type { Snapshot } from "./snapshot.ts";
export type SyncPhase =
  | "idle"
  | "syncing"
  | "offline"
  | "auth-required"
  | "unlinked"
  | "conflict"
  | "recovery"
  | "paused"
  | "error";
export type SyncStatus = {
  phase: SyncPhase;
  message?: string;
  lastSuccess?: string;
  retryAt?: number;
};
export type SyncIssue = {
  id: string;
  kind: "conflict" | "rejected" | "recovery" | "migration";
  message: string;
  baseBook: Book;
  remoteBook: Book;
  items: ConflictItem[];
  serverEpoch: string;
  cursor: number;
  versions: Snapshot["versions"];
  at: string;
  localKeys?: string[];
};
export type SyncFlight = {
  command: Command;
  receipt?: {
    operationId: string;
    status: "committed";
    cursor: number;
    changes: VersionedChange[];
  };
};
export type SyncLease = { owner: string; until: number };
export type SyncArchive = {
  at: string;
  reason: string;
  book: Book;
  operations: unknown[];
  baseline: unknown;
};
export const syncKeys = [
  "sync-import-review",
  "sync-flight",
  "sync-issue",
  "sync-status",
  "sync-init",
  "sync-lease",
];
