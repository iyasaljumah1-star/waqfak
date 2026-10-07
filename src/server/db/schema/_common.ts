import { text, timestamp, uuid } from "drizzle-orm/pg-core";

/** Primary key: random UUID (no sequential leakage of record counts). */
export const id = () => uuid().primaryKey().defaultRandom();

export const createdAt = () => timestamp({ withTimezone: true }).defaultNow().notNull();
export const updatedAt = () =>
  timestamp({ withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date());

/** Standard bookkeeping columns for business tables. */
export const tracking = () => ({
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  createdBy: uuid(),
  updatedBy: uuid(),
});

/** Soft-archive columns: regulated records are archived, never hard-deleted. */
export const archival = () => ({
  archivedAt: timestamp({ withTimezone: true }),
  archiveReason: text(),
});
