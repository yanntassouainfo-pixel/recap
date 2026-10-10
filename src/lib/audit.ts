import { db, schema } from "./db";
import { newId } from "./ids";

/** Journalise une opération sensible avec l'état avant / après pour comprendre ce qui a changé. */
export function audit(userId: string, entity: string, entityId: string, action: string, before?: unknown, after?: unknown) {
  db.insert(schema.auditLog).values({
    id: newId("log_"), userId, entity, entityId, action,
    before: before === undefined ? null : JSON.stringify(before),
    after: after === undefined ? null : JSON.stringify(after),
    at: new Date().toISOString(),
  }).run();
}
