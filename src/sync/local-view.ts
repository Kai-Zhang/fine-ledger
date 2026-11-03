import type { Book } from "../domain/types.ts";
import type { LedgerDB, RemoteBaseline } from "../storage/repository.ts";
import type { SyncIssue, SyncStatus } from "./state.ts";

export type LocalSyncState = {
  baseline?: RemoteBaseline;
  status?: SyncStatus;
  issue?: SyncIssue;
  pending: number;
};
export type LocalSyncView = LocalSyncState & { book?: Book };

// App owns this live view for its lifetime. Page and gesture mounts consume the
// same resolved snapshot instead of restarting asynchronous subscriptions.
export function readLocalSyncState(db: LedgerDB): Promise<LocalSyncState> {
  return db.transaction("r", db.state, db.outbox, async () => {
    const [baseline, status, issue, pending] = await Promise.all([
      db.state.get("remote-baseline"),
      db.state.get("sync-status"),
      db.state.get("sync-issue"),
      db.outbox.count(),
    ]);
    return {
      baseline: baseline as RemoteBaseline | undefined,
      status: status as SyncStatus | undefined,
      issue: issue as SyncIssue | undefined,
      pending,
    };
  });
}
