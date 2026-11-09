import { sql, type Kysely } from 'kysely';

// P0-025: índices para la consulta filtrada de la bitácora (misma tabla append-only; sin cambios de datos).
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`CREATE INDEX audit_logs_org_entity_idx ON audit_logs (organization_id, entity_type, entity_id, occurred_at)`.execute(db);
  await sql`CREATE INDEX audit_logs_org_actor_idx ON audit_logs (organization_id, actor_user_id, occurred_at)`.execute(db);
  await sql`CREATE INDEX audit_logs_org_request_idx ON audit_logs (organization_id, request_id) WHERE request_id IS NOT NULL`.execute(db);
  await sql`CREATE INDEX audit_logs_org_time_id_idx ON audit_logs (organization_id, occurred_at DESC, id DESC)`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const i of ['audit_logs_org_entity_idx', 'audit_logs_org_actor_idx', 'audit_logs_org_request_idx', 'audit_logs_org_time_id_idx']) await sql`DROP INDEX ${sql.id(i)}`.execute(db);
}
