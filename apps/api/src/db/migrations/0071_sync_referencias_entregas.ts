import { sql, type Kysely } from 'kysely';

// D — Las entregas declaradas sin conexión también guardan su correspondencia (referencia local → entrega del servidor), para que sus
// evidencias y soportes puedan citarla. Se amplía el tipo permitido de `sync_entity_refs`; no cambia ningún dato existente.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE sync_entity_refs DROP CONSTRAINT sync_entity_refs_entity_type_check`.execute(db);
  await sql`ALTER TABLE sync_entity_refs ADD CONSTRAINT sync_entity_refs_entity_type_check CHECK (entity_type IN ('PRODUCER', 'PLOT', 'DELIVERY'))`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DELETE FROM sync_entity_refs WHERE entity_type = 'DELIVERY'`.execute(db);
  await sql`ALTER TABLE sync_entity_refs DROP CONSTRAINT sync_entity_refs_entity_type_check`.execute(db);
  await sql`ALTER TABLE sync_entity_refs ADD CONSTRAINT sync_entity_refs_entity_type_check CHECK (entity_type IN ('PRODUCER', 'PLOT'))`.execute(db);
}
