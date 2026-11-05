import type { LedgerDB } from "./repository.ts";

// Only called after the complete local book equals an acknowledged baseline.
// Keep a recent window and at least 1,000 revisions; pending IDs always survive.
export const revisionRetention = { days: 30, minimum: 1000 };
export async function pruneConfirmedRevisions(db: LedgerDB, now = Date.now()) {
  if ((await db.state.get("sync-flight")) || (await db.state.get("sync-issue")))
    return;
  const policy = (await db.state.get("revision-retention")) as
    { days: number; minimum: number } | undefined;
  if (policy?.days === 0) return;
  const days =
    policy &&
    Number.isInteger(policy.days) &&
    policy.days >= 1 &&
    policy.days <= 365
      ? policy.days
      : revisionRetention.days;
  const minimum =
    policy &&
    Number.isInteger(policy.minimum) &&
    policy.minimum >= 100 &&
    policy.minimum <= 10000
      ? policy.minimum
      : revisionRetention.minimum;
  const count = await db.revisions.count();
  if (count <= minimum) return;
  const pending = new Set(await db.outbox.toCollection().primaryKeys());
  const cutoff = new Date(now - days * 86400000).toISOString();
  const candidates = await db.revisions
    .orderBy("at")
    .limit(count - minimum)
    .primaryKeys();
  const old = new Set(
    await db.revisions.where("at").below(cutoff).primaryKeys(),
  );
  await db.revisions.bulkDelete(
    candidates.filter((id) => old.has(id) && !pending.has(id)),
  );
}
